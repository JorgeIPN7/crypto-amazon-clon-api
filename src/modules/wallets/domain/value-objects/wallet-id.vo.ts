import { UuidId } from '@shared/domain/uuid-id.base';

import { InvalidWalletIdError } from '../errors/wallet.errors';

/**
 * Identidad del agregado `Wallet`, patrón de `order-id.vo.ts`. `equals()` y `toString()` vienen
 * de `ValueObject` y el formato de `UuidId`; lo único de este contexto es qué error se lanza.
 *
 * ⚠️ Ese error DEBE salir como **500**, no como 400 (spec §3.5), y hoy es una decisión pendiente,
 * no un hecho: quien la hará cierta es el mapa de `wallets-domain-exception.filter.ts`, que
 * todavía no existe. Sin su fila explícita, el fallback del filtro lo publicaría como 400.
 * El motivo: ningún endpoint de `wallets` recibe un id de wallet —los cinco son «lo mío»—, así
 * que si esto se dispara es una fila corrupta, y publicarlo como «entrada inválida» lo escondería
 * del `ErrorReporter`, que solo ve 5xx.
 */
export class WalletId extends UuidId {
  static generate(): WalletId {
    return new WalletId(UuidId.newUuid());
  }

  static from(value: string): WalletId {
    return new WalletId(UuidId.assertUuid(value, (invalid) => new InvalidWalletIdError(invalid)));
  }
}
