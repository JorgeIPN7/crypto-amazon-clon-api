import { SecretValueObject } from '@shared/domain/secret-value-object.base';

import { InvalidPasswordHashError } from '../errors/auth.errors';

const ARGON2ID_PREFIX = '$argon2id$';

/**
 * Envuelve un hash PHC de argon2id ya calculado. NO hashea ni verifica — eso es
 * I/O y vive tras el puerto `PasswordHasher`; este VO solo garantiza que lo que se
 * persiste tiene forma de hash y nunca un password en claro.
 *
 * Vivía en `users/domain/value-objects/`. Se mudó con la credencial: el hash es del
 * agregado `Credential`, y `users` dejó de conocerlo.
 *
 * **`SecretValueObject` y no `ValueObject`**: el hash NUNCA debe aparecer en un log. No es
 * celo — un hash argon2id filtrado permite atacar la contraseña **offline**, sin tocar el
 * servidor y sin que ningún rate limit cuente. La base tapa las tres superficies que lo
 * rendían a texto (`toString`, `toJSON`, `util.inspect`); por qué son tres y no una, con la
 * medición, en la cabecera de `secret-value-object.base.ts`.
 */
export class PasswordHash extends SecretValueObject<string> {
  static from(value: string): PasswordHash {
    if (!value.startsWith(ARGON2ID_PREFIX)) {
      throw new InvalidPasswordHashError();
    }
    return new PasswordHash(value);
  }
}
