import {
  BadRequestException,
  HttpException,
  ServiceUnavailableException,
  type ArgumentsHost,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { HttpAdapterHost } from '@nestjs/core';
import type { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';

import { AllExceptionsFilter } from '../../filters/all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  describe('catch() with HttpException', () => {
    it('debería formatear una HttpException 4xx como payload de warning', () => {
      // Arrange
      const { filter, reply, logger } = buildFilter();

      // Act
      filter.catch(new BadRequestException('Invalid input'), buildHost());

      // Assert
      expect(reply).toHaveBeenCalledTimes(1);
      const [, payload, status] = reply.mock.calls[0];
      expect(status).toBe(400);
      expect(payload).toMatchObject({
        statusCode: 400,
        message: 'Invalid input',
        requestId: 'req-x',
      });
      expect(payload.error).toBeDefined();
      expect(logger.warn).toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('debería registrar una HttpException 5xx como error y no como fatal', () => {
      // Arrange
      const { filter, logger } = buildFilter();

      // Act
      filter.catch(new HttpException('Boom', 503), buildHost());

      // Assert
      expect(logger.error).toHaveBeenCalled();
      expect(logger.fatal).not.toHaveBeenCalled();
    });
  });

  describe('catch() with native Error', () => {
    // El escenario que motiva sanitizar: un fallo de conexión lleva la topología interna
    // en el mensaje (`connect ECONNREFUSED 10.0.1.5:5432`) y no debe salir en el body.
    it('debería ocultar el mensaje original cuando corre en un entorno desplegado', () => {
      // Arrange
      const { filter, reply } = buildProductionFilter();

      // Act
      filter.catch(new TypeError('connect ECONNREFUSED 10.0.1.5:5432'), buildHost());

      // Assert
      const [, payload] = reply.mock.calls[0];
      expect(payload.message).toBe('Internal server error');
      expect(payload.error).toBe('InternalServerError');
    });

    it('debería exponer el mensaje original y registrar fatal en desarrollo', () => {
      // Arrange
      const { filter, reply, logger } = buildFilter();

      // Act
      filter.catch(new TypeError('actual cause'), buildHost());

      // Assert
      const [, payload] = reply.mock.calls[0];
      expect(payload.message).toBe('actual cause');
      expect(logger.fatal).toHaveBeenCalled();
    });
  });

  // Lo que se lanza en un incidente real no siempre es un Error: una librería puede
  // hacer `throw 'string'` o rechazar una promesa con un objeto plano. Es justo la rama
  // que se recorre cuando algo va mal de verdad, y no estaba cubierta.
  describe('catch() with a thrown non-Error', () => {
    it.each([
      ['una cadena', 'algo se rompió'],
      ['un objeto plano', { code: 1 }],
      ['null', null],
    ])('debería responder 500 genérico cuando se lanza %s', (_label, thrown) => {
      // Arrange
      const { filter, reply } = buildFilter();

      // Act
      filter.catch(thrown, buildHost());

      // Assert
      const [, payload, status] = reply.mock.calls[0];
      expect(status).toBe(500);
      expect(payload.message).toBe('Internal server error');
      expect(payload.error).toBe('InternalServerError');
    });
  });

  describe('catch() with ZodError', () => {
    it('debería responder 400 ValidationError incluyendo el detalle de los issues', () => {
      // Arrange
      const { filter, reply } = buildFilter();
      const schema = z.object({ name: z.string().min(3) });
      const result = schema.safeParse({ name: 'a' });
      if (result.success) {
        throw new Error('expected zod failure');
      }

      // Act
      filter.catch(result.error, buildHost());

      // Assert
      const [, payload, status] = reply.mock.calls[0];
      expect(status).toBe(400);
      expect(payload.error).toBe('ValidationError');
      expect(Array.isArray(payload.details)).toBe(true);
    });
  });

  describe('catch() with non-http context', () => {
    it('debería relanzar los errores nativos en vez de formatearlos', () => {
      // Arrange
      const { filter } = buildFilter();
      const host = {
        getType: () => 'rpc',
        switchToHttp: () => ({ getRequest: () => ({}), getResponse: () => ({}) }),
      } as unknown as ArgumentsHost;

      // Act + Assert
      expect(() => filter.catch(new Error('rpc'), host)).toThrow('rpc');
    });

    it('debería ignorar en silencio lo que no sea un Error fuera de contexto http', () => {
      // Arrange
      const { filter, reply } = buildFilter();
      const host = {
        getType: () => 'rpc',
        switchToHttp: () => ({ getRequest: () => ({}), getResponse: () => ({}) }),
      } as unknown as ArgumentsHost;

      // Act
      filter.catch('no es un Error', host);

      // Assert
      expect(reply).not.toHaveBeenCalled();
    });
  });

  /**
   * Fija el formato del 503 de `/health`, que hasta ahora no cubría ningún test.
   *
   * `HealthCheckService.check()` lanza `ServiceUnavailableException(result)` con el
   * `HealthCheckResult` de Terminus dentro, y este filtro lo reescribe al sobre estándar:
   * `@SkipTransform()` exime del interceptor de éxito, no de aquí. El resultado es que un 200 de
   * health sale en formato nativo de Terminus y un 503 sale envuelto — dos formatos para el mismo
   * endpoint según cómo acabe.
   *
   * El contrato publicado en `health.controller.ts` describe **este** cuerpo, no el de Terminus, y
   * nada lo sujetaba: el guardián compara el ejemplo contra el esquema, y ambos se declaran en el
   * mismo controller, así que cambiar el comportamiento sin tocarlo lo dejaba verde publicando algo
   * falso.
   *
   * Por eso estos tests son deliberadamente descriptivos y no normativos: fijan lo que hoy ocurre
   * para que el día que se unifiquen los dos formatos —ver `docs/backlog.md`— salgan en rojo y
   * obliguen a actualizar el contrato en el mismo cambio.
   *
   * Verificado por mutación, no por confianza: sustituyendo el `reply` del filtro por uno que
   * devuelve el cuerpo de Terminus crudo, **tres de los cuatro** se ponen rojos. El cuarto no, y
   * está anotado abajo — conviene saber cuál es la red y cuál solo describe.
   */
  describe('catch() with a Terminus health failure', () => {
    it('debería reescribir el resultado de Terminus al sobre estándar', () => {
      // Arrange
      const { filter, reply } = buildFilter();
      const downIndicators = {
        database: { status: 'down', message: 'Timeout of 1000ms exceeded' },
      };

      // Act
      filter.catch(
        new ServiceUnavailableException(buildTerminusResult(downIndicators)),
        buildHost({ url: '/api/v1/health' }),
      );

      // Assert
      const [, payload, status] = reply.mock.calls[0];
      expect(status).toBe(503);
      expect(payload).toMatchObject({
        statusCode: 503,
        message: 'Service Unavailable Exception',
        path: '/api/v1/health',
        requestId: 'req-x',
      });
    });

    // `error` como objeto es la razón por la que el 503 de health no puede reutilizar
    // `ErrorResponseDto`, donde ese campo es `string`.
    //
    // Este es el único de los cuatro que NO detecta el cambio: si el filtro dejara pasar el cuerpo
    // de Terminus tal cual, `error` seguiría siendo el mismo mapa y la aserción pasaría igual.
    // Se mantiene porque documenta el tipo publicado, que es lo que sostiene el esquema del
    // controller — pero la red de verdad son los otros tres.
    it('debería publicar en error el mapa de indicadores caídos y no una cadena', () => {
      // Arrange
      const { filter, reply } = buildFilter();
      const downIndicators = {
        database: { status: 'down', message: 'Timeout of 1000ms exceeded' },
      };

      // Act
      filter.catch(
        new ServiceUnavailableException(buildTerminusResult(downIndicators)),
        buildHost({ url: '/api/v1/health' }),
      );

      // Assert
      const [, payload] = reply.mock.calls[0];
      expect(payload.error).toEqual(downIndicators);
      expect(typeof payload.error).toBe('object');
    });

    it('debería descartar status, info y details del resultado de Terminus', () => {
      // Arrange
      const { filter, reply } = buildFilter();

      // Act
      filter.catch(
        new ServiceUnavailableException(
          buildTerminusResult({ database: { status: 'down', message: 'unreachable' } }),
        ),
        buildHost({ url: '/api/v1/health' }),
      );

      // Assert
      const [, payload] = reply.mock.calls[0];
      expect(payload.status).toBeUndefined();
      expect(payload.info).toBeUndefined();
      expect(payload.details).toBeUndefined();
    });

    // El apagado ordenado es el único 503 sin ningún indicador caído: `liveness` no consulta
    // dependencias, así que su mapa de errores va vacío incluso al fallar.
    it('debería mantener el mismo sobre cuando el 503 viene del apagado ordenado', () => {
      // Arrange
      const { filter, reply } = buildFilter();

      // Act
      filter.catch(
        new ServiceUnavailableException(buildTerminusResult({}, 'shutting_down')),
        buildHost({ url: '/api/v1/health/liveness' }),
      );

      // Assert
      const [, payload, status] = reply.mock.calls[0];
      expect(status).toBe(503);
      expect(payload.error).toEqual({});
      expect(payload.path).toBe('/api/v1/health/liveness');
    });
  });

  describe('extractDetails()', () => {
    it('debería exponer solo las claves permitidas del payload de la excepción', () => {
      // Arrange
      const { filter, reply } = buildFilter();

      // Act
      filter.catch(
        new BadRequestException({
          message: 'invalid',
          error: 'BadRequestException',
          statusCode: 400,
          errors: [{ field: 'email' }],
          cause: 'should-be-hidden',
          stack: 'should-be-hidden',
        }),
        buildHost(),
      );

      // Assert
      const [, payload] = reply.mock.calls[0];
      expect(payload.details).toEqual({ errors: [{ field: 'email' }] });
      expect(payload.details.cause).toBeUndefined();
      expect(payload.details.stack).toBeUndefined();
    });
  });
});

// Helpers

const buildHost = (request: Record<string, unknown> = {}, response: unknown = {}): ArgumentsHost =>
  ({
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({ id: 'req-x', url: '/api/v1/x', ...request }),
      getResponse: () => response,
    }),
  }) as unknown as ArgumentsHost;

/**
 * Un `HealthCheckResult` tal y como lo construye Terminus antes de meterlo en la excepción.
 * `info` va vacío a propósito: solo lleva los indicadores en verde, y en un fallo lo que importa
 * es `error`. `details` los agrupa a todos, y es justo lo que el filtro descarta.
 */
const buildTerminusResult = (
  errors: Record<string, { status: string; message?: string }>,
  status: 'error' | 'shutting_down' = 'error',
) => ({
  status,
  info: {},
  error: errors,
  details: errors,
});

const buildFilterFor = (isProductionLike: boolean) => {
  const reply = jest.fn();
  const httpAdapterHost = {
    httpAdapter: {
      getRequestUrl: (req: { url: string }) => req.url,
      reply,
    },
  } as unknown as HttpAdapterHost;
  const logger = {
    setContext: jest.fn(),
    fatal: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  } as unknown as PinoLogger;
  const config = {
    getOrThrow: () => ({ isProductionLike }),
  } as unknown as ConfigService;
  return { filter: new AllExceptionsFilter(httpAdapterHost, logger, config), reply, logger };
};

/** Filtro tal y como corre en desarrollo: el mensaje real del error llega al cliente. */
const buildFilter = () => buildFilterFor(false);

/** Filtro tal y como corre en producción y en staging: los mensajes se sanitizan. */
const buildProductionFilter = () => buildFilterFor(true);
