import type { AppConfig } from '../../src/config/app.config';
import type { AuthConfig } from '../../src/config/auth.config';
import type { DatabaseConfig } from '../../src/config/database.config';

/**
 * Factories de configuración para tests. Viven en `test/helpers/` —y no dentro de un
 * módulo— porque los consumen tres capas distintas: `bootstrap/`, `database/` y
 * `modules/health/`. Se importan con el alias `@test/`.
 *
 * Sin ellas, cada spec reconstruía el objeto entero a mano, así que añadir un campo a
 * `AppConfig` rompía la compilación en varios sitios a la vez sin aportar nada.
 */
export const buildAppConfig = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  env: 'test',
  isProduction: false,
  isProductionLike: false,
  isDevelopment: false,
  isTest: true,
  host: '0.0.0.0',
  port: 8888,
  globalPrefix: 'api',
  apiVersion: '1',
  trustProxy: 0,
  bodyLimit: '1mb',
  shutdownTimeoutMs: 1_000,
  requestTimeoutMs: 5_000,
  keepAliveTimeoutMs: 5_000,
  healthHeapLimitBytes: 300 * 1024 * 1024,
  healthRssLimitBytes: 600 * 1024 * 1024,
  ...overrides,
});

export const buildAuthConfig = (overrides: Partial<AuthConfig> = {}): AuthConfig => ({
  // Cumple el mínimo de 32 caracteres de `env.schema`; el valor en sí es irrelevante.
  jwtSecret: 'test-secret-of-at-least-32-characters!!',
  // Corta a propósito: un spec que necesite un token expirado no debe esperar una hora.
  jwtExpiresInSeconds: 60,
  ...overrides,
});

export const buildDatabaseConfig = (overrides: Partial<DatabaseConfig> = {}): DatabaseConfig => ({
  host: 'localhost',
  port: 5432,
  username: 'postgres',
  password: 'postgres',
  database: 'crypto_amazon_clon_api',
  schema: 'public',
  ssl: false,
  synchronize: false,
  migrationsRun: false,
  logging: false,
  poolMax: 10,
  poolIdleTimeoutMs: 30_000,
  connectionTimeoutMs: 10_000,
  ...overrides,
});

/**
 * Las credenciales del proveedor custodial sin las que `envSchema` no acepta `staging` ni
 * `production`.
 *
 * Se centralizan aquí porque varios casos de `src/config/__tests__/` parsean un entorno
 * production-like para comprobar algo que no tiene ninguna relación con estas credenciales —los
 * flags derivados de `NODE_ENV`, la guarda de `synchronize`, el veto de `JWT_SECRET`—, y sin
 * ellas fallarían señalando al refine equivocado.
 *
 * ⚠️ **La razón se escribe sin números a propósito.** Una versión anterior de este comentario
 * publicaba cuatro recuentos —«cuatro casos», «uno en cada spec», «de los cinco que hay», «seis
 * ejecuciones»— y los cuatro eran falsos o caducaron dentro de su propio commit: los puntos de
 * uso son cinco repartidos en cuatro specs, uno de los `it.each` implicados tiene cuatro
 * entradas, y el número de specs de esa carpeta cambia cada vez que alguien añade uno. El dato
 * que no caduca es POR QUÉ están aquí; el cuántos se mide con
 * `grep -rn PRODUCTION_LIKE src/config/__tests__/` el día que haga falta.
 *
 * ⚠️ La clave es `0x` + 64 ceros a propósito, y NO un hexadecimal de aspecto real: la regla
 * genérica de gitleaks —el gate de secretos de `.github/workflows/security.yml`— combina palabra
 * clave con entropía de Shannon, y una cadena de ceros tiene entropía nula. **Medido con la
 * herramienta real**, no razonado: `gitleaks:v8.30.1 detect --no-git` sobre este árbol marca
 * diez hexadecimales realistas de `docs/plans/` —y ninguna de las claves de ceros—, que es lo
 * que documenta `.gitleaksignore`. El criterio, con la
 * medición, está en el §7.1 de
 * `docs/specs/2026-08-27-ethereum-gas-pump-wallets-design.md`. Satisface el formato que exige
 * `envSchema` sin poder confundirse con una clave, ni por un humano ni por un escáner.
 */
export const PRODUCTION_LIKE_WALLETS_ENV: Readonly<Record<string, string>> = {
  TATUM_API_KEY: 'test-api-key',
  WALLETS_MASTER_ADDRESS: `0x${'a'.repeat(40)}`,
  WALLETS_MASTER_PRIVATE_KEY: `0x${'0'.repeat(64)}`,
};

/**
 * Todo lo que `envSchema` exige para aceptar `staging`/`production`: las credenciales de arriba
 * más el `JWT_SECRET`. Se mantienen separadas porque hay un caso que necesita justo lo contrario
 * —`auth.config.spec.ts` comprueba que production SIN `JWT_SECRET` se rechaza— y fundirlas en una
 * sola constante lo dejaría sin forma de expresarse.
 */
export const PRODUCTION_LIKE_ENV: Readonly<Record<string, string>> = {
  JWT_SECRET: 'x'.repeat(32),
  ...PRODUCTION_LIKE_WALLETS_ENV,
};
