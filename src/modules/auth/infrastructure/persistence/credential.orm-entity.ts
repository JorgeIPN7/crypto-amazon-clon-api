import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Modelo de persistencia de la credencial. Tabla PROPIA de `auth` (`auth_credentials`): el
 * hash dejó de ser una columna de `users` en este ciclo, porque el dato es de quien lo usa.
 *
 * El índice sobre `user_id` es ÚNICO y no hay un segundo índice plano al lado: un índice
 * único ya es un índice, y `user_id` es la clave de acceso del login (`findByUserId`).
 * Añadir uno no-único encima solo pagaría escrituras sin acelerar ninguna lectura.
 *
 * Las cuatro columnas de traza son `@Column`, nunca `@CreateDateColumn`/`@UpdateDateColumn`, por
 * el mismo motivo que en `user.orm-entity.ts` —donde vive el razonamiento completo—: el reloj lo
 * pone el dominio, y `@UpdateDateColumn` movería `updated_at` en un `update()` parcial dejando
 * `updated_by` desincronizado.
 *
 * Llevan `name` explícito en snake_case, como el resto de la tabla.
 * Hasta el 2026-08-24 esta era la peor mezcla del esquema: `user_id` y `password_hash` en snake
 * conviviendo con `"createdAt"` y `"updatedAt"` en camel, dentro de la MISMA tabla. Venía de que
 * las marcas de tiempo se heredaron de `users` al mudar aquí el hash, mientras que las otras dos
 * se escribieron nuevas. Se unificó reescribiendo las migraciones, barato solo porque no había
 * datos ni despliegue.
 *
 * `createdBy` / `updatedBy` son NULLABLE y sin `DEFAULT`: por eso `AddAuditActorColumns` es
 * aditiva y no necesita expand/contract. Hoy solo pueden valer `null` en el alta pública; ver la
 * cabecera de `Credential`, que no tiene ninguna transición todavía.
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

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'created_by', type: 'varchar', nullable: true })
  createdBy!: string | null;

  @Column({ name: 'updated_by', type: 'varchar', nullable: true })
  updatedBy!: string | null;
}
