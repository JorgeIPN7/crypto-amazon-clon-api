import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CONTRACT del par expand/contract que muda la credencial de `users` al bounded context `auth`
 * (ciclo 4 del refactor). Su gemela es `MoveCredentialsToAuthExpand`, que crea
 * `auth_credentials`, copia los hashes y afloja el `NOT NULL`; ver «Migraciones destructivas:
 * expand/contract» en `CLAUDE.md` y la entrada #12 del backlog.
 *
 * Una sola sentencia, y esa sentencia es la destructiva. Está sola precisamente para que
 * quien despliega pueda decidir CUÁNDO corre, que es la única decisión que el patrón no puede
 * tomar por él: no debe correr hasta que no quede ninguna réplica de la versión anterior. El
 * `UserOrmEntity` de esa versión mapea `password_hash` y TypeORM enumera las columnas en cada
 * `SELECT` en vez de usar `*`, así que desde el instante del DROP falla CUALQUIER lectura de
 * `users` en el código viejo —`POST /auth/login`, `GET /users`, `DELETE /users/:id` y también
 * `POST /orders`, que consulta el directorio de clientes en cada orden—, no solo lo que usaba
 * la columna.
 *
 * ⚠️ Con `DB_MIGRATIONS_RUN=true` esta migración corre al arrancar el PRIMER pod de la versión
 * nueva, que es justo el peor momento posible. Lanzarla en el mismo release que el expand
 * anula el patrón entero. Las dos salidas están escritas en `CLAUDE.md`: dejarla para un
 * release posterior, o desplegar el release del contract con `DB_MIGRATIONS_RUN=false` y
 * ejecutar `pnpm migration:run` a mano cuando el rodado haya terminado.
 *
 * Sin cualificar el schema, como todas las migraciones del repo: ambos sentidos heredan el
 * `search_path` de la conexión, que sale de `DB_SCHEMA`.
 */
export class MoveCredentialsToAuthContract1786210349581 implements MigrationInterface {
  name = 'MoveCredentialsToAuthContract1786210349581';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "password_hash"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Vuelve al estado que dejó el expand, ni más ni menos: columna presente y NULLABLE. El
    // `NOT NULL` original lo restaura el `down()` del expand, que es el que lo quitó, y por eso
    // la comprobación de perfiles irrecuperables vive allí y no aquí: un perfil sin credencial
    // se queda con NULL en esta columna y eso es legal en el estado expand.
    await queryRunner.query(`ALTER TABLE "users" ADD "password_hash" character varying(255)`);

    // El relleno es lo que hace que revertir el contract no pierda información: los hashes
    // llevan viviendo en `auth_credentials` desde el expand, y el código viejo los espera en
    // la columna. Los perfiles sin credencial quedan a NULL a propósito —no se inventa un
    // hash, mismo criterio que el «sin DEFAULT» de `AddAuthColumnsToUsers`.
    await queryRunner.query(`
      UPDATE "users" u SET "password_hash" = c."password_hash"
      FROM "auth_credentials" c WHERE c."user_id" = u."id"
    `);
  }
}
