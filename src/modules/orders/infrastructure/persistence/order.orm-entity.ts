import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Modelo de persistencia, deliberadamente distinto del agregado `Order` — dos modelos, un
 * mapper (convención del repo).
 *
 * `placed_at`, `created_at` y `updated_at` conviven y NO son lo mismo, aunque hoy siempre
 * coincidan: `placed_at` es el HECHO DE NEGOCIO —lo sella el dominio en `Order.place()` y viaja
 * en `OrderPlaced` y en el contrato publicado— mientras que los otros dos son las marcas de fila
 * que `Entity` da a todos los agregados. Coinciden porque la orden mínima es inmutable; el día
 * que tenga transiciones, `updated_at` se separará y `placed_at` no.
 *
 * Ninguno es `CreateDateColumn`/`UpdateDateColumn`: los tres instantes los decide el dominio con
 * el `now` que le inyecta el caso de uso, no la base de datos. Dejar que la base los escribiera
 * metería un segundo reloj en el sistema.
 *
 * Las tres columnas son NO nulas, igual que en `CreateOrdersAndOutbox`, que es la migración que
 * crea la tabla ya con ellas. No hay ventana que tolerar: no existe ni existió una versión
 * desplegada que insertara en `orders` sin nombrarlas, así que el mapper puede confiar en el
 * `Date` y no necesita fallback.
 *
 * `created_by` / `updated_by` son la excepción y por eso SÍ son nullables: llegan con
 * `AddAuditActorColumns` a una tabla que ya existe. Snake_case, a diferencia de `users` y
 * `auth_credentials`, porque aquí las columnas hermanas son `created_at` / `updated_at` — la
 * convención se hereda de la tabla, no del repo, que no tiene una sola.
 */
@Entity({ name: 'orders' })
export class OrderOrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ type: 'varchar', length: 140 })
  concept!: string;

  @Column({ name: 'amount_cents', type: 'int' })
  amountCents!: number;

  @Column({ name: 'placed_at', type: 'timestamptz' })
  placedAt!: Date;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'created_by', type: 'varchar', nullable: true })
  createdBy!: string | null;

  @Column({ name: 'updated_by', type: 'varchar', nullable: true })
  updatedBy!: string | null;
}
