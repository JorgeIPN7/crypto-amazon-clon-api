import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Cuántos ids caben en el mensaje de error de `down()` antes de que deje de ayudar y estorbe. */
const UNRESTORABLE_IN_MESSAGE = 10;

/**
 * EXPAND del par expand/contract que muda la credencial de `users` al bounded context `auth`
 * (ciclo 4 del refactor). Su gemela es `MoveCredentialsToAuthContract`, que es la que suelta
 * la columna; ver «Migraciones destructivas: expand/contract» en `CLAUDE.md` y la entrada #12
 * del backlog para el porqué del par.
 *
 * Aquí NO se suelta nada. Los tres pasos —crear, copiar, aflojar— dejan el esquema en un
 * estado que las DOS versiones del código pueden usar a la vez, que es exactamente lo que un
 * despliegue rodante necesita:
 *
 *  - el código VIEJO sigue leyendo y escribiendo `users.password_hash`, que sigue ahí con sus
 *    datos intactos;
 *  - el código NUEVO ya no menciona esa columna (`UserOrmEntity` no la mapea) y escribe en
 *    `auth_credentials`.
 *
 * Esta migración existía junta con el DROP en `MoveCredentialsToAuth1786117503416`, y su
 * cabecera argumentaba que partirla dejaría el hash duplicado sin dueño claro. La duplicación
 * es real y es el precio del patrón —dura lo que dure el despliegue—; lo que no era aceptable
 * es la alternativa: con `DB_MIGRATIONS_RUN=true`, el DROP corre al arrancar el primer pod
 * nuevo y TypeORM enumera las columnas en cada `SELECT`, así que las réplicas viejas pierden
 * de golpe CUALQUIER lectura de `users`, no solo el login. El dueño durante la ventana está
 * escrito y es `auth_credentials`: la columna vieja queda como copia de compatibilidad.
 *
 * Lo que el patrón NO resuelve aquí, dicho sin adornos: una cuenta creada por el código nuevo
 * durante la ventana deja `users.password_hash` a NULL, así que el código viejo no puede
 * autenticarla (y al revés, una creada por el código viejo no tiene fila en
 * `auth_credentials`). Cerrar eso pediría un trigger de doble escritura, que es la pieza que
 * se añade cuando la ventana no puede tener altas; en este repo la ventana es un despliegue y
 * el coste de un alta perdida es que ese usuario reintente.
 *
 * Comillas camelCase en `"createdAt"`/`"updatedAt"`: no hay `NamingStrategy`, así que TypeORM
 * usa el nombre de la propiedad tal cual (misma lección que `AddAuthColumnsToUsers`). Las
 * columnas nuevas snake_case (`user_id`, `password_hash`) lo son por `name:` explícito en
 * `CredentialOrmEntity`.
 *
 * Sin cualificar el schema, como todas las migraciones del repo: ambos sentidos heredan el
 * `search_path` de la conexión, que sale de `DB_SCHEMA`.
 */
export class MoveCredentialsToAuthExpand1786210289581 implements MigrationInterface {
  name = 'MoveCredentialsToAuthExpand1786210289581';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "auth_credentials" (
        "id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "password_hash" character varying(255) NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_auth_credentials" PRIMARY KEY ("id")
      )
    `);

    // ÚNICO y no un índice plano al lado: una cuenta tiene exactamente una credencial, y un
    // índice único ya sirve de camino de acceso para el `findByUserId` del login. Añadir un
    // segundo índice no-único sobre la misma columna solo pagaría escrituras.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_auth_credentials_user_id" ON "auth_credentials" ("user_id")
    `);

    // Los hashes existentes se MIGRAN, no se pierden: un usuario que podía entrar antes de
    // esta migración puede entrar después con la misma contraseña. `gen_random_uuid()` es
    // built-in desde PostgreSQL 13 (aquí, 18): sin extensiones.
    //
    // La copia va ANTES del `DROP NOT NULL` y no al revés. No lo exige SQL: lo exige poder
    // afirmar que en este instante la columna no admite nulos, así que no hay perfil que el
    // `SELECT` deje fuera y toda cuenta preexistente sale de aquí con su credencial.
    //
    // Los timestamps se COPIAN del perfil en vez de estamparse con `now()`, y esto es el dato
    // que no se puede reconstruir después: con `now(), now()` toda contraseña del sistema
    // declararía haberse fijado en el instante del despliegue, y cualquier política de
    // caducidad o rotación futura arrancaría con el reloj a cero para todo el mundo. Las dos
    // columnas de origen existen y son del mismo tipo, así que la información está ahí; solo
    // había que no tirarla.
    //
    // Qué significa exactamente cada una, sin venderlo como exacto:
    //
    //  - `createdAt` ← `users."createdAt"`. Hasta esta migración el hash era una columna de
    //    `users`, así que la credencial nació con el perfil: la fecha es la buena. Deja de
    //    serlo solo si el alta y el primer password no fueron el mismo acto, y en este repo
    //    (`RegisterAccountUseCase`, `seed:admin`) siempre lo son.
    //
    //  - `updatedAt` ← `users."updatedAt"`. Aquí sí hay aproximación, y va hacia el lado
    //    optimista: `users."updatedAt"` se movía con CUALQUIER escritura de la fila —cambio de
    //    nombre, de rol, desactivación—, no solo con un cambio de contraseña. Es una COTA
    //    SUPERIOR: la credencial se cambió en esa fecha o antes, nunca después. Quien monte una
    //    política de rotación sobre esta columna debe saber que para las filas migradas puede
    //    estar sobrestimando la frescura del hash; la cota inferior honesta es `createdAt`.
    await queryRunner.query(`
      INSERT INTO "auth_credentials" ("id", "user_id", "password_hash", "createdAt", "updatedAt")
      SELECT gen_random_uuid(), "id", "password_hash", "createdAt", "updatedAt" FROM "users"
    `);

    // El paso que hace que expand/contract funcione de verdad en este caso, y no un detalle
    // de limpieza: durante la ventana el código nuevo da de alta perfiles SIN mencionar
    // `password_hash`, así que el INSERT deja esa columna a su default —no hay— y el
    // `NOT NULL` lo rechazaría. Sin esta línea, `POST /auth/register` respondería 500 con
    // `null value in column "password_hash" ... violates not-null constraint` desde el
    // primer pod nuevo hasta que corriera el contract: exactamente la caída que el patrón
    // viene a evitar, solo que en la otra versión del código.
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Deshacer el expand es volver a un esquema que EXIGE `password_hash` en cada fila, así
    // que primero hay que repoblar la columna desde la tabla que mientras tanto ha sido la
    // dueña. Este `UPDATE` es el inverso de la copia del `up()`.
    //
    // Es incondicional a propósito: desde el momento en que corre el expand, `auth_credentials`
    // es el dueño del hash y la columna es una copia de compatibilidad. Si las dos difieren
    // —solo puede pasar si el código viejo escribió en la columna durante la ventana— gana la
    // tabla nueva, que es lo que el código que está entrando ya usaba.
    //
    // Redundante si se acaba de revertir el contract (su `down()` ya rellenó desde aquí) y
    // necesario si el contract nunca llegó a correr, que es justo el estado que el patrón
    // crea. Idempotente en ambos casos.
    await queryRunner.query(`
      UPDATE "users" u SET "password_hash" = c."password_hash"
      FROM "auth_credentials" c WHERE c."user_id" = u."id"
    `);

    // Los perfiles que se quedan sin hash se buscan ANTES de tocar el esquema, y no se deja
    // que los descubra el `SET NOT NULL` del final.
    //
    // Que existan no es una anomalía teórica: es un estado esperado y reparable según el
    // propio repo —la compensación de `RegisterAccountUseCase` puede fallar y dejar el perfil
    // sin su credencial— y de hecho la base de test queda así tras una corrida normal de la
    // suite E2E (`users` poblada, `auth_credentials` vacía por el TRUNCATE). Delegando el
    // diagnóstico al motor, `pnpm migration:revert` respondía
    // `column "password_hash" of relation "users" contains null values`: no nombra una sola
    // fila, y como el executor corre con `transaction: "all"` tampoco queda rastro de por
    // dónde iba. El operador se quedaba con una reversión abortada y sin pista.
    //
    // Sigue siendo un error —no se inventa un hash para esas filas, mismo criterio que el «sin
    // DEFAULT» de `AddAuthColumnsToUsers`—, pero uno que dice quién y qué hacer.
    //
    // La comprobación vive en ESTE `down()` y no en el del contract porque lo que la obliga es
    // el `NOT NULL`, y el único de los dos que lo restaura es este. El contract recrea la
    // columna nullable: allí un perfil sin credencial se queda con NULL y no rompe nada.
    //
    // Y se pregunta por la columna ya rellenada, no por «no tiene fila en auth_credentials»,
    // que es lo que preguntaba la versión de una sola migración. Es más preciso y más
    // permisivo por el mismo motivo: la condición real para el `SET NOT NULL` es que no quede
    // ningún NULL. Un perfil sin credencial que conserve su hash de antes del expand no
    // impide la reversión, y abortarla por él sería un falso positivo.
    const unrestorable = (await queryRunner.query(`
      SELECT "id" FROM "users" WHERE "password_hash" IS NULL ORDER BY "id"
    `)) as { id: string }[];

    if (unrestorable.length > 0) {
      const shown = unrestorable.slice(0, UNRESTORABLE_IN_MESSAGE).map((row) => row.id);
      const rest = unrestorable.length - shown.length;
      throw new Error(
        `No se puede revertir MoveCredentialsToAuthExpand: ${unrestorable.length} perfil(es) de ` +
          '"users" se quedan sin "password_hash" —no tienen fila en "auth_credentials" ni valor ' +
          'previo en la columna— y el esquema anterior lo exige NOT NULL. Ids: ' +
          shown.join(', ') +
          (rest > 0 ? ` (y ${rest} más)` : '') +
          '. Antes de revertir, dales una credencial (`pnpm seed:admin` si es el admin, o un ' +
          'INSERT en "auth_credentials") o borra esos perfiles.',
      );
    }

    // Con la comprobación de arriba delante, el `SET NOT NULL` ya no es quien informa del
    // problema, sino la última red por si alguien escribe entre medias.
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "password_hash" SET NOT NULL`);

    await queryRunner.query(`DROP INDEX "idx_auth_credentials_user_id"`);
    await queryRunner.query(`DROP TABLE "auth_credentials"`);
  }
}
