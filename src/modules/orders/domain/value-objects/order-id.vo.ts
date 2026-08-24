import { UuidId } from '@shared/domain/uuid-id.base';

import { InvalidOrderIdError } from '../errors/order.errors';

/**
 * Identidad del agregado, patrón de `user-id.vo.ts`. `equals()` y `toString()` vienen de
 * `ValueObject` —la decisión de no escribir API sin consumidor se toma una vez, en el
 * kernel—; el formato, de `UuidId`. Aquí solo queda lo que de verdad es de este contexto:
 * qué error se lanza cuando el id no vale.
 */
export class OrderId extends UuidId {
  static generate(): OrderId {
    return new OrderId(UuidId.newUuid());
  }

  static from(value: string): OrderId {
    return new OrderId(UuidId.assertUuid(value, (invalid) => new InvalidOrderIdError(invalid)));
  }
}
