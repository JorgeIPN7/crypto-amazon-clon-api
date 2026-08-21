import 'reflect-metadata';

import { ValidationPipe, VersioningType, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import compression from 'compression';
// `express` se declara como dependencia directa aunque llegue con `@nestjs/platform-express`:
// aquí se importa por nombre, y con el aislamiento estricto de pnpm una dependencia
// transitiva no es resoluble desde la raíz del proyecto. Sin declararla, los tests pasan
// —el resolver de Jest alcanza el store hoisted de pnpm— pero `node dist/src/main` muere
// con `Cannot find module 'express'`, así que solo se veía al desplegar.
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { setupOpenApi } from './bootstrap/openapi';
import type { AppConfig } from '@config/app.config';
import type { CorsConfig } from '@config/cors.config';
import type { DocsConfig } from '@config/docs.config';

export function applyGlobals(app: INestApplication, appCfg: AppConfig, corsCfg: CorsConfig): void {
  app.use(json({ limit: appCfg.bodyLimit }));
  app.use(urlencoded({ extended: true, limit: appCfg.bodyLimit }));

  // La CSP ya no se desactiva en desarrollo. Esa excepcion existia porque estorbaba a
  // Swagger UI, y significaba que un problema de CSP solo se manifestaba al desplegar. Con
  // Scalar servido desde el propio origen y su propia politica acotada a la ruta de la
  // documentacion, sobra: ahora lo que rompa, rompe en local.
  app.use(helmet());
  app.use(compression());

  if (corsCfg.enabled) {
    app.enableCors(corsCfg.options);
  }

  app.setGlobalPrefix(appCfg.globalPrefix);
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: appCfg.apiVersion,
  });

  // Sin `enableImplicitConversion`: convertía cada valor al tipo declarado *antes* de
  // validar, así que un `{"name": {"$ne": null}}` se volvía la cadena "[object Object]" y
  // pasaba `@IsString`, `@MinLength(2)` y `@MaxLength(120)` sin una sola queja. Los DTO
  // que sí necesitan coerción la piden explícitamente con `@Type(() => Number)`.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: false,
    }),
  );

  app.enableShutdownHooks();
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    abortOnError: false,
  });

  const logger = app.get(Logger);
  app.useLogger(logger);
  app.flushLogs();

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaughtException');
    process.exit(1);
  });

  const configService = app.get(ConfigService);
  const appCfg = configService.getOrThrow<AppConfig>('app');
  const corsCfg = configService.getOrThrow<CorsConfig>('cors');
  const docsCfg = configService.getOrThrow<DocsConfig>('docs');

  applyGlobals(app, appCfg, corsCfg);

  const httpAdapter = app.getHttpAdapter().getInstance() as {
    set?: (key: string, value: unknown) => void;
  };
  if (typeof httpAdapter.set === 'function') {
    httpAdapter.set('trust proxy', appCfg.trustProxy);
  }

  const docsPath = setupOpenApi(app, appCfg, docsCfg);

  await app.listen(appCfg.port, appCfg.host);

  const server = app.getHttpServer() as {
    requestTimeout: number;
    headersTimeout: number;
    keepAliveTimeout: number;
  };
  server.requestTimeout = appCfg.requestTimeoutMs;
  server.headersTimeout = appCfg.requestTimeoutMs + 1_000;
  server.keepAliveTimeout = appCfg.keepAliveTimeoutMs;

  const handleSignal = (signal: NodeJS.Signals): void => {
    logger.log(`Received ${signal}, starting graceful shutdown`, 'Bootstrap');
    const forceTimer = setTimeout(() => {
      logger.fatal({ signal }, 'Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, appCfg.shutdownTimeoutMs);
    forceTimer.unref();
    app
      .close()
      .then(() => {
        clearTimeout(forceTimer);
        logger.log('Graceful shutdown completed', 'Bootstrap');
        process.exit(0);
      })
      .catch((err: unknown) => {
        clearTimeout(forceTimer);
        logger.error({ err }, 'Error during graceful shutdown');
        process.exit(1);
      });
  };
  process.once('SIGTERM', () => handleSignal('SIGTERM'));
  process.once('SIGINT', () => handleSignal('SIGINT'));

  const url = await app.getUrl();
  logger.log(`Application ready at ${url}/${appCfg.globalPrefix}`, 'Bootstrap');
  if (docsPath) {
    logger.log(`OpenAPI docs available at ${url}/${docsPath}`, 'Bootstrap');
  }
}

// Arranca solo cuando este archivo es el punto de entrada del proceso. Los tests E2E
// importan `applyGlobals` desde aquí, y sin esta guarda el simple import levantaría un
// servidor HTTP real en cada worker de Jest, provocando colisiones de puerto.
if (require.main === module) {
  bootstrap().catch((err: unknown) => {
    console.error('Fatal bootstrap error', err);
    process.exit(1);
  });
}
