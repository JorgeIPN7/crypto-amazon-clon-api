import type { Wallet, WalletSnapshot } from '../../domain/entities/wallet.entity';
import type { WalletRepository, WalletSaveOutcome } from '../../domain/ports/wallet.repository';

/**
 * Lo que el próximo `save` hará en vez de guardar. Cola, y no un campo suelto, porque el desenlace
 * y su ganador viajan JUNTOS: con un campo compartido, dos conflictos programados en el mismo test
 * se pisarían el ganador y el segundo releería la fila del primero.
 */
type ProgrammedSave =
  { kind: 'owner-conflict'; winner: Wallet | null } | { kind: 'failure'; error: Error };

/**
 * Fake escrito a mano del puerto, no un mock generado. Se comporta como un repositorio real
 * —guarda, sobrescribe por dueño, relee— para que el test valide el caso de uso y no la
 * configuración de un doble. Mismo criterio que `users/__tests__/helpers/in-memory-user.repository.ts`.
 *
 * **El almacén se indexa por `ownerId` y no por id de wallet, y eso ES el índice único.**
 * `idx_wallets_user_id` es UNIQUE (contrato §8), así que un `Map` con esa clave no puede llegar a
 * un estado que PostgreSQL rechazaría: dos wallets del mismo dueño. Un `Map` por id de wallet sí
 * podría, y entonces el fake mentiría distinto de la base.
 *
 * ⚠️ **`programOwnerConflict()` reproduce la ÚNICA carrera que el alta puede perder**: otro proceso
 * insertó la wallet de este dueño entre nuestra lectura de idempotencia y nuestro INSERT, el
 * `23505` de `user_id` salta y el adaptador lo traduce al desenlace `'owner-conflict'` —no lanza—.
 * Se modela con el ganador apareciendo DESPUÉS del conflicto y no antes: si estuviera antes, el
 * caso de uso habría salido por la idempotencia y este camino no se probaría. Sin este método el
 * fake solo sabría decir `'saved'` y el único consumidor posible del desenlace quedaría sin cubrir.
 *
 * Pasar `null` como ganador es el otro extremo real: el ganador hizo `ROLLBACK` entre el conflicto y
 * la relectura, que es el único productor de `WalletAssignmentLostError`.
 *
 * ⚠️ **`programSaveFailure()` existe porque el puerto NO convierte todo el `23505` en desenlace.**
 * Los otros dos índices únicos (`address_index`, `address`) y el `CHECK` sí lanzan
 * —`AddressIndexAlreadyUsedError`, `WalletAddressAlreadyUsedError`, `WalletAddressIsMasterError`—,
 * y un fake que solo supiera devolver desenlaces dejaría esa mitad del contrato sin doble. El fake
 * **no inventa** esas comprobaciones: las decide el test, porque quien las decide en producción es
 * el motor y no el repositorio.
 *
 * ⚠️ **Donde este fake SÍ diverge de PostgreSQL es en el DESENLACE, no en el estado.** Medido con
 * una sonda: guardar una wallet y después OTRA distinta del MISMO dueño devuelve `'saved'` y
 * sobrescribe en silencio, mientras el índice único `idx_wallets_user_id` daría `23505` y el
 * adaptador lo traduciría a `'owner-conflict'`. Hoy es inalcanzable desde los casos de uso —el
 * alta relee por idempotencia antes de guardar—, pero quien escriba un caso de carrera tiene que
 * **PROGRAMARLA** con `programOwnerConflict`, no provocarla guardando dos veces: eso último pasa
 * en verde y no prueba nada.
 *
 * ⚠️ **`saveCalls` guarda el SNAPSHOT del instante del guardado, no la referencia.** `Wallet` es
 * mutable, y los casos de uso que la mutarán después de escribirla —`activate-wallet.use-case.ts`
 * y `transfer-asset.use-case.ts`, que hoy no están en el árbol— harían que una lista de
 * referencias dijera que la primera escritura ya iba con el estado final. Medido: ninguno de los
 * dos casos de uso escritos muta el agregado tras `save()`. Es el mismo criterio, y por el mismo motivo,
 * que `in-memory-wallet-transfer.repository.ts`. `toSnapshot()` es el método que usará el mapper,
 * así que el fake no inventa ninguna forma nueva.
 *
 * ⚠️ **Lo que este fake NO caza, dicho en vez de darse por supuesto**: `findByOwnerId` devuelve la
 * MISMA instancia que se guardó, mientras el adaptador real devolvería una entidad rehidratada de
 * la fila. Consecuencia medible: un caso de uso que mute el agregado y se olvide de `save()` deja
 * la mutación visible en una relectura de este fake, y no lo estaría en PostgreSQL. Es la misma
 * simplificación que tiene `InMemoryUserRepository`, y quien cierra ese hueco es el E2E contra la
 * base real. Las aserciones sobre lo que de verdad se escribió van contra `saveCalls`, que sí es
 * inmune porque fotografía.
 */
export class InMemoryWalletRepository implements WalletRepository {
  readonly findByOwnerIdCalls: string[] = [];
  readonly saveCalls: WalletSnapshot[] = [];

  private readonly byOwner = new Map<string, Wallet>();
  private readonly programmedSaves: ProgrammedSave[] = [];

  constructor(seed: readonly Wallet[] = []) {
    seed.forEach((wallet) => this.byOwner.set(wallet.ownerId, wallet));
  }

  /** El próximo `save` choca; `winner` es lo que la relectura encontrará (o no, con `null`). */
  programOwnerConflict(winner: Wallet | null): void {
    this.programmedSaves.push({ kind: 'owner-conflict', winner });
  }

  /** El próximo `save` lanza. Para los dos `23505` y el `CHECK` que SÍ son invariantes rotas. */
  programSaveFailure(error: Error): void {
    this.programmedSaves.push({ kind: 'failure', error });
  }

  findByOwnerId(ownerId: string): Promise<Wallet | null> {
    this.findByOwnerIdCalls.push(ownerId);
    return Promise.resolve(this.byOwner.get(ownerId) ?? null);
  }

  save(wallet: Wallet): Promise<WalletSaveOutcome> {
    this.saveCalls.push(wallet.toSnapshot());
    const programmed = this.programmedSaves.shift();

    if (programmed === undefined) {
      this.byOwner.set(wallet.ownerId, wallet);
      return Promise.resolve('saved');
    }

    if (programmed.kind === 'failure') {
      return Promise.reject(programmed.error);
    }

    // La fila que pierde la carrera NO queda escrita, y la del ganador ya es visible para la
    // relectura. Con `null` el ganador hizo `ROLLBACK`: no hay ninguna fila que releer.
    if (programmed.winner === null) {
      this.byOwner.delete(wallet.ownerId);
    } else {
      this.byOwner.set(programmed.winner.ownerId, programmed.winner);
    }
    return Promise.resolve('owner-conflict');
  }

  /**
   * Solo para aserciones del test, no forma parte del puerto. Cuenta filas, que con la clave por
   * dueño es lo mismo que contar dueños con wallet: distingue «se guardó» de «se intentó guardar»,
   * que `saveCalls` por sí solo no separa porque registra también los intentos fallidos.
   */
  size(): number {
    return this.byOwner.size;
  }
}
