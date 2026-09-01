/**
 * Corre antes de cargar los módulos de cada suite (`setupFiles` en ambos configs de Jest),
 * así que llega a tiempo de que `ConfigModule.forRoot()` lea el entorno al construir el
 * `AppModule`. `process.env` gana sobre el fichero `.env` en el merge de `@nestjs/config`,
 * de modo que lo que se fija aquí es lo que ve la aplicación bajo test.
 *
 * Apunta a una base propia por dos motivos:
 *
 *  1. Los E2E hacen TRUNCATE en cada `beforeEach` —lo necesitan para afirmar conteos
 *     exactos y para ser repetibles, porque si no el índice único de email devolvería 409
 *     en la segunda corrida—. Sin esto apuntaban a `crypto_amazon_clon_api`, la misma base que
 *     usa `pnpm start:dev`, así que cada `pnpm test:e2e` borraba los datos locales.
 *
 *  2. Con `NODE_ENV=development`, `resolveSynchronize()` permite que `DB_SYNCHRONIZE=true`
 *     deje a TypeORM alterar el esquema. Fijando `test` esa guarda vuelve a estar armada
 *     durante los tests, que es justamente lo que `database.config.spec.ts` da por hecho.
 *
 * El resto de la conexión (host, puerto, credenciales) se hereda del `.env`, para que
 * quien tenga el contenedor en un puerto distinto no necesite configurar nada más.
 */
process.env.NODE_ENV = 'test';
process.env.DB_DATABASE = process.env.DB_DATABASE_TEST ?? 'crypto_amazon_clon_api_test';

// Los E2E nunca deben tocar el esquema: para eso están las migraciones.
process.env.DB_SYNCHRONIZE = 'false';

// El AppModule bajo test lee `authConfig` directamente del entorno. Sin esto,
// `resolveJwtSecret()` caería al default de desarrollo — funciona en test, pero imprime
// su warning en cada suite y deja el secret de los tokens implícito. `??=` respeta un
// secret que venga del entorno del desarrollador.
process.env.JWT_SECRET ??= 'e2e-test-secret-of-at-least-32-chars!!';

// Los E2E arrancan la aplicación real, y varias suites provocan 404 y 401 a propósito para
// afirmar su forma. Pino los escribe a stdout como JSON, así que la salida de una corrida
// verde llega con volcados que parecen fallos y que obligan a distinguir a ojo el ruido
// esperado del error de verdad. `??=` respeta un nivel explícito del shell: para depurar una
// suite basta `LOG_LEVEL=info pnpm test:e2e`.
process.env.LOG_LEVEL ??= 'silent';

// El worker único de la suite E2E (`maxWorkers: 1`) acumula el heap de ~10 arranques de
// AppModule en un mismo proceso. El umbral de 300 MB del `.env` es tuning de producción
// (un proceso, una app) y bajo test produce 503 falsos intermitentes en el indicador
// `memory_heap` de `/health` — medido: 2 de 6 corridas completas rojas (2026-08-06).
// 1024 sigue detectando una fuga real desbocada. `??=` respeta un valor explícito del
// shell, mismo patrón que JWT_SECRET.
process.env.HEALTH_HEAP_LIMIT_MB ??= '1024';

// El RSS quedó fuera de aquel ajuste, y era la mitad que faltaba: `/health` y
// `/health/readiness` ejecutan `memory_heap` Y `memory_rss`, así que subir solo el heap deja
// el 503 a un indicador de distancia. Medido el 2026-08-13 sobre `pnpm test:e2e:ci` con la
// suite ENTERA en verde: el proceso de Jest pico en 498 MB de RSS contra el límite de 600 del
// `.env` — 83 %, un margen de 102 MB para 12 arranques de AppModule en un worker único.
// No es teórico: la CI de ese día se puso roja exactamente ahí. Un fallo previo dejó 12 apps
// sin cerrar y `health.e2e-spec.ts`, que corre la última, respondió 503 a los tres tests con
// indicadores mientras `liveness` —que no ejecuta ninguno— seguía en 200.
// 2048 mantiene el mismo criterio que el heap: absorbe el coste del entorno de test y sigue
// cazando una fuga desbocada.
process.env.HEALTH_RSS_LIMIT_MB ??= '2048';

// -----------------------------------------------------------------------------
//  Contexto `wallets`: el proveedor custodial, apuntado a loopback
// -----------------------------------------------------------------------------
//
// ⚠️ ESTA PRIMERA LÍNEA ES UN CONTROL DE SEGURIDAD, no configuración de comodidad. Sin ella el
// adaptador cae al default de `env.schema.ts` (`TATUM_API_URL` → `https://api.tatum.io`), que es
// la API real: `pnpm test:e2e` gastaría créditos en cada corrida y, en la suite de transferencias,
// MOVERÍA DINERO de la master. Ninguna otra aserción de la suite se pondría roja por eso — al
// contrario, todas pasarían. Por eso esta línea no puede ser el único control: el guardián del
// guardián es un caso que afirma sobre la configuración YA RESUELTA por la aplicación, y su sitio
// es `src/modules/wallets/__tests__/wallets.e2e-spec.ts`. Un borrado accidental de esta línea
// tiene que ponerse rojo en algún sitio.
//
// El puerto es el fijo de `test/helpers/tatum-stub-server.ts`, y tiene que ser fijo: la
// configuración se congela al construir el `AppModule` (`cache: true`), antes de que un puerto
// efímero se pudiera conocer. El literal está duplicado a propósito —importar el helper cargaría
// `node:http` en el arranque de TODAS las suites— y lo que impide que las dos copias diverjan es
// el caso «debería apuntar la URL del proveedor al puerto exacto del stub» de
// `src/__tests__/test-env-defaults.spec.ts`, que compara esta cadena con `TATUM_STUB_BASE_URL`.
process.env.TATUM_API_URL ??= 'http://127.0.0.1:14567';

// El stub no valida la clave; lo que importa es que exista, porque `wallets.config.ts` la exige
// junto con las otras dos —o las tres, o los placeholders— y porque el adaptador la manda en
// `x-api-key`. `??=` respeta un valor explícito del shell, mismo patrón que JWT_SECRET.
process.env.TATUM_API_KEY ??= 'stub-api-key-for-e2e';

// Corto a propósito. El caso del timeout espera a que la petición expire de verdad contra un stub
// que no responde; con el timeout de producción (10 s por defecto) no cabría holgadamente en el
// `testTimeout` de 30 s de la suite E2E y el rojo hablaría del reloj, no del libro de
// transferencias. Sigue cumpliendo el refine de `env.schema.ts` que exige
// `TATUM_TIMEOUT_MS < REQUEST_TIMEOUT_MS` (15000 en el `.env`).
process.env.TATUM_TIMEOUT_MS ??= '1500';

// ⚠️ Los dos valores siguientes SON UNA PAREJA y no se pueden tocar por separado: desde el
// 2026-08-31 `MasterKeyStartupCheck` corre en el arranque del módulo, deriva la dirección desde la
// clave privada y aborta si no coincide con la configurada. Cambiar uno sin el otro tumba la suite
// E2E ENTERA, incluidas las suites que no tienen nada que ver con `wallets`, porque cada
// `createTestApp()` arranca el `AppModule` completo. Medido cambiando UN carácter de la dirección
// (…bdf → …bde) y corriendo `pnpm test:e2e`: 176 de 200 casos rojos en 16 de 19 suites, todos con
// el mismo mensaje de configuración y ninguno hablando del test que se estaba escribiendo.
//
// ⚠️ Y fijarlos aquí NO es cosmética: apaga `usingDevPlaceholders`, que es la bandera con la que
// esa comprobación se salta a sí misma. O sea que a partir de esta línea la suite E2E ejercita la
// derivación de verdad en cada arranque, cosa que con los placeholders no hacía.
//
// Es el vector de prueba canónico de secp256k1 (clave privada = 1), de entropía NULA: no hay nada
// que filtrar porque no controla fondo alguno. **Medido en este repo**, con el mismo `@noble` que
// usa `master-address.derivation.ts` (keccak256 de la pública SIN comprimir menos su byte `0x04`,
// últimos 20 bytes):
//   priv 0x00…01  ->  addr 0x7e5f4552091a69125d5dfcb7b8c2659029395bdf
process.env.WALLETS_MASTER_ADDRESS ??= '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf';
process.env.WALLETS_MASTER_PRIVATE_KEY ??=
  '0x0000000000000000000000000000000000000000000000000000000000000001';
