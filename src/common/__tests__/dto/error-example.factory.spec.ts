import { NoopErrorReporter } from '@common/observability/error-reporter';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  type ArgumentsHost,
  type HttpException,
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

  /**
   * Los status contrastados con una excepción REAL, y la única fuente de la lista.
   *
   * Estaba duplicada: la tabla del `it.each` por un lado y un `new Set([...])` escrito a mano en
   * el caso de cobertura por otro. Esa duplicación era el hueco por el que se podía declarar un
   * status «cubierto» sin escribir su excepción: bastaba con añadirlo a las dos listas de
   * literales y a `VERIFIED_ERROR_STATUSES`, y los tres guardianes se quedaban verdes sin que
   * nadie hubiera pasado nada por el filtro. Con `covered` derivado de aquí, eso no compila.
   */
  const VERIFIED_CASES: [label: string, status: number, makeException: () => HttpException][] = [
    ['400', 400, () => new BadRequestException('email must be a valid address')],
    ['401', 401, () => new UnauthorizedException('Unauthorized')],
    ['403', 403, () => new ForbiddenException('Forbidden')],
    ['404', 404, () => new NotFoundException('User abc was not found')],
    ['409', 409, () => new ConflictException('Email a@b.com is already registered')],
    ['429', 429, () => new ThrottlerException()],
    // Los dos que trae `wallets`, con los mensajes FIJOS que emite su filtro de dominio: 502
    // cuando el proveedor de custodia no responde o su respuesta no cumple su propio esquema,
    // 503 cuando la integración está caída por causa nuestra. Se construyen con STRING, como los
    // de arriba, porque es lo que hace que Nest rellene `body.error` con el nombre canónico que
    // `expectedErrorName` deriva del status.
    [
      '502',
      502,
      () =>
        new BadGatewayException(
          'The custodial provider did not answer; the result of the operation is unknown',
        ),
    ],
    [
      '503',
      503,
      () => new ServiceUnavailableException('The custodial provider integration is unavailable'),
    ],
  ];

  // 401 y 403 se construyen con un STRING (`new UnauthorizedException('Unauthorized')`), nunca
  // sin argumento: `new UnauthorizedException()` serializa sin `error` propio y el filtro cae a
  // `exception.name` (`UnauthorizedException`, no canónico), que es exactamente lo que
  // `NON_CANONICAL_ERRORS` documenta para 429/500. La promesa canónica `error: 'Unauthorized'` /
  // `'Forbidden'` que publica `buildErrorExample` solo se sostiene si `JwtAuthGuard` construye
  // sus excepciones así; `openapi-contract.e2e-spec.ts` es el guardián end-to-end que lo
  // comprueba contra el documento real, no solo contra este contraste.
  it.each(VERIFIED_CASES)(
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
    // 500 no está en la tabla y se suma aquí: su cuerpo no sale de una `HttpException` sino de
    // la rama `isProductionLike` del filtro, y por eso tiene su propio caso más abajo.
    const covered = new Set([...VERIFIED_CASES.map(([, status]) => status), 500]);

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

  // El reporter real que no hace nada, no un doble: esta suite comprueba el CUERPO del error, y
  // un `jest.fn()` aquí solo añadiría ruido a un punto que no está bajo prueba.
  return {
    filter: new AllExceptionsFilter(httpAdapterHost, logger, config, new NoopErrorReporter()),
    reply,
  };
};
