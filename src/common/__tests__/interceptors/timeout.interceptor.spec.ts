import { RequestTimeoutException, type ExecutionContext } from '@nestjs/common';
import { SSE_METADATA } from '../../nest-metadata.constants';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of, throwError, timer } from 'rxjs';
import { map } from 'rxjs/operators';

import { SkipTimeout, TimeoutMs } from '../../decorators/timeout.decorator';
import { TimeoutInterceptor } from '../../interceptors/timeout.interceptor';

describe('TimeoutInterceptor', () => {
  describe('intercept()', () => {
    it('debería dejar pasar sin cambios las respuestas rápidas', async () => {
      // Arrange
      const { interceptor } = buildInterceptor(100);
      const handler = { handle: () => of('fast') };

      // Act
      const result = await firstValueFrom(interceptor.intercept(buildHttpContext(), handler));

      // Assert
      expect(result).toBe('fast');
    });

    it('debería lanzar RequestTimeoutException cuando el handler excede el timeout', async () => {
      // Arrange
      const { interceptor } = buildInterceptor(20);
      const slowHandler = { handle: () => timer(100).pipe(map(() => 'late')) };

      // Act + Assert
      await expect(
        firstValueFrom(interceptor.intercept(buildHttpContext(), slowHandler)),
      ).rejects.toBeInstanceOf(RequestTimeoutException);
    });

    it('debería relanzar tal cual los errores que no son de timeout', async () => {
      // Arrange
      const { interceptor } = buildInterceptor(100);
      const original = new Error('boom');
      const failingHandler = { handle: () => throwError(() => original) };

      // Act + Assert
      await expect(
        firstValueFrom(interceptor.intercept(buildHttpContext(), failingHandler)),
      ).rejects.toBe(original);
    });

    it('debería omitir los contextos que no son http', async () => {
      // Arrange
      const { interceptor } = buildInterceptor(20);
      const rpcContext = buildContextOfType('rpc');
      const slowHandler = { handle: () => timer(80).pipe(map(() => 'ok')) };

      // Act
      const result = await firstValueFrom(interceptor.intercept(rpcContext, slowHandler));

      // Assert
      expect(result).toBe('ok');
    });
  });

  /**
   * Estos tres casos son la razón de existir de los decoradores, y ninguno se ejercía: el
   * helper devolvía un `Reflector` desnudo y todos los tests usaban un handler sin decorar,
   * así que las tres ramas de `intercept()` quedaban muertas por muchos casos que se
   * añadieran. Aquí se usa un `Probe` decorado de verdad, no un mock del Reflector.
   */
  describe('intercept() con handlers decorados', () => {
    it('debería no aplicar timeout a un handler con @SkipTimeout()', async () => {
      // Arrange
      const { interceptor } = buildInterceptor(20);
      class Probe {
        @SkipTimeout()
        handler(): void {
          // Solo existe para portar la metadata del decorador.
        }
      }
      const context = buildContextForHandler(Probe.prototype.handler, Probe);
      const slowHandler = { handle: () => timer(80).pipe(map(() => 'tarde pero válido')) };

      // Act
      const result = await firstValueFrom(interceptor.intercept(context, slowHandler));

      // Assert
      expect(result).toBe('tarde pero válido');
    });

    it('debería usar el timeout de @TimeoutMs() por encima del valor por defecto', async () => {
      // Arrange: el default es holgado, el override es corto. Si no se aplicara, pasaría.
      const { interceptor } = buildInterceptor(5_000);
      class Probe {
        @TimeoutMs(20)
        handler(): void {
          // Solo existe para portar la metadata del decorador.
        }
      }
      const context = buildContextForHandler(Probe.prototype.handler, Probe);
      const slowHandler = { handle: () => timer(200).pipe(map(() => 'late')) };

      // Act + Assert
      await expect(
        firstValueFrom(interceptor.intercept(context, slowHandler)),
      ).rejects.toBeInstanceOf(RequestTimeoutException);
    });

    // Un stream SSE es deliberadamente largo: aplicarle el timeout de una petición normal
    // lo cortaría a los 15 s.
    it('debería no aplicar timeout a un handler marcado como SSE', async () => {
      // Arrange
      const { interceptor } = buildInterceptor(20);
      const handler = (): void => {
        // Solo existe para portar la metadata de SSE.
      };
      Reflect.defineMetadata(SSE_METADATA, true, handler);
      const context = buildContextForHandler(handler, class {});
      const slowHandler = { handle: () => timer(80).pipe(map(() => 'evento')) };

      // Act
      const result = await firstValueFrom(interceptor.intercept(context, slowHandler));

      // Assert
      expect(result).toBe('evento');
    });
  });
});

// Helpers

const buildContextOfType = (type: string): ExecutionContext =>
  ({
    getType: () => type,
    getHandler: () => () => null,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({}), getResponse: () => ({}) }),
  }) as unknown as ExecutionContext;

const buildHttpContext = (): ExecutionContext => buildContextOfType('http');

/** Contexto http que apunta a un handler concreto, para que el Reflector lea su metadata. */
const buildContextForHandler = (handler: object, target: object): ExecutionContext =>
  ({
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => target,
    switchToHttp: () => ({ getRequest: () => ({}), getResponse: () => ({}) }),
  }) as unknown as ExecutionContext;

const buildInterceptor = (
  timeoutMs = 50,
): { interceptor: TimeoutInterceptor; reflector: Reflector } => {
  const reflector = new Reflector();
  const config = {
    getOrThrow: () => ({ requestTimeoutMs: timeoutMs }),
  } as unknown as ConfigService;
  return { interceptor: new TimeoutInterceptor(config, reflector), reflector };
};
