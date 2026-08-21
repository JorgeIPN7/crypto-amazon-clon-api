import { appConfig, type AppConfig } from './app.config';
import { authConfig, type AuthConfig } from './auth.config';
import { corsConfig, type CorsConfig } from './cors.config';
import { databaseConfig, type DatabaseConfig } from './database.config';
import { docsConfig, type DocsConfig } from './docs.config';
import { logConfig, type LogConfig } from './log.config';
import { throttlerConfig, type ThrottlerConfigValues } from './throttler.config';

/** Los namespaces que `ConfigModule.forRoot({ load })` registra. Vivía en el barrel de config. */
export const configurations = [
  appConfig,
  corsConfig,
  databaseConfig,
  logConfig,
  throttlerConfig,
  docsConfig,
  authConfig,
];

export type Configurations = {
  app: AppConfig;
  cors: CorsConfig;
  database: DatabaseConfig;
  log: LogConfig;
  throttler: ThrottlerConfigValues;
  docs: DocsConfig;
  auth: AuthConfig;
};
