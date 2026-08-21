import type { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '../../nest-metadata.constants';

import { RequestId } from '../../decorators/request-id.decorator';

describe('RequestId', () => {
  it('debería devolver el id presente en la request', () => {
    // Arrange
    const factory = extractFactory();
    const context = buildContext({ id: 'req-42' });

    // Act
    const result = factory(undefined, context);

    // Assert
    expect(result).toBe('req-42');
  });

  it('debería devolver undefined cuando la request no trae id', () => {
    // Arrange
    const factory = extractFactory();
    const context = buildContext({});

    // Act
    const result = factory(undefined, context);

    // Assert
    expect(result).toBeUndefined();
  });
});

// Helpers

type ParamFactory = (data: unknown, ctx: ExecutionContext) => string | undefined;

/**
 * `createParamDecorator` no expone su factory: la guarda en la metadata de ruta que
 * Nest lee en tiempo de ejecución. Aplicamos el decorador a una clase de prueba y la
 * recuperamos desde ahí, que es la única vía sin duplicar la implementación.
 */
const extractFactory = (): ParamFactory => {
  class Probe {
    handler(@RequestId() _requestId?: string): void {
      // Solo existe para que el decorador registre su metadata.
    }
  }

  const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, Probe, 'handler') as Record<
    string,
    { factory: ParamFactory }
  >;
  const entry = Object.values(metadata)[0];
  if (!entry) {
    throw new Error('No se encontró la metadata del decorador RequestId');
  }
  return entry.factory;
};

const buildContext = (request: { id?: string }): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;
