import { ListUsersUseCase } from '../../../application/use-cases/list-users.use-case';
import type { User } from '../../../domain/entities/user.entity';
import { InMemoryUserRepository } from '../../helpers/in-memory-user.repository';
import { buildInactiveUser, buildUserWithEmail } from '../../helpers/user.factory';

describe('ListUsersUseCase', () => {
  describe('execute()', () => {
    it('debería devolver la página pedida junto al total', async () => {
      // Arrange
      const useCase = buildUseCase([
        buildUserWithEmail('a@example.com'),
        buildUserWithEmail('b@example.com'),
        buildUserWithEmail('c@example.com'),
      ]);

      // Act
      const page = await useCase.execute({ skip: 0, take: 2 });

      // Assert
      expect(page.items).toHaveLength(2);
      expect(page.total).toBe(3);
    });

    it('debería respetar el desplazamiento', async () => {
      // Arrange
      const useCase = buildUseCase([
        buildUserWithEmail('a@example.com'),
        buildUserWithEmail('b@example.com'),
      ]);

      // Act
      const page = await useCase.execute({ skip: 1, take: 10 });

      // Assert
      expect(page.items).toHaveLength(1);
      expect(page.total).toBe(2);
    });

    // El listado no filtra por estado: `DELETE /users/:id` desactiva sin borrar, y quien
    // consulta necesita ver también a los inactivos para poder reactivarlos.
    it('debería incluir también a los usuarios desactivados', async () => {
      // Arrange
      const useCase = buildUseCase([
        buildUserWithEmail('active@example.com'),
        buildInactiveUser('inactive@example.com'),
      ]);

      // Act
      const page = await useCase.execute({ skip: 0, take: 10 });

      // Assert
      expect(page.total).toBe(2);
    });

    it('debería devolver una página vacía cuando no hay usuarios', async () => {
      // Arrange
      const useCase = buildUseCase();

      // Act
      const page = await useCase.execute({ skip: 0, take: 10 });

      // Assert
      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
    });

    it('debería devolver una página vacía cuando el desplazamiento supera el total', async () => {
      // Arrange
      const useCase = buildUseCase([buildUserWithEmail('a@example.com')]);

      // Act
      const page = await useCase.execute({ skip: 50, take: 10 });

      // Assert
      expect(page.items).toEqual([]);
      expect(page.total).toBe(1);
    });
  });
});

// Helpers

const buildUseCase = (seed: User[] = []): ListUsersUseCase =>
  new ListUsersUseCase(new InMemoryUserRepository(seed));
