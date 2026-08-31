import type { Wallet } from '../entities/wallet.entity';

/**
 * El desenlace de guardar una wallet. `type` y no clase: es un DATO que acompaña al puerto, no algo
 * inyectable — mismo criterio que `UserPage` y `FindUsersCriteria` en
 * `users/domain/ports/user.repository.ts`.
 *
 * ⚠️ Por ser un dato y no un puerto, su nombre tiene que figurar en la **lista cerrada** del
 * selector de `type` inline de `eslint.config.mjs`. Mientras no figure, un
 * `import { WalletRepository, type WalletSaveOutcome }` sale **rojo** en `lint:check` —medido
 * con un archivo sonda en `application/`: `error no-restricted-syntax`— y la salida es escribir
 * ese import como VALOR. La lista falla en cerrado a propósito: un dato nuevo cuesta una línea
 * revisada, y un puerto marcado `type` por descuido se pone rojo solo.
 */
export type WalletSaveOutcome = 'saved' | 'owner-conflict';

/**
 * Puerto de salida (driven). Vive en el dominio porque es el dominio quien decide qué necesita de
 * la persistencia; `infrastructure/persistence/` provee la implementación.
 *
 * `abstract class` y no `type` + `Symbol`: la clase SOBREVIVE a la compilación, así que la misma
 * referencia es el tipo del contrato y el token de inyección, y ningún consumidor necesita
 * `@Inject`. El razonamiento completo, con las dos prohibiciones medidas con `tsc --noEmit
 * --strict`, vive en `users/domain/ports/user.repository.ts` y no se copia aquí.
 *
 * **Dos métodos y no tres: no hay `findById`.** Los cinco endpoints del contexto son «lo mío» y el
 * dueño sale siempre del `sub` del token, jamás del cuerpo ni de la ruta. Los cinco endpoints de
 * §6.1 viven en **cuatro** rutas —`/wallets`, `/wallets/me`, `/wallets/me/activation` y
 * `/wallets/me/transfers`, esta última con POST y GET— y **ninguna lleva parámetro**, así que
 * nadie busca por id de wallet. Mismo criterio con el que
 * `delete()` salió de `UserRepository`: un método público invita a llamarlo, y aquí el que sobra
 * abriría una lectura por id que ningún guard protege.
 *
 * ⚠️ **`save` devuelve un DESENLACE y no lanza cuando el dueño ya tiene wallet.** El `23505` del
 * índice único de `user_id` es una carrera normal entre dos altas simultáneas del mismo dueño —dos
 * pestañas, un reintento del cliente—, no una invariante rota: el adaptador lo traduce a
 * `'owner-conflict'` y el caso de uso relee **una vez** la fila que ganó (§5). Por eso
 * `WalletAlreadyAssignedError` **no existe** en `../errors/wallet.errors.ts`: no hay ningún camino
 * por el que llegue a HTTP, porque no hay error. Los otros dos `23505` —el índice de
 * `address_index` y el de `address`— y la violación del `CHECK` de §6.3 **sí lanzan**
 * (`AddressIndexAlreadyUsedError`, `WalletAddressAlreadyUsedError`, `WalletAddressIsMasterError`),
 * porque ahí sí hay una invariante rota y tiene que ser un 500 ruidoso que el `ErrorReporter` vea.
 * Los nombres de las tres restricciones los fija §8 del contrato; la migración que las crea es de
 * otra tarea, así que aquí son una referencia de diseño, no algo medido contra la base.
 *
 * `save` cubre el alta y la actualización de estado, y **no lleva eventos** en la firma a
 * diferencia de `OrderRepository`, cuyo `save(order, events: readonly OrderPlaced[])` sí los
 * transporta: en este ciclo no hay eventos de dominio ni outbox porque nadie reacciona (§3.1, y
 * las filas «Eventos de dominio + `AggregateRoot`» y «Outbox transaccional» de
 * `docs/module-blueprint.md`, ambas marcadas **No** en su columna de obligatoriedad).
 */
export abstract class WalletRepository {
  abstract findByOwnerId(ownerId: string): Promise<Wallet | null>;
  abstract save(wallet: Wallet): Promise<WalletSaveOutcome>;
}
