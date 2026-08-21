import { CreateUserUseCase } from '../../../application/use-cases/create-user.use-case';
import type { User } from '../../../domain/entities/user.entity';
import { EmailAlreadyTakenError, InvalidEmailError } from '../../../domain/errors/user.errors';
import { InMemoryUserRepository } from '../../helpers/in-memory-user.repository';
import { buildUserWithEmail } from '../../helpers/user.factory';

describe('CreateUserUseCase', () => {
  describe('execute()', () => {
    it('debería persistir un usuario nuevo y devolverlo', async () => {
      // Arrange
      const { useCase, repository } = buildUseCase();

      // Act
      const user = await useCase.execute({
        email: 'maria@example.com',
        name: 'María González',
      });

      // Assert
      expect(user.email.value).toBe('maria@example.com');
      expect(user.name).toBe('María González');
      expect(repository.size()).toBe(1);
    });

    it('debería normalizar el email antes de guardarlo', async () => {
      // Arrange
      const { useCase } = buildUseCase();

      // Act
      const user = await useCase.execute({ email: 'Maria@EXAMPLE.com', name: 'María' });

      // Assert
      expect(user.email.value).toBe('maria@example.com');
    });

    it('debería recortar los espacios del nombre', async () => {
      // Arrange
      const { useCase } = buildUseCase();

      // Act
      const user = await useCase.execute({ email: 'trim@example.com', name: '  María  ' });

      // Assert
      expect(user.name).toBe('María');
    });

    it('debería rechazar un email ya registrado', async () => {
      // Arrange
      const { useCase } = buildUseCase([buildUserWithEmail('taken@example.com')]);

      // Act + Assert
      await expect(
        useCase.execute({ email: 'taken@example.com', name: 'Otro Usuario' }),
      ).rejects.toThrow(EmailAlreadyTakenError);
    });

    // La comparación va contra el email ya normalizado, no contra la cadena cruda.
    it('debería detectar el duplicado aunque cambie el uso de mayúsculas', async () => {
      // Arrange
      const { useCase } = buildUseCase([buildUserWithEmail('taken@example.com')]);

      // Act + Assert
      await expect(
        useCase.execute({ email: 'TAKEN@EXAMPLE.COM', name: 'Otro Usuario' }),
      ).rejects.toThrow(EmailAlreadyTakenError);
    });

    it('debería no guardar nada cuando el email es inválido', async () => {
      // Arrange
      const { useCase, repository } = buildUseCase();

      // Act + Assert
      await expect(useCase.execute({ email: 'no-arroba', name: 'Nombre' })).rejects.toThrow(
        InvalidEmailError,
      );
      expect(repository.size()).toBe(0);
    });

    it('debería asignar un identificador distinto a cada usuario', async () => {
      // Arrange
      const { useCase } = buildUseCase();

      // Act
      const first = await useCase.execute({ email: 'a@example.com', name: 'Usuario A' });
      const second = await useCase.execute({ email: 'b@example.com', name: 'Usuario B' });

      // Assert
      expect(first.id.equals(second.id)).toBe(false);
    });

    it('debería crear el perfil siempre con rol user y activo', async () => {
      // Arrange
      const { useCase } = buildUseCase();

      // Act
      const user = await useCase.execute({ email: 'rol@example.com', name: 'Usuario Rol' });

      // Assert
      expect(user.role).toBe('user');
      expect(user.active).toBe(true);
    });

    /**
     * El caso de uso perdió el `password` en el ciclo 4: crear un usuario es crear un
     * PERFIL, y la credencial es del bounded context `auth`. Este `it` fija que ningún
     * campo del agregado guarda ya un secreto — sustituye a los tres casos anteriores
     * («debería hashear el password tras confirmar unicidad», «debería no llamar al hasher
     * si el email ya está tomado» y «debería jamás pasar el password en claro al
     * repositorio»), que hablaban de una responsabilidad que este SUT ya no tiene y se
     * mudaron a `auth/__tests__/application/use-cases/register-account.use-case.spec.ts`.
     */
    it('debería no guardar ningún rastro de credencial en el perfil', async () => {
      // Arrange
      const { useCase } = buildUseCase();

      // Act
      const user = await useCase.execute({ email: 'sin.hash@example.com', name: 'Ana López' });

      // Assert
      expect(user).not.toHaveProperty('passwordHash');
      expect(Object.keys(user.toSnapshot()).sort()).toEqual([
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
});

// Helpers

const buildUseCase = (seed: User[] = []) => {
  const repository = new InMemoryUserRepository(seed);
  return { useCase: new CreateUserUseCase(repository), repository };
};
