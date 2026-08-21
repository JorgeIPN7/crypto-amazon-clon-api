import { ValueObject } from '@shared/domain/value-object.base';

import { InvalidEmailError } from '../errors/user.errors';

const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const MAX_LENGTH = 254;

/**
 * El email se normaliza a minúsculas al construirse, de modo que la igualdad y la
 * unicidad se comportan igual dentro del dominio y en la base de datos.
 *
 * `equals()` y `toString()` los pone `ValueObject`; lo único que este VO aporta —y lo
 * único que la base NO factoriza— es la validación y la normalización.
 */
export class Email extends ValueObject<string> {
  static from(value: string): Email {
    const normalized = value.trim().toLowerCase();
    if (normalized.length > MAX_LENGTH || !EMAIL.test(normalized)) {
      throw new InvalidEmailError(value);
    }
    return new Email(normalized);
  }
}
