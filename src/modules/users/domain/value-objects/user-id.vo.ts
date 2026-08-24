import { UuidId } from '@shared/domain/uuid-id.base';

import { InvalidUserIdError } from '../errors/user.errors';

/**
 * Identidad del agregado. Es un value object para que un `string` cualquiera no pueda pasar
 * por un id de usuario: el tipo obliga a construirlo por `from()` o `generate()`.
 *
 * El formato lo valida `UuidId`; el ERROR lo pone este archivo. Esa división es el motivo
 * de que `assertUuid` reciba una fábrica: el kernel no puede importar `InvalidUserIdError`.
 */
export class UserId extends UuidId {
  static generate(): UserId {
    return new UserId(UuidId.newUuid());
  }

  static from(value: string): UserId {
    return new UserId(UuidId.assertUuid(value, (invalid) => new InvalidUserIdError(invalid)));
  }
}
