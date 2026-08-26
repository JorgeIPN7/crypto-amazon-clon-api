import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Da a `users` borrado LÓGICO: una columna `deleted_at` nullable y un índice único de email que
 * **ignora las filas borradas**.
 *
 * Solo `users`. `auth_credentials` y `orders` no la llevan porque no la necesitan: el único
 * borrado físico del repo es `UsersProvisioning.deleteProfile`, la compensación de un alta cuya
 * credencial no pudo escribirse. El criterio de por qué el soft delete es opt-in y no una
 * columna de la base común está en `shared/domain/soft-deletable-entity.base.ts`.
 *
 * ## El índice parcial NO es un adorno: sin él, la compensación deja de funcionar
 *
 * Con el índice único de siempre —`UNIQUE (email)`, sobre todas las filas—, un perfil marcado
 * como borrado seguiría ocupando su email. La compensación existe precisamente para que el
 * dueño de ese email pueda reintentar el alta, así que un soft delete con el índice viejo
 * cambiaría el 201 del reintento por un 409 y rompería la garantía que el borrado servía.
 *
 * `WHERE deleted_at IS NULL` la conserva: dos filas borradas pueden compartir email, y una
 * borrada no bloquea a una viva. Lo cubre el caso «debería dejar el email libre para un alta
 * posterior» de `auth.e2e-spec.ts`, que ya existía y ahora ejercita también esto.
 *
 * ## Aditiva, con una salvedad que sí hay que mirar
 *
 * La COLUMNA es aditiva sin discusión: nullable, sin `DEFAULT`, así que el código viejo —que no
 * la nombra en sus `INSERT`— sigue insertando (mismo razonamiento, con la misma medición, que
 * `AddAuditActorColumns`).
 *
 * El ÍNDICE es donde hay que pensar, porque se reemplaza y no se añade. Es seguro en rodado, y
 * el motivo es que el índice nuevo es **más permisivo** que el viejo sobre las filas que existen
 * durante la ventana: mientras haya réplicas antiguas, ninguna escribe `deleted_at`, así que
 * TODAS las filas tienen `deleted_at IS NULL` y el índice parcial las cubre exactamente igual
 * que el total. Las réplicas viejas no pueden violar una unicidad que sigue aplicándose a sus
 * filas, y las nuevas no pueden crear un duplicado que la vieja rechazaría.
 *
 * ⚠️ El `DROP INDEX` y el `CREATE UNIQUE INDEX` van en ese orden y sin `CONCURRENTLY`: TypeORM
 * envuelve cada migración en una transacción, y `CONCURRENTLY` no puede correr dentro de una.
 * Sobre una tabla grande eso significa un bloqueo de escritura durante la reconstrucción del
 * índice. Con el tamaño de hoy es instantáneo; con millones de filas, esta migración se saca de
 * la transacción o se hace a mano fuera de la release.
 *
 * ## Reversible de verdad
 *
 * `down()` restaura el índice total ANTES de tirar la columna, y ese orden importa: si primero
 * cayera la columna, el índice parcial referenciaría algo inexistente. ⚠️ El `CREATE UNIQUE
 * INDEX` total puede FALLAR si en ese momento existen dos filas con el mismo email —una viva y
 * otra borrada—, que es un estado legal bajo el índice parcial. No se fuerza ni se descartan
 * filas en silencio: el error de PostgreSQL nombra el email duplicado, y quién sobrevive es una
 * decisión de negocio que una migración no puede tomar sola.
 */
export class AddSoftDeleteToUsers1787800000000 implements MigrationInterface {
  name = 'AddSoftDeleteToUsers1787800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`DROP INDEX "idx_users_email"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_users_email" ON "users" ("email") WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_users_email"`);
    await queryRunner.query(`CREATE UNIQUE INDEX "idx_users_email" ON "users" ("email")`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "deleted_at"`);
  }
}
