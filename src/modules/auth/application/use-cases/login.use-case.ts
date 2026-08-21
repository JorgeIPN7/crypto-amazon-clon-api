import { Injectable } from '@nestjs/common';

import { InvalidCredentialsError } from '../../domain/errors/auth.errors';
import { CredentialRepository } from '../../domain/ports/credential.repository';
import { DUMMY_PASSWORD_HASH, PasswordHasher } from '../../domain/ports/password-hasher';
import { TokenSigner, type SignedToken } from '../../domain/ports/token-signer';
import { UserDirectory, type DirectoryUser } from '../../domain/ports/user-directory';
import { PasswordHash } from '../../domain/value-objects/password-hash.vo';

export type LoginInput = {
  email: string;
  password: string;
};

export type LoginResult = SignedToken & { user: DirectoryUser };

/**
 * Anti-enumeración por diseño, y ahora ENTERA dentro de auth —que es quien posee el hash y
 * el dummy—: email inexistente, cuenta sin credencial, usuario inactivo y password
 * incorrecto convergen en el MISMO error y el MISMO costo de tiempo (un `verify` y solo uno
 * en todos los caminos, contra el hash dummy del puerto cuando no hay credencial real que
 * comprobar). Es un requisito de seguridad MEDIDO: la fila L9 de la tabla de casos lo fija
 * como propiedad, no como ejemplo suelto.
 *
 * La normalización del email NO se hace aquí: la hace `users` dentro de `findByEmail`, con
 * el mismo value object que usa el alta. Duplicarla en auth sería la vía más directa a que
 * registro y login diverjan (un `trim()` de más en un lado y el usuario no puede entrar).
 */
@Injectable()
export class LoginUseCase {
  constructor(
    private readonly users: UserDirectory,
    private readonly credentials: CredentialRepository,
    private readonly hasher: PasswordHasher,
    private readonly signer: TokenSigner,
  ) {}

  async execute(input: LoginInput): Promise<LoginResult> {
    const user = await this.users.findByEmail(input.email);
    const credential = user ? await this.credentials.findByUserId(user.id) : null;

    // Una sola condición cubre los tres caminos sin credencial utilizable: email
    // inexistente (`user === null`), usuario inactivo y perfil sin credencial. TypeScript
    // estrecha `user` y `credential` a no-null tras el `if` porque la rama termina en
    // `throw` — verificado con `pnpm typecheck`.
    if (!user?.active || !credential) {
      await this.hasher.verify(input.password, PasswordHash.from(DUMMY_PASSWORD_HASH));
      throw new InvalidCredentialsError();
    }

    const matches = await this.hasher.verify(input.password, credential.passwordHash);
    if (!matches) {
      throw new InvalidCredentialsError();
    }

    const token = await this.signer.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
    return { ...token, user };
  }
}
