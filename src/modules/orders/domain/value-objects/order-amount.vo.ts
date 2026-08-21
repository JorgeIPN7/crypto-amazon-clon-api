import { ValueObject } from '@shared/domain/value-object.base';

import { InvalidOrderAmountError } from '../errors/order.errors';

/** Tope anti-desbordamiento absurdo de la spec §3: 10 000 000 céntimos. */
const AMOUNT_MAX_CENTS = 10_000_000;

/** Importe en céntimos: entero estricto y positivo — nunca flotantes (spec §2). */
export class OrderAmount extends ValueObject<number> {
  static from(value: number): OrderAmount {
    if (!Number.isInteger(value) || value <= 0 || value > AMOUNT_MAX_CENTS) {
      throw new InvalidOrderAmountError(value);
    }
    return new OrderAmount(value);
  }
}
