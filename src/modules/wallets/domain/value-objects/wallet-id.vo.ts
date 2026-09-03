import { UuidId } from '@shared/domain/uuid-id.base';

import { InvalidWalletIdError } from '../errors/wallet.errors';

/**
 * Identidad del agregado `Wallet`, patrón de `order-id.vo.ts`. `equals()` y `toString()` vienen
 * de `ValueObject` y el formato de `UuidId`; lo único de este contexto es qué error se lanza.
 *
 * ⚠️ Ese error sale como **500**, no como 400 (spec §3.5), y ya es un hecho y no una decisión
 * pendiente: lo hace cierto la fila `[InvalidWalletIdError, internalServerError]` de
 * `wallets-domain-exception.filter.ts`, con su caso «debería traducir InvalidWalletIdError a 500».
 * (Este párrafo decía que ese filtro «todavía no existe»; se corrige al aterrizar el archivo, no
 * se borra, porque un comentario que niega una protección que sí existe es peor que ninguno.)
 * Sin esa fila explícita el fallback del filtro lo publicaría como 400, y borrarla pone rojo ese
 * caso. El motivo: ningún endpoint de `wallets` recibe un id de wallet —los cinco son «lo mío»—,
 * así que si esto se dispara es una fila corrupta, y publicarlo como «entrada inválida» lo
 * escondería del `ErrorReporter`, que solo ve 5xx.
 */
export class WalletId extends UuidId {
  static generate(): WalletId {
    return new WalletId(UuidId.newUuid());
  }

  static from(value: string): WalletId {
    return new WalletId(UuidId.assertUuid(value, (invalid) => new InvalidWalletIdError(invalid)));
  }
}
