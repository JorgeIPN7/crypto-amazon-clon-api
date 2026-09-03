import { SYSTEM_ACTORS } from '@shared/domain/system-actor';

import { ActivateWalletUseCase } from '../../../application/use-cases/activate-wallet.use-case';
import { EthereumAddress } from '../../../domain/value-objects/ethereum-address.vo';
import { FakeCustodialAddressGateway } from '../../helpers/fake-custodial-address.gateway';
import { FakeOwnerDirectory } from '../../helpers/fake-owner.directory';
import { InMemoryWalletRepository } from '../../helpers/in-memory-wallet.repository';
import { TransactionHash } from '../../../domain/value-objects/transaction-hash.vo';
import {
  AdminUsesMasterAddressError,
  WalletActivationInProgressError,
  WalletAlreadyActivatedError,
  WalletNotFoundError,
  WalletOwnerGoneError,
  WalletOwnerMismatchError,
  WalletProviderUnavailableError,
} from '../../../domain/errors/wallet.errors';
import {
  WALLET_MASTER_ADDRESS,
  WALLET_OTHER_MASTER_ADDRESS,
  WALLET_OWNER_ID,
  buildWallet,
} from '../../helpers/wallet.factory';

import type { Wallet } from '../../../domain/entities/wallet.entity';

const OWNER_ID = WALLET_OWNER_ID;
const MASTER = WALLET_MASTER_ADDRESS;
const ACTIVATION_TX = '0x7a1c3b5d7e90a2d4e6f8a19f2e6c1b4a8d3f5e7c0b9a2d4e6f8a1c3b5d7e9012';

/**
 * Índice explícito y distinto del que `buildWallet` pone por defecto (3), para que la aserción de
 * V1 sobre lo que recibe la pasarela compare contra un literal INDEPENDIENTE del agregado. Con
 * `wallet.addressIndex.value` a los dos lados, la comparación se satisface sola.
 */
const ADDRESS_INDEX = 11;

describe('ActivateWalletUseCase', () => {
  describe('execute()', () => {
    it('debería solicitar la activación y guardar el hash cuando la dirección todavía no puede enviar', async () => {
      // Arrange
      const { useCase, repository, gateway } = buildUseCase([
        buildWallet({ addressIndex: ADDRESS_INDEX }),
      ]);
      gateway.programSendingEnabled(false);
      gateway.programEnableSending(TransactionHash.from(ACTIVATION_TX));

      // Act
      const wallet = await useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' });

      // Assert
      expect(wallet.status).toBe('activating');
      expect(wallet.activationTxId?.value).toBe(ACTIVATION_TX);
      expect(gateway.enableSendingCalls).toHaveLength(1);
      // El proveedor toma el ÍNDICE, no la dirección: medido en
      // `docs/tatum/gas-pump/openapi.json`, los siete esquemas del `oneOf` de
      // `POST /v3/gas-pump/activate` exigen `["chain","owner","from","to"]` con `from`/`to`
      // `type: integer`, y la dirección derivada no aparece en ninguno.
      expect(gateway.enableSendingCalls[0]?.value).toBe(ADDRESS_INDEX);
      // `saveCalls` fotografía con `toSnapshot()`, así que la comparación va contra el snapshot y
      // no contra la referencia — ver el aviso de `in-memory-wallet.repository.ts`.
      expect(repository.saveCalls).toEqual([wallet.toSnapshot()]);
    });

    it('debería curar la wallet a active sin volver a activar cuando el proveedor dice que ya puede enviar', async () => {
      // Arrange: nuestra fila se quedó en `activating` porque perdimos la respuesta.
      const stored = buildWallet({ status: 'activating', addressIndex: ADDRESS_INDEX });
      const { useCase, repository, gateway } = buildUseCase([stored]);
      gateway.programSendingEnabled(true);

      // Act + Assert
      await expect(useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' })).rejects.toThrow(
        WalletAlreadyActivatedError,
      );
      // La curación se guarda ANTES de lanzar. La aserción va contra el SNAPSHOT escrito, no
      // contra `stored.status`: la fotografía es lo único que distingue «se guardó ya curada» de
      // «se guardó y se curó después», y las dos dejan `stored.status === 'active'`.
      expect(repository.saveCalls).toEqual([stored.toSnapshot()]);
      expect(repository.saveCalls[0]?.status).toBe('active');
      // Una segunda activación se ACEPTA y quema el gas: la operación 02 del proveedor responde
      // 200 con un hash nuevo y su `oneOf` no tiene rama de rechazo; el fallo solo sería visible
      // leyendo el `invalid[]` de la operación 03, que este ciclo no lee (backlog #4 y #7).
      expect(gateway.enableSendingCalls).toEqual([]);
    });

    // ⚠️ **Este caso, «debería propagar el fallo del proveedor sin guardar nada» y «debería anotar
    // al dueño como autor de la solicitud de activación» matan CERO mutantes, y se quedan por eso
    // mismo.** Medido con
    // `pnpm test:mutation --mutate "src/modules/wallets/application/use-cases/activate-wallet.use-case.ts"`:
    // el informe por test imprime `~ … (covered 18)`, `~ … (covered 19)` y `~ … (covered 20)` en
    // los tres, y `✓ … (killed N)` en los otros ocho, que se reparten los 34 mutantes del archivo.
    //
    // La razón no es que sobren, es que Stryker no tiene mutador para lo que fijan: el actor de la
    // curación y el de la solicitud son expresiones de MIEMBRO (`SYSTEM_ACTORS.…`, `input.ownerId`)
    // y la identidad del error propagado tampoco es un literal. Medido cambiando el actor de la
    // curación por `input.ownerId` y corriendo la suite del módulo: cae **uno solo** —este
    // caso, y ninguno más—. Es decir, el único control que existe sobre la falsificación de la
    // traza es este `it`; el gate de mutación seguiría al 100 % sin él.
    it('debería atribuir la curación al actor de reconciliación y no al dueño', async () => {
      // Arrange
      const stored = buildWallet({ status: 'activating', addressIndex: ADDRESS_INDEX });
      const { useCase, repository, gateway } = buildUseCase([stored]);
      gateway.programSendingEnabled(true);

      // Act
      await expect(useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' })).rejects.toThrow(
        WalletAlreadyActivatedError,
      );

      // Assert: el dueño no activó nada — su transacción anterior lo hizo, o se perdió. La
      // comparación es distinguible porque `buildWallet` deja `updatedBy` valiendo el propio
      // `OWNER_ID` tras `markActivationRequested`: si el caso de uso pasara `input.ownerId`, el
      // valor no cambiaría y este caso lo vería.
      expect(repository.saveCalls[0]?.updatedBy).toBe(SYSTEM_ACTORS.ACTIVATION_RECONCILIATION);
      expect(repository.saveCalls[0]?.updatedBy).not.toBe(OWNER_ID);
    });

    it('debería rechazar con WalletActivationInProgressError sin emitir una segunda transacción', async () => {
      // Arrange: `enableSending` se deja SIN programar a propósito — el fake rechaza con
      // «sin programar», así que si el corte desapareciera el error cambiaría de clase y este
      // caso se pondría rojo por partida doble.
      const { useCase, repository, gateway } = buildUseCase([
        buildWallet({ status: 'activating', addressIndex: ADDRESS_INDEX }),
      ]);
      gateway.programSendingEnabled(false);

      // Act + Assert
      await expect(useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' })).rejects.toThrow(
        WalletActivationInProgressError,
      );
      expect(gateway.enableSendingCalls).toEqual([]);
      expect(repository.saveCalls).toEqual([]);
    });

    it('debería rechazar con WalletAlreadyActivatedError sin preguntar al proveedor cuando la wallet ya está activa', async () => {
      // Arrange
      const { useCase, repository, gateway } = buildUseCase([
        buildWallet({ status: 'active', addressIndex: ADDRESS_INDEX }),
      ]);

      // Act + Assert
      await expect(useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' })).rejects.toThrow(
        WalletAlreadyActivatedError,
      );
      // El estado es monótono: una dirección activada no se des-activa, así que el `active`
      // cacheado ahorra el crédito de la comprobación (spec §5.4, razón 2).
      expect(gateway.isSendingEnabledCalls).toEqual([]);
      expect(repository.saveCalls).toEqual([]);
    });

    it('debería rechazar con WalletOwnerGoneError cuando el directorio ya no conoce al dueño', async () => {
      // Arrange: el JWT sigue firmado y vigente, pero su dueño se desactivó.
      const { useCase, repository, gateway } = buildUseCase(
        [buildWallet({ addressIndex: ADDRESS_INDEX })],
        [],
      );

      // Act + Assert
      await expect(useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' })).rejects.toThrow(
        WalletOwnerGoneError,
      );
      expect(gateway.isSendingEnabledCalls).toEqual([]);
      expect(gateway.enableSendingCalls).toEqual([]);
      expect(repository.saveCalls).toEqual([]);
    });

    it('debería lanzar WalletNotFoundError cuando el dueño no tiene wallet', async () => {
      // Arrange
      const { useCase, gateway } = buildUseCase([]);

      // Act + Assert
      await expect(useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' })).rejects.toThrow(
        WalletNotFoundError,
      );
      expect(gateway.isSendingEnabledCalls).toEqual([]);
      expect(gateway.enableSendingCalls).toEqual([]);
    });

    it('debería lanzar WalletOwnerMismatchError cuando la wallet se derivó bajo otra master', async () => {
      // Arrange: la master rotó y esta dirección ya no la controlamos.
      const { useCase, gateway } = buildUseCase([
        buildWallet({ ownerAddress: WALLET_OTHER_MASTER_ADDRESS, addressIndex: ADDRESS_INDEX }),
      ]);

      // Act + Assert: operar bajo una master que ya no es la nuestra quema gas para nada, así
      // que el corte va ANTES de la primera llamada que cobra.
      await expect(useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' })).rejects.toThrow(
        WalletOwnerMismatchError,
      );
      expect(gateway.isSendingEnabledCalls).toEqual([]);
      expect(gateway.enableSendingCalls).toEqual([]);
    });

    it('debería propagar el fallo del proveedor sin guardar nada', async () => {
      // Arrange: un 400 del proveedor al ACTIVAR es culpa nuestra —`'misconfigured'`— y sale
      // como 503. Se usa el error de dominio y no un `Error` pelado porque es lo que el
      // adaptador va a lanzar de verdad, y porque el fake acepta cualquiera de los nueve
      // motivos de `PROVIDER_FAILURE_REASONS` sin enumerarlos.
      const failure = new WalletProviderUnavailableError('misconfigured', 400);
      const { useCase, repository, gateway } = buildUseCase([
        buildWallet({ addressIndex: ADDRESS_INDEX }),
      ]);
      gateway.programSendingEnabled(false);
      gateway.programEnableSending(failure);

      // Act + Assert: el MISMO error, no uno equivalente — el caso de uso no lo envuelve.
      await expect(useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' })).rejects.toBe(failure);
      expect(gateway.enableSendingCalls).toHaveLength(1);
      expect(repository.saveCalls).toEqual([]);
    });

    it('debería anotar al dueño como autor de la solicitud de activación', async () => {
      // Arrange
      const { useCase, repository, gateway } = buildUseCase([
        buildWallet({ addressIndex: ADDRESS_INDEX }),
      ]);
      gateway.programSendingEnabled(false);
      gateway.programEnableSending(TransactionHash.from(ACTIVATION_TX));

      // Act
      const wallet = await useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' });

      // Assert: esta transición SÍ la pidió él, a diferencia de la curación.
      expect(wallet.updatedBy).toBe(OWNER_ID);
      expect(repository.saveCalls[0]?.updatedBy).toBe(OWNER_ID);
    });

    it('debería rechazar con AdminUsesMasterAddressError cuando el rol es admin, sin consultar nada', async () => {
      // Arrange: la master no es una gas pump address, así que no hay nada que activar. La wallet
      // está en la tabla a propósito: sin ella, el caso pasaría también con el corte movido detrás
      // de la lectura.
      const { useCase, directory, repository, gateway } = buildUseCase([
        buildWallet({ addressIndex: ADDRESS_INDEX }),
      ]);

      // Act + Assert
      await expect(useCase.execute({ ownerId: OWNER_ID, ownerRole: 'admin' })).rejects.toThrow(
        AdminUsesMasterAddressError,
      );
      // El corte es lo PRIMERO: el rol viaja en el token y no cuesta E/S, así que va antes que
      // el directorio, que es lo único gratis que queda.
      expect(directory.existsCalls).toEqual([]);
      expect(repository.findByOwnerIdCalls).toEqual([]);
      expect(gateway.isSendingEnabledCalls).toEqual([]);
      expect(gateway.enableSendingCalls).toEqual([]);
    });
  });
});

// Helpers

const buildUseCase = (wallets: readonly Wallet[], knownOwners: readonly string[] = [OWNER_ID]) => {
  const directory = new FakeOwnerDirectory(knownOwners);
  const repository = new InMemoryWalletRepository(wallets);
  const gateway = new FakeCustodialAddressGateway(EthereumAddress.from(MASTER));

  return {
    useCase: new ActivateWalletUseCase(directory, repository, gateway),
    directory,
    repository,
    gateway,
  };
};
