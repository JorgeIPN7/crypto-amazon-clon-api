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
    // Entra el 2026-08-31 con `sequence-address-index.allocator.e2e-spec.ts`. Mismo caso que un
    // repositorio TypeORM: el sujeto es una secuencia del motor y su prueba no puede vivir en la
    // suite unitaria. El patrón es el ESPEJO EXACTO del `!src/**/infrastructure/**/*.allocator.ts`
    // de `jest.config.mjs` —`infrastructure/` incluido— para que el puerto
    // `domain/ports/address-index.allocator.ts` siga midiéndose allí y solo allí; el razonamiento,
    // con la medición, está en aquel archivo.
    'src/**/infrastructure/**/*.allocator.ts',
    'src/database/data-source.ts',
    'src/database/seeds/**',
    'src/database/outbox/**',
    // Entran el 2026-08-25 con `migrations.e2e-spec.ts`, que las ejercita de verdad (up → down →
    // up, con filas dentro). Hasta entonces estaban fuera con su motivo escrito —DDL de un solo
    // uso que corre la CLI— y esa exención era backlog #2, no algo que esta config cubriera.
    'src/database/migrations/**',
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
  // `outbox/`: los cuatro umbrales se quedaron como estaban porque los cuatro pasaban con margen:
  //
  //     statements  84.47  (suelo 80)      branches  41.09  (suelo 30)
  //     functions   89.18  (suelo 80)      lines     87.96  (suelo 80)
  //
  // **Remedido otra vez el 2026-08-25**, tras meter `src/database/migrations/**` en el scope con
  // `migrations.e2e-spec.ts`. La cobertura SUBIÓ, que era lo contrario de lo esperado al ampliar:
  //
  //     statements  87.14  (suelo 84)      branches  41.57  (suelo 38)
  //     functions   92.15  (suelo 88)      lines     90.16  (suelo 87)
  //
  // Sube porque las migraciones salen a **100 % de statements y de lines** —el spec las recorre
  // enteras, ida y vuelta— y arrastran hacia arriba un agregado que hasta ahora solo tenía
  // módulos y repositorios. Los suelos se elevan con ~3 puntos de margen: apretarlos más
  // convertiría cualquier refactor menor en una CI roja, que es la vía rápida a que alguien los
  // baje sin mirar.
  //
  // Los números más bajos del informe siguen siendo los mismos y siguen por encima:
  // `relay-orders-outbox.ts` 64.70 %, `data-source.ts` 33.33 % de funciones (solo la CLI ejecuta
  // el resto) y `seed-admin.ts` 82.25 %.
  //
  // **Remedido el 2026-08-31**, al entrar en el scope los dos repositorios TypeORM de `wallets` y
  // `sequence-address-index.allocator.ts` (al entrar los dos repositorios TypeORM de `wallets` y el asignador):
  //
  //     statements  87.65  (suelo 84)      branches  42.43  (suelo 38)
  //     functions   93.79  (suelo 88)      lines     90.48  (suelo 87)
  //
  // Los cuatro suelos se quedan como están: los cuatro pasan con 3.5-5.8 puntos de margen, que es
  // el criterio de arriba. Subirlos a ras del número de hoy convertiría en CI roja el primer
  // adaptador nuevo que entre sin E2E propio, y esa es la vía rápida a que alguien los baje sin
  // mirar. El archivo más bajo del bloque nuevo es `sequence-address-index.allocator.ts`, 82.60 %
  // de statements, y lo que reporta sin cubrir son las líneas 19-21 — que están DENTRO de su
  // bloque JSDoc, o sea que no son código. Es el mismo artefacto de la instrumentación de SWC que
  // enseñan los otros tres adaptadores del informe (21-23, 22-24, 23-25, también dentro de su
  // JSDoc): no hay ninguna rama de `next()` sin ejercitar.
  coverageThreshold: {
    global: { branches: 38, functions: 88, lines: 87, statements: 84 },
  },
};

export default config;
