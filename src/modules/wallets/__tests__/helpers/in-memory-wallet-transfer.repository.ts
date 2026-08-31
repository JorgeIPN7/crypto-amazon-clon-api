import type {
  WalletTransfer,
  WalletTransferSnapshot,
} from '../../domain/entities/wallet-transfer.entity';
import type {
  FindTransfersCriteria,
  TransferPage,
  WalletTransferRepository,
} from '../../domain/ports/wallet-transfer.repository';

/**
 * Fake escrito a mano del libro de transferencias, hermano de `in-memory-wallet.repository.ts`.
 *
 * ⚠️ **`saveCalls` guarda el SNAPSHOT del instante del guardado, no la referencia.** La entidad es
 * mutable y el caso de uso la muta después de escribirla, así que una lista de referencias diría
 * que la primera escritura ya iba en `submitted` — y con eso la escritura POR DELANTE, que es la
 * razón de existir del libro, quedaría sin probar: los dos elementos de la lista se leerían
 * idénticos. `toSnapshot()` es el mismo método que usará el mapper, así que el fake no inventa
 * ninguna forma nueva.
 *
 * ⚠️ **`programSaveFailures()` acepta la cola COMPLETA (`null` = éxito) y no un fallo suelto**,
 * porque el caso que importa necesita que falle el SEGUNDO guardado y no el primero: la escritura
 * por delante tiene que haber ocurrido para que el reintento único de la liquidación (spec §3.2)
 * signifique algo. Con un fallo suelto solo se podría tumbar el primero, que es el caso que NO
 * interesa.
 *
 * Un guardado que falla queda en `saveCalls` pero **no** en el almacén, igual que un `INSERT` que
 * revienta: es lo que separa «se intentó escribir» de «quedó escrito».
 *
 * **La paginación se calcula aquí igual que en el adaptador real.** El criterio viaja en `page` y
 * `limit` —el vocabulario del cliente— y quien traduce a desplazamiento es quien consulta; el
 * JSDoc del propio puerto ya escribe que ese coste se paga aquí, y que es deliberado.
 *
 * ⚠️ **El orden es `createdAt` DESCENDENTE, y es una SUPOSICIÓN sobre un adaptador que todavía no
 * existe** —medido: `find src/modules/wallets/infrastructure` responde `No such file or
 * directory`—. Se elige así, y no «orden de inserción», por dos indicios y ninguna medida: el único
 * precedente del repo ordena así (`order: { createdAt: 'DESC' }` en el `findAndCount` de
 * `users/infrastructure/persistence/user.typeorm.repository.ts`) y el índice que el contrato §8
 * fija para esta tabla es `idx_wallet_transfers_owner_id_created_at`. Si el adaptador acaba
 * ordenando de otra forma, **el equivocado es este fake** y hay que cambiarlo aquí: un fake que
 * ordena distinto de la base deja verde un listado que en producción sale al revés.
 *
 * El empate de `createdAt` cae en orden de inserción porque `Array.prototype.sort` es estable desde
 * ES2019; PostgreSQL no promete nada en ese caso, así que ninguna aserción debe apoyarse en él.
 */
export class InMemoryWalletTransferRepository implements WalletTransferRepository {
  readonly saveCalls: WalletTransferSnapshot[] = [];
  readonly findByOwnerCalls: FindTransfersCriteria[] = [];

  private readonly store = new Map<string, WalletTransfer>();
  private readonly failures: (Error | null)[] = [];

  constructor(seed: readonly WalletTransfer[] = []) {
    seed.forEach((transfer) => this.store.set(transfer.id.value, transfer));
  }

  programSaveFailures(...failures: readonly (Error | null)[]): void {
    this.failures.push(...failures);
  }

  save(transfer: WalletTransfer): Promise<void> {
    this.saveCalls.push(transfer.toSnapshot());

    const failure = this.failures.shift();
    if (failure) {
      return Promise.reject(failure);
    }

    this.store.set(transfer.id.value, transfer);
    return Promise.resolve();
  }

  findByOwner(criteria: FindTransfersCriteria): Promise<TransferPage> {
    // Copia y no la referencia: el criterio lo construye el caso de uso y una lista de referencias
    // no distinguiría «pidió la página 2» de «pidió un objeto que luego alguien cambió a 2».
    this.findByOwnerCalls.push({ ...criteria });

    const owned = [...this.store.values()]
      .filter((transfer) => transfer.ownerId === criteria.ownerId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    const skip = (criteria.page - 1) * criteria.limit;

    return Promise.resolve({
      items: owned.slice(skip, skip + criteria.limit),
      total: owned.length,
    });
  }

  /** Solo para aserciones del test: filas que de verdad quedaron escritas, dueños incluidos. */
  size(): number {
    return this.store.size;
  }
}
