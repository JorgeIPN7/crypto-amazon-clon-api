import { ValueObject } from '@shared/domain/value-object.base';

import { InvalidPasswordHashError } from '../errors/auth.errors';

const ARGON2ID_PREFIX = '$argon2id$';

/**
 * Envuelve un hash PHC de argon2id ya calculado. NO hashea ni verifica — eso es
 * I/O y vive tras el puerto `PasswordHasher`; este VO solo garantiza que lo que se
 * persiste tiene forma de hash y nunca un password en claro.
 *
 * Vivía en `users/domain/value-objects/`. Se mudó con la credencial: el hash es del
 * agregado `Credential`, y `users` dejó de conocerlo.
 */
export class PasswordHash extends ValueObject<string> {
  static from(value: string): PasswordHash {
    if (!value.startsWith(ARGON2ID_PREFIX)) {
      throw new InvalidPasswordHashError();
    }
    return new PasswordHash(value);
  }
}
