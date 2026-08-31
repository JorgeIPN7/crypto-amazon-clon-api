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
  ADMIN_PASSWORD: z.string().min(8).optional(),

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
  DB_DATABASE: z.string().min(1).default('crypto_amazon_clon_api'),
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

  // --- Wallets: proveedor custodial (Tatum Gas Pump) ------------------------
  //
  // Las tres credenciales van `optional()` aquí y las hace obligatorias el refine del final,
  // exactamente igual que `JWT_SECRET`: el default depende de `NODE_ENV` y lo resuelve
  // `resolveTatumCredentials()` en `src/config/wallets.config.ts`. Un default de desarrollo
  // escrito aquí se aplicaría también en production, que es justo lo que ese refine impide.
  TATUM_API_KEY: z.string().min(1).optional(),

  // ⚠️ La dirección viaja SOLO como dirección (derivar, activar) y la clave SOLO como firma
  // (transferir): medido sobre `docs/tatum/gas-pump/openapi.json`, `TransferCustodialWallet`
  // tiene diez propiedades y ninguna se llama `owner`. Nada en el contrato del proveedor ata las
  // dos, así que una configuración con dirección y clave de cuentas distintas pasa toda la
  // validación y solo falla al enviar, con el gas ya gastado. Cerrarlo es derivar la dirección
  // desde la clave al arrancar; el formato es lo único que se puede comprobar aquí.
  WALLETS_MASTER_ADDRESS: z
    .string()
    .regex(
      /^0x[0-9a-fA-F]{40}$/,
      'WALLETS_MASTER_ADDRESS must be 0x followed by 40 hexadecimal characters.',
    )
    .optional(),

  // 66 caracteres: `0x` + 64 hexadecimales. Es la longitud exacta que el proveedor exige —
  // `TransferCustodialWallet.fromPrivateKey`, `minLength: 66` y `maxLength: 66`, medido sobre su
  // `openapi.json`. Sin el prefijo son 64 y la llamada muere allí, con el mensaje del proveedor.
  //
  // ⚠️ Obligatoria también con `WALLETS_ACTIVATION_PAYER=tatum`, y es fácil equivocarse:
  // `feesCovered` existe en UN solo esquema de los 32 (`ActivateGasPumpTatum`) y solo cubre la
  // ACTIVACIÓN. Para transferir sobre ETH hay exactamente dos cuerpos —medido—:
  // `TransferCustodialWallet`, que exige `fromPrivateKey`, y `TransferCustodialWalletKMS`, que
  // firma con el KMS del proveedor. El segundo es la condición de salida que el refine de
  // `WALLETS_NETWORK` deja fuera de este ciclo, así que aquí la clave no es opcional.
  WALLETS_MASTER_PRIVATE_KEY: z
    .string()
    .regex(
      /^0x[0-9a-fA-F]{64}$/,
      'WALLETS_MASTER_PRIVATE_KEY must be 0x followed by 64 hexadecimal characters.',
    )
    .optional(),

  // `z.url()` y no `z.string().url()`: la forma encadenada está marcada `@deprecated Use
  // z.url() instead.` en `node_modules/zod/v4/classic/schemas.d.cts` — mismo criterio que
  // `ADMIN_EMAIL`.
  TATUM_API_URL: z.url().default('https://api.tatum.io'),

  TATUM_TIMEOUT_MS: rejectEmpty(int().positive()).default(10_000),

  // Quién paga la comisión de la transacción de activación, que es lo mismo que decir CUÁL de los
  // dos cuerpos se envía a `POST /v3/gas-pump/activate`. Medido sobre
  // `docs/tatum/gas-pump/openapi.json`: su `oneOf` tiene siete esquemas y solo tres aceptan
  // `chain: ETH` — `ActivateGasPumpTatum` (`feesCovered: true`, la cobra el proveedor contra la
  // cuota de créditos), `ActivateGasPump` (`fromPrivateKey`, la paga la master en ETH) y
  // `ActivateGasPumpKMS` (`signatureId`), que exige el KMS y por eso no tiene valor aquí.
  //
  // Default `tatum` porque en testnet cuesta un crédito —«On the testnet, only one credit is
  // deducted from the monthly credit allowance for transaction fee», su propia documentación— y
  // no toca el saldo de la master, que es el punto único de fallo que nadie vigila todavía.
  WALLETS_ACTIVATION_PAYER: z.enum(['tatum', 'master']).default('tatum'),

  // ⚠️ Esta variable NO cambia de red: es una ETIQUETA, no un control. La red la decide la API
  // key —«to get two keys (testnet and mainnet)», su propia documentación— y no hay ningún campo
  // de red en ninguno de los 32 esquemas de su `openapi.json`, medido sobre el fichero buscando
  // una propiedad que case /network|testnet|mainnet/i: cero resultados. Lo único que declara es
  // cuál se CREE que es la key, y existe por una sola razón: es lo que permite bloquear el
  // arranque cuando esa creencia es `mainnet`. Una key de mainnet con esto en `testnet` mueve
  // dinero real igual, y este esquema no se entera.
  //
  // El enum ACEPTA `mainnet` y es el refine del final quien lo veta. Con `z.enum(['testnet'])` el
  // arranque diría `Invalid input: expected "testnet"` —medido con zod 4.4.3— y quien lo leyera
  // no sabría si es un veto nuestro o una errata suya.
  WALLETS_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
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
  })
  // Mismo criterio que el refine de JWT_SECRET, y por el mismo motivo: sin este veto la
  // aplicación arrancaría en production con los placeholders de desarrollo, cuya clave privada
  // son 64 ceros y está publicada en el repositorio. La diferencia con JWT_SECRET es que aquí el
  // placeholder ni siquiera puede firmar, así que el síntoma sería una transferencia fallida y no
  // una puerta abierta — pero el diagnóstico llegaría en producción, no al desplegar.
  //
  // El fallback que el mensaje nombra vive en `resolveTatumCredentials()`, dentro de
  // `src/config/wallets.config.ts`: ahí es donde las tres credenciales caen a los placeholders de
  // desarrollo cuando faltan. Este refine existe para que ese fallback NO pueda alcanzar a
  // staging ni a production — la guarda y el agujero que tapa son inseparables, y por eso el
  // mensaje describe el fallback en vez de limitarse a decir que falta una variable.
  .refine(
    (env) =>
      !(env.NODE_ENV === 'staging' || env.NODE_ENV === 'production') ||
      (env.TATUM_API_KEY !== undefined &&
        env.WALLETS_MASTER_ADDRESS !== undefined &&
        env.WALLETS_MASTER_PRIVATE_KEY !== undefined),
    {
      message:
        'TATUM_API_KEY, WALLETS_MASTER_ADDRESS and WALLETS_MASTER_PRIVATE_KEY are all required ' +
        'in staging/production: without them the wallets module falls back to the development ' +
        'placeholders, whose private key is 64 zeros and cannot sign anything.',
      path: ['WALLETS_MASTER_PRIVATE_KEY'],
    },
  )
  // El veto de mainnet es de arranque y no de despliegue a propósito: la clave privada de la
  // master viaja en el CUERPO de cada transferencia y vive en configuración en claro. Con dinero
  // real, cualquiera de las superficies de fuga que hoy están tapadas a mano —un serializador de
  // pino, un `error.cause`, un `console.warn`— pasa de incidente a robo. Lo dice el propio
  // proveedor en su `openapi.json`: «You should use the private keys only for testing a solution
  // you are building on the testnet of a blockchain». La condición de salida es su sistema de
  // gestión de claves, que además cambia la firma del puerto — `TransferCustodialWalletKMS`
  // devuelve un identificador de firma en lugar de un hash de transacción.
  .refine((env) => env.WALLETS_NETWORK !== 'mainnet', {
    message:
      'WALLETS_NETWORK=mainnet is blocked at startup: the master private key is held in plain ' +
      'configuration and travels in the body of every transfer. Real funds require the provider ' +
      'KMS, which also changes the port signature (signature id instead of transaction hash).',
    path: ['WALLETS_NETWORK'],
  })
  // Estrictamente menor, no menor o igual. Si el corte global llega primero, el interceptor
  // responde 408 y la llamada al proveedor sigue en vuelo: la fila del libro de transferencias se
  // queda en `submitting` —el estado del que nadie sabe salir— en lugar de en `unknown`, que es
  // lo que de verdad sabemos. Con el empate los dos temporizadores compiten y el resultado
  // depende del orden de los timers, que es peor que cualquiera de los dos comportamientos.
  .refine((env) => env.TATUM_TIMEOUT_MS < env.REQUEST_TIMEOUT_MS, {
    message:
      'TATUM_TIMEOUT_MS must be strictly lower than REQUEST_TIMEOUT_MS: otherwise the global ' +
      'timeout interceptor answers 408 first and the transfer ledger row is left in ' +
      '"submitting" with the provider call still in flight.',
    path: ['TATUM_TIMEOUT_MS'],
  });

export type Env = z.infer<typeof envSchema>;
