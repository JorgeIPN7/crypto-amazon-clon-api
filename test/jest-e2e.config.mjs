import { baseConfig } from '../jest.config.mjs';

/**
 * Config de la suite E2E. Hereda de `jest.config.mjs` en vez de duplicar el transform de
 * SWC y el mapa de aliases, que es como estaba antes y garantizaba que ambos divergieran.
 *
 * @type {import('jest').Config}
 */
const config = {
  ...baseConfig,
  // `rootDir` se resuelve relativo a este archivo, que vive en `test/`.
  rootDir: '..',
  testRegex: '\\.e2e-spec\\.ts$',
  // Arrancar el AppModule real y conectar a Postgres es lento comparado con un unitario.
  testTimeout: 30_000,
  // Un solo worker: las suites E2E comparten base y `users.e2e-spec.ts` hace TRUNCATE en
  // cada `beforeEach`. En paralelo, una suite vaciaría la tabla de otra a mitad de un test.
  maxWorkers: 1,
  // Mide lo que la suite unitaria excluye argumentando que "lo cubren los E2E". Sin esto
  // aquello era un acto de fe: nadie comprobaba que fuera cierto.
  //
  // ⚠️ Y hasta el 2026-08-19 seguía siéndolo a medias, que es peor que no afirmarlo: la lista
  // eran DOS patrones frente a los SEIS que `jest.config.mjs` excluye, así que
  // `data-source.ts`, `seeds/`, `outbox/` y `migrations/` no los medía NINGUNA de las dos
  // suites, mientras tres comentarios —uno aquí— publicaban lo contrario. Comprobado sobre el
  // `coverage-e2e/lcov.info` en disco: 10 entradas `SF:`, todas módulo o repositorio TypeORM.
  //
  // Los tres primeros entran ahora porque su prueba ya existía y solo faltaba medirla:
  // `src/database/__tests__/seed-admin.e2e-spec.ts` y `relay-orders-outbox.e2e-spec.ts`.
  //
  // `migrations/` se queda fuera de las dos, dicho en voz alta: son DDL de un solo uso que
  // ejecuta la CLI, y que nada las ejercite directamente es una deuda abierta con su propia
  // entrada —`docs/backlog.md` #17—, no algo que este archivo esté cubriendo.
  collectCoverageFrom: [
    'src/**/*.module.ts',
    'src/**/*.typeorm.repository.ts',
    'src/database/data-source.ts',
    'src/database/seeds/**',
    'src/database/outbox/**',
    '!src/**/__tests__/**',
  ],
  coverageDirectory: 'coverage-e2e',
  coverageReporters: ['text', 'lcov'],
  // `branches: 30` — mismo fenómeno que documenta `jest.config.mjs` para la unitaria, pero
  // aquí la desproporción es extrema y está medida (2026-08-06, lcov de esta suite): de las
  // 130 ramas del scope, 106 son sintéticas de los helpers de decoradores de SWC — los cinco
  // `*.module.ts` reportan 19 ramas cada uno con BRDA más allá de su EOF, y `health.module.ts`
  // tiene 10 líneas y CERO condicionales en el fuente. Cubriendo TODA rama real alcanzable el
  // techo es 60/130 = 46 %: el 50 heredado era matemáticamente impasable y nunca estuvo verde
  // desde que nació (a30a677). El suelo en 30 queda bajo el 33 % medido hoy con margen corto:
  // sigue detectando un colapso real (suites que dejan de arrancar módulos), sin fingir una
  // cobertura que esta instrumentación no puede medir.
  //
  // Remedido el 2026-08-19 tras ampliar `collectCoverageFrom` con `data-source.ts`, `seeds/` y
  // `outbox/`: los cuatro umbrales **se quedan como estaban** porque los cuatro pasan con
  // margen. Medido sobre `pnpm test:e2e:ci` con la suite entera en verde:
  //
  //     statements  84.47  (suelo 80)      branches  41.09  (suelo 30)
  //     functions   89.18  (suelo 80)      lines     87.96  (suelo 80)
  //
  // Los tres grupos nuevos tiran del agregado hacia abajo sin hundirlo, y su reparto dice por
  // qué: `data-source.ts` 86.66 % stmts pero 33.33 % de funciones —solo la CLI ejecuta el resto—,
  // `relay-orders-outbox.ts` 64.70 % y `seed-admin.ts` 81.66 %. Son los números más bajos del
  // informe y siguen por encima del suelo: medir estos archivos no obligó a relajar nada, que
  // era la duda al ampliar el scope.
  coverageThreshold: {
    global: { branches: 30, functions: 80, lines: 80, statements: 80 },
  },
};

export default config;
