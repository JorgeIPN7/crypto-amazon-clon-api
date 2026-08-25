import { randomUUID } from 'node:crypto';

import * as argon2 from 'argon2';
import type { DataSource, EntityManager } from 'typeorm';

// Imports relativos a propósito, como hace `data-source.ts`: este archivo también corre
// bajo ts-node vía `pnpm seed:admin`, fuera del contenedor de Nest, y ts-node no resuelve
// los alias de `tsconfig.paths` sin `tsconfig-paths/register`.
import { ARGON2_PARAMS } from '../../config/auth.config';
import { envSchema } from '../../config/env.schema';
import cliDataSource from '../data-source';
// Relativo como el resto de imports de este archivo, y por el mismo motivo: corre bajo ts-node
// sin `tsconfig-paths/register`, que es quien resolvería `@shared/`.
import { SYSTEM_ACTORS } from '../../shared/domain/system-actor';

const ADMIN_NAME = 'Administrator';

/**
 * Idempotente: crea el admin si no existe, o lo deja operativo si existe — rol `admin`,
 * `active = true` y hash refrescado. Recibe el DataSource por parámetro (testabilidad — el
 * E2E le pasa el suyo).
 *
 * **Dos tablas y una transacción, desde el ciclo 4.** El perfil vive en `users` y la
 * credencial en `auth_credentials`, así que el seed escribe en ambas dentro de
 * `dataSource.transaction`: un admin con perfil y sin credencial no podría entrar, y uno con
 * credencial y sin perfil sería una fila colgada. La atomicidad aquí es barata porque el
 * seed es un proceso único que habla SQL crudo — en el camino HTTP la misma consistencia se
 * consigue con compensación (`RegisterAccountUseCase`), porque ahí los dos contextos no
 * comparten transacción por diseño.
 *
 * Todas las columnas van en snake_case. No hay `NamingStrategy` configurada, así que cada una lo
 * consigue por su `name:` explícito en la ORM entity — sin él, TypeORM usaría el nombre de la
 * propiedad y `createdAt` nacería en camel, que es como estuvo el esquema hasta el 2026-08-24.
 *
 * **El seed SE ATRIBUYE sus escrituras con `SYSTEM_ACTORS.ADMIN_SEED`**, en los dos INSERT y en
 * los dos UPDATE. ⚠️ Esto INVIERTE lo que este mismo comentario decía hasta el 2026-08-25 —«el
 * seed nunca nombra `created_by`: el sistema es `null`»— y la inversión tiene motivo: `null`
 * significaba a la vez «lo hizo un proceso» y «no se sabe quién lo hizo», que es el valor legítimo
 * de las filas anteriores a `AddAuditActorColumns`. Con las dos colapsadas, una fila escrita por el
 * seed y una fila histórica sin datos se leían igual. Lo que aquí se sabe, ahora se dice.
 *
 * La objeción de entonces —«no hay centinela `'system'`»— era buena contra un valor suelto
 * inventado en el sitio. `SYSTEM_ACTORS` no lo es: catálogo cerrado, y su prefijo `system:` NO
 * puede colisionar con el UUID de un usuario. Lo fija un caso de `system-actor.spec.ts`.
 *
 * En los UPDATE el actor es una ESCRITURA y no una omisión, igual que antes lo era el `NULL`:
 * quien acaba de tocar la fila es el seed, y dejar el valor anterior diría que fue el último
 * humano que la modificó.
 *
 * Nunca loguea el password ni el hash (security-auth-jwt): el único `console.log` de
 * este módulo, en el bloque CLI de más abajo, imprime el resultado ('created' |
 * 'promoted'), no las credenciales.
 */
/**
 * ⚠️ El instante se calcula UNA vez en JS y viaja como parámetro: el SQL de este archivo no llama
 * a `now()` en ninguna parte. Dos motivos. (1) Las filas de perfil y credencial de un mismo seed
 * comparten marca EXACTA, en vez de dos lecturas del reloj del servidor separadas por la latencia
 * de la consulta anterior. (2) El reloj lo pone el llamante, que es la regla que siguen los tres
 * agregados desde que `Entity` sella la traza — el seed era el último sitio del repo donde el
 * instante lo ponía PostgreSQL, y esa asimetría no tenía defensa: quitar el `DEFAULT now()` de
 * las tablas y dejar que el seed lo llamara a mano es la misma incoherencia con otro disfraz.
 */
export async function seedAdmin(dataSource: DataSource): Promise<'created' | 'promoted'> {
  const env = envSchema.parse(process.env);
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    throw new Error('seed:admin necesita ADMIN_EMAIL y ADMIN_PASSWORD en el entorno (ambas).');
  }
  const email = env.ADMIN_EMAIL.trim().toLowerCase();
  const passwordHash = await argon2.hash(env.ADMIN_PASSWORD, {
    ...ARGON2_PARAMS,
    type: argon2.argon2id,
  });

  // Una sola lectura del reloj para TODAS las filas del seed (ver la cabecera). Se toma antes
  // de abrir la transacción a propósito: dentro, cada consulta añadiría su latencia y las dos
  // tablas volverían a nacer con instantes distintos, que es justo lo que esto evita.
  const now = new Date();

  return dataSource.transaction(async (manager) => {
    const existing = await manager.query<{ id: string }[]>(
      'SELECT id FROM users WHERE email = $1',
      [email],
    );

    if (existing[0]) {
      const userId = existing[0].id;
      // `active = true` va en el UPDATE porque sin él `promoted` es una respuesta MENTIROSA
      // para el único escenario en el que este seed es la vía de rescate. Si se desactiva por
      // error la única cuenta admin, todo endpoint `@Auth('admin')` queda inalcanzable; el
      // operador aplica la receta documentada, el seed imprime `promoted` y termina con éxito
      // — y el login sigue devolviendo 401, porque `LoginUseCase` rechaza al inactivo
      // (`!user?.active`) con el MISMO `InvalidCredentialsError` que una contraseña mala. Nada
      // en la salida distingue "arreglado" de "sigue roto", y sin SQL directo no hay salida.
      //
      // Promover a admin y dejarlo desactivado no es un estado que nadie pida a propósito:
      // «este usuario es el administrador pero no puede operar» no describe ninguna intención.
      // `"updated_by" = NULL` es una ESCRITURA, no una omisión: quien acaba de tocar la fila es
      // el seed, que corre por CLI y no tiene actor humano detrás. Dejar el valor anterior diría
      // que el último en modificar el perfil fue el administrador que lo desactivó por error, y
      // esa afirmación se vuelve falsa justo en el momento en que el seed lo rescata.
      await manager.query(
        `UPDATE users SET role = 'admin', active = true, "updated_at" = $2, "updated_by" = $3
          WHERE id = $1`,
        [userId, now, SYSTEM_ACTORS.ADMIN_SEED],
      );
      await upsertCredential(manager, userId, passwordHash, now);
      return 'promoted';
    }

    const userId = randomUUID();
    await manager.query(
      `INSERT INTO users (id, email, name, role, active, "created_at", "updated_at", "created_by", "updated_by")
       VALUES ($1, $2, $3, 'admin', true, $4, $4, $5, $5)`,
      [userId, email, ADMIN_NAME, now, SYSTEM_ACTORS.ADMIN_SEED],
    );
    await upsertCredential(manager, userId, passwordHash, now);
    return 'created';
  });
}

/**
 * `ON CONFLICT (user_id)` se apoya en `idx_auth_credentials_user_id`, el índice ÚNICO de la
 * migración: si el usuario ya tenía credencial se refresca su hash en vez de duplicar la
 * fila, que es lo que hace idempotente al seed también en su mitad de auth.
 */
const upsertCredential = async (
  manager: EntityManager,
  userId: string,
  passwordHash: string,
  now: Date,
): Promise<void> => {
  await manager.query(
    `INSERT INTO auth_credentials
       (id, user_id, password_hash, "created_at", "updated_at", "created_by", "updated_by")
     VALUES ($1, $2, $3, $4, $4, $5, $5)
     ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash,
       "updated_at" = $4, "updated_by" = $5`,
    [randomUUID(), userId, passwordHash, now, SYSTEM_ACTORS.ADMIN_SEED],
  );
};

// CLI entry (patrón require.main de main.ts). data-source.ts exporta DEFAULT (único
// export — la CLI de TypeORM rechaza el archivo con más de uno, dice su comentario).
if (require.main === module) {
  cliDataSource
    .initialize()
    .then(() => seedAdmin(cliDataSource))
    .then((result) => {
      console.log(`[seed:admin] ${result}`);
      return cliDataSource.destroy();
    })
    .catch((error: unknown) => {
      console.error('[seed:admin] failed:', error);
      process.exit(1);
    });
}
