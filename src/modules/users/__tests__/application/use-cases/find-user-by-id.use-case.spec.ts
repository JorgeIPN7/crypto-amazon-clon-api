import { FindUserByIdUseCase } from '../../../application/use-cases/find-user-by-id.use-case';
import { InvalidUserIdError, UserNotFoundError } from '../../../domain/errors/user.errors';
import type { User } from '../../../domain/entities/user.entity';
import { UserId } from '../../../domain/value-objects/user-id.vo';
import { InMemoryUserRepository } from '../../helpers/in-memory-user.repository';
import { buildUserWithEmail } from '../../helpers/user.factory';

describe('FindUserByIdUseCase', () => {
  describe('execute()', () => {
    it('debería devolver el usuario cuando existe', async () => {
      // Arrange
      const user = buildUserWithEmail('found@example.com');
      const useCase = buildUseCase([user]);

      // Act
      const found = await useCase.execute({ userId: user.id.value });

      // Assert
      expect(found.email.value).toBe('found@example.com');
    });

    it('debería lanzar UserNotFoundError cuando no existe', async () => {
      // Arrange
      const useCase = buildUseCase();
      const unknownId = UserId.generate().value;

      // Act + Assert
      await expect(useCase.execute({ userId: unknownId })).rejects.toThrow(UserNotFoundError);
    });

    // El value object valida antes de tocar el repositorio: un id mal formado es un error
    // de dominio que el filtro traduce a 400, no un "no encontrado" (404).
    it('debería rechazar un id con formato inválido antes de consultar', async () => {
      // Arrange
      const useCase = buildUseCase();

      // Act + Assert
      await expect(useCase.execute({ userId: 'not-a-uuid' })).rejects.toThrow(InvalidUserIdError);
    });
  });
});

// Helpers

const buildUseCase = (seed: User[] = []): FindUserByIdUseCase =>
  new FindUserByIdUseCase(new InMemoryUserRepository(seed));
