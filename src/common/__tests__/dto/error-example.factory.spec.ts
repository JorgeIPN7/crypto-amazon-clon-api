import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  type ArgumentsHost,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { HttpAdapterHost } from '@nestjs/core';
import { ThrottlerException } from '@nestjs/throttler';
import type { PinoLogger } from 'nestjs-pino';

import { buildErrorExample, VERIFIED_ERROR_STATUSES } from '../../dto/error-example.factory';
import { AllExceptionsFilter, type ErrorPayload } from '../../filters/all-exceptions.filter';

/**
 * Cierra el flanco que el guardián del contrato no puede cubrir por sí solo.
 *
 * `openapi-contract.e2e-spec.ts` comprueba que los `example` publicados coinciden con
 * `buildErrorExample`, pero como esos ejemplos **salen** de la factoría, esa comparación solo
 * verifica consistencia interna: si la factoría empezara a producir un cuerpo falso, los
 * ejemplos lo heredarían y el guardián seguiría en verde. Medido, no supuesto.
 *
 * Aquí se contrasta la factoría contra la única fuente de verdad, `AllExceptionsFilter`, pasando
 * excepciones reales por su `catch()`. Sin servidor, sin base de datos y sin fixtures, así que
 * cubre **todos** los status —incluidos los que ningún endpoint ejercita todavía—, no solo los
 * que tienen un E2E escrito.
 */
describe('buildErrorExample', () => {
  const PATH = '/api/v1/resource';

  // 401 y 403 se construyen con un STRING (`new UnauthorizedException('Unauthorized')`), nunca
  // sin argumento: `new UnauthorizedException()` serializa sin `error` propio y el filtro cae a
  // `exception.name` (`UnauthorizedException`, no canónico), que es exactamente lo que
  // `NON_CANONICAL_ERRORS` documenta para 429/500. La promesa canónica `error: 'Unauthorized'` /
  // `'Forbidden'` que publica `buildErrorExample` solo se sostiene si `JwtAuthGuard` (Task 7)
  // construye sus excepciones así; `openapi-contract.e2e-spec.ts` (Task 10) es el guardián
  // end-to-end que lo comprueba contra el documento real, no solo contra este contraste.
  it.each([
    ['400', 400, () => new BadRequestException('email must be a valid address')],
    ['401', 401, () => new UnauthorizedException('Unauthorized')],
    ['403', 403, () => new ForbiddenException('Forbidden')],
    ['404', 404, () => new NotFoundException('User abc was not found')],
    ['409', 409, () => new ConflictException('Email a@b.com is already registered')],
    ['429', 429, () => new ThrottlerException()],
  ])(
    'debería producir para %s el mismo cuerpo que AllExceptionsFilter',
    (_label, status, makeException) => {
      // Arrange
      const { filter, reply } = buildFilter();

      // Act
      filter.catch(makeException(), buildHost(PATH));
      const actual = reply.mock.calls[0]?.[1] as ErrorPayload;
      const documented = buildErrorExample(status, { path: PATH, message: actual.message });

      // Assert
      // `timestamp` y `requestId` se igualan: cambian en cada respuesta y no forman parte del
      // contrato de forma. Todo lo demás —claves exactas, `statusCode`, `error`, `path`— sí.
      expect({
        ...actual,
        timestamp: documented.timestamp,
        requestId: documented.requestId,
      }).toEqual(documented);
    },
  );

  it('debería cubrir con casos reales todos los status que declara verificados', () => {
    // Arrange
    const covered = new Set([400, 401, 403, 404, 409, 429, 500]);

    // Act
    const uncovered = [...VERIFIED_ERROR_STATUSES].filter((status) => !covered.has(status));

    // Assert
    // `VERIFIED_ERROR_STATUSES` es una promesa que el guardián del contrato consume para
    // rechazar status sin contrastar. Este test es lo que impide que esa promesa se firme sin
    // cumplirse: añadir un 422 al conjunto sin escribir su caso de arriba pone esto en rojo.
    expect(uncovered).toEqual([]);
  });

  it('debería producir para 500 el cuerpo saneado que el filtro emite en producción', () => {
    // Arrange
    // La rama `isProductionLike` es la que importa documentar: en desarrollo el filtro deja
    // pasar el mensaje real, y publicar ese ejemplo filtraría topología interna.
    const { filter, reply } = buildFilter(true);

    // Act
    filter.catch(new TypeError('connect ECONNREFUSED 10.0.1.5:5432'), buildHost(PATH));
    const actual = reply.mock.calls[0]?.[1] as ErrorPayload;
    const documented = buildErrorExample(500, { path: PATH, message: actual.message });

    // Assert
    expect({ ...actual, timestamp: documented.timestamp, requestId: documented.requestId }).toEqual(
      documented,
    );
    expect(actual.message).toBe('Internal server error');
  });
});

// Helpers

const buildHost = (url: string): ArgumentsHost =>
  ({
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({ id: 'req-x', url }),
      getResponse: () => ({}),
    }),
  }) as unknown as ArgumentsHost;

const buildFilter = (isProductionLike = false) => {
  const reply = jest.fn();
  const httpAdapterHost = {
    httpAdapter: { getRequestUrl: (req: { url: string }) => req.url, reply },
  } as unknown as HttpAdapterHost;
  const logger = {
    setContext: jest.fn(),
    fatal: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  } as unknown as PinoLogger;
  const config = { getOrThrow: () => ({ isProductionLike }) } as unknown as ConfigService;

  return { filter: new AllExceptionsFilter(httpAdapterHost, logger, config), reply };
};
