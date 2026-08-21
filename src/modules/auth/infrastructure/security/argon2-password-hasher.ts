import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

import { ARGON2_PARAMS } from '@config/auth.config';

import { PasswordHasher } from '../../domain/ports/password-hasher';
import { PasswordHash } from '../../domain/value-objects/password-hash.vo';

/**
 * Adaptador real del puerto `PasswordHasher`: argon2id con los parámetros explícitos de
 * `config/auth.config.ts`, la MISMA fuente que consume el seed del primer admin — si el
 * costo cambiara solo en un sitio, el hash del seed y el del alta dejarían de ser
 * comparables en tiempo.
 */
@Injectable()
export class Argon2PasswordHasher implements PasswordHasher {
  async hash(plain: string): Promise<PasswordHash> {
    return PasswordHash.from(await argon2.hash(plain, { ...ARGON2_PARAMS, type: argon2.argon2id }));
  }

  async verify(plain: string, hash: PasswordHash): Promise<boolean> {
    return argon2.verify(hash.value, plain);
  }
}
