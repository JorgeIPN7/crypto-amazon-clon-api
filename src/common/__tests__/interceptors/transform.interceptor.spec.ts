import { StreamableFile, type ExecutionContext } from '@nestjs/common';
import type { HttpAdapterHost, Reflector } from '@nestjs/core';
import type { ClsService } from 'nestjs-cls';
import { firstValueFrom, of } from 'rxjs';

import {
  TransformInterceptor,
  type ApiSuccessResponse,
} from '../../interceptors/transform.interceptor';

describe('TransformInterceptor', () => {
  describe('intercept()', () => {
    it('debería envolver las respuestas JSON en el envelope de éxito', async () => {
      // Arrange
      const interceptor = buildInterceptor();
      const handler = { handle: () => of({ id: 1 }) };

      // Act
      const result = await firstValueFrom(interceptor.intercept(buildContext(), handler));

      // Assert
      const envelope = result as ApiSuccessResponse<unknown>;
      expect(envelope.success).toBe(true);
      expect(envelope.data).toEqual({ id: 1 });
      expect(envelope.request.path).toBe('/api/v1/things');
      expect(envelope.request.requestId).toBe('cls-id');
    });

    // En producción, fuera del middleware de CLS —tareas programadas, un error muy
    // temprano en el ciclo—, `getId()` devuelve undefined. El fake devolvía siempre un id,
    // así que los dos fallbacks de `cls.getId() ?? request.id ?? ''` no se ejercían nunca.
    it('debería caer al id de la petición cuando CLS no tiene contexto', async () => {
      // Arrange
      const interceptor = buildInterceptorWithoutCls();
      const handler = { handle: () => of({ id: 1 }) };

      // Act
      const result = await firstValueFrom(interceptor.intercept(buildContext(), handler));

      // Assert
      expect((result as ApiSuccessResponse<unknown>).request.requestId).toBe('req-1');
    });

    it('debería usar cadena vacía cuando no hay ni contexto CLS ni id de petición', async () => {
      // Arrange
      const interceptor = buildInterceptorWithoutCls();
      const context = buildContext({ request: { url: '/api/v1/things' } });
      const handler = { handle: () => of({ id: 1 }) };

      // Act
      const result = await firstValueFrom(interceptor.intercept(context, handler));

      // Assert
      expect((result as ApiSuccessResponse<unknown>).request.requestId).toBe('');
    });

    it('debería respetar @SkipTransform()', async () => {
      // Arrange
      const interceptor = buildSkippingInterceptor();
      const handler = { handle: () => of({ raw: true }) };

      // Act
      const result = await firstValueFrom(interceptor.intercept(buildContext(), handler));

      // Assert
      expect(result).toEqual({ raw: true });
    });

    it('debería devolver StreamableFile sin modificar', async () => {
      // Arrange
      const interceptor = buildInterceptor();
      const file = new StreamableFile(Buffer.from('hello'));

      // Act
      const result = await firstValueFrom(
        interceptor.intercept(buildContext(), { handle: () => of(file) }),
      );

      // Assert
      expect(result).toBe(file);
    });

    it('debería devolver Buffer sin modificar', async () => {
      // Arrange
      const interceptor = buildInterceptor();
      const buf = Buffer.from('binary');

      // Act
      const result = await firstValueFrom(
        interceptor.intercept(buildContext(), { handle: () => of(buf) }),
      );

      // Assert
      expect(result).toBe(buf);
    });

    it('debería devolver el descriptor de redirect sin modificar', async () => {
      // Arrange
      const interceptor = buildInterceptor();
      const redirect = { url: '/elsewhere', statusCode: 302 };

      // Act
      const result = await firstValueFrom(
        interceptor.intercept(buildContext(), { handle: () => of(redirect) }),
      );

      // Assert
      expect(result).toBe(redirect);
    });

    it('debería devolver la respuesta tal cual cuando el content-type no es JSON', async () => {
      // Arrange
      const interceptor = buildInterceptor();
      const context = buildContext({ responseHeaders: { 'content-type': 'text/html' } });
      const html = '<h1>hi</h1>';

      // Act
      const result = await firstValueFrom(
        interceptor.intercept(context, { handle: () => of(html) }),
      );

      // Assert
      expect(result).toBe(html);
    });

    it('debería dejar pasar los contextos que no son http', async () => {
      // Arrange
      const interceptor = buildInterceptor();
      const rpcContext = buildNonHttpContext();

      // Act
      const result = await firstValueFrom(
        interceptor.intercept(rpcContext, { handle: () => of({ rpc: true }) }),
      );

      // Assert
      expect(result).toEqual({ rpc: true });
    });
  });
});

// Helpers

type BuildContextOptions = {
  responseHeaders?: Record<string, unknown>;
  handler?: () => unknown;
  request?: Record<string, unknown>;
};

const buildContext = ({
  responseHeaders = {},
  handler = () => null,
  request = { id: 'req-1', url: '/api/v1/things' },
}: BuildContextOptions = {}): ExecutionContext =>
  ({
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({
        getHeader: (name: string) => responseHeaders[name.toLowerCase()],
      }),
    }),
  }) as unknown as ExecutionContext;

const buildNonHttpContext = (): ExecutionContext =>
  ({
    getType: () => 'rpc',
    getHandler: () => () => null,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({}), getResponse: () => ({}) }),
  }) as unknown as ExecutionContext;

const buildInterceptorWith = (skip: true | undefined, clsId: string | undefined) => {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(skip),
    get: jest.fn().mockReturnValue(undefined),
  } as unknown as Reflector;
  const httpAdapterHost = {
    httpAdapter: { getRequestUrl: (req: { url?: string }) => req.url },
  } as unknown as HttpAdapterHost;
  const cls = { getId: () => clsId } as unknown as ClsService;
  return new TransformInterceptor(reflector, httpAdapterHost, cls);
};

/** Interceptor tal cual corre en una petición normal, dentro del middleware de CLS. */
const buildInterceptor = () => buildInterceptorWith(undefined, 'cls-id');

/** Handler anotado con `@SkipTransform()`: la respuesta debe salir sin envelope. */
const buildSkippingInterceptor = () => buildInterceptorWith(true, undefined);

/** Fuera del middleware de CLS, donde `getId()` devuelve undefined. */
const buildInterceptorWithoutCls = () => buildInterceptorWith(undefined, undefined);
