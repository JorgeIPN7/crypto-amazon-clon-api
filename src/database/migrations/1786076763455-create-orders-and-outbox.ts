import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrdersAndOutbox1786076763455 implements MigrationInterface {
  name = 'CreateOrdersAndOutbox1786076763455';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "orders" (
        "id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "concept" character varying(140) NOT NULL,
        "amount_cents" integer NOT NULL,
        "placed_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "pk_orders" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "orders_outbox" (
        "id" uuid NOT NULL,
        "event_type" character varying(120) NOT NULL,
        "payload" jsonb NOT NULL,
        "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "processed_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "pk_orders_outbox" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Sin cualificar el schema, como todas las migraciones del repo: ambos sentidos
    // heredan el `search_path` de la conexión (lección de `create-users-table`).
    await queryRunner.query(`DROP TABLE "orders_outbox"`);
    await queryRunner.query(`DROP TABLE "orders"`);
  }
}
