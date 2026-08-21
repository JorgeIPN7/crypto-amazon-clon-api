import type { PasswordHasher } from '../../domain/ports/password-hasher';
import { PasswordHash } from '../../domain/value-objects/password-hash.vo';

/**
 * Determinista pero OPACO: codifica el plano en base64url para que el hash falso
 * jamás CONTENGA el password en claro — la fila que exige «ningún campo contiene el
 * password plano» se cumple literalmente, igual que con argon2 real. Un fake con el plano
 * embebido haría la fila insatisfacible; el contrato es inamovible, así que el que se adapta
 * es el fake.
 */
export class FakePasswordHasher implements PasswordHasher {
  readonly verifyCalls: { plain: string; hash: PasswordHash }[] = [];
  readonly hashCalls: string[] = [];
  /** Cuando se fija, `hash()` rechaza con este error: el disparador del caso de compensación. */
  failNextHashWith?: Error;

  hash(plain: string): Promise<PasswordHash> {
    this.hashCalls.push(plain);
    if (this.failNextHashWith) {
      return Promise.reject(this.failNextHashWith);
    }
    return Promise.resolve(PasswordHash.from(fakeHashOf(plain)));
  }

  verify(plain: string, hash: PasswordHash): Promise<boolean> {
    this.verifyCalls.push({ plain, hash });
    return Promise.resolve(hash.value === fakeHashOf(plain));
  }
}

export const fakeHashOf = (plain: string): string =>
  `$argon2id$fake$${Buffer.from(plain).toString('base64url')}`;
