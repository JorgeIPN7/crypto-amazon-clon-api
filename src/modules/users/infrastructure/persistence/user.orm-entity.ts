import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Modelo de persistencia. Es deliberadamente distinto de `User` del dominio: aquí viven
 * los decoradores del ORM y la forma de la tabla, y puede evolucionar (índices, columnas
 * desnormalizadas) sin arrastrar al dominio. `UserMapper` traduce entre ambos.
 *
 * Sin `password_hash` desde el ciclo 4: la credencial vive en `auth_credentials`, tabla del
 * bounded context `auth`. El par expand/contract la mudó: `MoveCredentialsToAuthExpand` copió
 * los datos y aflojó el `NOT NULL` —sin eso, un INSERT desde aquí, que ya no nombra la
 * columna, sería rechazado— y `MoveCredentialsToAuthContract` la dejó caer en un despliegue
 * posterior.
 *
 * `createdBy` / `updatedBy` son NULLABLE y sin `DEFAULT`, y eso es lo que hace que
 * `AddAuditActorColumns` sea puramente aditiva: el código viejo, que no nombra las columnas,
 * sigue insertando sin problema. Nada que ver con el par expand/contract de arriba — la regla de
 * `CLAUDE.md` («Destructive migrations») solo aplica a lo que TIRA o RENOMBRA. Un `ADD COLUMN`
 * nullable no rompe a ninguna réplica antigua, ni siquiera con `DB_MIGRATIONS_RUN=true`.
 *
 * **Las cuatro columnas de traza son `@Column`, no `@CreateDateColumn`/`@UpdateDateColumn`.** El
 * reloj lo pone el dominio con el `now` que le inyecta el caso de uso; dejar que lo pusiera
 * TypeORM metería un segundo reloj en el sistema, y por eso tampoco llevan `DEFAULT now()`.
 *
 * No es simetría con `orders`: es que los decoradores tienen un modo de fallo concreto. Con
 * `@UpdateDateColumn`, un `repository.update({...})` parcial hace que TypeORM añada por su cuenta
 * `updated_at = CURRENT_TIMESTAMP` (`UpdateQueryBuilder`), y `updated_by` se quedaría con el actor
 * anterior — una fila afirmando que quien la escribió por última vez es alguien que no la
 * escribió. Hoy no hay ningún `.update()` parcial en `src/` y todos los mutadores pasan por
 * `touch()`, así que era inalcanzable; se unificó antes de que dejara de serlo.
 *
 * **Ninguna lleva ya `name` explícito, y sin embargo todas son snake_case.** Lo pone
 * `SnakeNamingStrategy`, registrada en `buildTypeOrmOptions` desde el 2026-08-25. Hasta entonces
 * cada columna dependía de que quien la escribiera se acordara del `name:`, y en cuatro casos no
 * se acordó: el esquema mezclaba las dos convenciones y `auth_credentials` llegaba a mezclarlas
 * dentro de la MISMA tabla (`user_id` y `password_hash` en snake junto a `"createdAt"` en camel).
 * Los 20 `name:` que quedaban se quitaron al registrar la estrategia, comprobando antes y después
 * que `migration:generate` responde «No changes in database schema were found».
 *
 * Se unificó todo a snake_case reescribiendo las migraciones, algo que solo era barato porque no
 * había datos ni despliegue — el mismo argumento con el que se colapsó el expand/contract de
 * `orders`. ⚠️ Con datos, cada columna habría necesitado su propia pareja expand/contract.
 *
 * `varchar` sin `length` y no `uuid`: el actor es un `string | null` en el dominio (ver
 * `AuditTrail`), y una columna `uuid` obligaría a que toda cuenta de servicio futura tuviera
 * forma de UUID. La columna es más permisiva que el dato, que es el lado seguro del error.
 */
@Entity({ name: 'users' })
export class UserOrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Index('idx_users_email', { unique: true })
  @Column({ type: 'varchar', length: 254 })
  email!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 16, default: 'user' })
  role!: string;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'varchar', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'varchar', nullable: true })
  updatedBy!: string | null;
}
