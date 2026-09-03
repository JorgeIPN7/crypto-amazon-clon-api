import { EthereumAddress } from '../../domain/value-objects/ethereum-address.vo';
import { TransactionHash } from '../../domain/value-objects/transaction-hash.vo';
import {
  TransferAsset,
  type TransferAssetKind,
  type TransferAssetParts,
} from '../../domain/transfer-asset';
import { TransferId } from '../../domain/value-objects/transfer-id.vo';
import { WalletTransfer } from '../../domain/entities/wallet-transfer.entity';

import type { ProviderFailureReason } from '../../domain/errors/wallet.errors';
import type { TransferStatus } from '../../domain/transfer-status';

/** El mismo dueño que `wallet.factory.ts`: una transferencia sale de la wallet de ese dueño. */
export const TRANSFER_OWNER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';

/** El origen es la dirección de la WALLET, así que por defecto es la misma que `WALLET_ADDRESS`. */
export const TRANSFER_FROM_ADDRESS = '0x1c3b5d7e90a2d4e6f8a19f2e6c1b4a8d3f5e7c0b';

export const TRANSFER_RECIPIENT_ADDRESS = '0x5d7e90a2d4e6f8a19f2e6c1b4a8d3f5e7c0b1c3b';
export const TRANSFER_CONTRACT = '0x782919afc85eea2cb736874225456bb5d3e242ba';
export const TRANSFER_TX = '0x9c1b4a8d3f5e7c0b9a2d4e6f8a1c3b5d7e901c3b5d7e90a2d4e6f8a19f2e6c1b';

const STARTED_AT = new Date('2026-08-27T10:00:00.000Z');
const SETTLED_AT = new Date('2026-08-27T10:00:05.000Z');
const DEFAULT_AMOUNT = '1000000000000000000';
const DEFAULT_TOKEN_ID = '7';

export type TransferOverrides = {
  ownerId?: string;
  from?: string;
  recipient?: string;
  assetKind?: TransferAssetKind;
  tokenAddress?: string;
  amount?: string;
  tokenId?: string;
  status?: TransferStatus;
  txId?: string;
  reasonCode?: ProviderFailureReason;
  now?: Date;
  createdBy?: string | null;
};

/**
 * Las partes que `TransferAsset.fromParts` acepta para cada clase, **con las prohibidas fuera**.
 * No es cosmética: `fromParts` lanza `AssetFieldNotAllowedError` si un `native` trae
 * `tokenAddress`, así que un objeto con los cuatro campos siempre puestos no construiría nada.
 *
 * `switch` sobre el union y no una cadena de `if`, para que el compilador cierre la lista: con
 * `if`s, una quinta clase de activo caería en silencio por la rama de multi-token y la factoría
 * fabricaría un activo que nadie pidió.
 */
const partsFor = (overrides: TransferOverrides): TransferAssetParts => {
  const kind = overrides.assetKind ?? 'native';
  const tokenAddress = overrides.tokenAddress ?? TRANSFER_CONTRACT;
  const amount = overrides.amount ?? DEFAULT_AMOUNT;
  const tokenId = overrides.tokenId ?? DEFAULT_TOKEN_ID;

  switch (kind) {
    case 'native':
      return { kind, amount };
    case 'fungible':
      return { kind, tokenAddress, amount };
    case 'nft':
      return { kind, tokenAddress, tokenId };
    case 'multi-token':
      return { kind, tokenAddress, amount, tokenId };
  }
};

/**
 * Constructor de filas del libro para las suites del módulo, hermano de `buildWallet`.
 *
 * ⚠️ **La clase de activo se nombra `'multi-token'`, CON GUION**, igual que en el dominio, en la
 * columna y en el DTO. `multiToken` (camelCase) solo existe como clave del matcher de
 * `TransferAsset`, que es un identificador de TypeScript y no vocabulario.
 *
 * Igual que en `buildWallet`, `status` se alcanza EJECUTANDO los mutadores: una fila `rejected`
 * fabricada a mano podría llevar un `reasonCode` que el agregado nunca escribiría — y su propio
 * `rehydrate` admite cualquier cadena ahí, incluido el `message` del proveedor que toda la decisión
 * de lista cerrada existe para mantener fuera de la respuesta HTTP.
 *
 * `SETTLED_AT` es posterior a `STARTED_AT` a propósito: con el mismo instante, un caso que
 * compruebe que la liquidación movió la traza pasaría aunque el `touch()` no se hubiera ejecutado.
 *
 * Los dos motivos por defecto no son intercambiables y por eso son dos: `'body-rejected'` es el
 * ÚNICO 400 que significa «no pasó nada en la cadena» —el resto de fallos del proveedor van a
 * `unknown`—, y `'timeout'` es el ejemplo canónico de «pudo minarse o no».
 */
export const buildTransfer = (overrides: TransferOverrides = {}): WalletTransfer => {
  const ownerId = overrides.ownerId ?? TRANSFER_OWNER_ID;
  const createdBy = overrides.createdBy === undefined ? ownerId : overrides.createdBy;

  const transfer = WalletTransfer.start({
    id: TransferId.generate(),
    ownerId,
    from: EthereumAddress.from(overrides.from ?? TRANSFER_FROM_ADDRESS),
    recipient: EthereumAddress.from(overrides.recipient ?? TRANSFER_RECIPIENT_ADDRESS),
    asset: TransferAsset.fromParts(partsFor(overrides)),
    now: overrides.now ?? STARTED_AT,
    createdBy,
  });

  const status = overrides.status ?? 'submitting';
  if (status === 'submitted') {
    transfer.markSubmitted(
      TransactionHash.from(overrides.txId ?? TRANSFER_TX),
      SETTLED_AT,
      createdBy,
    );
  }
  if (status === 'rejected') {
    transfer.markRejected(overrides.reasonCode ?? 'body-rejected', SETTLED_AT, createdBy);
  }
  if (status === 'unknown') {
    transfer.markUnknown(overrides.reasonCode ?? 'timeout', SETTLED_AT, createdBy);
  }
  return transfer;
};
