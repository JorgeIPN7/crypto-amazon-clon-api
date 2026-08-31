import fc from 'fast-check';

import { InMemoryWalletTransferRepository } from '../../helpers/in-memory-wallet-transfer.repository';
import { ListWalletTransfersUseCase } from '../../../application/use-cases/list-wallet-transfers.use-case';
import { TRANSFER_OWNER_ID, buildTransfer } from '../../helpers/wallet-transfer.factory';
import { limitArb, pageArb } from '../../helpers/arbitraries';

const OWNER_ID = TRANSFER_OWNER_ID;
const OTHER_OWNER_ID = '4b8e2f1a-5c3d-4e7f-8a9b-0c1d2e3f4a5b';

describe('ListWalletTransfersUseCase', () => {
  describe('execute()', () => {
    it('debería devolver la página del dueño con su total', async () => {
      // Arrange
      const ledger = new InMemoryWalletTransferRepository([
        buildTransfer({ ownerId: OWNER_ID }),
        buildTransfer({ ownerId: OWNER_ID }),
        buildTransfer({ ownerId: OWNER_ID }),
      ]);
      const useCase = new ListWalletTransfersUseCase(ledger);

      // Act
      const page = await useCase.execute({ ownerId: OWNER_ID, page: 1, limit: 2 });

      // Assert: `total` cuenta el libro entero del dueño y no la rebanada — con `items.length` el
      // cliente no sabría que hay una segunda página.
      expect(page.items).toHaveLength(2);
      expect(page.total).toBe(3);
    });

    it('debería pasar al repositorio un solo criterio con ownerId, page y limit', async () => {
      // Arrange
      const ledger = new InMemoryWalletTransferRepository();
      const useCase = new ListWalletTransfersUseCase(ledger);

      // Act
      await useCase.execute({ ownerId: OWNER_ID, page: 3, limit: 20 });

      // Assert: el desplazamiento lo calcula el adaptador, que es quien sabe cómo pagina su
      // motor; el puerto habla el vocabulario del cliente. La lista ENTERA y no su primer
      // elemento: así el caso también fija que hay una sola consulta por listado.
      expect(ledger.findByOwnerCalls).toEqual([{ ownerId: OWNER_ID, page: 3, limit: 20 }]);
    });

    it('debería devolver una página vacía cuando el dueño no tiene transferencias', async () => {
      // Arrange
      const useCase = new ListWalletTransfersUseCase(new InMemoryWalletTransferRepository());

      // Act
      const page = await useCase.execute({ ownerId: OWNER_ID, page: 1, limit: 20 });

      // Assert: página vacía y no error. Es también la respuesta que le toca al rol `admin`, que
      // no puede transferir —`transfer-asset.use-case.ts` le lanza `AdminUsesMasterAddressError`
      // antes de tocar nada— y por tanto nunca tiene filas en el libro (spec §6.1).
      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
    });

    it('debería pedir solo las transferencias del dueño del token', async () => {
      // Arrange
      const own = buildTransfer({ ownerId: OWNER_ID });
      const ledger = new InMemoryWalletTransferRepository([
        own,
        buildTransfer({ ownerId: OTHER_OWNER_ID }),
      ]);
      const useCase = new ListWalletTransfersUseCase(ledger);

      // Act
      const page = await useCase.execute({ ownerId: OWNER_ID, page: 1, limit: 20 });

      // Assert: el dueño sale del `sub` del token y llega hasta el criterio sin pasar por el
      // cuerpo ni por la ruta. Medido sustituyendo `input.ownerId` por el literal de
      // `OTHER_OWNER_ID` en el criterio del caso de uso: `4 failed, 2 passed` — este caso, los dos
      // primeros y la propiedad. Los que aguantan son la página vacía, que sale vacía con
      // cualquier dueño, y el de la aridad, que no llama a `execute()`.
      expect(ledger.findByOwnerCalls[0]?.ownerId).toBe(OWNER_ID);
      expect(page.items).toEqual([own]);
      expect(page.total).toBe(1);
    });

    it('debería depender solo del repositorio, sin directorio de dueños', () => {
      // Arrange & Act
      const dependencies = ListWalletTransfersUseCase.length;

      // Assert
      // Gemelo del caso homónimo de `find-wallet-by-owner.use-case.spec.ts`, y por el mismo
      // motivo: el spec §5 declara que las DOS lecturas se saltan el directorio, así que sin un
      // caso que lo fije alguien lo «arregla» por simetría con los tres que sí lo consultan. La
      // aridad del constructor ES la lista de puertos inyectados. Medido añadiendo `OwnerDirectory`
      // como segundo puerto: `Expected: 1 / Received: 2`, y ningún otro caso de la suite se inmuta.
      expect(dependencies).toBe(1);
    });

    // ⚠️ Propiedad escrita con `fc.assert` dentro de un `it` normal, NO con `fcTest.prop`, por lo
    // mismo que las de los otros cuatro casos de uso del módulo: `@fast-check/jest` mete la semilla
    // DENTRO del nombre del test y `stryker.config.mjs` usa `coverageAnalysis: perTest`, que
    // empareja por nombre (backlog #18).
    //
    // ⚠️ **Y escrita así el poder de muerte NO se pierde**, que es un matiz que este archivo puede
    // medir porque solo tiene dos mutantes. Con
    // `pnpm test:mutation --mutate "src/modules/wallets/application/use-cases/list-wallet-transfers.use-case.ts"`:
    //
    //   · Suite entera → `✓ … con su total (killed 2)` y `~ … (propiedad) (covered 2)`.
    //   · Con el primer caso en `it.skip` → el segundo pasa a `(killed 2)`.
    //   · Con los cuatro casos que llaman a `execute()` en `it.skip` → **`✓ … (propiedad)
    //     (killed 2)`**.
    //
    // O sea que el `killed 0` de la primera línea es ORDEN DE ATRIBUCIÓN —Stryker para en el primer
    // test que mata— y no impotencia: el nombre de este `it` es estable, así que Stryker sí lo
    // encuentra y sí lo ejecuta, que es exactamente lo que `fcTest.prop` impide. La regla de
    // backlog #18 —«hace falta un caso puntual que ancle»— sigue valiendo para `fcTest.prop`; para
    // esta forma, lo medido aquí dice que el idioma la devuelve al juego. Aun así los cuatro casos
    // puntuales se quedan: son ellos los que nombran cada rama.
    it('debería trasladar page y limit al criterio sin transformarlos (propiedad)', async () => {
      await fc.assert(
        fc.asyncProperty(pageArb, limitArb, async (page, limit) => {
          // Arrange
          const ledger = new InMemoryWalletTransferRepository();
          const useCase = new ListWalletTransfersUseCase(ledger);

          // Act
          await useCase.execute({ ownerId: OWNER_ID, page, limit });

          // Assert: exactamente lo que entró. Un caso de uso que restara uno a la página o
          // multiplicara por el tamaño estaría haciendo el trabajo del adaptador dos veces.
          expect(ledger.findByOwnerCalls).toEqual([{ ownerId: OWNER_ID, page, limit }]);
        }),
      );
    });
  });
});
