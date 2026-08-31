import fc from 'fast-check';

import { SYSTEM_ACTORS } from '@shared/domain/system-actor';

import { EthereumAddress } from '../../../domain/value-objects/ethereum-address.vo';
import { FakeCustodialAddressGateway } from '../../helpers/fake-custodial-address.gateway';
import { FakeOwnerDirectory } from '../../helpers/fake-owner.directory';
import { InMemoryWalletRepository } from '../../helpers/in-memory-wallet.repository';
import { InMemoryWalletTransferRepository } from '../../helpers/in-memory-wallet-transfer.repository';
import { TransactionHash } from '../../../domain/value-objects/transaction-hash.vo';
import { TransferAssetUseCase } from '../../../application/use-cases/transfer-asset.use-case';
import {
  AdminUsesMasterAddressError,
  AssetFieldNotAllowedError,
  InvalidEthereumAddressError,
  WalletNotActivatedError,
  WalletNotFoundError,
  WalletOwnerGoneError,
  WalletOwnerMismatchError,
  WalletProviderRejectedError,
  WalletProviderUnreachableError,
} from '../../../domain/errors/wallet.errors';
import {
  WALLET_ADDRESS,
  WALLET_MASTER_ADDRESS,
  WALLET_OTHER_MASTER_ADDRESS,
  WALLET_OWNER_ID,
  buildWallet,
} from '../../helpers/wallet.factory';
import { TRANSFER_RECIPIENT_ADDRESS, TRANSFER_TX } from '../../helpers/wallet-transfer.factory';

import type { SendCommand } from '../../../domain/ports/custodial-address.gateway';
import type { TransferAssetParts } from '../../../domain/transfer-asset';
import type { Wallet } from '../../../domain/entities/wallet.entity';
import type { WalletTransfer } from '../../../domain/entities/wallet-transfer.entity';

const OWNER_ID = WALLET_OWNER_ID;
const MASTER = WALLET_MASTER_ADDRESS;
const DERIVED = WALLET_ADDRESS;
const RECIPIENT = TRANSFER_RECIPIENT_ADDRESS;
const NATIVE_ASSET: TransferAssetParts = { kind: 'native', amount: '1000000000000000000' };

/** La entrada completa del camino feliz. Cada caso cambia solo lo suyo con un `spread`. */
const TRANSFER_INPUT = {
  ownerId: OWNER_ID,
  ownerRole: 'user',
  recipient: RECIPIENT,
  asset: NATIVE_ASSET,
};

describe('TransferAssetUseCase', () => {
  describe('execute()', () => {
    it('debería registrar la transferencia como submitted con el hash devuelto por el proveedor', async () => {
      // Arrange
      const { useCase, ledger, gateway } = buildUseCase([buildWallet({ status: 'active' })]);
      gateway.programSend(TransactionHash.from(TRANSFER_TX));

      // Act
      const transfer = await useCase.execute(TRANSFER_INPUT);

      // Assert
      expect(transfer.status).toBe('submitted');
      expect(transfer.txId?.value).toBe(TRANSFER_TX);
      // Dos y no tres: el reintento de la liquidación solo corre cuando la PRIMERA falla. Medido
      // invirtiendo el `if (!saved)` de `recordOutcome()` y corriendo la suite del módulo: caen
      // CUATRO casos —este, el del diario y los dos del reintento—. Stryker le atribuye la muerte
      // a este solo porque corre antes; los cuatro lo cazan.
      expect(ledger.saveCalls).toHaveLength(2);
    });

    it('debería escribir la fila del libro ANTES de llamar al proveedor', async () => {
      // Arrange
      const { useCase, journal, gateway } = buildUseCase([buildWallet({ status: 'active' })]);
      gateway.programSend(TransactionHash.from(TRANSFER_TX));

      // Act
      await useCase.execute(TRANSFER_INPUT);

      // Assert: con la escritura posterior, un timeout no dejaría rastro — que es justo el caso
      // para el que el libro existe (spec §3.2). El diario compara la secuencia ENTERA y no dos
      // llamadas sueltas, así que también fija que la liquidación va después de la respuesta.
      expect(journal).toEqual(['save:submitting', 'send', 'save:submitted']);
    });

    // ⚠️ **Este caso mata CERO mutantes y es el único control del fallo más caro del archivo.**
    // Medido dos veces. Con
    // `pnpm test:mutation --mutate "src/modules/wallets/application/use-cases/transfer-asset.use-case.ts"`
    // el informe por test imprime `~ … (covered 26)`: los 26 mutantes que cubre los mata otro caso
    // antes. Y cambiando `from: wallet.address` por `from: wallet.ownerAddress` en la llamada
    // —o sea, enviando desde la master— la suite del módulo tumba **este caso, y
    // ninguno más. Stryker no tiene mutador que sustituya una expresión de MIEMBRO por otra, así
    // que el gate seguiría en 98.04 % con el fondo de gas de la plataforma saliendo por la puerta.
    // Es la misma familia de hueco que el actor de la curación en `activate-wallet.use-case.spec.ts`.
    it('debería enviar desde la dirección de la wallet y nunca desde la master', async () => {
      // Arrange
      const { useCase, gateway } = buildUseCase([buildWallet({ status: 'active' })]);
      gateway.programSend(TransactionHash.from(TRANSFER_TX));

      // Act
      await useCase.execute(TRANSFER_INPUT);

      // Assert: la master FIRMA, no envía. Enviar desde ella movería el fondo de gas de la
      // plataforma. `sendCalls` guarda una proyección de campos NOMBRADOS, así que `from` y
      // `recipient` ya son cadenas — ver el aviso de `fake-custodial-address.gateway.ts`.
      expect(gateway.sendCalls[0]?.from).toBe(DERIVED);
      expect(gateway.sendCalls[0]?.from).not.toBe(MASTER);
      expect(gateway.sendCalls[0]?.recipient).toBe(RECIPIENT);
    });

    it('debería registrar rejected con el código del proveedor y propagar el error', async () => {
      // Arrange: el 400 de validación del cuerpo es el ÚNICO rechazo que significa «no pasó nada
      // en la cadena» (spec §3.2).
      const rejection = new WalletProviderRejectedError('body-rejected', 400);
      const { useCase, ledger, gateway } = buildUseCase([buildWallet({ status: 'active' })]);
      gateway.programSend(rejection);

      // Act + Assert: el MISMO error, no uno equivalente — el caso de uso no lo envuelve.
      await expect(useCase.execute(TRANSFER_INPUT)).rejects.toBe(rejection);
      expect(ledger.saveCalls.at(-1)?.status).toBe('rejected');
      expect(ledger.saveCalls.at(-1)?.reasonCode).toBe('body-rejected');
      // ⚠️ **UNA sola llamada, y esta aserción es lo único que lo ancla.** El JSDoc del caso de
      // uso nombra el reintento de `send()` como el fallo que no hay que cometer —una segunda
      // transacción es dinero movido dos veces— pero nada lo comprobaba: medido envolviendo la
      // llamada en un `try/catch` que reintenta, la suite del módulo pasaba ENTERA y el gate de
      // mutación seguía sin supervivientes nuevos, porque Stryker no genera ese mutante.
      expect(gateway.sendCalls).toHaveLength(1);
    });

    it('debería registrar unknown cuando la llamada no deja saber el resultado', async () => {
      // Arrange: un timeout NO es «no se ejecutó» — pudo minarse o no.
      const failure = new WalletProviderUnreachableError('timeout', null);
      const { useCase, ledger, gateway } = buildUseCase([buildWallet({ status: 'active' })]);
      gateway.programSend(failure);

      // Act + Assert
      await expect(useCase.execute(TRANSFER_INPUT)).rejects.toBe(failure);
      expect(ledger.saveCalls.at(-1)?.status).toBe('unknown');
      expect(ledger.saveCalls.at(-1)?.reasonCode).toBe('timeout');
      // Y sobre todo aquí: un timeout es el caso donde reintentar «parece» razonable, y es
      // justo donde no se puede — la primera pudo minarse. Ver el gemelo del caso de rechazo.
      expect(gateway.sendCalls).toHaveLength(1);
    });

    it('debería rechazar un destinatario mal formado sin tocar la red ni escribir en el libro', async () => {
      // Arrange — la wallet nace en `receive-only` A PROPÓSITO, no `active`.
      //
      // ⚠️ Con una wallet ya activa este caso NO ancla el orden: la precondición corta en seco
      // por `wallet.canSend` y nunca llega a preguntar al proveedor, así que da igual dónde se
      // valide el destinatario. Medido moviendo las dos líneas de construcción del dominio
      // DEBAJO de la precondición: con la wallet activa la suite pasaba entera; con esta,
      // `isSendingEnabledCalls` deja de estar vacío y el caso cae.
      //
      // Lo que cuesta el orden equivocado es concreto: **un crédito del proveedor gastado para
      // devolver un 400**. «Sin tocar la red» solo significa lo que dice si el caso puede llegar
      // a tocarla.
      const { useCase, ledger, gateway } = buildUseCase([buildWallet()]);

      // Act + Assert
      await expect(useCase.execute({ ...TRANSFER_INPUT, recipient: '0x123' })).rejects.toThrow(
        InvalidEthereumAddressError,
      );
      expect(gateway.sendCalls).toEqual([]);
      expect(ledger.saveCalls).toEqual([]);
      // Ni un crédito: si la validación se hiciera DESPUÉS de la precondición, aquí habría una
      // llamada a `isSendingEnabled` y esta lista no estaría vacía.
      expect(gateway.isSendingEnabledCalls).toEqual([]);
    });

    it('debería rechazar un activo con campos excluyentes sin tocar la red ni escribir en el libro', async () => {
      // Arrange: el nativo no admite `tokenId`; el DTO deja pasar el campo de más a propósito y
      // la invariante real vive aquí (spec §6.1).
      const { useCase, ledger, gateway } = buildUseCase([buildWallet({ status: 'active' })]);

      // Act + Assert
      await expect(
        useCase.execute({
          ...TRANSFER_INPUT,
          asset: { kind: 'native', amount: '1', tokenId: '7' },
        }),
      ).rejects.toThrow(AssetFieldNotAllowedError);
      expect(gateway.sendCalls).toEqual([]);
      expect(ledger.saveCalls).toEqual([]);
    });

    it('debería rechazar con WalletNotActivatedError cuando el proveedor dice que aún no puede enviar', async () => {
      // Arrange: `send` se deja SIN programar a propósito — el fake rechaza con «sin programar»,
      // así que si el corte desapareciera el error cambiaría de clase y este caso se pondría
      // rojo por partida doble.
      const { useCase, ledger, gateway } = buildUseCase([buildWallet()]);
      gateway.programSendingEnabled(false);

      // Act + Assert
      await expect(useCase.execute(TRANSFER_INPUT)).rejects.toThrow(WalletNotActivatedError);
      expect(gateway.sendCalls).toEqual([]);
      // Sin este corte antes de la escritura, el libro se llenaría de rechazos que nunca
      // salieron del proceso (spec §3.2).
      expect(ledger.saveCalls).toEqual([]);
    });

    it('debería curar la wallet a active atribuyéndolo al actor de reconciliación y seguir adelante', async () => {
      // Arrange: nuestra fila se quedó en `receive-only` porque perdimos la respuesta de una
      // activación que el proveedor sí aceptó.
      const stored = buildWallet();
      const { useCase, repository, gateway } = buildUseCase([stored]);
      gateway.programSendingEnabled(true);
      gateway.programSend(TransactionHash.from(TRANSFER_TX));

      // Act
      const transfer = await useCase.execute(TRANSFER_INPUT);

      // Assert: mismo criterio que `activate-wallet.use-case.ts`, que resuelve la misma
      // reconciliación (spec §5.4) — dos lecturas del mismo estado que discreparan serían peor
      // que una sola. `saveCalls` fotografía con `toSnapshot()`, así que la comparación va
      // contra el snapshot y no contra la referencia.
      expect(repository.saveCalls).toEqual([stored.toSnapshot()]);
      expect(repository.saveCalls[0]?.status).toBe('active');
      // El dueño no activó nada: solo intentó transferir. `buildWallet` deja `updatedBy`
      // valiendo el propio `OWNER_ID`, así que pasar `input.ownerId` aquí sería visible.
      expect(repository.saveCalls[0]?.updatedBy).toBe(SYSTEM_ACTORS.ACTIVATION_RECONCILIATION);
      expect(repository.saveCalls[0]?.updatedBy).not.toBe(OWNER_ID);
      expect(transfer.status).toBe('submitted');
    });

    it('debería no preguntar al proveedor por la activación cuando la wallet ya está activa', async () => {
      // Arrange
      const { useCase, gateway } = buildUseCase([buildWallet({ status: 'active' })]);
      gateway.programSend(TransactionHash.from(TRANSFER_TX));

      // Act
      const transfer = await useCase.execute(TRANSFER_INPUT);

      // Assert: el estado es monótono —una dirección activada no se des-activa—, así que el
      // `active` cacheado es información completa y ahorra el crédito (spec §5.4, razón 2).
      expect(gateway.isSendingEnabledCalls).toEqual([]);
      expect(transfer.status).toBe('submitted');
    });

    it('debería rechazar con WalletOwnerGoneError cuando el directorio ya no conoce al dueño', async () => {
      // Arrange: el JWT sigue firmado y vigente, pero su dueño se desactivó.
      const { useCase, ledger, gateway } = buildUseCase([buildWallet({ status: 'active' })], []);

      // Act + Assert
      await expect(useCase.execute(TRANSFER_INPUT)).rejects.toThrow(WalletOwnerGoneError);
      expect(gateway.isSendingEnabledCalls).toEqual([]);
      expect(gateway.sendCalls).toEqual([]);
      expect(ledger.saveCalls).toEqual([]);
    });

    it('debería lanzar WalletNotFoundError cuando el dueño no tiene wallet', async () => {
      // Arrange
      const { useCase, ledger, gateway } = buildUseCase([]);

      // Act + Assert
      await expect(useCase.execute(TRANSFER_INPUT)).rejects.toThrow(WalletNotFoundError);
      expect(gateway.isSendingEnabledCalls).toEqual([]);
      expect(gateway.sendCalls).toEqual([]);
      expect(ledger.saveCalls).toEqual([]);
    });

    it('debería lanzar WalletOwnerMismatchError cuando la wallet se derivó bajo otra master', async () => {
      // Arrange: la master rotó y esta dirección ya no la controlamos.
      const { useCase, ledger, gateway } = buildUseCase([
        buildWallet({ status: 'active', ownerAddress: WALLET_OTHER_MASTER_ADDRESS }),
      ]);

      // Act + Assert: operar bajo una master que ya no es la nuestra quema gas para nada.
      await expect(useCase.execute(TRANSFER_INPUT)).rejects.toThrow(WalletOwnerMismatchError);
      expect(gateway.sendCalls).toEqual([]);
      expect(ledger.saveCalls).toEqual([]);
    });

    it('debería reintentar UNA vez el guardado posterior del libro', async () => {
      // Arrange: la escritura por delante pasa (`null`) y el guardado del desenlace falla una vez.
      const { useCase, ledger, gateway } = buildUseCase([buildWallet({ status: 'active' })]);
      gateway.programSend(TransactionHash.from(TRANSFER_TX));
      ledger.programSaveFailures(null, new Error('connection reset'));

      // Act
      const transfer = await useCase.execute(TRANSFER_INPUT);

      // Assert: la escritura posterior no toca la cadena y es idempotente, así que reintentarla
      // es gratis (spec §3.2). Reintentar la LLAMADA, en cambio, movería el dinero dos veces.
      expect(transfer.status).toBe('submitted');
      expect(ledger.saveCalls).toHaveLength(3);
    });

    it('debería devolver la transferencia enviada aunque el reintento del guardado también falle', async () => {
      // Arrange
      const { useCase, ledger, gateway } = buildUseCase([buildWallet({ status: 'active' })]);
      gateway.programSend(TransactionHash.from(TRANSFER_TX));
      ledger.programSaveFailures(null, new Error('down'), new Error('down'));

      // Act
      const transfer = await useCase.execute(TRANSFER_INPUT);

      // Assert: el dinero ya se movió. Convertir el fallo del guardado en un 500 borraría el
      // único sitio donde el cliente puede leer el hash de una transacción que SÍ existe; la fila
      // sobrevive en `submitting`, que la regla escrita manda leer como `unknown`.
      expect(transfer.txId?.value).toBe(TRANSFER_TX);
      // Tres y no cuatro: el reintento es ÚNICO. Es lo que ancla que no haya bucle.
      expect(ledger.saveCalls).toHaveLength(3);
    });

    it('debería rechazar con AdminUsesMasterAddressError cuando el rol es admin, sin consultar nada', async () => {
      // Arrange: la master no envía por Gas Pump — firma, que es otra cosa. La wallet está en la
      // tabla a propósito: sin ella, el caso pasaría también con el corte movido detrás de la
      // lectura.
      const { useCase, directory, repository, ledger, gateway } = buildUseCase([
        buildWallet({ status: 'active' }),
      ]);

      // Act + Assert
      await expect(useCase.execute({ ...TRANSFER_INPUT, ownerRole: 'admin' })).rejects.toThrow(
        AdminUsesMasterAddressError,
      );
      // El corte es lo PRIMERO: el rol viaja en el token y no cuesta E/S.
      expect(directory.existsCalls).toEqual([]);
      expect(repository.findByOwnerIdCalls).toEqual([]);
      expect(gateway.sendCalls).toEqual([]);
      expect(ledger.saveCalls).toEqual([]);
    });

    it('debería dejar la fila en submitting y propagar cuando el fallo no viene traducido del proveedor', async () => {
      // Arrange: un `Error` corriente escapando de la pasarela es un defecto NUESTRO.
      const bug = new Error('mapper exploded');
      const { useCase, ledger, gateway } = buildUseCase([buildWallet({ status: 'active' })]);
      gateway.programSend(bug);

      // Act + Assert
      await expect(useCase.execute(TRANSFER_INPUT)).rejects.toBe(bug);
      // No se le inventa un motivo: `ProviderFailureReason` es una lista cerrada sin código para
      // un fallo nuestro, y publicar uno falso en `GET /wallets/me/transfers` es peor que no
      // publicar ninguno. Un solo guardado: el de la escritura por delante.
      expect(ledger.saveCalls).toHaveLength(1);
      expect(ledger.saveCalls[0]?.status).toBe('submitting');
      expect(ledger.saveCalls[0]?.reasonCode).toBeNull();
    });

    // ⚠️ Propiedad escrita con `fc.assert` dentro de un `it` normal, NO con `fcTest.prop`, por lo
    // mismo que las de `assign-wallet.use-case.spec.ts` y `find-wallet-by-owner.use-case.spec.ts`:
    // `@fast-check/jest` mete la semilla DENTRO del nombre del test y `stryker.config.mjs` usa
    // `coverageAnalysis: perTest`, que empareja por nombre. La propiedad EXPLORA; quien ancla cada
    // rama son los diecisiete casos puntuales de arriba (backlog #18).
    //
    // ⚠️ Y aun escrita así, el informe por test **no le atribuye ninguna muerte**, que no es lo
    // mismo que «no puede matar»: Stryker atribuye cada mutante al primer test que lo mata, y
    // aquí llegan antes los diecisiete casos puntuales. Medido en
    // `list-wallet-transfers.use-case.spec.ts` poniendo los puntuales en `it.skip`: la propiedad
    // pasa a `killed 2`. La conclusión útil sigue siendo la misma —anclar cada rama con un caso
    // puntual— pero por el motivo correcto. Ver `docs/backlog.md` #18. Medido: `~ … (covered
    // 35)`, el número más alto de los dieciocho. No es que sobre —es la única aserción que recorre
    // los tres desenlaces con la misma pregunta—, es que los 35 mutantes que toca ya los mató un
    // caso puntual anterior. Confirma la regla en vez de contradecirla: explorar no es anclar.
    it('debería escribir siempre la primera fila en submitting, sea cual sea el desenlace (propiedad)', async () => {
      await fc.assert(
        fc.asyncProperty(outcomeArb, async (outcome) => {
          // Arrange
          const { useCase, ledger, gateway } = buildUseCase([buildWallet({ status: 'active' })]);
          gateway.programSend(programmedOutcome(outcome));

          // Act: los tres desenlaces se miran igual, y dos de ellos propagan.
          await useCase.execute(TRANSFER_INPUT).catch(() => undefined);

          // Assert
          expect(ledger.saveCalls[0]?.status).toBe('submitting');
        }),
      );
    });
  });
});

// Helpers

type ProviderOutcome = 'submitted' | 'rejected' | 'unknown';

const outcomeArb = fc.constantFrom<ProviderOutcome>('submitted', 'rejected', 'unknown');

/**
 * Los tres desenlaces del proveedor, cada uno con su representante canónico: el hash del 200, el
 * ÚNICO 400 que significa «no pasó nada en la cadena» y el timeout, que es el ejemplo de «pudo
 * minarse o no». No hay un cuarto: un `Error` sin traducir no es un desenlace del proveedor sino
 * un defecto nuestro, y por eso lo cubre un caso puntual y no esta propiedad.
 */
const programmedOutcome = (outcome: ProviderOutcome): TransactionHash | Error => {
  if (outcome === 'submitted') {
    return TransactionHash.from(TRANSFER_TX);
  }
  return outcome === 'rejected'
    ? new WalletProviderRejectedError('body-rejected', 400)
    : new WalletProviderUnreachableError('timeout', null);
};

/**
 * Dobles que REGISTRAN el orden de llamada en un diario compartido y delegan en el fake con
 * `super`, exactamente como `assign-wallet.use-case.spec.ts` y por el mismo motivo medido allí:
 * `jest.spyOn(...).mockImplementation()` SUSTITUYE el cuerpo del fake, así que el caso del orden
 * dejaría de escribir `saveCalls` y el almacén, y ninguna otra aserción de ese caso podría
 * asomarse a esas listas. Delegando, un solo `buildUseCase` sirve para los dieciocho casos y el
 * diario sale gratis en los otros diecisiete.
 *
 * ⚠️ **El diario anota solo las DOS operaciones que la escritura por delante ordena entre sí** —el
 * guardado del libro y la llamada—, y no el directorio, la lectura de la wallet o
 * `isSendingEnabled`. Esos tienen su propia lista en su propio fake (`existsCalls`,
 * `findByOwnerIdCalls`, `isSendingEnabledCalls`), y que van ANTES de la primera escritura lo fijan
 * los cuatro casos que exigen `ledger.saveCalls` vacío tras un rechazo local.
 *
 * El guardado se anota con el ESTADO del instante y no solo con `'save'`: es lo único que
 * distingue la fila escrita por delante de la liquidación posterior, que es toda la afirmación.
 */
class RecordingWalletTransferRepository extends InMemoryWalletTransferRepository {
  constructor(private readonly journal: string[]) {
    super();
  }

  override save(transfer: WalletTransfer): Promise<void> {
    this.journal.push(`save:${transfer.status}`);
    return super.save(transfer);
  }
}

class RecordingCustodialAddressGateway extends FakeCustodialAddressGateway {
  constructor(
    private readonly journal: string[],
    master: EthereumAddress,
  ) {
    super(master);
  }

  override send(command: SendCommand): Promise<TransactionHash> {
    this.journal.push('send');
    return super.send(command);
  }
}

const buildUseCase = (wallets: readonly Wallet[], knownOwners: readonly string[] = [OWNER_ID]) => {
  const journal: string[] = [];
  const directory = new FakeOwnerDirectory(knownOwners);
  const repository = new InMemoryWalletRepository(wallets);
  const ledger = new RecordingWalletTransferRepository(journal);
  const gateway = new RecordingCustodialAddressGateway(journal, EthereumAddress.from(MASTER));

  return {
    useCase: new TransferAssetUseCase(directory, repository, ledger, gateway),
    directory,
    repository,
    ledger,
    gateway,
    journal,
  };
};
