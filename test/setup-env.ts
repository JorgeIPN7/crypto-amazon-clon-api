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
 *     en la segunda corrida—. Sin esto apuntaban a `nest_base_template`, la misma base que
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
process.env.DB_DATABASE = process.env.DB_DATABASE_TEST ?? 'nest_base_template_test';

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
