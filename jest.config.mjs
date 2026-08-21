import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// `.swcrc` se lee del disco en vez de duplicarlo aquí, para que la transformación de los
// tests sea exactamente la del build.
//
// Dos ajustes obligatorios sobre lo que hay en el fichero:
//   - `exclude` se descarta. Existe para que `nest build` no meta los specs en `dist/`;
//     aplicado a los tests dejaría sin transformar justo lo que la suite necesita.
//   - `swcrc: false` es imprescindible: sin él, `@swc/core` vuelve a leer `.swcrc` del
//     disco al compilar cada archivo y reaplica ese mismo `exclude`, ignorando que aquí
//     ya lo habíamos quitado. El síntoma es `cannot process file because it's ignored`.
const { exclude: _buildOnlyExclude, ...swcrcOnDisk } = JSON.parse(
  readFileSync(resolve(here, '.swcrc'), 'utf-8'),
);

export const swcTransformOptions = { ...swcrcOnDisk, swcrc: false };

/**
 * Todo lo que ambas suites deben compartir. `test/jest-e2e.config.mjs` parte de aquí en vez
 * de reinlinear una copia: la config E2E llevaba el transform de SWC duplicado a mano y sin
 * `jsc.paths`, así que cualquier cambio en `.swcrc` solo lo recogía la suite unitaria. Es el
 * origen clásico del "pasa en unit, falla en E2E" — bastaba con que `useDefineForClassFields`
 * divergiera para que los defaults de propiedad de los DTO se emitieran distinto.
 *
 * Estos configs son `.mjs` y no `.ts` a propósito: Jest carga los configs TypeScript como
 * ESM, que exige extensión explícita en el import, mientras que `tsc` la rechaza sin
 * `allowImportingTsExtensions`. En `.mjs` no hay tal conflicto y se comparten de verdad.
 *
 * @type {import('jest').Config}
 */
export const baseConfig = {
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: {
    '^.+\\.(t|j)s$': ['@swc/jest', swcTransformOptions],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@common/(.*)$': '<rootDir>/src/common/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@modules/(.*)$': '<rootDir>/src/modules/$1',
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
    '^@database/(.*)$': '<rootDir>/src/database/$1',
    '^@test/(.*)$': '<rootDir>/test/$1',
  },
  // `@scalar/*` se publica como ESM puro. En producción no hace falta transformarlo: Node lo
  // carga con `require(esm)`, sin flag desde 22.12, que es el motivo del pin de `engines`.
  //
  // Jest **no** usa el `require` de Node — tiene su propio loader CJS, que no implementa
  // `require(esm)` — así que sin esta excepción falla con `Unexpected token 'export'` en cuanto
  // un spec importa `bootstrap/openapi.ts`.
  //
  // Consecuencia que conviene tener presente: la suite transpila ese paquete a CJS, de modo que
  // **ninguna prueba ejercita la ruta de carga real de producción**. Un `ERR_REQUIRE_ESM` o un
  // `ERR_REQUIRE_ASYNC_MODULE` no aparecería aquí. Eso lo cubre arrancar el proceso de verdad:
  // `pnpm build && node -e "require('@scalar/nestjs-api-reference')"`.
  //
  // La negación mira el resto de la ruta y no solo el segmento siguiente: con pnpm, un paquete
  // aparece como `node_modules/.pnpm/@scalar+x@v/node_modules/@scalar/x/…`, con **dos** tramos
  // `node_modules`, y un patrón anclado al primero deja que el segundo lo vuelva a ignorar.
  transformIgnorePatterns: ['node_modules/(?!.*@scalar)'],

  // Fija NODE_ENV=test y la base de datos de tests antes de que arranque el AppModule.
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  clearMocks: true,
  restoreMocks: true,
};

/** @type {import('jest').Config} */
const config = {
  ...baseConfig,
  // `\.spec\.ts$` exige un punto antes de "spec", así que no captura los `*.e2e-spec.ts`:
  // las dos suites no se solapan.
  testRegex: '.*\\.spec\\.ts$',
  testTimeout: 15_000,
  collectCoverageFrom: [
    'src/**/*.ts',
    // Los tests viven en carpetas `__tests__/` dentro de cada módulo: nunca son fuente.
    '!src/**/__tests__/**',
    '!src/**/*.spec.ts',
    '!src/**/*.e2e-spec.ts',
    '!src/**/index.ts',
    '!src/main.ts',
    // Lo siguiente se valida en la suite E2E (`pnpm test:e2e`), no aquí. Medirlo en la
    // suite unitaria penalizaría por seguir la propia convención del repo:
    //   - `*.module.ts`: wiring declarativo; compilar el módulo abre conexiones reales.
    //   - `*.typeorm.repository.ts`: el skill exige probar repositorios contra una base
    //     real, no con `jest.mock('typeorm')`, y eso es justo lo que hacen los E2E.
    //   - `data-source.ts` y `migrations/`: los ejecuta la CLI (`pnpm migration:run`).
    // `test/jest-e2e.config.mjs` mide estos archivos y les aplica su propio umbral —con UNA
    // excepción, que conviene tener escrita porque el comentario anterior la negaba: hasta el
    // 2026-08-19 aquella lista tenía dos patrones y esta seis, así que cuatro de los seis
    // grupos no los medía ninguna suite. Se corrigió allí, salvo `migrations/`, que sigue
    // fuera de las dos a propósito y con deuda propia (`docs/backlog.md` #17).
    //   - `seeds/`: igual que las migraciones, los ejecuta la CLI (`pnpm seed:admin`), no
    //     Jest. Tendrá su propio E2E dedicado (Task 9 del plan de auth) — mismo patrón que
    //     `data-source.ts`/`migrations/`, no una excepción aparte.
    '!src/**/*.module.ts',
    '!src/**/*.typeorm.repository.ts',
    '!src/database/data-source.ts',
    '!src/database/migrations/**',
    '!src/database/seeds/**',
    //   - `outbox/`: mismo caso que `seeds/` — CLI ejecutada por ts-node
    //     (`pnpm outbox:relay`), no por Jest; la cubre su E2E dedicado.
    '!src/database/outbox/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  // El umbral de `branches` es deliberadamente más bajo que el resto. SWC instrumenta el
  // código que genera para `emitDecoratorMetadata` y para los defaults de propiedad, y esas
  // ramas sintéticas no son alcanzables desde un test. La evidencia es directa: los archivos
  // sin decoradores (`src/config/**`, `pino-options.ts`) llegan al 88-100 % de branches,
  // mientras que los que están cargados de decoradores (DTOs, controllers, módulos) se
  // estancan cerca del 50 % por muchos casos que se añadan. Subirlo obligaría a escribir
  // tests que no prueban nada.
  coverageThreshold: {
    global: { branches: 50, functions: 88, lines: 85, statements: 85 },
  },
};

export default config;
