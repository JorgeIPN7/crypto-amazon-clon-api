import { registerAs } from '@nestjs/config';

import { envSchema, type Env } from './env.schema';

export type AppConfig = {
  env: Env['NODE_ENV'];
  isProduction: boolean;
  /**
   * `staging` no es desarrollo: se despliega en infraestructura real, con datos y redes
   * internas. Todo lo que endurece la aplicación —sanitizar mensajes de error, activar
   * CSP— debe mirar este flag y no `isProduction`, o `staging` filtraría IPs internas y
   * trazas de stack al cliente. `database.config.ts` ya razona así con `synchronize`.
   */
  isProductionLike: boolean;
  isDevelopment: boolean;
  isTest: boolean;
  host: string;
  port: number;
  globalPrefix: string;
  apiVersion: string;
  trustProxy: number | string;
  bodyLimit: string;
  shutdownTimeoutMs: number;
  requestTimeoutMs: number;
  keepAliveTimeoutMs: number;
  healthHeapLimitBytes: number;
  healthRssLimitBytes: number;
};

export const appConfig = registerAs('app', (): AppConfig => {
  const env = envSchema.parse(process.env);
  const MB = 1024 * 1024;
  return {
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    isProductionLike: env.NODE_ENV === 'production' || env.NODE_ENV === 'staging',
    isDevelopment: env.NODE_ENV === 'development',
    isTest: env.NODE_ENV === 'test',
    host: env.HOST,
    port: env.PORT,
    globalPrefix: env.GLOBAL_PREFIX,
    apiVersion: env.API_VERSION,
    trustProxy: env.TRUST_PROXY,
    bodyLimit: env.BODY_LIMIT,
    shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    requestTimeoutMs: env.REQUEST_TIMEOUT_MS,
    keepAliveTimeoutMs: env.KEEP_ALIVE_TIMEOUT_MS,
    healthHeapLimitBytes: env.HEALTH_HEAP_LIMIT_MB * MB,
    healthRssLimitBytes: env.HEALTH_RSS_LIMIT_MB * MB,
  };
});
