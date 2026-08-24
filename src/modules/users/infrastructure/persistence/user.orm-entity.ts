import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

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
 * **Se llaman `"createdBy"`/`"updatedBy"` (camelCase entrecomillado) y no `created_by`** porque
 * en ESTA tabla las columnas hermanas son `"createdAt"`/`"updatedAt"`: no hay NamingStrategy y
 * TypeORM usa el nombre de propiedad tal cual. Poner `created_by` junto a `"createdAt"` metería
 * dos convenciones en la misma fila. `orders` hace lo contrario por el mismo motivo: allí las
 * hermanas son `created_at`/`updated_at`.
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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'varchar', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'varchar', nullable: true })
  updatedBy!: string | null;
}
