import { AddressIndex } from '../../domain/value-objects/address-index.vo';

import type { AddressIndexAllocator } from '../../domain/ports/address-index.allocator';

/**
 * Secuencia de mentira.
 *
 * ⚠️ **Es OTRO almacén, y por eso este fake no lee de `InMemoryWalletRepository`.** Detrás del
 * puerto real hay una `SEQUENCE` de PostgreSQL, no la tabla `wallets`: su cursor avanza aunque la
 * transacción que lo pidió haga `ROLLBACK`, y no retrocede nunca. Un fake que dedujera el próximo
 * índice de las wallets guardadas se comportaría como el `max(index)+1` que el JSDoc del puerto
 * descarta por escrito —reciclaría el índice de una fila borrada, dos usuarios sobre la misma
 * dirección— y además haría imposible el caso que de verdad importa: el índice consumido por un
 * alta que después falló.
 *
 * `allocated` guarda cada índice entregado, y es lo que permite afirmar las dos caras del spec
 * §5.2:
 *   - un alta idempotente **no** consume índice (`allocated` vacío),
 *   - un fallo de la pasarela **sí** lo deja consumido y sin compensación (`allocated` con un
 *     elemento y ninguna wallet guardada). `next()` no tiene contrapartida a propósito: consumir
 *     una secuencia es irreversible por diseño.
 *
 * `programFailure()` es la secuencia caída —la base rechaza el `nextval`—, y es persistente y no
 * una cola de un solo uso: ningún caso de uso llama a `next()` dos veces, así que una cola solo
 * añadiría una forma de equivocarse. Un fallo **no** avanza el cursor ni escribe en `allocated`,
 * que es lo que hace la base: si `nextval` no devolvió nada, no se consumió nada.
 */
export class FakeAddressIndexAllocator implements AddressIndexAllocator {
  readonly allocated: number[] = [];

  private cursor: number;
  private failure: Error | null = null;

  constructor(start = 0) {
    this.cursor = start;
  }

  programFailure(error: Error): void {
    this.failure = error;
  }

  next(): Promise<AddressIndex> {
    if (this.failure) {
      return Promise.reject(this.failure);
    }

    const value = this.cursor;
    this.cursor += 1;
    this.allocated.push(value);
    return Promise.resolve(AddressIndex.from(value));
  }
}
