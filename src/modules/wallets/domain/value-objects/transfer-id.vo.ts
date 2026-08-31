import { UuidId } from '@shared/domain/uuid-id.base';

import { InvalidTransferIdError } from '../errors/wallet.errors';

/**
 * Identidad del agregado `WalletTransfer`. Es una clase aparte de `WalletId` y no un alias:
 * `ValueObject.equals` compara la clase, así que `WalletId.from(u).equals(TransferId.from(u))` es
 * `false` aunque el UUID sea el mismo. El caso W5 de `wallet-id.vo.spec.ts` lo caza.
 *
 * ⚠️ **Es una separación de TIEMPO DE EJECUCIÓN, no de tipos, y conviene no creer lo contrario.**
 * TypeScript es estructural y las dos clases publican exactamente la misma forma
 * (`value: string`), así que una función que pida un `WalletId` acepta un `TransferId` sin una
 * queja del compilador — medido con una sonda de `tsc`, que solo señaló el error centinela.
 * Lo que separa de verdad en tipos es un campo privado, como hace `TransferAsset`; aquí no se
 * paga ese precio porque los ids no cruzan fronteras de agregado.
 */
export class TransferId extends UuidId {
  static generate(): TransferId {
    return new TransferId(UuidId.newUuid());
  }

  static from(value: string): TransferId {
    return new TransferId(
      UuidId.assertUuid(value, (invalid) => new InvalidTransferIdError(invalid)),
    );
  }
}
