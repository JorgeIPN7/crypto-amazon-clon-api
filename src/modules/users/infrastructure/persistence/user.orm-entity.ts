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
}
