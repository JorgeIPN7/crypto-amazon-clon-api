import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuthColumnsToUsers1785937334332 implements MigrationInterface {
  name = 'AddAuthColumnsToUsers1785937334332';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Sin `DEFAULT`, a propósito: un hash falso violaría el VO en cuanto la fila se
    // reconstituyera (`PasswordHash.from()` exige el prefijo `$argon2id$`). Sobre una tabla
    // con filas, este `ALTER` falla por el `NOT NULL` sin default — el patrón honesto para
    // una plantilla es `pnpm db:reset` (datos de desarrollo, no de producción) y reaplicar.
    await queryRunner.query(`
      ALTER TABLE "users" ADD "password_hash" character varying(255) NOT NULL
    `);

    // `role` sí lleva default: todo usuario existente se convierte en `'user'`, que es
    // también el valor que produce `User.create()` — no hay ascenso implícito a admin.
    await queryRunner.query(`
      ALTER TABLE "users" ADD "role" character varying(16) NOT NULL DEFAULT 'user'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "role"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "password_hash"`);
  }
}
