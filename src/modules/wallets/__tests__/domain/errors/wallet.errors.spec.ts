import fc from 'fast-check';

import { DomainError } from '@shared/domain/domain-error.base';

import * as walletErrors from '../../../domain/errors/wallet.errors';
import {
  AddressIndexAlreadyUsedError,
  AdminUsesMasterAddressError,
  AssetFieldNotAllowedError,
  InvalidAddressIndexError,
  InvalidEthereumAddressError,
  InvalidTokenAmountError,
  InvalidTokenIdError,
  InvalidTransactionHashError,
  InvalidTransferIdError,
  InvalidWalletIdError,
  MissingAssetFieldError,
  PROVIDER_FAILURE_REASONS,
  UnknownAssetKindError,
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
  WalletProviderError,
  WalletProviderRejectedError,
  WalletProviderRevertedError,
  WalletProviderUnavailableError,
  WalletProviderUnreachableError,
} from '../../../domain/errors/wallet.errors';
import { providerFailureReasonArb, providerStatusArb } from '../../helpers/arbitraries';

describe('wallet.errors', () => {
  describe('errores de identidad y formato', () => {
    it('debería construir InvalidWalletIdError con su mensaje exacto y su valor', () => {
      // Arrange
      const value = 'not-a-uuid';

      // Act
      const error = new InvalidWalletIdError(value);

      // Assert
      expect(error.message).toBe('"not-a-uuid" is not a valid wallet id');
      expect(error.value).toBe(value);
    });

    it('debería construir InvalidTransferIdError con su mensaje exacto y su valor', () => {
      // Arrange
      const value = 'not-a-uuid';

      // Act
      const error = new InvalidTransferIdError(value);

      // Assert
      expect(error.message).toBe('"not-a-uuid" is not a valid transfer id');
      expect(error.value).toBe(value);
    });

    it('debería construir InvalidEthereumAddressError con su mensaje exacto y su valor', () => {
      // Arrange
      const value = '0xzz';

      // Act
      const error = new InvalidEthereumAddressError(value);

      // Assert
      expect(error.message).toBe('"0xzz" is not a valid Ethereum address');
      expect(error.value).toBe(value);
    });

    it('debería construir InvalidAddressIndexError con su mensaje exacto y su valor numérico', () => {
      // Arrange
      const value = -1;

      // Act
      const error = new InvalidAddressIndexError(value);

      // Assert
      expect(error.message).toBe('-1 is not a valid address index');
      expect(error.value).toBe(-1);
    });

    it('debería construir InvalidTokenAmountError con su mensaje exacto y su valor', () => {
      // Arrange
      const value = '01';

      // Act
      const error = new InvalidTokenAmountError(value);

      // Assert
      expect(error.message).toBe('"01" is not a valid token amount');
      expect(error.value).toBe('01');
    });

    it('debería construir InvalidTokenIdError con su mensaje exacto y su valor', () => {
      // Arrange
      const value = '01';

      // Act
      const error = new InvalidTokenIdError(value);

      // Assert
      expect(error.message).toBe('"01" is not a valid token id');
      expect(error.value).toBe('01');
    });

    it('debería construir InvalidTransactionHashError con su mensaje exacto y su valor', () => {
      // Arrange
      const value = 'abc';

      // Act
      const error = new InvalidTransactionHashError(value);

      // Assert
      expect(error.message).toBe('"abc" is not a valid transaction hash');
      expect(error.value).toBe('abc');
    });
  });

  describe('errores del activo a transferir', () => {
    // ⚠️ El orden de los argumentos es (campo, clase) y el del mensaje es el inverso. Es la
    // trampa exacta que este caso fija: invertir la llamada compila —los dos son `string`— y
    // publicaría «Asset of kind "amount" requires the field "fungible"», que es literalmente al
    // revés y ningún tipo lo caza.
    it('debería construir MissingAssetFieldError recibiendo primero el campo y después la clase', () => {
      // Arrange + Act
      const error = new MissingAssetFieldError('amount', 'fungible');

      // Assert
      expect(error.message).toBe('Asset of kind "fungible" requires the field "amount"');
      expect(error.field).toBe('amount');
      expect(error.kind).toBe('fungible');
    });

    it('debería construir AssetFieldNotAllowedError recibiendo primero el campo y después la clase', () => {
      // Arrange + Act
      const error = new AssetFieldNotAllowedError('tokenId', 'native');

      // Assert
      expect(error.message).toBe('Asset of kind "native" does not accept the field "tokenId"');
      expect(error.field).toBe('tokenId');
      expect(error.kind).toBe('native');
    });

    it('debería construir UnknownAssetKindError con la clase desconocida', () => {
      // Arrange + Act
      const error = new UnknownAssetKindError('erc721');

      // Assert
      expect(error.message).toBe('"erc721" is not a known asset kind');
      expect(error.kind).toBe('erc721');
    });
  });

  describe('errores de estado de la wallet', () => {
    it('debería construir WalletNotFoundError con el dueño buscado', () => {
      // Arrange + Act
      const error = new WalletNotFoundError('owner-1');

      // Assert
      expect(error.message).toBe('Wallet for owner owner-1 was not found');
      expect(error.ownerId).toBe('owner-1');
    });

    // Lleva el ESTADO y no el id de la wallet: el id no le dice nada al cliente —los cinco
    // endpoints son «lo mío» y nunca lo ve—, mientras que el estado le dice si le toca activar o
    // esperar a que termine la activación en curso.
    it('debería construir WalletNotActivatedError con el ESTADO que impide enviar', () => {
      // Arrange + Act
      const error = new WalletNotActivatedError('receive-only');

      // Assert
      expect(error.message).toBe('Wallet cannot send funds yet: its status is "receive-only"');
      expect(error.status).toBe('receive-only');
    });

    it('debería construir WalletActivationInProgressError sin argumentos y con mensaje fijo', () => {
      // Arrange + Act
      const error = new WalletActivationInProgressError();

      // Assert
      expect(error.message).toBe('Wallet already has an activation in progress');
    });

    it('debería construir WalletAlreadyActivatedError sin argumentos y con mensaje fijo', () => {
      // Arrange + Act
      const error = new WalletAlreadyActivatedError();

      // Assert
      expect(error.message).toBe('Wallet is already activated');
    });

    it('debería construir WalletOwnerGoneError con un mensaje interno que el filtro nunca publica', () => {
      // Arrange + Act
      const error = new WalletOwnerGoneError('owner-1');

      // Assert
      expect(error.message).toBe('Owner owner-1 no longer exists or is inactive');
      expect(error.ownerId).toBe('owner-1');
    });

    // El admin ya opera la master: darle una dirección derivada crearía una segunda EOA en el
    // sistema, que es justo la invariante de §3.1.1. No lleva argumentos porque no hay nada
    // variable que contar — el rol ya es la explicación entera.
    it('debería construir AdminUsesMasterAddressError sin argumentos y con mensaje fijo', () => {
      // Arrange + Act
      const error = new AdminUsesMasterAddressError();

      // Assert
      expect(error.message).toBe(
        'The admin operates the master address and has no gas pump wallet',
      );
    });
  });

  describe('violaciones de invariante y de configuración', () => {
    it('debería construir AddressIndexAlreadyUsedError con el índice repetido en el campo index', () => {
      // Arrange + Act
      const error = new AddressIndexAlreadyUsedError(7);

      // Assert
      expect(error.message).toBe('Address index 7 is already assigned to another wallet');
      expect(error.index).toBe(7);
    });

    it('debería construir WalletAddressAlreadyUsedError con la dirección repetida', () => {
      // Arrange + Act
      const error = new WalletAddressAlreadyUsedError('0xabc');

      // Assert
      expect(error.message).toBe('Address 0xabc is already assigned to another wallet');
      expect(error.address).toBe('0xabc');
    });

    it('debería construir WalletOwnerMismatchError nombrando la master de la fila y la configurada', () => {
      // Arrange + Act
      const error = new WalletOwnerMismatchError('0xold', '0xnew');

      // Assert
      expect(error.message).toBe('Wallet was derived under master 0xold, not under 0xnew');
      expect(error.walletOwnerAddress).toBe('0xold');
      expect(error.configuredMaster).toBe('0xnew');
    });

    it('debería construir WalletAddressIsMasterError con la dirección que jamás puede entregarse', () => {
      // Arrange + Act
      const error = new WalletAddressIsMasterError('0xmaster');

      // Assert
      expect(error.message).toBe(
        'Address 0xmaster is the master address and cannot be handed to a user',
      );
      expect(error.address).toBe('0xmaster');
    });

    it('debería construir WalletAssignmentLostError con el dueño cuya relectura volvió vacía', () => {
      // Arrange + Act
      const error = new WalletAssignmentLostError('owner-1');

      // Assert
      expect(error.message).toBe(
        'Wallet assignment for owner owner-1 vanished between the conflict and the re-read',
      );
      expect(error.ownerId).toBe('owner-1');
    });
  });

  describe('errores del proveedor', () => {
    it('debería construir WalletProviderRejectedError con motivo y status, sin nada del cuerpo', () => {
      // Arrange + Act
      const error = new WalletProviderRejectedError('body-rejected', 400);

      // Assert
      expect(error.message).toBe('The wallet provider rejected the transfer request');
      expect(error.reason).toBe('body-rejected');
      expect(error.providerStatus).toBe(400);
    });

    // El mensaje afirma lo que se sabe —revirtió y no se minó nada— y NO «no hay saldo»: ese
    // `errorCode` cubre cualquier reversión del contrato y el proveedor no la desglosa.
    it('debería construir WalletProviderRevertedError con un mensaje que no menciona el saldo', () => {
      // Arrange + Act
      const error = new WalletProviderRevertedError('chain-reverted', 403);

      // Assert
      expect(error.message).toBe('The blockchain reverted the transfer');
      expect(error.reason).toBe('chain-reverted');
      expect(error.providerStatus).toBe(403);
      expect(error.message).not.toContain('balance');
    });

    it('debería construir WalletProviderUnreachableError admitiendo un status nulo', () => {
      // Arrange + Act
      const error = new WalletProviderUnreachableError('timeout', null);

      // Assert
      expect(error.message).toBe(
        'The wallet provider could not be reached or broke its published contract',
      );
      expect(error.reason).toBe('timeout');
      expect(error.providerStatus).toBeNull();
    });

    it('debería construir WalletProviderUnavailableError con motivo y status', () => {
      // Arrange + Act
      const error = new WalletProviderUnavailableError('unauthorized', 401);

      // Assert
      expect(error.message).toBe('The wallet provider integration is unavailable');
      expect(error.reason).toBe('unauthorized');
      expect(error.providerStatus).toBe(401);
    });

    // El padre existe por dos motivos: declarar `reason` y `providerStatus` una vez en lugar de
    // cuatro, y que el caso de uso de la transferencia capture la familia para leer `error.reason`.
    // ⚠️ El filtro NO: gana con el primer `instanceof`, así que agruparlas ahí colapsaría 400, 409,
    // 502 y 503 en un solo status.
    it('debería agrupar los cuatro errores del proveedor bajo el padre WalletProviderError, y solo a ellos', () => {
      // Arrange
      const fromTheProvider = [
        new WalletProviderRejectedError('body-rejected', 400),
        new WalletProviderRevertedError('chain-reverted', 403),
        new WalletProviderUnreachableError('timeout', null),
        new WalletProviderUnavailableError('unauthorized', 401),
      ];

      // Act
      const allUnderTheFamily = fromTheProvider.every(
        (error) => error instanceof WalletProviderError,
      );

      // Assert
      expect(allUnderTheFamily).toBe(true);
      expect(new WalletNotFoundError('owner-1')).not.toBeInstanceOf(WalletProviderError);
    });

    // La lista es ÚNICA: el `reasonCode` del libro de transferencias reutiliza este mismo tipo, y
    // añadir un motivo aquí es lo que lo hace guardable allí. Un segundo vocabulario paralelo
    // dejaría dos verdades sobre por qué falló la misma llamada.
    it('debería publicar los diez motivos de fallo del proveedor como lista única', () => {
      // Arrange + Act + Assert
      expect(PROVIDER_FAILURE_REASONS).toEqual([
        'body-rejected',
        'misconfigured',
        'unauthorized',
        'forbidden',
        // El décimo, añadido el 2026-09-02: el 403 con `errorCode: "sc.operation.failed"`. Va
        // pegado a `forbidden` porque los dos son ese mismo status leído con y sin el cuerpo.
        'chain-reverted',
        'undocumented-4xx',
        'upstream-error',
        'unreachable',
        'timeout',
        'malformed-response',
      ]);
    });
  });

  describe('WalletDomainError', () => {
    it('debería dejar fuera del marcador de wallets a un error de dominio de otro contexto', () => {
      // Arrange
      const foreign = new ForeignDomainError();

      // Act
      const caughtByTheMarker = foreign instanceof WalletDomainError;

      // Assert
      expect(caughtByTheMarker).toBe(false);
      expect(foreign).toBeInstanceOf(DomainError);
    });
  });

  describe('wallet.errors (property-based)', () => {
    // Compartir abuelo (`DomainError`) NO ensancha el `instanceof`: lo que se comprueba aquí es
    // que ninguna de las 25 clases se saltó el marcador, porque una que heredara directamente de
    // `DomainError` compilaría igual y el filtro de `wallets` dejaría de verla — un 500 mudo.
    it('debería heredar del marcador y publicar su nombre concreto, sea cual sea el error', () => {
      fc.assert(
        fc.property(fc.constantFrom(...errorFactories), ([name, build]) => {
          // Act
          const error = build();

          // Assert
          expect(error).toBeInstanceOf(WalletDomainError);
          expect(error).toBeInstanceOf(DomainError);
          expect(error.name).toBe(name);
        }),
      );
    });

    // §7.1: el mensaje viaja al cliente tal cual fuera de producción y staging, y `pino` lo
    // escribe siempre. Un mensaje que interpolara el motivo o el status abriría la puerta a
    // interpolar también el cuerpo, que es donde va la clave privada de la master.
    //
    // ⚠️ Es también lo que impide reescribir el mensaje del 502 como «is unreachable»: ese
    // literal CONTIENE el motivo `'unreachable'` de la lista, y esta propiedad se pondría roja.
    it('debería no interpolar nunca el motivo ni el status del proveedor en el mensaje', () => {
      fc.assert(
        fc.property(providerFailureReasonArb, providerStatusArb, (reason, status) => {
          // Act
          const errors = [
            new WalletProviderRejectedError(reason, status),
            new WalletProviderRevertedError(reason, status),
            new WalletProviderUnreachableError(reason, status),
            new WalletProviderUnavailableError(reason, status),
          ];

          // Assert
          for (const error of errors) {
            expect(error.message).not.toContain(reason);
            expect(error.message).not.toContain(String(status));
          }
        }),
      );
    });

    // P1 sortea `errorFactories`, que es una lista ESCRITA A MANO: solo protege lo que alguien se
    // acordó de meter en ella. Una 25.ª clase que heredase de `DomainError` saltándose el
    // marcador, y a la que su autor tampoco añadiera a la lista, dejaba la suite EN VERDE — y los
    // dos olvidos son del mismo autor en el mismo commit, así que no son independientes. Esa
    // clase no la vería el `@Catch(WalletDomainError)` del filtro: saldría como 500 sin traducir,
    // que es justo el fallo del que P1 dice defender. Este caso no recuerda nada: descubre las
    // clases del PROPIO módulo.
    //
    // Los dos ABSTRACTOS entran en el sorteo, cada uno por su razón:
    //  · `WalletProviderError` es hija del marcador de pleno derecho y `abstract` desaparece al
    //    compilar —en runtime no hay nada que la distinga de una concreta—, así que excluirla
    //    exigiría nombrarla a mano y abriría el hueco de que una FAMILIA entera colgase fuera del
    //    marcador sin que nadie se enterase.
    //  · `WalletDomainError` se satisface por IDENTIDAD y no por herencia: ninguna clase es
    //    subclase ESTRICTA de sí misma. Medido en node — `class A extends Error {}` y
    //    `A.prototype instanceof A` imprime `false`. Sacarla del arbitrario a mano sería
    //    reintroducir la lista escrita a mano que este caso viene a sustituir.
    it('debería garantizar que TODA clase exportada del catálogo hereda del marcador', () => {
      // Arrange
      const anyExportedClass = fc.constantFrom(...catalogueClasses);

      fc.assert(
        fc.property(anyExportedClass, (exported) => {
          // Act
          const reachesTheMarker =
            exported === WalletDomainError || exported.prototype instanceof WalletDomainError;

          // Assert
          expect(reachesTheMarker).toBe(true);
        }),
      );
    });
  });
});

// Helpers

/** Un error de dominio que NO es de `wallets`: el contraejemplo del caso E27. */
class ForeignDomainError extends DomainError {
  constructor() {
    super('un error de otro bounded context');
  }
}

/** Lo único que P3 necesita de un export para interrogarlo: `instanceof` recorre su `prototype`. */
type CatalogueClass = { prototype: object };

/**
 * Las clases del catálogo, DESCUBIERTAS de este mismo ARCHIVO con `import * as` — nunca un inventario
 * paralelo, que es exactamente el defecto de `errorFactories` que P3 viene a cubrir.
 *
 * El filtro es `typeof === 'function'` y NO «hereda de `DomainError`», a propósito: filtrar por la
 * herencia se tragaría en silencio justo la clase mal escrita que se busca —una que colgase de
 * `Error` a secas pasaría de largo— y devolvería el caso a ser decorativo. Con este filtro el
 * único export que queda fuera es `PROVIDER_FAILURE_REASONS`, que es un array;
 * `ProviderFailureReason` es un `type` y no llega al runtime.
 *
 * ⚠️ Un filtro que dejara la lista VACÍA tampoco se quedaría verde en silencio: `fc.constantFrom()`
 * sin valores lanza. Medido con fast-check 4.9.0 — «fc.constantFrom expects at least one
 * parameter».
 */
const exportedValues: readonly unknown[] = Object.values(walletErrors);
const catalogueClasses: readonly CatalogueClass[] = exportedValues.filter(
  (exported): exported is CatalogueClass => typeof exported === 'function',
);

/**
 * Las 25 clases concretas del archivo, con el nombre que cada una debe publicar en `name`.
 * ⚠️ Añadir una clase a `wallet.errors.ts` obliga a añadirla aquí: la propiedad P1 solo
 * comprueba lo que esta lista contiene. Lo que P1 NO puede ver —una clase que se saltara el
 * marcador y que tampoco llegara a esta lista— lo cubre P3, que descubre las clases del módulo.
 */
const errorFactories: readonly (readonly [string, () => WalletDomainError])[] = [
  ['InvalidWalletIdError', () => new InvalidWalletIdError('x')],
  ['InvalidTransferIdError', () => new InvalidTransferIdError('x')],
  ['InvalidEthereumAddressError', () => new InvalidEthereumAddressError('x')],
  ['InvalidAddressIndexError', () => new InvalidAddressIndexError(-1)],
  ['InvalidTokenAmountError', () => new InvalidTokenAmountError('x')],
  ['InvalidTokenIdError', () => new InvalidTokenIdError('x')],
  ['InvalidTransactionHashError', () => new InvalidTransactionHashError('x')],
  ['MissingAssetFieldError', () => new MissingAssetFieldError('amount', 'fungible')],
  ['AssetFieldNotAllowedError', () => new AssetFieldNotAllowedError('tokenId', 'native')],
  ['UnknownAssetKindError', () => new UnknownAssetKindError('x')],
  ['WalletNotFoundError', () => new WalletNotFoundError('owner-1')],
  ['WalletNotActivatedError', () => new WalletNotActivatedError('receive-only')],
  ['WalletActivationInProgressError', () => new WalletActivationInProgressError()],
  ['WalletAlreadyActivatedError', () => new WalletAlreadyActivatedError()],
  ['WalletOwnerGoneError', () => new WalletOwnerGoneError('owner-1')],
  ['AdminUsesMasterAddressError', () => new AdminUsesMasterAddressError()],
  ['AddressIndexAlreadyUsedError', () => new AddressIndexAlreadyUsedError(7)],
  ['WalletAddressAlreadyUsedError', () => new WalletAddressAlreadyUsedError('0xabc')],
  ['WalletOwnerMismatchError', () => new WalletOwnerMismatchError('0xold', '0xnew')],
  ['WalletAddressIsMasterError', () => new WalletAddressIsMasterError('0xmaster')],
  ['WalletAssignmentLostError', () => new WalletAssignmentLostError('owner-1')],
  ['WalletProviderRejectedError', () => new WalletProviderRejectedError('body-rejected', 400)],
  ['WalletProviderRevertedError', () => new WalletProviderRevertedError('chain-reverted', 403)],
  ['WalletProviderUnreachableError', () => new WalletProviderUnreachableError('timeout', null)],
  ['WalletProviderUnavailableError', () => new WalletProviderUnavailableError('unauthorized', 401)],
];
