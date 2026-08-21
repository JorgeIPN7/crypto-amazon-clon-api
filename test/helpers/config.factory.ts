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
  database: 'nest_base_template',
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
