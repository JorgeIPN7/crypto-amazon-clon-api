import { DeactivateUserUseCase } from '../../../application/use-cases/deactivate-user.use-case';
import { UserNotFoundError } from '../../../domain/errors/user.errors';
import type { User } from '../../../domain/entities/user.entity';
import { UserId } from '../../../domain/value-objects/user-id.vo';
import { InMemoryUserRepository } from '../../helpers/in-memory-user.repository';
import { buildUserWithEmail } from '../../helpers/user.factory';

/**
 * Muta estado pese a lo discreto del nombre: antes vivía dentro de un archivo llamado
 * `query-handlers.spec.ts`, lo que lo hacía pasar por una consulta.
 */
/** Actor de la desactivación: el `sub` del admin que llama a `DELETE /users/:id`. */
const ADMIN_ID = '5b7c2d4e-9a1f-4c3b-8e6d-0f2a4b6c8d1e';

describe('DeactivateUserUseCase', () => {
  describe('execute()', () => {
    it('debería desactivar al usuario y persistir el cambio', async () => {
      // Arrange
      const user = buildUserWithEmail('active@example.com');
      const { useCase, repository } = buildUseCase([user]);

      // Act
      const result = await useCase.execute({ userId: user.id.value, by: ADMIN_ID });

      // Assert
      expect(result.active).toBe(false);
      const reloaded = await repository.findById(user.id);
      expect(reloaded?.active).toBe(false);
    });

    // El actor no es decorado: `by` viaja SIN transformarse hasta `updatedBy`, y `userId` —a
    // quién se desactiva— no lo pisa. Es lo que se rompe si alguien escribe `input.userId`
    // donde va `input.by`, que es la confusión natural con dos ids en la misma entrada.
    it('debería anotar en updatedBy al actor recibido, no al usuario desactivado', async () => {
      // Arrange
      const user = buildUserWithEmail('auditado@example.com');
      const { useCase } = buildUseCase([user]);

      // Act
      const result = await useCase.execute({ userId: user.id.value, by: ADMIN_ID });

      // Assert
      expect(result.updatedBy).toBe(ADMIN_ID);
      expect(result.updatedBy).not.toBe(user.id.value);
    });

    it('debería aceptar null como actor: es el sistema, no un hueco', async () => {
      // Arrange
      const user = buildUserWithEmail('sistema@example.com');
      const { useCase } = buildUseCase([user]);

      // Act
      const result = await useCase.execute({ userId: user.id.value, by: null });

      // Assert
      expect(result.updatedBy).toBeNull();
    });

    it('debería lanzar UserNotFoundError cuando el usuario no existe', async () => {
      // Arrange
      const { useCase } = buildUseCase();

      // Act + Assert
      await expect(
        useCase.execute({ userId: UserId.generate().value, by: ADMIN_ID }),
      ).rejects.toThrow(UserNotFoundError);
    });

    // La entidad corta en seco si ya está inactiva, así que ni siquiera toca `updatedAt`.
    it('debería ser idempotente sobre un usuario ya inactivo', async () => {
      // Arrange
      const user = buildUserWithEmail('inactive@example.com');
      const { useCase } = buildUseCase([user]);
      const first = await useCase.execute({ userId: user.id.value, by: ADMIN_ID });
      const firstUpdatedAt = first.updatedAt;

      // Act
      const result = await useCase.execute({ userId: user.id.value, by: null });

      // Assert
      expect(result.active).toBe(false);
      expect(result.updatedAt).toEqual(firstUpdatedAt);
      // Tampoco se borra el actor de la primera desactivación, que es la que ocurrió.
      expect(result.updatedBy).toBe(ADMIN_ID);
    });

    // Desactivar no es borrar: la fila debe seguir ahí para conservar el histórico.
    it('debería conservar al usuario en el repositorio', async () => {
      // Arrange
      const user = buildUserWithEmail('conservado@example.com');
      const { useCase, repository } = buildUseCase([user]);

      // Act
      await useCase.execute({ userId: user.id.value, by: ADMIN_ID });

      // Assert
      expect(repository.size()).toBe(1);
    });
  });
});

// Helpers

const buildUseCase = (seed: User[] = []) => {
  const repository = new InMemoryUserRepository(seed);
  return { useCase: new DeactivateUserUseCase(repository), repository };
};
