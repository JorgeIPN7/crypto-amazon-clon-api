import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import {
  AddressIndexAlreadyUsedError,
  AdminUsesMasterAddressError,
  InvalidAddressIndexError,
  InvalidEthereumAddressError,
  InvalidTransactionHashError,
  InvalidTransferIdError,
  InvalidWalletIdError,
  WalletActivationInProgressError,
  WalletAddressAlreadyUsedError,
  WalletAddressIsMasterError,
  WalletAlreadyActivatedError,
  WalletAssignmentLostError,
  WalletDomainError,
  WalletNotActivatedError,
  WalletNotFoundError,
  WalletOwnerGoneError,
  WalletOwnerMismatchError,
  WalletProviderRejectedError,
  WalletProviderRevertedError,
  WalletProviderUnavailableError,
  WalletProviderUnreachableError,
} from '../../../domain/errors/wallet.errors';
import { WalletsDomainExceptionFilter } from '../../../infrastructure/http/wallets-domain-exception.filter';
// El plan traía una copia local de este helper; la convención del repo («nunca copies un builder
// en varios specs», `CLAUDE.md`) manda sobre el borrador y el helper del módulo ya existía con el
// mismo cuerpo exacto.
import { captureError } from '../../helpers/capture-error';

const OWNER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const ADDRESS = '0x687422eea2cb73b5d3e242ba5456b782919afc85';
const MASTER = '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed';

const PROVIDER_UNREACHABLE =
  'The custodial provider did not answer; the result of the operation is unknown';
const PROVIDER_UNAVAILABLE = 'The custodial provider integration is unavailable';

describe('WalletsDomainExceptionFilter', () => {
  describe('catch()', () => {
    it('debería traducir WalletNotFoundError a 404', () => {
      // Arrange
      const filter = new WalletsDomainExceptionFilter();

      // Act + Assert
      expect(() => filter.catch(new WalletNotFoundError(OWNER_ID))).toThrow(NotFoundException);
    });

    it('debería traducir WalletOwnerGoneError a 403 con el mensaje canónico', () => {
      // Arrange
      const filter = new WalletsDomainExceptionFilter();

      // Act
      const thrown = captureError(() => filter.catch(new WalletOwnerGoneError(OWNER_ID)));

      // Assert
      // El motivo (borrado vs desactivado) es información interna, igual que en `orders`.
      expect(thrown).toBeInstanceOf(ForbiddenException);
      expect(thrown.message).toBe('Forbidden');
      expect(thrown.message).not.toContain('9d2a1c7e');
    });

    it.each([
      ['WalletNotActivatedError', new WalletNotActivatedError('receive-only')],
      ['WalletActivationInProgressError', new WalletActivationInProgressError()],
      ['WalletAlreadyActivatedError', new WalletAlreadyActivatedError()],
      ['AdminUsesMasterAddressError', new AdminUsesMasterAddressError()],
    ])('debería traducir %s a 409', (_caso, error) => {
      // Arrange
      const filter = new WalletsDomainExceptionFilter();

      // Act + Assert
      expect(() => filter.catch(error)).toThrow(ConflictException);
    });

    it.each([
      ['InvalidWalletIdError', new InvalidWalletIdError('no-es-uuid')],
      ['InvalidTransferIdError', new InvalidTransferIdError('no-es-uuid')],
      ['InvalidAddressIndexError', new InvalidAddressIndexError(-1)],
      // ⚠️ Caso AÑADIDO sobre la tabla del plan, que se dejaba esta clase fuera del mapa y de la
      // lista de las que caen al fallback. El contrato congelado §3 la pone en el grupo
      // «Inalcanzables desde la API → 500 EXPLÍCITO», y el árbol lo confirma: los TRES
      // `TransactionHash.from` de producción son el gateway —que ya lo traduce a
      // `malformed-response` dentro de su propio `catch`— y los dos mappers de fila. Ningún
      // endpoint acepta un hash del cliente, así que un 400 aquí culparía al cliente de una fila
      // nuestra y además lo escondería del `ErrorReporter`.
      ['InvalidTransactionHashError', new InvalidTransactionHashError('0xzz')],
      ['AddressIndexAlreadyUsedError', new AddressIndexAlreadyUsedError(7)],
      ['WalletAddressAlreadyUsedError', new WalletAddressAlreadyUsedError(ADDRESS)],
      ['WalletOwnerMismatchError', new WalletOwnerMismatchError(ADDRESS, MASTER)],
      ['WalletAddressIsMasterError', new WalletAddressIsMasterError(ADDRESS)],
      ['WalletAssignmentLostError', new WalletAssignmentLostError(OWNER_ID)],
    ])('debería traducir %s a 500', (_caso, error) => {
      // Arrange
      const filter = new WalletsDomainExceptionFilter();

      // Act + Assert
      expect(() => filter.catch(error)).toThrow(InternalServerErrorException);
    });

    it('debería publicar el 500 con el cuerpo saneado y el detalle solo en el cause', () => {
      // Arrange
      // Los nueve 500 nombran direcciones, índices y hashes internos, y fuera de producción
      // `AllExceptionsFilter` devuelve el mensaje tal cual: el cuerpo tiene que salir idéntico
      // al de cualquier otro fallo del servidor, con el detalle viajando solo al logger.
      const filter = new WalletsDomainExceptionFilter();
      const domainError = new WalletAddressIsMasterError(ADDRESS);

      // Act
      const thrown = captureError(() => filter.catch(domainError));

      // Assert
      expect((thrown as InternalServerErrorException).getResponse()).toEqual({
        statusCode: 500,
        message: 'Internal server error',
        // `expectedErrorName(500)` de `error-example.factory.ts`, no el canónico HTTP
        // `Internal Server Error`: el 500 del contrato es el de la rama saneada del filtro
        // global, y este tiene que salir igual.
        error: 'InternalServerError',
      });
      expect(JSON.stringify((thrown as InternalServerErrorException).getResponse())).not.toContain(
        '0x687422',
      );
      expect(thrown.cause).toBe(domainError);
    });

    it('debería traducir WalletProviderRejectedError a 400', () => {
      // Arrange
      const filter = new WalletsDomainExceptionFilter();

      // Act + Assert
      // El único 400 del proveedor que es culpa del cliente: solo la transferencia lleva entrada
      // suya, y su motivo es `body-rejected`. Un 400 en derivar o activar es configuración
      // NUESTRA, llega como `misconfigured` y sale 503.
      expect(() => filter.catch(new WalletProviderRejectedError('body-rejected', 400))).toThrow(
        BadRequestException,
      );
    });

    // ⚠️ **409 y no 503**, que es donde caía hasta el 2026-09-02. El proveedor contestó y contestó
    // bien: lo que impide la operación es el estado de la wallet, y sobre eso el cliente SÍ puede
    // actuar. Con 503 le decíamos «reintenta más tarde» y reintentaría para siempre.
    it('debería traducir WalletProviderRevertedError a 409 con su mensaje fijo', () => {
      // Arrange
      const filter = new WalletsDomainExceptionFilter();

      // Act
      const thrown = captureError(() =>
        filter.catch(new WalletProviderRevertedError('chain-reverted', 403)),
      );

      // Assert
      expect(thrown).toBeInstanceOf(ConflictException);
      expect(thrown.message).toBe('The blockchain reverted the transfer');
      // Publicar el mensaje solo es seguro porque es FIJO. El código de motivo es diagnóstico
      // interno y no viaja, igual que en el 502 y el 503.
      expect(thrown.message).not.toContain('chain-reverted');
      expect((thrown as ConflictException).getResponse()).toMatchObject({
        statusCode: 409,
        error: 'Conflict',
      });
    });

    it('debería traducir WalletProviderUnreachableError a 502', () => {
      // Arrange
      const filter = new WalletsDomainExceptionFilter();

      // Act + Assert
      expect(() => filter.catch(new WalletProviderUnreachableError('timeout', null))).toThrow(
        BadGatewayException,
      );
    });

    it('debería traducir WalletProviderUnavailableError a 503', () => {
      // Arrange
      const filter = new WalletsDomainExceptionFilter();

      // Act + Assert
      expect(() => filter.catch(new WalletProviderUnavailableError('unauthorized', 401))).toThrow(
        ServiceUnavailableException,
      );
    });

    it('debería publicar el 502 y el 503 con mensaje fijo, sin el código de motivo', () => {
      // Arrange
      const filter = new WalletsDomainExceptionFilter();

      // Act
      const unreachable = captureError(() =>
        filter.catch(new WalletProviderUnreachableError('timeout', null)),
      );
      const unavailable = captureError(() =>
        filter.catch(new WalletProviderUnavailableError('unauthorized', 401)),
      );

      // Assert
      // El motivo es diagnóstico interno: lo escribe el adaptador en el log, no la respuesta.
      expect(unreachable.message).toBe(PROVIDER_UNREACHABLE);
      expect(unreachable.message).not.toContain('timeout');
      expect(unavailable.message).toBe(PROVIDER_UNAVAILABLE);
      expect(unavailable.message).not.toContain('unauthorized');
      expect((unreachable as BadGatewayException).getResponse()).toMatchObject({
        statusCode: 502,
        error: 'Bad Gateway',
      });
      expect((unavailable as ServiceUnavailableException).getResponse()).toMatchObject({
        statusCode: 503,
        error: 'Service Unavailable',
      });
    });

    it('debería dejar el 502 y el 503 sin cause', () => {
      // Arrange
      // ⚠️ La causa de un fallo del proveedor es un error del TRANSPORTE, y el serializador de
      // pino concatena mensajes y stacks de las causas — la medición está en el JSDoc de
      // `tatum-http.client.ts`, contra el `fetch` real de Node. Si ese error llevara dentro el
      // cuerpo de la transferencia, la clave privada de la master acabaría en el log. Los nueve
      // 500 sí llevan cause porque su causa es un error de DOMINIO: direcciones, índices y hashes.
      const filter = new WalletsDomainExceptionFilter();

      // Act
      const unreachable = captureError(() =>
        filter.catch(new WalletProviderUnreachableError('unreachable', null)),
      );
      const unavailable = captureError(() =>
        filter.catch(new WalletProviderUnavailableError('upstream-error', 502)),
      );

      // Assert
      expect(unreachable.cause).toBeUndefined();
      expect(unavailable.cause).toBeUndefined();
    });

    // ⚠️ **500 y NO 400**, aunque una dirección mal escrita del cuerpo sea lo más parecido a un
    // 400 que existe. El motivo es el ORIGEN: quien valida la dirección del cliente es el DTO, que
    // corta antes de llegar aquí. Lo único que puede traer este error hasta el filtro es
    // `WalletMapper.toDomain`, que lo lanza en dos líneas del camino de LECTURA —al reconstruir
    // `ownerAddress` y `address` de una fila—.
    //
    // Una fila corrupta es un defecto NUESTRO: un 400 le mentiría al cliente y, peor, escondería
    // el incidente del `ErrorReporter`, que solo ve 5xx. Es el mismo criterio con el que los otros
    // cuatro `Invalid*` ya estaban mapeados a 500.
    it('debería traducir InvalidEthereumAddressError a 500 porque solo llega desde una fila', () => {
      // Arrange
      const filter = new WalletsDomainExceptionFilter();

      // Act + Assert
      expect(() => filter.catch(new InvalidEthereumAddressError('0xzz'))).toThrow(
        InternalServerErrorException,
      );
    });

    it('debería tratar un error de dominio sin mapeo como 400', () => {
      // Arrange
      // ⚠️ `new UnmappedDomainError()` va DENTRO del `it` y no en una tabla de `it.each`: la
      // clase se declara en el bloque `// Helpers` del final, y una tabla se evalúa mientras
      // corre el cuerpo del `describe`, cuando todavía está en su zona muerta temporal. La suite
      // entera moriría con `Cannot access 'UnmappedDomainError' before initialization` sin
      // ejecutar un solo caso. Las clases de error importadas arriba sí pueden ir en tablas.
      const filter = new WalletsDomainExceptionFilter();

      // Act + Assert
      expect(() => filter.catch(new UnmappedDomainError())).toThrow(BadRequestException);
    });
  });
});

// Helpers

class UnmappedDomainError extends WalletDomainError {
  constructor() {
    super('Regla de dominio nueva sin mapeo HTTP');
  }
}
