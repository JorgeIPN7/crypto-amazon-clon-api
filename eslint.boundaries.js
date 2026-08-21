// eslint.boundaries.js
/**
 * Fronteras de módulo y de capa — las 5 reglas de la spec
 * `docs/specs/2026-08-04-module-boundaries-design.md`, en la API VIGENTE del
 * plugin 7.x: `boundaries/dependencies` con `policies`. Las reglas
 * `element-types`/`external` y la clave `mode` están deprecadas y aquí NO se
 * usan — criterio de la enmienda: cero warnings de deprecación en la salida.
 *
 * Compartido entre `eslint.config.mjs` (el gate real) y
 * `src/__tests__/eslint-boundaries.spec.ts` (la suite de 34 casos + P1): un solo
 * objeto, cero copias — mismo principio que `.swcrc` para build y Jest.
 *
 * Clasificación: POR ORDEN DEL ARRAY, no por profundidad calculada.
 * `elementsSingleMatch` (default `true`, sin fijar aquí) corta en el PRIMER
 * descriptor cuyo pattern coincide — los posteriores ni se evalúan. Como todos
 * los patterns anclan en `src`, varios pueden coincidir a la vez: ordena
 * siempre de más estrecho a más ancho, con `app` AL FINAL. Un descriptor
 * añadido después de `app` queda muerto en silencio — inserta los nuevos
 * SIEMPRE antes de `app`. El `*.module.ts` se clasifica aparte como CATEGORÍA
 * de archivo (`boundaries/files`): es la única puerta legal cross-módulo
 * (spec §4, «module-public»).
 *
 * Cómo añadir piezas:
 * (a) carpeta transversal nueva en `src/` → su descriptor ANTES de `app`, su
 *     policy en la matriz y un caso nuevo en la suite (vía JIT del modelo —
 *     la tabla de casos es el contrato);
 * (b) módulo nuevo bajo `src/modules/` → cero ediciones aquí: los wildcards
 *     lo cubren (verificado con un `billing` sintético).
 *
 * Determinaciones resueltas contra el código local del plugin
 * (`dist/Rules/Dependencies.js` y `@boundaries/elements/dist`):
 *
 * D1 — «mismo módulo». La sintaxis `${…}` dispara el warning «Detected legacy
 * template syntax» (`Settings/Rules.js`), así que el template es Handlebars:
 * `{{from.captured.module}}`. En los datos de template del matcher
 * (`getLegacyDependencySelectorExtraTemplateData`), `from.captured` son los
 * valores capturados del elemento origen; `from.module` solo existe como atajo
 * del modo legacy, no se usa.
 *
 * D2 — externos. Con las opciones por defecto los módulos externos NI SE
 * EVALÚAN (`checkAllOrigins ?? false`: solo dependencias `origin: 'local'`).
 * Por eso la regla activa `checkAllOrigins: true`, y entonces `default:
 * 'disallow'` SÍ alcanza a externos y a los builtins de Node (`origin:
 * 'core'`): la primera policy los permite en bloque y las prohibiciones
 * puntuales van DESPUÉS, porque la evaluación es last-match-wins
 * (`evaluatePolicies`: la última policy que matchea decide; dentro de una
 * misma policy, `disallow` gana a `allow`).
 *
 * Barrels: todo `index.ts` bajo `src/` está en `boundaries/ignore` — el barrel
 * no forma parte del grafo de dependencias porque su EXISTENCIA ya es el error (regla 5,
 * bloque aparte que `boundaries/ignore` no toca). Así el importador de un
 * barrel no duplica el reporte, y el hueco se sella solo: ningún index.ts
 * puede existir legalmente bajo `src/`.
 */
const boundaries = require('eslint-plugin-boundaries');

const elements = [
  { type: 'module-domain', pattern: 'src/modules/*/domain', capture: ['module'] },
  { type: 'module-application', pattern: 'src/modules/*/application', capture: ['module'] },
  { type: 'module-infrastructure', pattern: 'src/modules/*/infrastructure', capture: ['module'] },
  { type: 'module', pattern: 'src/modules/*', capture: ['module'] },
  { type: 'bootstrap', pattern: 'src/bootstrap' },
  { type: 'common', pattern: 'src/common' },
  { type: 'config', pattern: 'src/config' },
  { type: 'database', pattern: 'src/database' },
  // `shared-domain` ANTES de `shared`, y ambos antes de `app`: la clasificación corta en el
  // PRIMER descriptor que matchea (ver cabecera). Con `shared` delante, `src/shared/domain`
  // caería en `shared` y `shared-domain` quedaría muerto en silencio — y con él tanto el
  // permiso que abre a los módulos como la prohibición de externals que lo protege.
  { type: 'shared-domain', pattern: 'src/shared/domain' },
  { type: 'shared', pattern: 'src/shared' },
  { type: 'app', pattern: 'src' },
];

/** D1: la capa destino debe pertenecer al MISMO módulo que el origen. */
const SAME_MODULE = { module: '{{from.captured.module}}' };

/** Selector «capas X del MISMO módulo que el origen». */
const ownLayers = (types) => ({
  to: { element: { types: { anyOf: types }, captured: SAME_MODULE } },
});

/**
 * La anotación no es decorativa: `eslint.config.mjs` lleva `// @ts-check`, así que TypeScript
 * comprueba el `...boundariesBlocks` del final. Sin ella infiere este literal de forma
 * demasiado laxa y da un TS2345 en esa línea, por dos motivos encadenados:
 *
 *   1. `eslint-plugin-boundaries@7` describe en `dist/index.d.ts` solo un `export default`,
 *      mientras que su `dist/index.js` termina con `module.exports = { ...publicInterface }`
 *      «For CommonJS compatibility». En runtime `require()` devuelve `{ meta, rules, configs }`
 *      —un plugin válido, y por eso el lint funciona—, pero TS ve el objeto módulo entero.
 *   2. Los pares `['error', { … }]` de `rules` se infieren como array y no como TUPLA, que es
 *      lo que exige `RuleEntry`.
 *
 * Ninguno de los dos es un defecto de esta configuración, y ninguno rompe un gate: el archivo
 * queda fuera del `include` de `tsconfig.json`, así que `pnpm typecheck` no lo mira y el error
 * solo se veía en el editor. Se arregla aquí, en el tipo exportado, porque es el mismo que la
 * suite ya asume — ver el `as Linter.Config[]` de `src/__tests__/eslint-boundaries.spec.ts`.
 *
 * @type {import('eslint').Linter.Config[]}
 */
module.exports = [
  {
    files: ['src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': elements,
      'boundaries/files': [{ category: 'module-entry', pattern: 'src/modules/*/*.module.ts' }],
      // Los tests importan internals de su módulo y AppModule por diseño (spec §4);
      // los barrels no participan del grafo (ver cabecera).
      'boundaries/ignore': ['src/**/__tests__/**', 'src/**/index.ts'],
      'import/resolver': { typescript: { alwaysTryTypes: true } },
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          checkAllOrigins: true,
          message: 'Frontera violada (spec 2026-08-04-module-boundaries)',
          policies: [
            // D2: base de externos — sin ella, `default: 'disallow'` + `checkAllOrigins`
            // vetaría todo import de node_modules y de builtins. Va PRIMERO para que
            // las prohibiciones puntuales (últimas) la sobrescriban (last-match-wins).
            { allow: { to: { module: { origin: ['external', 'core'] } } } },
            // Regla 1: dominio solo su propio dominio — más el kernel compartido.
            // `shared-domain` es la ÚNICA excepción a «domain no importa nada de fuera del
            // módulo»: es dominio también (cero framework, cero I/O), solo que sin dueño.
            // El resto de `src/shared/` sigue vedado: lo que se abre es `shared/domain`, no
            // `shared`.
            {
              from: { element: { type: 'module-domain' } },
              allow: [ownLayers(['module-domain']), { to: { element: { type: 'shared-domain' } } }],
            },
            // Regla 2: aplicación → su dominio, su propia capa y el kernel compartido.
            {
              from: { element: { type: 'module-application' } },
              allow: [
                ownLayers(['module-domain', 'module-application']),
                { to: { element: { type: 'shared-domain' } } },
              ],
            },
            // Infraestructura y raíz del módulo: todas sus capas + cross-cutting.
            {
              from: { element: { types: { anyOf: ['module-infrastructure', 'module'] } } },
              allow: [
                ownLayers([
                  'module-domain',
                  'module-application',
                  'module-infrastructure',
                  'module',
                ]),
                { to: { element: { types: { anyOf: ['common', 'config'] } } } },
                // El kernel compartido, igual que para domain y application: un mapper o un
                // controller pueden necesitar el tipo base de un VO.
                { to: { element: { type: 'shared-domain' } } },
                // Regla 3, lado permitido (enmienda 2026-08-06, plan orders-minimal): de
                // OTRO módulo, solo su *.module.ts. Solo para infraestructura y raíz —
                // application y domain siguen sin poder tocar un módulo ajeno (reglas
                // 1-2), y eso lo fijan los casos G3-G4 de la suite.
                { to: { file: { categories: 'module-entry' } } },
              ],
            },
            // Regla 3 (lado permitido): app-root entra a los módulos SOLO por su *.module.ts.
            {
              from: { element: { type: 'app' } },
              allow: [
                { to: { file: { categories: 'module-entry' } } },
                {
                  to: {
                    element: { types: { anyOf: ['common', 'config', 'database', 'bootstrap'] } },
                  },
                },
              ],
            },
            {
              from: { element: { type: 'bootstrap' } },
              allow: { to: { element: { types: { anyOf: ['common', 'config'] } } } },
            },
            {
              from: { element: { type: 'common' } },
              allow: { to: { element: { types: { anyOf: ['common', 'config'] } } } },
            },
            {
              from: { element: { type: 'config' } },
              allow: { to: { element: { type: 'config' } } },
            },
            {
              from: { element: { type: 'database' } },
              allow: { to: { element: { types: { anyOf: ['database', 'config'] } } } },
            },
            {
              from: { element: { type: 'shared' } },
              allow: { to: { element: { type: 'shared' } } },
            },
            // Al partir el element type, `shared → shared` dejó de cubrir al kernel consigo
            // mismo: `aggregate-root.ts` importando `value-object.base.ts` es ahora
            // `shared-domain → shared-domain` y necesita su propia policy.
            {
              from: { element: { type: 'shared-domain' } },
              allow: { to: { element: { type: 'shared-domain' } } },
            },
            // Regla 1 (externals): pureza de dominio — la lista de CLAUDE.md, ahora mecánica.
            // `argon2` se suma por la Tabla C (gate de boundaries, plan 2026-08-05-auth-roles):
            // `@nestjs/jwt` NO se añade aparte — el wildcard `@nestjs/*` ya lo cubre.
            {
              from: { element: { type: 'module-domain' } },
              disallow: {
                to: {
                  module: {
                    origin: 'external',
                    source: ['@nestjs/*', 'typeorm', 'pino', 'class-validator', 'axios', 'argon2'],
                  },
                },
              },
            },
            // Regla 2 (externals): aplicación sin ORM ni clientes HTTP.
            // `argon2` y `@nestjs/jwt` se suman por la Tabla C (gate de boundaries, plan
            // 2026-08-05-auth-roles): aquí no hay wildcard `@nestjs/*` previo, así que
            // `@nestjs/jwt` sí necesita su propia entrada.
            {
              from: { element: { type: 'module-application' } },
              disallow: {
                to: {
                  module: {
                    origin: 'external',
                    source: ['typeorm', 'axios', 'argon2', '@nestjs/jwt'],
                  },
                },
              },
            },
            // Regla 1 (externals), replicada para el kernel: MISMA lista que `module-domain`.
            // Sin esto, abrir `shared-domain` a los tres layers habría convertido al kernel en
            // el agujero de la pureza que el gate existe para proteger: bastaría con importar
            // `@nestjs/common` en `value-object.base.ts` para que todo `domain/` arrastrara
            // framework por la puerta de atrás, sin que ninguna regla se enterase.
            {
              from: { element: { type: 'shared-domain' } },
              disallow: {
                to: {
                  module: {
                    origin: 'external',
                    source: ['@nestjs/*', 'typeorm', 'pino', 'class-validator', 'axios', 'argon2'],
                  },
                },
              },
            },
            // Regla 4: typeorm solo en module-infrastructure y database.
            {
              from: {
                element: {
                  types: { anyOf: ['module', 'common', 'config', 'bootstrap', 'shared', 'app'] },
                },
              },
              disallow: { to: { module: { origin: 'external', source: 'typeorm' } } },
            },
          ],
        },
      ],
    },
  },
  {
    // Regla 5: sin barrels en src/. `Program` matchea cualquier contenido: existir es el error.
    files: ['src/**/index.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Program',
          message:
            'Sin barrels en src/: importa el archivo concreto (regla 5, spec 2026-08-04-module-boundaries).',
        },
      ],
    },
  },
];
