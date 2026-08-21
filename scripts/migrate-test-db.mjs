import { spawnSync } from 'node:child_process';

/**
 * Aplica las migraciones pendientes a la base de datos de los TESTS.
 *
 * **Por qué hace falta un script y no vale `pnpm migration:run`.** La CLI de TypeORM lee
 * `DB_DATABASE` del `.env` a través de `src/database/data-source.ts`, y ese valor apunta a la
 * base de desarrollo. Quien redirige a la de tests es `test/setup-env.ts`, pero lo hace
 * **dentro del proceso de Jest**, así que la CLI nunca se entera: `docker/initdb/` crea la base
 * de tests vacía y ahí se queda. El resultado era que un clon nuevo seguía el README al pie de
 * la letra y `pnpm test:e2e` reventaba con `relation "users" does not exist`.
 *
 * **Por qué un `.mjs` y no un prefijo de shell.** `.github/workflows/ci.yml` resuelve lo mismo
 * con `DB_DATABASE: nest_base_template_test` en el `env:` del step, y en Linux bastaría un
 * `DB_DATABASE=… pnpm migration:run`. En los scripts de `package.json` ese prefijo NO funciona
 * en Windows —el entorno de referencia de este repo— y no hay `cross-env` en el árbol. Fijar la
 * variable en `process.env` antes de delegar funciona en los dos sistemas sin añadir una
 * dependencia.
 *
 * Funciona porque `data-source.ts` carga el `.env` con `dotenv`, que por defecto **no pisa** lo
 * que ya está en `process.env`.
 *
 * El default duplica el de `test/setup-env.ts` a propósito: son los dos extremos del mismo
 * acuerdo, y `scripts/init-project.targets.json` declara este archivo para que `init:project`
 * los renombre a la vez.
 */

process.env.DB_DATABASE = process.env.DB_DATABASE_TEST ?? 'nest_base_template_test';

console.log(`[db:migrate:test] migrando ${process.env.DB_DATABASE}`);

// `shell: true` es necesario en Windows: `pnpm` es un `.cmd` y `spawnSync` no lo resuelve solo.
const result = spawnSync('pnpm', ['migration:run'], {
  stdio: 'inherit',
  env: process.env,
  shell: true,
});

if (result.error) {
  console.error(`[db:migrate:test] no se pudo lanzar pnpm: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
