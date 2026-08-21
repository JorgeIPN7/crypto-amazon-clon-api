import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types';

import { AppModule } from '../../src/app.module';
import { setupOpenApi } from '../../src/bootstrap/openapi';
import type { AppConfig } from '../../src/config/app.config';
import type { CorsConfig } from '../../src/config/cors.config';
import type { DocsConfig } from '../../src/config/docs.config';
import { applyGlobals } from '../../src/main';

export type TestApp = {
  app: INestApplication<App>;
  appConfig: AppConfig;
  corsConfig: CorsConfig;
  /** Prefijo completo de las rutas versionadas, p. ej. /api/v1. */
  prefix: string;
  /** Ruta montada de la documentación, o null si no se pidió o está deshabilitada. */
  docsPath: string | null;
};

/**
 * Monta la aplicación real —el mismo `AppModule` y los mismos globals que producción—
 * para que los E2E ejerciten el pipeline completo: pipes, filtros, interceptores y base
 * de datos. Devuelve también la config para no tener que hardcodear el prefijo en cada
 * spec: si cambia `GLOBAL_PREFIX`, los tests siguen apuntando bien.
 */
export type CreateTestAppOptions = {
  /**
   * Monta también la documentación OpenAPI.
   *
   * `applyGlobals` no la incluye —vive en `setupOpenApi`, que `main.ts` llama aparte— así que sin
   * esto los E2E no verían ninguna de sus rutas.
   */
  withDocs?: boolean;
};

export async function createTestApp({
  withDocs = false,
}: CreateTestAppOptions = {}): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication<INestApplication<App>>({
    bufferLogs: false,
    logger: false,
  });
  app.useLogger(false);

  const configService = app.get(ConfigService);
  const appConfig = configService.getOrThrow<AppConfig>('app');
  const corsConfig = configService.getOrThrow<CorsConfig>('cors');

  applyGlobals(app, appConfig, corsConfig);

  let docsPath: string | null = null;
  if (withDocs) {
    docsPath = setupOpenApi(app, appConfig, configService.getOrThrow<DocsConfig>('docs'));
  }

  await app.init();

  return {
    app,
    appConfig,
    corsConfig,
    prefix: `/${appConfig.globalPrefix}/v${appConfig.apiVersion}`,
    docsPath,
  };
}
