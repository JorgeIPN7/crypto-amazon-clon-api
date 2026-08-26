import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Outbox PROPIO del contexto (spec §6): cada módulo es dueño del suyo, por eso la tabla se
 * llama `orders_outbox` y la entidad vive aquí y no en un genérico compartido. Sin FK a
 * `orders` a propósito: la fila es autosuficiente (el payload lleva todo) y el relay no
 * necesita join. El glob `*.orm-entity.ts` la descubre sin lista central.
 */
@Entity({ name: 'orders_outbox' })
export class OutboxMessageOrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'varchar', length: 120 })
  eventType!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ type: 'timestamptz' })
  occurredAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  processedAt!: Date | null;
}
