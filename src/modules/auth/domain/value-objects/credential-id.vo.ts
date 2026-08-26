import { UuidId } from '@shared/domain/uuid-id.base';

import { InvalidCredentialIdError } from '../errors/auth.errors';

/**
 * Identidad del agregado `Credential`. Hasta este ciclo era un `string` crudo; pasa a value
 * object porque `Entity` exige un id comparable, y porque la uniformidad entre contextos era
 * el objetivo del cambio.
 *
 * NO cambia el esquema: la columna sigue siendo `uuid` y `CredentialSnapshot.id` sigue
 * siendo `string`. Lo que gana un tipo es el dominio, no la tabla.
 *
 * Ojo con no confundirlo con `userId`, que sigue siendo un `string` a propósito: pertenece a
 * `users` y copiar aquí su `UserId` duplicaría una invariante ajena.
 */
export class CredentialId extends UuidId {
  static generate(): CredentialId {
    return new CredentialId(UuidId.newUuid());
  }

  static from(value: string): CredentialId {
    return new CredentialId(
      UuidId.assertUuid(value, (invalid) => new InvalidCredentialIdError(invalid)),
    );
  }
}
