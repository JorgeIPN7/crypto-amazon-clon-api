import { PaginationDto } from '@common/dto/pagination.dto';

import { DeactivateUserUseCase } from '../../../application/use-cases/deactivate-user.use-case';
import { FindUserByIdUseCase } from '../../../application/use-cases/find-user-by-id.use-case';
import { ListUsersUseCase } from '../../../application/use-cases/list-users.use-case';
import type { User } from '../../../domain/entities/user.entity';
import { UsersController } from '../../../infrastructure/http/users.controller';
import { InMemoryUserRepository } from '../../helpers/in-memory-user.repository';
import { buildUserWithEmail } from '../../helpers/user.factory';

/**
 * El controller es un adaptador: traduce transporte a caso de uso y resultado a DTO. Lo
 * que se prueba aquí es solo esa traducción.
 *
 * Los caminos felices de `findOne` y `deactivate` no están: cablear los casos de uso y el
 * repositorio reales para reproducirlos convierte al unitario en un E2E más lento y menos
 * fiel que `users.e2e-spec.ts`, que ya los cubre sobre HTTP de verdad. Queda lo que el E2E
 * no aísla: la forma exacta del DTO y el cálculo de `skip` desde la paginación.
 *
 * El bloque `create()` desapareció con `POST /users` (ciclo 4): el alta se documenta y se
 * prueba ahora en `auth/__tests__/infrastructure/http/auth.controller.spec.ts`.
 */
describe('UsersController', () => {
  describe('list()', () => {
    it('debería calcular el desplazamiento a partir de la paginación', async () => {
      // Arrange
      const { controller } = buildController([
        buildUserWithEmail('a@example.com'),
        buildUserWithEmail('b@example.com'),
        buildUserWithEmail('c@example.com'),
      ]);

      // Act
      const result = await controller.list(buildPaginationOf(2, 2));

      // Assert
      expect(result.items).toHaveLength(1);
      expect(result.meta.totalPages).toBe(2);
    });

    it('debería usar los valores por defecto cuando la paginación viene vacía', async () => {
      // Arrange
      const { controller } = buildController([buildUserWithEmail('a@example.com')]);

      // Act
      const result = await controller.list(buildPagination());

      // Assert
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(20);
    });

    it('debería mapear cada elemento de la página a su DTO', async () => {
      // Arrange
      const { controller } = buildController([buildUserWithEmail('mapeado@example.com')]);

      // Act
      const result = await controller.list(buildPagination());

      // Assert
      expect(result.items[0]?.email).toBe('mapeado@example.com');
      expect(result.items[0]).not.toHaveProperty('toSnapshot');
    });

    // Impide que un campo nuevo del agregado se filtre a la respuesta sin decidirlo.
    it('debería exponer solo los campos del DTO, nunca el agregado', async () => {
      // Arrange
      const { controller } = buildController([buildUserWithEmail('dto@example.com')]);

      // Act
      const result = await controller.list(buildPagination());

      // Assert
      expect(Object.keys(result.items[0] ?? {}).sort()).toEqual([
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

const buildController = (seed: User[] = []) => {
  const repository = new InMemoryUserRepository(seed);
  const controller = new UsersController(
    new FindUserByIdUseCase(repository),
    new ListUsersUseCase(repository),
    new DeactivateUserUseCase(repository),
  );
  return { controller, repository };
};

/** Paginación con los defaults del DTO, tal como llega cuando no hay query string. */
const buildPagination = (): PaginationDto => new PaginationDto();

const buildPaginationOf = (page: number, limit: number): PaginationDto => {
  const dto = new PaginationDto();
  dto.page = page;
  dto.limit = limit;
  return dto;
};
