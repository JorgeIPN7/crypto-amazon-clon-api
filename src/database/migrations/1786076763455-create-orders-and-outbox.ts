import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Crea las dos tablas del contexto `orders`: el agregado y su outbox transaccional.
 *
 * **`orders` tiene TRES instantes y no son lo mismo, aunque hoy siempre coincidan.**
 * `placed_at` es el HECHO DE NEGOCIO —lo sella el dominio en `Order.place()` y viaja en
 * `OrderPlaced` y en el contrato publicado de `POST /orders`—; `created_at` y `updated_at` son
 * las marcas de fila que `Entity` da a todo agregado. Coinciden porque la orden mínima es
 * inmutable; el día que tenga transiciones, `updated_at` se separará y `placed_at` no.
 *
 * Los tres son columnas normales y NO `CreateDateColumn` / `UpdateDateColumn`: el reloj lo pone
 * el dominio con el `now` que le inyecta el caso de uso, no la base. Dejar que la base los
 * escribiera metería un segundo reloj en el sistema — y por eso tampoco llevan `DEFAULT now()`.
 *
 * Que las tres nazcan `NOT NULL` aquí es legal precisamente porque nacen CON la tabla: no
 * existe versión desplegada del código que inserte en `orders` sin nombrarlas, que es la
 * condición que pide «Destructive migrations: expand/contract» en `CLAUDE.md`. Añadirlas
 * después a una tabla viva habría sido otra historia: un `NOT NULL` sin `DEFAULT` sobre una
 * tabla que el código viejo ya inserta es un paso destructivo disfrazado.
 *
 * ---
 *
 * ⚠️ **Esta migración se REESCRIBIÓ el 2026-08-22, después de haber sido aplicada.**
 * `created_at` y `updated_at` llegaron primero en una pareja expand/contract aparte
 * (`AddTimestampsToOrders…`), que se colapsó aquí al comprobar que el proyecto no tenía datos
 * reales ni despliegue. Es la operación espejo del split retroactivo del backlog #12, y fue
 * igual de gratis por el mismo motivo: nunca se había desplegado en ningún sitio.
 *
 * **Consecuencia para quien traiga esta rama con una base ya migrada:** TypeORM registra las
 * migraciones POR NOMBRE, y el nombre no cambió. `pnpm migration:run` responderá «No migrations
 * are pending» y dejará una tabla `orders` **sin** `created_at` / `updated_at`, mientras
 * `OrderOrmEntity` las exige `NOT NULL` — todo `POST /orders` reventaría. **Hay que correr
 * `pnpm db:reset`**, que tira el volumen y reconstruye ambas bases desde cero. Medido: sin él,
 * `migration:run` no detecta nada que hacer.
 */
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
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL,
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
