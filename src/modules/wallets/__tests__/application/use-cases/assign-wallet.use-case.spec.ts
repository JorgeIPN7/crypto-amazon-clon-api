import fc from 'fast-check';

import { AssignWalletUseCase } from '../../../application/use-cases/assign-wallet.use-case';
import { EthereumAddress } from '../../../domain/value-objects/ethereum-address.vo';
import { FakeAddressIndexAllocator } from '../../helpers/fake-address-index.allocator';
import { FakeCustodialAddressGateway } from '../../helpers/fake-custodial-address.gateway';
import { FakeOwnerDirectory } from '../../helpers/fake-owner.directory';
import { InMemoryWalletRepository } from '../../helpers/in-memory-wallet.repository';
import {
  AdminUsesMasterAddressError,
  WalletAddressIsMasterError,
  WalletAssignmentLostError,
  WalletOwnerGoneError,
  WalletProviderUnavailableError,
} from '../../../domain/errors/wallet.errors';
import {
  WALLET_ADDRESS,
  WALLET_MASTER_ADDRESS,
  WALLET_OWNER_ID,
  buildWallet,
} from '../../helpers/wallet.factory';
import { addressIndexArb, ethereumAddressArb } from '../../helpers/arbitraries';

import type { AddressIndex } from '../../../domain/value-objects/address-index.vo';
import type { Wallet } from '../../../domain/entities/wallet.entity';
import type { WalletSaveOutcome } from '../../../domain/ports/wallet.repository';

const OWNER_ID = WALLET_OWNER_ID;
const MASTER = WALLET_MASTER_ADDRESS;
const DERIVED = WALLET_ADDRESS;
const FIRST_INDEX = 7;

describe('AssignWalletUseCase', () => {
  describe('execute()', () => {
    it('debería asignar una wallet derivada bajo la master cuando el dueño no tiene ninguna', async () => {
      // Arrange
      const { useCase, repository, gateway } = buildUseCase({ knownOwners: [OWNER_ID] });

      // Act
      const wallet = await useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' });

      // Assert
      expect(wallet.ownerId).toBe(OWNER_ID);
      expect(wallet.addressIndex.value).toBe(FIRST_INDEX);
      expect(wallet.address.value).toBe(DERIVED);
      expect(wallet.ownerAddress.value).toBe(MASTER);
      // `saveCalls` fotografía con `toSnapshot()`, así que la comparación va contra el snapshot
      // y no contra la referencia — ver el aviso de `in-memory-wallet.repository.ts`.
      expect(repository.saveCalls).toEqual([wallet.toSnapshot()]);
      expect(gateway.deriveCalls).toHaveLength(1);
    });

    it('debería devolver la wallet existente sin reservar índice ni llamar a la pasarela', async () => {
      // Arrange
      const existing = buildWallet({ ownerId: OWNER_ID });
      const { useCase, repository, allocator, gateway } = buildUseCase({
        knownOwners: [OWNER_ID],
        existing: [existing],
      });

      // Act
      const wallet = await useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' });

      // Assert: idempotencia barata — repetir el alta no gasta ni un crédito del proveedor.
      expect(wallet).toBe(existing);
      expect(allocator.allocated).toEqual([]);
      expect(gateway.deriveCalls).toEqual([]);
      expect(repository.saveCalls).toEqual([]);
    });

    it('debería rechazar con WalletOwnerGoneError cuando el directorio ya no conoce al dueño', async () => {
      // Arrange: el JWT sigue firmado y vigente, pero su dueño se desactivó.
      const { useCase, repository, allocator, gateway } = buildUseCase({ knownOwners: [] });

      // Act + Assert
      await expect(useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' })).rejects.toThrow(
        WalletOwnerGoneError,
      );
      expect(allocator.allocated).toEqual([]);
      expect(gateway.deriveCalls).toEqual([]);
      expect(repository.saveCalls).toEqual([]);
    });

    it('debería consultar el directorio antes de reservar el índice y antes de derivar', async () => {
      // Arrange
      const { useCase, journal } = buildUseCase({ knownOwners: [OWNER_ID] });

      // Act
      await useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' });

      // Assert: el directorio va PRIMERO porque es lo único gratis; detrás van un índice
      // irrecuperable y el crédito del proveedor.
      expect(journal).toEqual(['exists', 'findByOwnerId', 'next', 'deriveAddress', 'save']);
    });

    it('debería propagar el fallo de la pasarela sin guardar nada y sin devolver el índice reservado', async () => {
      // Arrange: un 400 al derivar es culpa NUESTRA —`'misconfigured'`— y sale como 503.
      const failure = new WalletProviderUnavailableError('misconfigured', 400);
      const { useCase, repository, allocator, gateway } = buildUseCase({ knownOwners: [OWNER_ID] });
      gateway.programDeriveAddress(failure);

      // Act + Assert: el MISMO error, no uno equivalente — el caso de uso no lo envuelve.
      await expect(useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' })).rejects.toBe(failure);
      expect(repository.saveCalls).toEqual([]);
      // El índice queda consumido y NO se compensa: lo huérfano es un número, no una fila, y
      // el intento siguiente pide el siguiente índice.
      expect(allocator.allocated).toEqual([FIRST_INDEX]);
    });

    it('debería devolver la wallet del ganador tras UNA sola relectura cuando el alta pierde la carrera', async () => {
      // Arrange
      const winner = buildWallet({ ownerId: OWNER_ID });
      const { useCase, repository, allocator } = buildUseCase({ knownOwners: [OWNER_ID] });
      repository.programOwnerConflict(winner);

      // Act
      const wallet = await useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' });

      // Assert
      expect(wallet).toBe(winner);
      expect(repository.findByOwnerIdCalls).toEqual([OWNER_ID, OWNER_ID]);
      expect(repository.saveCalls).toHaveLength(1);
      expect(allocator.allocated).toEqual([FIRST_INDEX]);
    });

    it('debería lanzar WalletAssignmentLostError cuando la relectura vuelve vacía', async () => {
      // Arrange: el ganador hizo ROLLBACK entre el conflicto y la relectura.
      const { useCase, repository, allocator } = buildUseCase({ knownOwners: [OWNER_ID] });
      repository.programOwnerConflict(null);

      // Act + Assert
      await expect(useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' })).rejects.toThrow(
        WalletAssignmentLostError,
      );
      // Una relectura, no un bucle: reintentar gastaría otro crédito y otro índice para volver a
      // arriesgar la misma carrera.
      expect(repository.findByOwnerIdCalls).toEqual([OWNER_ID, OWNER_ID]);
      expect(repository.saveCalls).toHaveLength(1);
      expect(allocator.allocated).toEqual([FIRST_INDEX]);
    });

    it('debería anotar al dueño como autor de la fila', async () => {
      // Arrange
      const { useCase } = buildUseCase({ knownOwners: [OWNER_ID] });

      // Act
      const wallet = await useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' });

      // Assert: el único camino es el dueño pidiéndose su propia dirección, así que la traza
      // lo nombra a él y no a un actor de sistema.
      expect(wallet.createdBy).toBe(OWNER_ID);
      expect(wallet.updatedBy).toBe(OWNER_ID);
    });

    it('debería rechazar con AdminUsesMasterAddressError cuando el rol es admin, sin consultar nada', async () => {
      // Arrange: el admin YA tiene dirección —la master— y darle además una derivada le dejaría
      // dos, que es la invariante «una sola EOA en el sistema».
      const { useCase, directory, repository, allocator, gateway } = buildUseCase({
        knownOwners: [OWNER_ID],
      });

      // Act + Assert
      await expect(useCase.execute({ ownerId: OWNER_ID, ownerRole: 'admin' })).rejects.toThrow(
        AdminUsesMasterAddressError,
      );
      // El corte es lo PRIMERO: no cuesta E/S, así que va antes que el directorio.
      expect(directory.existsCalls).toEqual([]);
      expect(repository.findByOwnerIdCalls).toEqual([]);
      expect(allocator.allocated).toEqual([]);
      expect(gateway.deriveCalls).toEqual([]);
    });

    // ⚠️ Propiedad escrita con `fc.assert` dentro de un `it` normal, NO con `fcTest.prop`, y no es
    // estilo: `@fast-check/jest` mete la semilla DENTRO del nombre del test —`… (with
    // seed=399077411)`—, y `stryker.config.mjs` usa `coverageAnalysis: perTest`, que empareja los
    // tests por nombre; con la semilla dentro, Stryker no vuelve a encontrar el test en la corrida
    // del mutante y la propiedad no mata nada. Esa medición no es mía: vive en
    // `__tests__/domain/entities/wallet-transfer.entity.spec.ts`, con la línea de salida del
    // auditor.
    //
    // Lo que SÍ está medido aquí es la mitad barata: el nombre de este caso no lleva semilla —se
    // lee tal cual en el rojo del stub, `● AssignWalletUseCase › execute() › debería reservar un
    // índice y derivar exactamente una vez por alta nueva (propiedad)`—. Que por eso Stryker lo
    // empareje es la consecuencia esperada, **no comprobada**: haría falta leer el informe por
    // test, y no se hizo.
    //
    // En cualquier caso las cinco ramas del caso de uso las anclan los nueve casos puntuales de
    // arriba, así que el gate no depende de esto: la propiedad explora, no ancla.
    // ⚠️ **Añadido por confirmación**: la tabla acordada no lo traía, y el hueco es el más caro
    // del módulo. `Wallet.assign()` rechaza que la dirección derivada sea la propia master —uno de
    // los cinco controles de esa invariante— y este caso de uso no la traga: no hay ni un `try` en
    // el archivo. Pero **nada lo anclaba**.
    //
    // Medido antes de escribirlo: envolviendo `Wallet.assign()` en un `try/catch` que se come el
    // error y reasigna igualmente —entregando la dirección de la master a un usuario— la suite del
    // módulo pasa ENTERA. El fallo sería catastrófico y silencioso: ese usuario «tendría» el fondo
    // de gas, y el siguiente también.
    //
    // Lo que este caso impide no es un bug de hoy, es que alguien «arregle» esta ruta añadiendo un
    // `catch` defensivo — que es la única forma en que este fallo entraría de verdad.
    it('debería dejar salir WalletAddressIsMasterError cuando la pasarela devuelve la master', async () => {
      // Arrange: la pasarela devuelve la MASTER como si fuera la derivada, que es exactamente el
      // fallo del adaptador contra el que existe la comprobación de la entidad.
      const { useCase, repository } = buildUseCase({
        knownOwners: [OWNER_ID],
        derivedAddress: MASTER,
      });

      // Act + Assert
      await expect(useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' })).rejects.toThrow(
        WalletAddressIsMasterError,
      );
      // Y no se guarda nada: una fila con la master dentro es peor que no tener fila.
      expect(repository.saveCalls).toEqual([]);
    });

    it('debería reservar un índice y derivar exactamente una vez por alta nueva (propiedad)', async () => {
      await fc.assert(
        fc.asyncProperty(addressIndexArb, ethereumAddressArb, async (index, derived) => {
          // Arrange
          const { useCase, repository, allocator, gateway } = buildUseCase({
            knownOwners: [OWNER_ID],
            firstIndex: index,
            derivedAddress: derived,
          });

          // Act
          const wallet = await useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' });

          // Assert
          expect(allocator.allocated).toEqual([index]);
          expect(gateway.deriveCalls).toHaveLength(1);
          expect(gateway.deriveCalls[0]?.value).toBe(index);
          expect(wallet.addressIndex.value).toBe(index);
          // La master sale de la pasarela, no del caso de uso: `deriveAddress` ya no la recibe.
          expect(wallet.ownerAddress.value).toBe(MASTER);
          expect(repository.saveCalls).toEqual([wallet.toSnapshot()]);
        }),
      );
    });
  });
});

// Helpers

/**
 * Dobles que REGISTRAN el orden de llamada en un diario compartido y delegan en el fake con
 * `super`. Escritos a mano y no con `jest.spyOn`, que es lo que hace el precedente de `orders`:
 * `mockImplementation` SUSTITUYE el cuerpo del fake, así que el caso del orden dejaría de escribir
 * `saveCalls`, `allocated` y el almacén. Se ve en
 * `orders/__tests__/application/use-cases/place-order.use-case.spec.ts`: de sus cinco casos, el del
 * orden es el único cuyo `save` queda sustituido, y por eso es también el único que no afirma nada
 * sobre `repository.saveCalls` — asomarse a esa lista ahí diría `[]` aunque el caso de uso haya
 * guardado. Delegando, un solo `buildUseCase` sirve para los diez casos y el diario sale gratis en
 * los otros nueve.
 *
 * `masterAddress()` NO se registra a propósito: es síncrono y lee configuración ya resuelta —lo
 * dice el JSDoc del puerto—, así que no es un paso del orden que la tabla fija, que enumera solo
 * las cinco llamadas que salen del proceso.
 */
class RecordingOwnerDirectory extends FakeOwnerDirectory {
  constructor(
    private readonly journal: string[],
    knownIds: readonly string[],
  ) {
    super(knownIds);
  }

  override exists(ownerId: string): Promise<boolean> {
    this.journal.push('exists');
    return super.exists(ownerId);
  }
}

class RecordingWalletRepository extends InMemoryWalletRepository {
  constructor(
    private readonly journal: string[],
    seed: readonly Wallet[],
  ) {
    super(seed);
  }

  override findByOwnerId(ownerId: string): Promise<Wallet | null> {
    this.journal.push('findByOwnerId');
    return super.findByOwnerId(ownerId);
  }

  override save(wallet: Wallet): Promise<WalletSaveOutcome> {
    this.journal.push('save');
    return super.save(wallet);
  }
}

class RecordingAddressIndexAllocator extends FakeAddressIndexAllocator {
  constructor(
    private readonly journal: string[],
    start: number,
  ) {
    super(start);
  }

  override next(): Promise<AddressIndex> {
    this.journal.push('next');
    return super.next();
  }
}

class RecordingCustodialAddressGateway extends FakeCustodialAddressGateway {
  constructor(
    private readonly journal: string[],
    master: EthereumAddress,
  ) {
    super(master);
  }

  override deriveAddress(index: AddressIndex): Promise<EthereumAddress> {
    this.journal.push('deriveAddress');
    return super.deriveAddress(index);
  }
}

type BuildOptions = {
  knownOwners?: readonly string[];
  existing?: readonly Wallet[];
  firstIndex?: number;
  derivedAddress?: string;
};

const buildUseCase = (options: BuildOptions = {}) => {
  const journal: string[] = [];
  const directory = new RecordingOwnerDirectory(journal, options.knownOwners ?? []);
  const repository = new RecordingWalletRepository(journal, options.existing ?? []);
  const allocator = new RecordingAddressIndexAllocator(journal, options.firstIndex ?? FIRST_INDEX);
  const gateway = new RecordingCustodialAddressGateway(journal, EthereumAddress.from(MASTER));
  gateway.programDeriveAddress(EthereumAddress.from(options.derivedAddress ?? DERIVED));

  return {
    useCase: new AssignWalletUseCase(directory, repository, allocator, gateway),
    directory,
    repository,
    allocator,
    gateway,
    journal,
  };
};
