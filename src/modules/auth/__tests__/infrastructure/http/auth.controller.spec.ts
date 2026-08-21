import { LoginUseCase } from '../../../application/use-cases/login.use-case';
import { RegisterAccountUseCase } from '../../../application/use-cases/register-account.use-case';
import { Credential } from '../../../domain/entities/credential.entity';
import { PasswordHash } from '../../../domain/value-objects/password-hash.vo';
import { AuthController } from '../../../infrastructure/http/auth.controller';
import { FakePasswordHasher, fakeHashOf } from '../../helpers/fake-password-hasher';
import { FakeTokenSigner } from '../../helpers/fake-token-signer';
import { FakeUserDirectory, buildDirectoryUser } from '../../helpers/fake-user.directory';
import { InMemoryCredentialRepository } from '../../helpers/in-memory-credential.repository';

/**
 * El controller es un adaptador: traduce transporte a caso de uso y resultado a DTO. Lo que
 * se prueba aquí es solo esa traducción — los caminos de error viven en los specs de los
 * casos de uso y en `auth.e2e-spec.ts`, que los ejercita sobre HTTP de verdad.
 */
describe('AuthController', () => {
  describe('register()', () => {
    it('debería devolver la cuenta creada envuelta en el DTO', async () => {
      // Arrange
      const { controller } = build();

      // Act
      const result = await controller.register({
        email: 'maria@example.com',
        name: 'María González',
        password: 'contrasena-larga-de-prueba',
      });

      // Assert
      expect(result.user.email).toBe('maria@example.com');
      expect(result.user.name).toBe('María González');
      expect(result.user.active).toBe(true);
    });

    // Impide que un campo nuevo del directorio se filtre a la respuesta sin decidirlo.
    it('debería exponer solo los campos del DTO, nunca el perfil crudo', async () => {
      // Arrange
      const { controller } = build();

      // Act
      const result = await controller.register({
        email: 'dto@example.com',
        name: 'Usuario DTO',
        password: 'contrasena-larga-de-prueba',
      });

      // Assert
      expect(Object.keys(result)).toEqual(['user']);
      expect(Object.keys(result.user).sort()).toEqual([
        'active',
        'createdAt',
        'email',
        'id',
        'name',
        'role',
        'updatedAt',
      ]);
    });
  });

  describe('login()', () => {
    it('debería devolver token, expiración y usuario en el DTO', async () => {
      // Arrange
      const user = buildDirectoryUser({ email: 'maria@example.com' });
      const credential = Credential.create({
        userId: user.id,
        passwordHash: PasswordHash.from(fakeHashOf('contrasena-larga-de-prueba')),
        now: new Date('2026-08-07T10:00:00.000Z'),
      });
      const { controller } = build({ users: [user], credentials: [credential] });

      // Act
      const result = await controller.login({
        email: 'maria@example.com',
        password: 'contrasena-larga-de-prueba',
      });

      // Assert
      expect(result.accessToken).toBe(`fake.jwt.${user.id}`);
      expect(result.expiresInSeconds).toBe(3600);
      expect(result.user.id).toBe(user.id);
    });

    // El hash jamás debe asomar por la respuesta: el DTO no lo declara y el resultado del
    // caso de uso tampoco lo lleva — este `it` fija que sigue siendo así.
    it('debería no incluir ningún rastro del hash en la respuesta', async () => {
      // Arrange
      const user = buildDirectoryUser({ email: 'maria@example.com' });
      const credential = Credential.create({
        userId: user.id,
        passwordHash: PasswordHash.from(fakeHashOf('contrasena-larga-de-prueba')),
        now: new Date('2026-08-07T10:00:00.000Z'),
      });
      const { controller } = build({ users: [user], credentials: [credential] });

      // Act
      const result = await controller.login({
        email: 'maria@example.com',
        password: 'contrasena-larga-de-prueba',
      });

      // Assert
      expect(JSON.stringify(result)).not.toContain('argon2');
    });
  });
});

// Helpers

type BuildOptions = {
  users?: ReturnType<typeof buildDirectoryUser>[];
  credentials?: Credential[];
};

const build = ({ users = [], credentials = [] }: BuildOptions = {}) => {
  const directory = new FakeUserDirectory(users);
  const repository = new InMemoryCredentialRepository(credentials);
  const hasher = new FakePasswordHasher();
  const signer = new FakeTokenSigner();
  const controller = new AuthController(
    new RegisterAccountUseCase(directory, repository, hasher),
    new LoginUseCase(directory, repository, hasher, signer),
  );
  return { controller, directory, repository };
};
