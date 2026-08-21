import { readFileSync } from 'node:fs';

import { registerAs } from '@nestjs/config';

import { envSchema, type Env } from './env.schema';

export type DatabaseSslConfig = {
  ca?: string;
  rejectUnauthorized: boolean;
};

export type DatabaseConfig = {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  schema: string;
  ssl: DatabaseSslConfig | false;
  synchronize: boolean;
  migrationsRun: boolean;
  logging: boolean;
  poolMax: number;
  poolIdleTimeoutMs: number;
  connectionTimeoutMs: number;
};

/**
 * `synchronize: true` deja que TypeORM altere el esquema para que encaje con las
 * entidades: puede eliminar columnas y tablas, y con ellas los datos. Por eso NO se
 * toma directamente del entorno. La variable `DB_SYNCHRONIZE` solo puede APAGARLO;
 * encenderlo requiere además estar en `development`. Un `.env` de producción mal
 * copiado no puede tocar el esquema.
 */
export const resolveSynchronize = (env: Pick<Env, 'NODE_ENV' | 'DB_SYNCHRONIZE'>): boolean =>
  env.NODE_ENV === 'development' && env.DB_SYNCHRONIZE;

/** Las migraciones se aplican al arrancar fuera de development, nunca dentro. */
export const resolveMigrationsRun = (env: Pick<Env, 'NODE_ENV' | 'DB_MIGRATIONS_RUN'>): boolean =>
  env.NODE_ENV !== 'development' && env.DB_MIGRATIONS_RUN;

export const resolveSsl = (
  env: Pick<Env, 'DB_SSL' | 'DB_SSL_REJECT_UNAUTHORIZED' | 'DB_SSL_CA'>,
  readCa: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): DatabaseSslConfig | false => {
  if (!env.DB_SSL) {
    return false;
  }

  const ca = env.DB_SSL_CA ? readCa(env.DB_SSL_CA) : undefined;
  return { ca, rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED };
};

export const buildDatabaseConfig = (env: Env): DatabaseConfig => ({
  host: env.DB_HOST,
  port: env.DB_PORT,
  username: env.DB_USERNAME,
  password: env.DB_PASSWORD,
  database: env.DB_DATABASE,
  schema: env.DB_SCHEMA,
  ssl: resolveSsl(env),
  synchronize: resolveSynchronize(env),
  migrationsRun: resolveMigrationsRun(env),
  logging: env.DB_LOGGING,
  poolMax: env.DB_POOL_MAX,
  poolIdleTimeoutMs: env.DB_POOL_IDLE_TIMEOUT_MS,
  connectionTimeoutMs: env.DB_CONNECTION_TIMEOUT_MS,
});

export const databaseConfig = registerAs('database', (): DatabaseConfig =>
  buildDatabaseConfig(envSchema.parse(process.env)),
);
