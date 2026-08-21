import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { Logger, PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';

import { appConfig } from '@config/app.config';
import { logConfig } from '@config/log.config';

import { LoggerModule } from '../../logger/logger.module';

const ORIGINAL_ENV = process.env;

/**
 * Este spec cubre solo el cableado del módulo. Toda la lógica que construye las opciones
 * —niveles, redacción, transport, serializers, filtrado de rutas de salud— vive en
 * `pino-options.ts` y se prueba ahí, con aserciones sobre valores.
 *
 * Antes había cuatro tests que variaban `process.env` y terminaban los cuatro en el mismo
 * `expect(logger).toBeDefined()`, una aserción incapaz de distinguir esas variaciones:
 * vaciando `buildPinoHttpOptions` seguían pasando. Ahora hay uno que comprueba que las
 * opciones resueltas llegan de verdad al provider de pino.
 */
describe('LoggerModule', () => {
  let moduleRef: TestingModule;

  afterEach(async () => {
    process.env = ORIGINAL_ENV;
    await moduleRef?.close();
  });

  it('debería exponer el Logger de pino con las opciones que resuelve la config', async () => {
    // Arrange
    process.env = { ...ORIGINAL_ENV, LOG_LEVEL: 'debug', LOG_PRETTY: 'false' };

    // Act
    moduleRef = await compileLoggerModule();

    // Assert
    expect(moduleRef.get(Logger, { strict: false })).toBeInstanceOf(Logger);
    const { pinoHttp } = moduleRef.get<{
      pinoHttp: { level: string; redact: { paths: string[] } };
    }>(PARAMS_PROVIDER_TOKEN, { strict: false });
    expect(pinoHttp.level).toBe('debug');
    expect(pinoHttp.redact.paths).toContain('req.headers.authorization');
  });
});

// Helpers

const compileLoggerModule = (): Promise<TestingModule> =>
  Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [appConfig, logConfig] }),
      LoggerModule,
    ],
  }).compile();
