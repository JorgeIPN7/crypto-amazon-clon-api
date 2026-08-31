import { Entity, type AuditTrail } from '@shared/domain/entity.base';

import type { EthereumAddress } from '../value-objects/ethereum-address.vo';
import type { ProviderFailureReason } from '../errors/wallet.errors';
import type { TransactionHash } from '../value-objects/transaction-hash.vo';
import type { TransferAsset, TransferAssetKind } from '../transfer-asset';
import type { TransferId } from '../value-objects/transfer-id.vo';
import type { TransferStatus } from '../transfer-status';

export type WalletTransferSnapshot = {
  id: string;
  ownerId: string;
  from: string;
  recipient: string;
  assetKind: TransferAssetKind;
  tokenAddress: string | null;
  amount: string | null;
  tokenId: string | null;
  status: TransferStatus;
  txId: string | null;
  reasonCode: ProviderFailureReason | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
};

/**
 * Las tres columnas que dependen de la clase del activo. No se exporta: es la forma intermedia del
 * aplanado de `toSnapshot()`, y quien la consume —el mapper, el DTO— recibe el snapshot entero.
 */
type AssetColumns = {
  tokenAddress: string | null;
  amount: string | null;
  tokenId: string | null;
};

/**
 * El libro de transferencias, con **escritura por delante**: la fila se escribe ANTES de llamar al
 * proveedor (§3.2). Eso es lo que convierte al libro en algo útil — con la escritura posterior, un
 * timeout no dejaría rastro, que es justo el caso para el que existe.
 *
 * `Entity` y no `AggregateRoot`, igual que `Wallet` y por el mismo motivo: en este ciclo nadie
 * reacciona a nada de `wallets` (§3.1), así que no hay eventos de dominio que recolectar.
 *
 * `from` es la dirección de la wallet y NO la master: la master firma, no envía (§5.3). Se guarda
 * la dirección y no el id de la wallet porque es lo que un explorador de bloques necesita y lo que
 * sigue siendo cierto tras una rotación de la master.
 *
 * `ownerId` es un `string` y no un VO propio: llega del `sub` de un token ya verificado y el
 * identificador pertenece a `users`. Mismo criterio, y por la misma regla del gate de fronteras,
 * que `Wallet.ownerId` y que `createdBy`/`updatedBy` de la traza.
 *
 * ⚠️ **El motivo es `ProviderFailureReason`, la misma lista cerrada que usan los errores del
 * proveedor, y JAMÁS el `message` del proveedor.** No es purismo: el `message` del 401 de Tatum
 * interpola la clave de API —`"Unable to find valid subscription for '${apiKey}'"`, medido abriendo
 * `docs/tatum/gas-pump/openapi.json`, en
 * `components/responses/Error401 → content['application/json'].schema.oneOf[1].properties.message.example`—
 * y esta columna se publica por `GET /wallets/me/transfers`, así que guardar su texto escribiría un
 * secreto en una respuesta HTTP.
 *
 * **Quien lo impide es el TIPO, no la disciplina de quien llama.** Medido con `pnpm typecheck`
 * (`tsc 6.0.3 --noEmit`) sobre un archivo sonda que hace exactamente lo que hay que impedir
 * —`transfer.markUnknown(error.message, now, actor)` y su gemelo `markRejected`, con
 * `error: Error`—: dos `TS2345`, uno por llamada,
 * `Argument of type 'string' is not assignable to parameter of type '"body-rejected" | "misconfigured" | … | "malformed-response"'`.
 * La contrafactual se midió en una SEGUNDA pasada de esa misma sonda —a la vez es imposible, los
 * `reason: string` y pasándole `error.message`: `tsc` sale con **cero errores**. O sea que lo que
 * cierra la puerta es el union, no que nadie lo intente.
 *
 * Y es la lista de `wallet.errors.ts` y no un vocabulario propio del libro porque es la misma
 * información vista desde otro sitio: lo que el adaptador clasificó al fallar la llamada es
 * exactamente lo que la fila tiene que registrar, y dos listas paralelas divergirían en silencio.
 */
export class WalletTransfer extends Entity<TransferId> {
  private constructor(
    id: TransferId,
    readonly ownerId: string,
    readonly from: EthereumAddress,
    readonly recipient: EthereumAddress,
    readonly asset: TransferAsset,
    private _status: TransferStatus,
    private _txId: TransactionHash | null,
    private _reasonCode: ProviderFailureReason | null,
    audit: AuditTrail,
  ) {
    super(id, audit);
  }

  /**
   * La escritura por delante. Ocurre DESPUÉS de toda la validación local y de la precondición de
   * activación, justo antes de la llamada: antes, el libro se llenaría de rechazos que nunca
   * salieron del proceso (§3.2).
   *
   * `updatedBy` nace igual a `createdBy` por la misma simetría con la que `updatedAt` nace igual a
   * `createdAt`: quien creó la fila es, hasta el primer `touch()`, el último que la escribió. Mismo
   * criterio que `Wallet.assign`, `User.create` y `Order.place`.
   */
  static start(params: {
    id: TransferId;
    ownerId: string;
    from: EthereumAddress;
    recipient: EthereumAddress;
    asset: TransferAsset;
    now: Date;
    createdBy: string | null;
  }): WalletTransfer {
    return new WalletTransfer(
      params.id,
      params.ownerId,
      params.from,
      params.recipient,
      params.asset,
      'submitting',
      null,
      null,
      {
        createdAt: params.now,
        updatedAt: params.now,
        createdBy: params.createdBy,
        updatedBy: params.createdBy,
      },
    );
  }

  /**
   * Reconstituye desde persistencia sin re-aplicar reglas de creación, igual que
   * `Wallet.rehydrate`. Recibe el activo ya construido —`TransferAsset`— y no sus cuatro columnas
   * sueltas: quien lee la fila es el mapper, y es él quien tiene que decidir qué clase de activo
   * era. Con las cuatro columnas aquí dentro, la entidad tendría que volver a validar la
   * combinación excluyente que `TransferAsset.fromParts` ya sabe rechazar, y una fila guardada no
   * es una entrada del cliente.
   *
   * ⚠️ **Qué deja pasar exactamente, porque «no valida» no es lo mismo que «da igual».** Admite
   * cualquier combinación de estado × txId × motivo, incluidas las que el dominio no produce: un
   * `submitting` con hash, un `submitted` sin él, un `rejected` sin motivo.
   *
   * ⚠️ **Y admite además CUALQUIER cadena en `reasonCode`.** El union es una comprobación de
   * COMPILACIÓN, y aquí el valor viene de la fila: un texto libre escrito por SQL crudo —o por un
   * mapper futuro que haga `as ProviderFailureReason` sobre lo que leyó— sale intacto por
   * `toSnapshot()` y de ahí por `GET /wallets/me/transfers`. Medido pasando el propio mensaje del
   * 401 del proveedor con esa aserción: `toSnapshot().reasonCode` lo devuelve VERBATIM, sin
   * validar, normalizar ni recortar. Es literalmente la cadena que toda la decisión de lista
   * cerrada existe para mantener fuera de esa respuesta.
   *
   * **Quien tiene que cerrarlo es el esquema, y hoy sigue sin haber nadie**: haría falta un
   * `CHECK ("reason_code" IS NULL OR "reason_code" IN (…los nueve…))` sobre `wallet_transfers`.
   * Sin eso escrito aquí, el control no está en el calendario de nadie.
   *
   * ⚠️ **Lo que ya NO es cierto es que falte la tabla.** `wallet_transfers` la crea
   * `src/database/migrations/1787900000000-create-wallets.ts` —la misma que `wallets`— y lo que
   * esa migración decide, con su motivo escrito, es no ponerle ningún `CHECK`. Aquí ponía «la
   * tabla todavía no existe: medido con `find src/database/migrations -name '*transfer*'`, que no
   * devuelve nada»: ese `find` sigue sin devolver nada hoy, porque el archivo se llama
   * `create-wallets`, así que la medición era CIERTA y la conclusión FALSA. Es exactamente el
   * `find` que se caza a sí mismo.
   */
  static rehydrate(params: {
    id: TransferId;
    ownerId: string;
    from: EthereumAddress;
    recipient: EthereumAddress;
    asset: TransferAsset;
    status: TransferStatus;
    txId: TransactionHash | null;
    reasonCode: ProviderFailureReason | null;
    createdAt: Date;
    updatedAt: Date;
    createdBy: string | null;
    updatedBy: string | null;
  }): WalletTransfer {
    return new WalletTransfer(
      params.id,
      params.ownerId,
      params.from,
      params.recipient,
      params.asset,
      params.status,
      params.txId,
      params.reasonCode,
      {
        createdAt: params.createdAt,
        updatedAt: params.updatedAt,
        createdBy: params.createdBy,
        updatedBy: params.updatedBy,
      },
    );
  }

  get status(): TransferStatus {
    return this._status;
  }

  get txId(): TransactionHash | null {
    return this._txId;
  }

  /** El proveedor devolvió un hash: la transacción está ENVIADA, no necesariamente minada. */
  markSubmitted(txId: TransactionHash, now: Date, by: string | null): void {
    this.settle('submitted', txId, null, now, by);
  }

  /**
   * Solo el 400 de validación del cuerpo, que significa que **no pasó nada en la cadena**. Un 401
   * o un 403 del proveedor no son un rechazo del envío —la petición ni llegó a procesarse como
   * transferencia— y van a `markUnknown`.
   */
  markRejected(reason: ProviderFailureReason, now: Date, by: string | null): void {
    this.settle('rejected', null, reason, now, by);
  }

  /**
   * Timeout, red caída o 5xx: **pudo minarse o no**. Es el estado honesto, y por eso existe: no
   * se inventa un `rejected`, que afirmaría que no pasó nada, ni un `submitted` sin hash.
   */
  markUnknown(reason: ProviderFailureReason, now: Date, by: string | null): void {
    this.settle('unknown', null, reason, now, by);
  }

  /**
   * ⚠️ **La clave del matcher es `multiToken` en camelCase y el literal del vocabulario es
   * `'multi-token'` CON GUION.** Son cosas distintas y las dos son correctas en su sitio.
   *
   * En ESTE archivo no queda hueco silencioso, y está medido: la clave la protege el TIPO
   * —escribiendo `multitoken` en el matcher, `tsc` saca `TS2561: Object literal may only specify
   * known properties, but 'multitoken' does not exist in type
   * `TransferAssetMatchers<AssetColumns>`. Did you mean to write 'multiToken'?`, que hasta nombra
   * la corrección—, y el literal publicado NO se escribe aquí: sale del getter `kind` del propio
   * activo, que es su única escritura.
   */
  toSnapshot(): WalletTransferSnapshot {
    const columns = this.asset.match<AssetColumns>({
      native: (amount) => ({ tokenAddress: null, amount: amount.value, tokenId: null }),
      fungible: (token, amount) => ({
        tokenAddress: token.value,
        amount: amount.value,
        tokenId: null,
      }),
      nft: (token, tokenId) => ({
        tokenAddress: token.value,
        amount: null,
        tokenId: tokenId.value,
      }),
      multiToken: (token, amount, tokenId) => ({
        tokenAddress: token.value,
        amount: amount.value,
        tokenId: tokenId.value,
      }),
    });

    return {
      id: this.id.value,
      ownerId: this.ownerId,
      from: this.from.value,
      recipient: this.recipient.value,
      assetKind: this.asset.kind,
      tokenAddress: columns.tokenAddress,
      amount: columns.amount,
      tokenId: columns.tokenId,
      status: this._status,
      txId: this._txId?.value ?? null,
      reasonCode: this._reasonCode,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      createdBy: this.createdBy,
      updatedBy: this.updatedBy,
    };
  }

  /**
   * ⚠️ **Gana la PRIMERA liquidación: sobre una fila ya liquidada esto es no-op, y sin `touch()`.**
   * El fallo que evita es alcanzable, no hipotético: §3.2 manda reintentar UNA vez el guardado
   * posterior a la llamada —«La escritura posterior no toca la cadena y es idempotente, así que se
   * reintenta una vez»—, así que existe un `catch` alrededor de una entidad ya marcada. Sin este
   * corte, un `markUnknown` en ese `catch` reescribiría una fila `submitted` que ya tiene `txId` —el
   * libro afirmando «no sé si se movió el dinero» sobre una transacción cuyo hash tenemos guardado,
   * que es la peor mentira posible en esta tabla—.
   *
   * Que el no-op sea anterior al `touch` es el mismo criterio que `Wallet.confirmActivated` y que
   * `User.promoteToAdmin`: la traza debe seguir nombrando a quien liquidó de verdad.
   *
   * ⚠️ **No lanza, a diferencia de `Wallet.markActivationRequested`**, y la asimetría es
   * deliberada: allí la segunda petición trae un txId NUEVO que se perdería en silencio, aquí el
   * segundo `mark*` es el reintento que el propio §3.2 ordena, y hacerlo estallar convertiría en
   * error el camino que la especificación manda recorrer.
   *
   * Un solo guardián para los tres mutadores y no tres copias: con tres, el auditor de mutación
   * tendría tres mutantes equivalentes del mismo corte y bastaría con olvidarlo en uno.
   *
   * El parámetro es `Exclude<TransferStatus, 'submitting'>` porque liquidar es salir de
   * `submitting`: pasarle el estado inicial dejaría la fila abierta y volvería el corte de arriba
   * inalcanzable para siempre.
   */
  private settle(
    status: Exclude<TransferStatus, 'submitting'>,
    txId: TransactionHash | null,
    reasonCode: ProviderFailureReason | null,
    now: Date,
    by: string | null,
  ): void {
    if (this._status !== 'submitting') {
      return;
    }
    this._status = status;
    this._txId = txId;
    this._reasonCode = reasonCode;
    this.touch(now, by);
  }
}
