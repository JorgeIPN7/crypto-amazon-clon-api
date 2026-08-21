import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsersTable1785165436853 implements MigrationInterface {
  name = 'CreateUsersTable1785165436853';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL,
        "email" character varying(254) NOT NULL,
        "name" character varying(120) NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_users" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_users_email" ON "users" ("email")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Sin cualificar el schema, igual que el `up()`: así ambos heredan el `search_path`
    // de la conexión, que sale de `DB_SCHEMA`. Fijar "public" aquí hacía que con
    // `DB_SCHEMA=app` la migración se aplicara pero no se pudiera revertir.
    await queryRunner.query(`DROP INDEX "idx_users_email"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
