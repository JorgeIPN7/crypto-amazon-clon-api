import { AddressIndex } from '../../domain/value-objects/address-index.vo';
import { EthereumAddress } from '../../domain/value-objects/ethereum-address.vo';
import { TransactionHash } from '../../domain/value-objects/transaction-hash.vo';
import { Wallet } from '../../domain/entities/wallet.entity';
import { WalletId } from '../../domain/value-objects/wallet-id.vo';

import type { WalletStatus } from '../../domain/wallet-status';

/** Un UUID v4 fijo, para que el dueño por defecto sea el mismo en todas las suites del módulo. */
export const WALLET_OWNER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';

/** La master por defecto: lo que `CustodialAddressGateway.masterAddress()` devolverá en los tests. */
export const WALLET_MASTER_ADDRESS = '0x9f2e6c1b4a8d3f5e7c0b9a2d4e6f8a1c3b5d7e90';

/** Otra master, para el único productor de `WalletOwnerMismatchError`: la rotación de la master. */
export const WALLET_OTHER_MASTER_ADDRESS = '0x0000c1b4a8d3f5e7c0b9a2d4e6f8a1c3b5d7e901';

/** La dirección derivada. Distinta de la master, o `Wallet.assign` lanzaría. */
export const WALLET_ADDRESS = '0x1c3b5d7e90a2d4e6f8a19f2e6c1b4a8d3f5e7c0b';

export const WALLET_ACTIVATION_TX =
  '0x1111111111111111111111111111111111111111111111111111111111111111';

const ASSIGNED_AT = new Date('2026-08-27T10:00:00.000Z');
const ACTIVATION_REQUESTED_AT = new Date('2026-08-27T11:00:00.000Z');
const ACTIVATED_AT = new Date('2026-08-27T12:00:00.000Z');
const DEFAULT_ADDRESS_INDEX = 3;

export type WalletOverrides = {
  ownerId?: string;
  ownerAddress?: string;
  addressIndex?: number;
  address?: string;
  status?: WalletStatus;
  activationTxId?: string;
  now?: Date;
  createdBy?: string | null;
};

/**
 * Constructor de wallets para las suites del módulo. Existe porque el mismo `Wallet.assign()` de
 * siete campos haría falta en cada spec de `application/`: la convención del repo («nunca copiar un
 * builder en varios specs») lo prohíbe, y la copia además haría que cambiar la firma del agregado
 * costase una edición por spec.
 *
 * ⚠️ **`status` se alcanza EJECUTANDO las transiciones del agregado**, nunca inyectando el campo:
 * una wallet `activating` fabricada a mano podría tener un estado que el dominio no sabe producir
 * —`Wallet.rehydrate` admite las seis combinaciones de estado × txId y su propio JSDoc nombra las
 * dos que el dominio nunca escribe—, y entonces la suite probaría un mundo que no existe. El precio
 * es que la traza de una wallet `active` lleva las marcas de las dos transiciones, que es
 * exactamente lo que pasa en producción.
 *
 * Los tres instantes son fijos y distintos entre sí a propósito: con el mismo `now` en las tres,
 * un caso que compruebe que la traza se movió pasaría aunque el `touch()` no se hubiera ejecutado.
 *
 * `createdBy` por defecto es el propio dueño —una wallet la pide su dueño autenticado, no un
 * proceso— y se propaga a las dos transiciones. Pasar `createdBy: null` explícitamente es legal y
 * distinto de omitirlo, por eso la comparación es contra `undefined` y no un `??`.
 */
export const buildWallet = (overrides: WalletOverrides = {}): Wallet => {
  const ownerId = overrides.ownerId ?? WALLET_OWNER_ID;
  const createdBy = overrides.createdBy === undefined ? ownerId : overrides.createdBy;

  const wallet = Wallet.assign({
    id: WalletId.generate(),
    ownerId,
    ownerAddress: EthereumAddress.from(overrides.ownerAddress ?? WALLET_MASTER_ADDRESS),
    addressIndex: AddressIndex.from(overrides.addressIndex ?? DEFAULT_ADDRESS_INDEX),
    address: EthereumAddress.from(overrides.address ?? WALLET_ADDRESS),
    now: overrides.now ?? ASSIGNED_AT,
    createdBy,
  });

  const status = overrides.status ?? 'receive-only';
  if (status === 'receive-only') {
    return wallet;
  }

  wallet.markActivationRequested(
    TransactionHash.from(overrides.activationTxId ?? WALLET_ACTIVATION_TX),
    ACTIVATION_REQUESTED_AT,
    createdBy,
  );
  if (status === 'active') {
    wallet.confirmActivated(ACTIVATED_AT, createdBy);
  }
  return wallet;
};
