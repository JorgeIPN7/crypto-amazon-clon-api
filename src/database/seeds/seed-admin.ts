import { randomUUID } from 'node:crypto';

import * as argon2 from 'argon2';
import type { DataSource, EntityManager } from 'typeorm';

// Imports relativos a propósito, como hace `data-source.ts`: este archivo también corre
// bajo ts-node vía `pnpm seed:admin`, fuera del contenedor de Nest, y ts-node no resuelve
// los alias de `tsconfig.paths` sin `tsconfig-paths/register`.
import { ARGON2_PARAMS } from '../../config/auth.config';
import { envSchema } from '../../config/env.schema';
import cliDataSource from '../data-source';

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
 * OJO con las columnas: los timestamps son camelCase ENTRECOMILLADOS ("createdAt"/
 * "updatedAt") — no hay NamingStrategy y TypeORM usó el nombre de propiedad tal cual;
 * las columnas snake_case (`role`, `user_id`, `password_hash`) lo son por `name:` explícito
 * en su ORM entity.
 *
 * Nunca loguea el password ni el hash (security-auth-jwt): el único `console.log` de
 * este módulo, en el bloque CLI de más abajo, imprime el resultado ('created' |
 * 'promoted'), no las credenciales.
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
      await manager.query(
        `UPDATE users SET role = 'admin', active = true, "updatedAt" = now() WHERE id = $1`,
        [userId],
      );
      await upsertCredential(manager, userId, passwordHash);
      return 'promoted';
    }

    const userId = randomUUID();
    await manager.query(
      `INSERT INTO users (id, email, name, role, active, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'admin', true, now(), now())`,
      [userId, email, ADMIN_NAME],
    );
    await upsertCredential(manager, userId, passwordHash);
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
): Promise<void> => {
  await manager.query(
    `INSERT INTO auth_credentials (id, user_id, password_hash, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, now(), now())
     ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash,
       "updatedAt" = now()`,
    [randomUUID(), userId, passwordHash],
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
