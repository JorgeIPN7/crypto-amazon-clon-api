import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Modelo de persistencia de la credencial. Tabla PROPIA de `auth` (`auth_credentials`): el
 * hash dejó de ser una columna de `users` en este ciclo, porque el dato es de quien lo usa.
 *
 * El índice sobre `user_id` es ÚNICO y no hay un segundo índice plano al lado: un índice
 * único ya es un índice, y `user_id` es la clave de acceso del login (`findByUserId`).
 * Añadir uno no-único encima solo pagaría escrituras sin acelerar ninguna lectura.
 *
 * `createdBy` / `updatedBy`: camelCase entrecomillado como sus hermanas `"createdAt"` /
 * `"updatedAt"` —esta tabla mezcla ya las dos convenciones (`user_id` y `password_hash` son
 * snake por `name:` explícito), así que la referencia correcta son las columnas de traza, no la
 * tabla entera—. NULLABLE y sin `DEFAULT`: por eso `AddAuditActorColumns` es aditiva y no
 * necesita expand/contract. Hoy solo pueden valer `null` en el alta pública; ver la cabecera de
 * `Credential`, que no tiene ninguna transición todavía.
 */
@Entity({ name: 'auth_credentials' })
export class CredentialOrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Index('idx_auth_credentials_user_id', { unique: true })
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'varchar', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'varchar', nullable: true })
  updatedBy!: string | null;
}
