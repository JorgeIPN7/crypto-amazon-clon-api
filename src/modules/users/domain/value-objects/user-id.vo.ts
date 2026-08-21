import { randomUUID } from 'node:crypto';

import { ValueObject } from '@shared/domain/value-object.base';

import { InvalidUserIdError } from '../errors/user.errors';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Identidad del agregado. Es un value object para que un `string` cualquiera no pueda
 * pasar por un id de usuario: el tipo obliga a construirlo por `from()` o `generate()`.
 */
export class UserId extends ValueObject<string> {
  static generate(): UserId {
    return new UserId(randomUUID());
  }

  static from(value: string): UserId {
    if (!UUID_V4.test(value)) {
      throw new InvalidUserIdError(value);
    }
    return new UserId(value);
  }
}
