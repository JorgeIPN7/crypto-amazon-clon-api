import { z } from 'zod';

// Zod 4: `.default()` takes the OUTPUT type and short-circuits parsing, so it cannot
// receive a raw string here — this schema outputs a boolean. Use `.prefault()` instead,
// which substitutes an INPUT value and still runs it through the transform below.
const booleanString = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1');

/**
 * Distingue "variable ausente" de "variable presente pero vacía".
 *
 * `z.coerce.number()` aplica `Number(input)`, y `Number('')` es `0`. Sin esto, un
 * `SHUTDOWN_TIMEOUT_MS=` en el `.env` —o un task definition que renderiza vacío— pasaba
 * la validación como cero, y `main.ts` acababa forzando `process.exit(1)` en el tick
 * siguiente a cada SIGTERM, cortando las peticiones en vuelo en todos los despliegues.
 * `.default()` no protege de esto: en Zod solo actúa sobre `undefined`.
 *
 * Ausente sigue tomando el default; vacía es un error de configuración y se rechaza.
 */
const rejectEmpty = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? Number.NaN : value),
    schema,
  );

/** Entero coercionado desde string, que es como llega todo en `process.env`. */
const int = () => z.coerce.number().int();

const trustProxyValue = rejectEmpty(z.union([int().nonnegative(), z.string().min(1)])).default(0);

/**
 * Trocea una lista separada por comas. Vive aquí y no dentro del schema a propósito:
 * `@nestjs/config` solo copia de vuelta a `process.env` los valores validados que son
 * `string | number | boolean` (ver `assignVariablesToProcess`), y descarta el resto en
 * silencio. Como los factories de `registerAs` vuelven a parsear `process.env`, un
 * `.transform()` que produjera un array haría que el valor del fichero `.env` se
 * perdiera y el factory acabara aplicando el default — sin ningún error visible.
 *
 * Por eso este schema emite **solo escalares** y el troceo lo hacen los factories.
 * El test `debería emitir solo valores escalares` de `env.schema.spec.ts` lo vigila.
 */
export const splitList = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),

  PORT: rejectEmpty(int().positive()).default(8888),
  HOST: z.string().default('0.0.0.0'),
  GLOBAL_PREFIX: z.string().default('api'),
  API_VERSION: z.string().default('1'),

  TRUST_PROXY: trustProxyValue,

  CORS_ENABLED: booleanString.prefault('true'),
  CORS_CREDENTIALS: booleanString.prefault('false'),
  // Lista separada por comas. Se trocea en `cors.config.ts` con `splitList`, no aquí.
  CORS_ORIGINS: z.string().default('*'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: booleanString.prefault('false'),
  // Lista separada por comas. Se trocea en `log.config.ts` con `splitList`, no aquí.
  LOG_REDACT_FIELDS: z
    .string()
    .default('req.headers.authorization,req.headers.cookie,password,token'),

  THROTTLER_TTL_MS: rejectEmpty(int().positive()).default(60_000),
  THROTTLER_LIMIT: rejectEmpty(int().positive()).default(100),

  // Apagado por defecto: `setupOpenApi` solo mira este flag, y las rutas de la documentación
  // se registran fuera del pipeline de Nest, así que el ThrottlerGuard global no las cubre.
  // Un despliegue que olvide la variable no debe acabar publicando el inventario de
  // endpoints y esquemas. En local se enciende desde `.env.example`, que ya trae `true`.
  DOCS_ENABLED: booleanString.prefault('false'),
  DOCS_PATH: z.string().default('docs'),

  // Basic Auth opcional sobre la documentación. Ausentes las dos, queda abierta; definidas las
  // dos, exige credenciales. Una sola definida es un error de arranque — ver el `.refine` del
  // final del archivo. No sustituye al feature flag: `DOCS_ENABLED=false` sigue siendo la
  // protección primaria en producción, y esto es lo que permite publicarla en staging.
  DOCS_USERNAME: z.string().min(1).optional(),
  DOCS_PASSWORD: z.string().min(1).optional(),

  // --- Auth -----------------------------------------------------------------
  // Sin default aquí a propósito: el default depende de NODE_ENV (igual que
  // DB_SYNCHRONIZE) y lo resuelve `resolveJwtSecret()` en auth.config.ts. El
  // refine del final del archivo hace que staging/production sin secret NI
  // ARRANQUEN — un JWT firmado con un default publicado es una puerta abierta.
  JWT_SECRET: z.string().min(32).optional(),
  JWT_EXPIRES_IN_S: rejectEmpty(int().positive()).default(3600),

  // Credenciales del PRIMER admin. Solo las lee `pnpm seed:admin` (nunca la app).
  // Par ambas-o-ninguna, como DOCS_USERNAME/DOCS_PASSWORD. `z.email()` y no
  // `z.string().email()`: la forma encadenada está deprecada en Zod 4.
  ADMIN_EMAIL: z.email().optional(),
  ADMIN_PASSWORD: z.string().min(12).optional(),

  // `positive`, no `nonnegative`: con 0 el temporizador de gracia vence antes de que
  // `app.close()` resuelva y el proceso muere a mitad del cierre ordenado.
  SHUTDOWN_TIMEOUT_MS: rejectEmpty(int().positive()).default(10_000),
  REQUEST_TIMEOUT_MS: rejectEmpty(int().positive()).default(15_000),
  // Aquí 0 sí es significativo: desactiva el timeout de keep-alive en Node.
  KEEP_ALIVE_TIMEOUT_MS: rejectEmpty(int().nonnegative()).default(5_000),
  BODY_LIMIT: z.string().default('1mb'),

  HEALTH_HEAP_LIMIT_MB: rejectEmpty(int().positive()).default(300),
  HEALTH_RSS_LIMIT_MB: rejectEmpty(int().positive()).default(600),

  // --- PostgreSQL -----------------------------------------------------------
  DB_HOST: z.string().min(1).default('localhost'),
  DB_PORT: rejectEmpty(int().positive().max(65_535)).default(5432),
  DB_USERNAME: z.string().min(1).default('postgres'),
  DB_PASSWORD: z.string().default('postgres'),
  DB_DATABASE: z.string().min(1).default('nest_base_template'),
  DB_SCHEMA: z.string().min(1).default('public'),

  // TLS. En local Postgres corre sin cifrado; contra RDS se activa DB_SSL=true.
  // `DB_SSL_REJECT_UNAUTHORIZED=false` cifra pero NO verifica la identidad del
  // servidor: úsalo solo si no puedes montar el bundle de CA de AWS.
  DB_SSL: booleanString.prefault('false'),
  DB_SSL_REJECT_UNAUTHORIZED: booleanString.prefault('true'),
  DB_SSL_CA: z.string().optional(),

  // `DB_SYNCHRONIZE` solo surte efecto en development — ver `database.config.ts`.
  // Fuera de ahí el esquema evoluciona únicamente con migraciones.
  DB_SYNCHRONIZE: booleanString.prefault('false'),
  DB_MIGRATIONS_RUN: booleanString.prefault('false'),
  DB_LOGGING: booleanString.prefault('false'),

  DB_POOL_MAX: rejectEmpty(int().positive()).default(10),
  DB_POOL_IDLE_TIMEOUT_MS: rejectEmpty(int().nonnegative()).default(30_000),
  DB_CONNECTION_TIMEOUT_MS: rejectEmpty(int().positive()).default(10_000),
});

/**
 * La validación cruzada de credenciales vive aquí y no en `docs.config.ts` porque `registerAs`
 * es perezoso: en el factory, el fallo aparecería en la primera petición a la documentación en
 * vez de al arrancar, que es justo cuando alguien puede reaccionar.
 *
 * La detección de las variables **retiradas** (`SWAGGER_*`) no puede vivir aquí: `z.object()`
 * hace *strip* de las claves desconocidas antes de ejecutar los refines, así que dentro del
 * refine ya no existen. Y relajar el objeto a `passthrough` para verlas dejaría pasar todo
 * `process.env`, rompiendo el test que garantiza que el schema solo emite escalares. Está en
 * `validate-env.ts`, donde el objeto crudo todavía llega entero.
 */
export const envSchema = baseEnvSchema
  .refine((env) => (env.DOCS_USERNAME === undefined) === (env.DOCS_PASSWORD === undefined), {
    message:
      'DOCS_USERNAME and DOCS_PASSWORD must both be set or both be omitted: with only one, ' +
      'the Basic Auth middleware never mounts and the docs are published without asking for ' +
      'credentials.',
    path: ['DOCS_PASSWORD'],
  })
  .refine(
    (env) =>
      !(env.NODE_ENV === 'staging' || env.NODE_ENV === 'production') ||
      env.JWT_SECRET !== undefined,
    {
      message:
        'JWT_SECRET is required in staging/production: without it the guard would sign with ' +
        'the development default, which is public in the repository.',
      path: ['JWT_SECRET'],
    },
  )
  .refine((env) => (env.ADMIN_EMAIL === undefined) === (env.ADMIN_PASSWORD === undefined), {
    message:
      'ADMIN_EMAIL and ADMIN_PASSWORD must both be set or both be omitted: the first-admin ' +
      'seed needs them together.',
    path: ['ADMIN_PASSWORD'],
  });

export type Env = z.infer<typeof envSchema>;
