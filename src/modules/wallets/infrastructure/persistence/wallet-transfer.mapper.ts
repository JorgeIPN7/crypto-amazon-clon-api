import { EthereumAddress } from '../../domain/value-objects/ethereum-address.vo';
import { TransactionHash } from '../../domain/value-objects/transaction-hash.vo';
import { TransferAsset } from '../../domain/transfer-asset';
import { TransferId } from '../../domain/value-objects/transfer-id.vo';
import { WalletTransfer } from '../../domain/entities/wallet-transfer.entity';

import type { ProviderFailureReason } from '../../domain/errors/wallet.errors';
import type { TransferStatus } from '../../domain/transfer-status';

import { WalletTransferOrmEntity } from './wallet-transfer.orm-entity';

/**
 * Frontera fila ↔ libro. Mismas reglas que `WalletMapper` —campo a campo, sin spread, `rehydrate`
 * al reconstituir— y allí está el razonamiento largo de cada una. Aquí son quince asignaciones en
 * cada sentido, tantas como campos tiene `WalletTransferSnapshot`.
 *
 * ⚠️ **Aquí es donde `from` se convierte en `fromAddress`**, por lo mismo que `ownerId` se
 * convierte en `userId` en `WalletMapper`: `FROM` es palabra reservada de SQL y la columna se llama
 * `from_address`. Cruzar los dos nombres es trabajo de este archivo y de ningún otro.
 *
 * **El activo NO se despliega aquí.** `WalletTransfer.toSnapshot()` ya lo publica en sus cuatro
 * campos (`assetKind`, `tokenAddress`, `amount`, `tokenId`), que es donde `TransferAsset.match()`
 * decide qué lleva cada clase. Repetir ese `match()` en el mapper pondría la misma decisión en dos
 * sitios que pueden divergir, y el segundo es justo el que nadie lee al añadir una quinta clase de
 * activo.
 *
 * **Al releer, en cambio, el mapper SÍ decide qué clase de activo era**, con
 * `TransferAsset.fromParts()`. Es asimétrico a propósito y está argumentado en el JSDoc de
 * `WalletTransfer.rehydrate`: la entidad recibe el activo YA CONSTRUIDO, no sus cuatro columnas
 * sueltas, porque quien lee la fila es este archivo. Una fila con una clase que el dominio no
 * conoce —una migración a medias, una escritura manual— sale como `UnknownAssetKindError` con
 * nombre, no como un `undefined` cayéndose por un `switch` sin `default`.
 *
 * `row.status as TransferStatus` y `row.reasonCode as ProviderFailureReason | null` son casts
 * conscientes y acotados, con el mismo criterio que el `status` de `WalletMapper`: las dos columnas
 * solo las escriben este mapper y las migraciones, y ninguno de los dos valores gobierna un
 * privilegio.
 *
 * ⚠️ **Ese segundo cast es además el agujero que `WalletTransfer.rehydrate` mide y nombra**: el
 * union es una comprobación de COMPILACIÓN, así que una cadena arbitraria escrita por SQL crudo en
 * `reason_code` sale intacta por `toSnapshot()` y de ahí por HTTP. Quien puede cerrarlo es un
 * `CHECK` en la migración de `wallet_transfers` — el razonamiento completo, incluido por qué ese
 * `CHECK` es una decisión y no un impedimento técnico, está en `wallet-transfer.orm-entity.ts`.
 */
export const WalletTransferMapper = {
  /**
   * ⚠️ **Asimetría con `WalletMapper.toDomain`, y su consecuencia.** Aquel usa `rehydrate` y NO
   * revalida —una fila corrupta hay que poder LEERLA para diagnosticarla—; este sí, porque llama a
   * `TransferAsset.fromParts` para rearmar el activo desde sus cuatro columnas.
   *
   * El radio de explosión: `findByOwner` mapea con `rows.map(...)`, así que **UNA sola fila
   * incoherente tumba el listado ENTERO del usuario**, no esa fila. Es justo la escritura por SQL
   * crudo para la que `wallets` tiene su `CHECK` y `wallet_transfers` decidió no tenerlo.
   *
   * ⚠️ Para quien escriba el filtro de excepciones: `UnknownAssetKindError`,
   * `MissingAssetFieldError` y `AssetFieldNotAllowedError` **no son un 400 cuando vienen de una
   * FILA**. Del cuerpo del cliente sí; de aquí son un defecto nuestro y deben salir 500, o
   * culparíamos al cliente de una fila que escribimos nosotros.
   */
  toDomain(row: WalletTransferOrmEntity): WalletTransfer {
    return WalletTransfer.rehydrate({
      id: TransferId.from(row.id),
      ownerId: row.ownerId,
      from: EthereumAddress.from(row.fromAddress),
      recipient: EthereumAddress.from(row.recipient),
      // ⚠️ **`?? undefined` en los tres, y no es cosmética.** `fromParts` distingue «campo ausente»
      // de «campo presente» con `!== undefined`, no con una comprobación de nulidad: pasarle el
      // `null` de la columna cuenta como PRESENTE, así que un activo nativo —cuyas columnas de
      // contrato y de `tokenId` son nulas por construcción— saldría por `forbiddenField` con
      // `AssetFieldNotAllowedError` y ninguna transferencia nativa podría releerse jamás.
      // Medido sustituyendo los tres `?? undefined` por un `as string | undefined` —que compila y
      // deja pasar el `null`—: en `wallet-transfer.mapper.spec.ts` caen los CUATRO casos de
      // `toDomain()` y la propiedad de ida y vuelta.
      asset: TransferAsset.fromParts({
        kind: row.assetKind,
        tokenAddress: row.tokenAddress ?? undefined,
        amount: row.amount ?? undefined,
        tokenId: row.tokenId ?? undefined,
      }),
      status: row.status as TransferStatus,
      txId: row.txId === null ? null : TransactionHash.from(row.txId),
      reasonCode: row.reasonCode as ProviderFailureReason | null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
    });
  },

  toPersistence(transfer: WalletTransfer): WalletTransferOrmEntity {
    const snapshot = transfer.toSnapshot();
    const row = new WalletTransferOrmEntity();
    row.id = snapshot.id;
    row.ownerId = snapshot.ownerId;
    row.fromAddress = snapshot.from;
    row.recipient = snapshot.recipient;
    row.assetKind = snapshot.assetKind;
    row.tokenAddress = snapshot.tokenAddress;
    row.amount = snapshot.amount;
    row.tokenId = snapshot.tokenId;
    row.status = snapshot.status;
    row.txId = snapshot.txId;
    row.reasonCode = snapshot.reasonCode;
    row.createdAt = snapshot.createdAt;
    row.updatedAt = snapshot.updatedAt;
    row.createdBy = snapshot.createdBy;
    row.updatedBy = snapshot.updatedBy;
    return row;
  },
};
