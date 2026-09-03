import { Check, Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Modelo de persistencia de la dirección custodiada. Deliberadamente distinto de `Wallet` —dos
 * modelos, un mapper—: aquí viven los decoradores del ORM y la forma de la tabla, y `WalletMapper`
 * es el único puente.
 *
 * **`@Entity({ name })` es obligatorio.** Sin él, `SnakeNamingStrategy` derivaría el nombre de la
 * tabla del nombre de la CLASE, y `WalletOrmEntity` daría `wallet_orm_entity`: la estrategia no
 * puede saber que `OrmEntity` es decoración nuestra, y su propia cabecera
 * (`src/database/snake-naming.strategy.ts`) lo dice. Medido con `toSnakeCase('WalletOrmEntity')`
 * en Node, que devuelve `wallet_orm_entity`; lo fija además un caso del spec de este archivo.
 *
 * **Ninguna columna lleva `name:`, y todas nacen en snake_case.** Lo pone esa misma estrategia,
 * registrada en `buildTypeOrmOptions` —el único sitio que comparten la CLI de TypeORM y el runtime
 * de Nest—. Escribirlo a mano era la puerta por la que el esquema acabó mezclando las dos
 * convenciones hasta el 2026-08-24; el episodio está contado en `user.orm-entity.ts`.
 *
 * ⚠️ **Por eso la propiedad se llama `userId` y no `ownerId`: la columna es `user_id`.** Sin
 * `name:` disponible, el nombre de la propiedad ES el nombre de la columna una vez pasada la
 * estrategia, así que `ownerId` daría `owner_id`. El agregado sigue llamando `ownerId` al dueño;
 * cruzar los dos vocabularios es trabajo de `wallet.mapper.ts`, el único archivo del módulo que
 * conoce los dos lados a la vez.
 *
 * **Ninguna columna es `@CreateDateColumn`/`@UpdateDateColumn`.** El instante lo pone el dominio
 * con el `now` que le inyecta el caso de uso; dejarlo a la base metería un segundo reloj en el
 * sistema. El modo de fallo concreto —con `@UpdateDateColumn`, un `repository.update()` parcial
 * hace que TypeORM añada por su cuenta `updated_at = CURRENT_TIMESTAMP` mientras `updated_by` se
 * queda con el actor anterior, o sea una fila afirmando que quien la escribió por última vez es
 * alguien que no la escribió— está razonado y medido en `user.orm-entity.ts`, que es donde vive ese
 * análisis. Ninguna ORM entity del árbol usa esos dos decoradores: verificado con un `grep -rn` de
 * `CreateDateColumn` y `UpdateDateColumn` sobre los archivos `orm-entity` de `src/modules`, que
 * solo devuelve comentarios como este. (El comando no se escribe literal porque su glob lleva un
 * `*` seguido de `/` y cerraría este bloque de comentario — medido: `tsc` sacó dos `TS2304` y
 * `eslint` dos errores más antes de reescribirlo así.)
 *
 * **`created_by` / `updated_by` son NULLABLES, y aquí el motivo NO es el de `orders`.** Allí lo
 * eran porque `AddAuditActorColumns` las añadía a una tabla viva y un `NOT NULL` sin `DEFAULT`
 * habría roto los INSERT del código anterior. Esta tabla nace entera en su migración, así que ese
 * argumento no aplica: son nullables porque `AuditTrail` las tipa `string | null`
 * (`shared/domain/entity.base.ts`) y `null` significa «no se sabe quién». Hoy el alta siempre trae
 * un actor —sale del `sub` del token—, así que la columna no vería NULL por ese camino; ponerla
 * `NOT NULL` la haría mentir el día que escriba un proceso. La columna es más permisiva que el
 * dato, que es el lado seguro del error.
 *
 * **Los tres índices son ÚNICOS y sus NOMBRES son parte del contrato.** No son cosméticos:
 * `wallet.typeorm.repository.ts` distingue los tres `23505` mirando `driverError.constraint`, que
 * vale exactamente estas cadenas, y las tres violaciones significan cosas distintas — la de
 * `user_id` es una carrera normal entre dos altas que el caso de uso absorbe releyendo, y las
 * otras dos son invariantes rotas que deben ser 500 ruidosos. **Renombrar un índice aquí obliga a
 * renombrarlo también allí**, o los tres desenlaces colapsan en un 500 anónimo. Un caso del spec
 * de este archivo fija las tres cadenas, porque ningún guardián de esquema mira el nombre de un
 * índice.
 *
 * **El `CHECK` no es simetría con el dominio.** `Wallet.assign()` ya rechaza que la dirección
 * entregada sea la master, pero esa comprobación solo ve las escrituras que pasan por el agregado.
 * Este `CHECK` vive en el motor y es el único control que ve además una escritura por SQL crudo
 * —un seed, una consola, otra migración—. Qué se rompe sin él: esa escritura le entrega a un
 * usuario el fondo de gas de la plataforma, y al siguiente usuario también, en silencio.
 *
 * ⚠️ **Esta clase DECLARA la tabla; no la crea.** Quien la materializa en PostgreSQL —columnas,
 * índices y `CHECK`— es `src/database/migrations/…-create-wallets.ts`. Y las dos piezas están
 * atadas por un guardián: el caso «debería aplicarse entero y crear una tabla por cada ORM entity
 * registrada» de `src/database/__tests__/migrations.e2e-spec.ts` deriva las tablas esperadas de
 * `dataSource.entityMetadatas` —o sea del glob `*.orm-entity.ts`— y las compara con las que crean
 * las migraciones, así que **una ORM entity sin su migración pone esa suite en rojo**. Medido antes
 * de que la migración existiera, sacando esta clase y su hermana del árbol: toda la suite en verde;
 * con las dos dentro caía ese caso, y solo ese.
 *
 * ⚠️ La cifra que había aquí —«5 de 5 verdes»— se quitó el 2026-08-31 al pasar esa suite a nueve
 * casos: era cierta y el solo hecho de añadir casos la habría vuelto falsa sin poner nada rojo. Los
 * cuatro nuevos (`CreateWallets`) no participan de esta atadura, porque ninguno lee
 * `entityMetadatas`.
 *
 * `varchar(42)` = `0x` + 40 hexadecimales; `varchar(66)` = `0x` + 64. Son exactamente las
 * longitudes que `EthereumAddress` y `TransactionHash` ya garantizan con sus expresiones
 * regulares: la columna no valida, acota. `varchar(16)` para el estado deja sitio de sobra para el
 * literal más largo de `WALLET_STATUSES` — `'receive-only'`, 12 caracteres, medido sobre la lista.
 */
@Entity({ name: 'wallets' })
@Check('ck_wallets_address_not_master', '"address" <> "owner_address"')
export class WalletOrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Index('idx_wallets_user_id', { unique: true })
  @Column({ type: 'uuid' })
  userId!: string;

  /**
   * La master bajo la que se derivó `address`. Va en la fila y no solo en la configuración por dos
   * motivos que se pierden si se quita: sin ella el `CHECK` no tendría con qué comparar, y
   * `Wallet.assertOwnedBy()` no podría saber que una rotación de la master dejó esta dirección
   * fuera de nuestro control.
   */
  @Column({ type: 'varchar', length: 42 })
  ownerAddress!: string;

  @Index('idx_wallets_address_index', { unique: true })
  @Column({ type: 'int' })
  addressIndex!: number;

  @Index('idx_wallets_address', { unique: true })
  @Column({ type: 'varchar', length: 42 })
  address!: string;

  @Column({ type: 'varchar', length: 16 })
  status!: string;

  @Column({ type: 'varchar', length: 66, nullable: true })
  activationTxId!: string | null;

  @Column({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz' })
  updatedAt!: Date;

  /**
   * `varchar` sin `length` y no `uuid`, igual que en `user.orm-entity.ts` y por el mismo motivo: el
   * actor es un `string | null` en el dominio, y una columna `uuid` obligaría a que toda cuenta de
   * servicio futura tuviera forma de UUID — `SYSTEM_ACTORS` (`shared/domain/system-actor.ts`) ya
   * usa un prefijo `system:` que no la tiene.
   */
  @Column({ type: 'varchar', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'varchar', nullable: true })
  updatedBy!: string | null;
}
