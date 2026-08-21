import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Modelo de persistencia, deliberadamente distinto del agregado `Order` — dos modelos,
 * un mapper (convención del repo). Sin `CreateDateColumn`: `placed_at` lo sella el
 * dominio en `Order.place()`, no la base. Sin `updatedAt`: la orden mínima es inmutable.
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
}
