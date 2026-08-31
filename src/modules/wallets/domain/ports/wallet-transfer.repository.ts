import type { WalletTransfer } from '../entities/wallet-transfer.entity';

/**
 * El criterio del listado. Lleva el `ownerId` DENTRO y no como parámetro aparte: el listado siempre
 * es de un dueño, y separarlo dejaría escribir una consulta paginada sin filtro por dueño que
 * compilaría perfectamente.
 *
 * ⚠️ Lleva `page`/`limit` —lo que el cliente manda— y **no `skip`/`take`**, al revés que
 * `FindUsersCriteria`. El motivo es que el puerto hable el vocabulario del CLIENTE y que la
 * traducción a TypeORM sea del adaptador, que es quien conoce ese ORM.
 *
 * ⚠️ **Y tiene un coste, que se dice en vez de negarse.** Una versión anterior de este comentario
 * afirmaba que `skip` obligaría a los fakes a repetir la multiplicación: es exactamente al revés,
 * medido en el repo. Con `skip`/`take` el fake solo rebana —`in-memory-user.repository.ts` hace
 * `all.slice(criteria.skip, criteria.skip + criteria.take)`, cero aritmética— porque quien
 * multiplica es el DTO de transporte: `common/dto/pagination.dto.ts` tiene
 * `get skip() { return ((this.page ?? 1) - 1) * (this.limit ?? 20); }`. Aquí, al no viajar el
 * offset, esa multiplicación la hará el adaptador **y la repetirá el fake de** `application/`
 * para mentir igual que la base. Es el precio asumido de que el puerto no hable de offsets.
 *
 * `type` y no clase: es un dato que acompaña al puerto, así que su nombre entra en la lista cerrada
 * del selector de `eslint.config.mjs`. Mientras no figure ahí, importarlo con `type` inline
 * sale rojo en `lint:check` y la salida es importarlo como valor — ver `wallet.repository.ts`.
 */
export type FindTransfersCriteria = {
  ownerId: string;
  page: number;
  limit: number;
};

/**
 * Página del libro. `UserPage` es el precedente en estructura —`items` + `total`— pero **no** en la
 * mutabilidad: el suyo declara `items: User[]`, medido en `users/domain/ports/user.repository.ts`.
 * Aquí `items` es `readonly` porque el caso de uso solo la lee y el DTO la mapea; publicar un array
 * mutable invitaría a ordenarlo en sitio sobre lo que devolvió el adaptador.
 *
 * `type` y no clase, por lo mismo que `FindTransfersCriteria`.
 */
export type TransferPage = {
  items: readonly WalletTransfer[];
  total: number;
};

/**
 * Puerto de salida (driven) del segundo agregado. `abstract class` —tipo y token en la misma
 * referencia— por el mismo motivo que `wallet.repository.ts`, donde está la referencia al
 * razonamiento completo.
 *
 * `save` sirve para las dos escrituras del libro: la de por delante (`submitting`, antes de llamar
 * al proveedor) y la liquidación posterior. Esa segunda **no toca la cadena y es idempotente**, que
 * es lo que permite el único reintento que §3.2 autoriza; si aun así falla, la regla escrita allí
 * es que una fila que sobrevive en `submitting` a su petición se lee como `unknown`.
 *
 * Devuelve `void` y no un desenlace, a diferencia de `WalletRepository.save`: sobre
 * `wallet_transfers` no hay más índice único que la clave primaria (§8) y el id lo pone el caso de
 * uso, así que no hay ninguna carrera que dos peticiones puedan disputarse.
 */
export abstract class WalletTransferRepository {
  abstract save(transfer: WalletTransfer): Promise<void>;
  abstract findByOwner(criteria: FindTransfersCriteria): Promise<TransferPage>;
}
