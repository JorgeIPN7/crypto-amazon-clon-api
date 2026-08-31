import fc from 'fast-check';

import { FindWalletByOwnerUseCase } from '../../../application/use-cases/find-wallet-by-owner.use-case';
import { InMemoryWalletRepository } from '../../helpers/in-memory-wallet.repository';
import { WalletNotFoundError } from '../../../domain/errors/wallet.errors';
import {
  WALLET_ADDRESS,
  WALLET_OTHER_MASTER_ADDRESS,
  WALLET_OWNER_ID,
  buildWallet,
} from '../../helpers/wallet.factory';
import { addressIndexArb, ethereumAddressArb } from '../../helpers/arbitraries';

const OWNER_ID = WALLET_OWNER_ID;

describe('FindWalletByOwnerUseCase', () => {
  describe('execute()', () => {
    it('debería devolver la wallet del dueño', async () => {
      // Arrange
      const existing = buildWallet({ ownerId: OWNER_ID, address: WALLET_ADDRESS });
      const repository = new InMemoryWalletRepository([existing]);
      const useCase = new FindWalletByOwnerUseCase(repository);

      // Act
      const wallet = await useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' });

      // Assert: la MISMA instancia, y una sola consulta — el endpoint más llamado del módulo no
      // puede permitirse dos viajes a la base por lectura.
      expect(wallet).toBe(existing);
      expect(repository.findByOwnerIdCalls).toEqual([OWNER_ID]);
    });

    it('debería lanzar WalletNotFoundError cuando el dueño no tiene wallet', async () => {
      // Arrange
      const useCase = new FindWalletByOwnerUseCase(new InMemoryWalletRepository());

      // Act + Assert: `null` del repositorio es «no hay fila», no «no hay wallet que publicar» —
      // ese `null` es el del admin y sale por otro camino.
      await expect(useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' })).rejects.toThrow(
        WalletNotFoundError,
      );
    });

    it('debería depender solo del repositorio, sin directorio de dueños ni pasarela', () => {
      // Arrange & Act
      const dependencies = FindWalletByOwnerUseCase.length;

      // Assert
      // La aridad del constructor ES la lista de puertos inyectados. Inyectar el directorio «por
      // simetría» con los otros tres casos de uso añadiría una consulta al endpoint más llamado
      // del módulo —la gente consulta repetidamente esperando la activación—, y este caso se pone
      // rojo al hacerlo: medido añadiendo `OwnerDirectory` como segundo puerto del constructor,
      // `Expected: 1 / Received: 2`, y ningún otro caso de la suite se inmuta.
      expect(dependencies).toBe(1);
    });

    it('debería no ejecutar assertOwnedBy sobre la wallet devuelta', async () => {
      // Arrange: wallet derivada bajo OTRA master, la que quedaría tras una rotación.
      const existing = buildWallet({
        ownerId: OWNER_ID,
        ownerAddress: WALLET_OTHER_MASTER_ADDRESS,
      });
      // Espía SIN `mockImplementation`: el método original sigue en pie, así que este caso observa
      // la llamada en vez de sustituirla — la razón por la que `assign-wallet.use-case.spec.ts`
      // evita `jest.spyOn` (sustituir el cuerpo del fake) no aplica aquí. `restoreMocks: true` en
      // `jest.config.mjs` lo deshace al terminar.
      const guard = jest.spyOn(existing, 'assertOwnedBy');
      const useCase = new FindWalletByOwnerUseCase(new InMemoryWalletRepository([existing]));

      // Act
      const wallet = await useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' });

      // Assert: la lectura sigue respondiendo la dirección vieja; lo que debe fallar es cualquier
      // intento de OPERAR con ella, no la consulta (spec §5). Medido añadiendo al caso de uso un
      // `wallet.assertOwnedBy(wallet.ownerAddress)` —tautológico, ni siquiera lanza—: cae solo
      // este caso, `Expected number of calls: 0 / Received number of calls: 1`.
      expect(wallet).toBe(existing);
      expect(guard).not.toHaveBeenCalled();
    });

    it('debería devolver null al rol admin sin consultar el repositorio', async () => {
      // Arrange: aunque hubiera una fila con ese id, la del admin es la master y no está en la
      // tabla — la respuesta la compone el controlador con `kind: 'master'`.
      const repository = new InMemoryWalletRepository([buildWallet({ ownerId: OWNER_ID })]);
      const useCase = new FindWalletByOwnerUseCase(repository);

      // Act
      const wallet = await useCase.execute({ ownerId: OWNER_ID, ownerRole: 'admin' });

      // Assert
      expect(wallet).toBeNull();
      expect(repository.findByOwnerIdCalls).toEqual([]);
    });

    // ⚠️ Propiedad escrita con `fc.assert` dentro de un `it` normal, NO con `fcTest.prop`, por lo
    // mismo que la de `assign-wallet.use-case.spec.ts`: `@fast-check/jest` mete la semilla DENTRO
    // del nombre del test y `stryker.config.mjs` usa `coverageAnalysis: perTest`, que empareja los
    // tests por nombre. La medición que lo demuestra —con la línea del auditor— vive en
    // `__tests__/domain/entities/wallet-transfer.entity.spec.ts`; no es mía y no la repito aquí.
    //
    // Quien ancla las dos ramas del caso de uso son F1, F2 y F5 —los tres que MATAN—: se reparten
    // los **11** mutantes del archivo, y esta propiedad **cero**. El adjetivo que los separa de F4
    // no es «deterministas que ejecutan `execute()`»: F4 también lo ejecuta y también cubre siete
    // mutantes, pero no mata ninguno.
    // Medido con `pnpm test:mutation --mutate "src/modules/wallets/application/use-cases/find-wallet-by-owner.use-case.ts"`,
    // que imprime `(killed 5)`, `(killed 3)` y `(killed 3)` en esos tres y `~ … (covered 7)` aquí.
    // La propiedad se queda porque explora índices y direcciones que ellos no; no porque sostenga
    // el gate.
    it('debería devolver siempre la wallet del dueño consultado (propiedad)', async () => {
      await fc.assert(
        fc.asyncProperty(addressIndexArb, ethereumAddressArb, async (index, address) => {
          // Arrange
          const existing = buildWallet({ ownerId: OWNER_ID, address, addressIndex: index });
          const useCase = new FindWalletByOwnerUseCase(new InMemoryWalletRepository([existing]));

          // Act
          const wallet = await useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' });

          // Assert: `EthereumAddress` normaliza a minúsculas y `ethereumAddressArb` mezcla las dos
          // cajas, así que la comparación va contra el valor normalizado y no contra la cadena
          // generada — si no, la propiedad culparía al caso de uso de una normalización del dominio.
          expect(wallet?.ownerId).toBe(OWNER_ID);
          expect(wallet?.addressIndex.value).toBe(index);
          expect(wallet?.address.value).toBe(address.toLowerCase());
        }),
      );
    });
  });
});
