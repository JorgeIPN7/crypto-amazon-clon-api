import { randomUUID } from 'node:crypto';

import { ValueObject } from '@shared/domain/value-object.base';

import { InvalidOrderIdError } from '../errors/order.errors';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Identidad del agregado, patrón de `user-id.vo.ts`. `equals()` y `toString()` ya no se
 * escriben ni se omiten aquí: vienen de `ValueObject`, que es justo el punto de tener una
 * base — la decisión de no escribir API sin consumidor se toma una vez, en el kernel.
 */
export class OrderId extends ValueObject<string> {
  static generate(): OrderId {
    return new OrderId(randomUUID());
  }

  static from(value: string): OrderId {
    if (!UUID_V4.test(value)) {
      throw new InvalidOrderIdError(value);
    }
    return new OrderId(value);
  }
}
