import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Modelo de persistencia del libro de transferencias. Las mismas cuatro reglas que
 * `wallet.orm-entity.ts` —`@Entity({ name })` obligatorio, cero `name:` en las columnas, cero
 * fechas automáticas del ORM, actores nullables— y ahí vive el razonamiento largo de cada una.
 * Medido con `toSnakeCase('WalletTransferOrmEntity')` en Node: sin el `name` la tabla se llamaría
 * `wallet_transfer_orm_entity`.
 *
 * ⚠️ **Declara la tabla, no la crea**, y el guardián que ata las dos piezas está nombrado y medido
 * en `wallet.orm-entity.ts`: `migrations.e2e-spec.ts` compara las tablas que crean las migraciones
 * contra las ORM entities que el glob registra.
 *
 * ⚠️ **`fromAddress`, no `from`.** `FROM` es palabra reservada de SQL: una columna llamada así
 * obligaría a citarla con comillas dobles en cada consulta cruda —y este repo escribe SQL crudo en
 * las migraciones, en los E2E de repositorio y en los guardianes de esquema—, donde olvidar las
 * comillas no da un error de columna sino un error de sintaxis a diez líneas de distancia. El
 * snapshot del dominio la llama `from`; cruzar los dos nombres es trabajo de
 * `wallet-transfer.mapper.ts`.
 *
 * **La dirección emisora se GUARDA, y no se deriva de la wallet actual.** Es estado del hecho, no
 * de la cuenta: el día que una wallet cambie de dirección —rotación de la master, migración de
 * índice—, el libro tiene que seguir diciendo desde dónde salió CADA envío. Derivarla al leer
 * reescribiría el pasado.
 *
 * **El activo viaja DESPLEGADO en cuatro columnas y no en un `jsonb`.** `TransferAsset` hace
 * imposibles las combinaciones excluyentes en TypeScript, pero eso no llega al esquema: lo que la
 * tabla guarda es lo que `WalletTransfer.toSnapshot()` ya desplegó. Un `jsonb` habría ahorrado tres
 * columnas a cambio de no poder consultar ni indexar por clase de activo.
 *
 * **Las tres columnas del activo son nullables por construcción, no por comodidad:** el nativo no
 * lleva contrato, el NFT no lleva importe, y ni el nativo ni el fungible llevan `tokenId`. La
 * exclusión mutua NO se declara aquí con un `CHECK`: la garantía real la da `TransferAsset`, que es
 * el único camino de escritura, y un `CHECK` de cuatro ramas duplicaría esa regla en un sitio donde
 * nadie la lee al cambiarla.
 *
 * **`txId` y `reasonCode` nacen nulos porque la fila se escribe ANTES de llamar al proveedor.** Es
 * lo que convierte el libro en algo útil: con la escritura posterior, un timeout no dejaría rastro
 * — que es justo el caso para el que existe. Si estas dos fueran `NOT NULL`, la escritura por
 * delante sería imposible y el libro solo registraría lo que ya sabemos que salió bien.
 *
 * ⚠️ **`reason_code` guarda un código de `PROVIDER_FAILURE_REASONS`, JAMÁS el `message` del
 * proveedor.** El motivo está medido y escrito en `wallet-transfer.entity.ts`: el mensaje del 401
 * de Tatum interpola la clave de API, y esta columna se publica por HTTP. El nombre de la columna
 * lo dice y el `varchar(40)` lo acota — el código más largo de la lista es
 * `'malformed-response'`, 18 caracteres, medido sobre `PROVIDER_FAILURE_REASONS` (diez elementos
 * desde el 2026-09-02; el nuevo, `'chain-reverted'`, mide 14 y no mueve esa cota).
 *
 * ⚠️ **El tipo NO cierra esta columna al releer.** `WalletTransfer.rehydrate` acepta cualquier
 * cadena que el mapper le pase con un `as`, cosa que su propio JSDoc mide y nombra. Quien puede
 * cerrarlo es el esquema, con un
 * `CHECK ("reason_code" IS NULL OR "reason_code" IN (…los diez de la lista…))` en la migración de
 * esta tabla. ⚠️ Eran nueve hasta el 2026-09-02: `chain-reverted` los hizo diez y la columna siguió
 * aceptando cualquier cosa, que es la deuda intacta. El `varchar(40)` sigue holgado — el código más
 * largo sigue siendo `'malformed-response'`, 18 caracteres, y el nuevo mide 14.
 *
 * **Por qué ese `CHECK` no se declara aquí, dicho como lo que es: una decisión, no un
 * impedimento.** Nada impide que este archivo importe `PROVIDER_FAILURE_REASONS` —la regla de
 * dependencias corre de fuera hacia dentro, así que `infrastructure/` puede leer `domain/`—; lo que
 * manda es el contrato congelado §8, que para `wallet_transfers` declara la clave primaria y el
 * índice compuesto y ningún `CHECK`. La decisión queda escrita aquí para que llegue a quien escriba
 * la migración, que es donde el contrato sí lo pondría.
 *
 * `amount` es `varchar(79)` y `tokenId` `varchar(78)`: son exactamente las cotas que `TokenAmount`
 * y `TokenId` validan (`MAX_LENGTH` y `MAX_DIGITS` de sus archivos). Van como TEXTO y no como
 * número porque un token de 18 decimales no pasa por un flotante, y `numeric` obligaría a decidir
 * precisión y escala para un valor cuya canonicidad ya garantiza el value object como string.
 * `varchar(16)` cubre el literal más largo de `TRANSFER_STATUSES` (`'submitting'`, 10) y el de
 * `TRANSFER_ASSET_KINDS` (`'multi-token'`, 11), los dos medidos sobre sus listas.
 *
 * El índice compuesto **no es único**: un dueño tiene muchas transferencias, y marcarlo único
 * rompería el segundo envío de cualquier usuario. El orden de las columnas es el del listado
 * paginado —filtrar por dueño, ordenar por fecha—, no al revés. No lleva `DESC` aunque el listado
 * ordene descendente: TypeORM no modela el sentido en la metadata de `@Index`, así que un `DESC`
 * que solo existiera en el SQL de la migración sería una divergencia entre entidad y esquema. No he
 * medido si aporta algo al plan de PostgreSQL; lo que sí es seguro es que un btree se recorre en
 * los dos sentidos.
 */
@Entity({ name: 'wallet_transfers' })
@Index('idx_wallet_transfers_owner_id_created_at', ['ownerId', 'createdAt'])
export class WalletTransferOrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'uuid' })
  ownerId!: string;

  @Column({ type: 'varchar', length: 42 })
  fromAddress!: string;

  @Column({ type: 'varchar', length: 42 })
  recipient!: string;

  @Column({ type: 'varchar', length: 16 })
  assetKind!: string;

  @Column({ type: 'varchar', length: 42, nullable: true })
  tokenAddress!: string | null;

  @Column({ type: 'varchar', length: 79, nullable: true })
  amount!: string | null;

  @Column({ type: 'varchar', length: 78, nullable: true })
  tokenId!: string | null;

  @Column({ type: 'varchar', length: 16 })
  status!: string;

  @Column({ type: 'varchar', length: 66, nullable: true })
  txId!: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  reasonCode!: string | null;

  @Column({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'varchar', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'varchar', nullable: true })
  updatedBy!: string | null;
}
