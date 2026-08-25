import { SYSTEM_ACTORS } from '@shared/domain/system-actor';

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
      // La lista es EXACTA a propósito: un campo nuevo del agregado no entra al snapshot sin
      // que este caso se ponga rojo. `createdBy`/`updatedBy` entraron así, decididos.
      expect(Object.keys(user.toSnapshot()).sort()).toEqual([
        'active',
        'createdAt',
        'createdBy',
        'email',
        'id',
        'name',
        'role',
        'updatedAt',
        'updatedBy',
      ]);
    });

    /**
     * El único camino que llega hasta aquí es `UsersFacadeImpl.createProfile`, y a esa la llama
     * solo `RegisterAccountUseCase` desde `POST /auth/register`, que es `@Public()`: no hay
     * token y no hay `sub`. Lo que SÍ hay es un origen conocido, y desde el 2026-08-25 se
     * nombra: `SYSTEM_ACTORS.PUBLIC_REGISTRATION` en vez del `null` que había antes.
     *
     * ⚠️ Este par de casos es lo que se pone rojo el día que alguien rellene `createdBy` con el
     * id del propio usuario recién creado —la tentación obvia— sin decidirlo. Que la cuenta se
     * creó a sí misma no es una afirmación que la traza pueda hacer.
     */
    it('debería firmar el perfil como alta pública, que es un origen con nombre y no un hueco', async () => {
      // Arrange
      const { useCase } = buildUseCase();

      // Act
      const user = await useCase.execute({ email: 'sistema@example.com', name: 'Ana López' });

      // Assert
      expect(user.createdBy).toBe(SYSTEM_ACTORS.PUBLIC_REGISTRATION);
      expect(user.updatedBy).toBe(SYSTEM_ACTORS.PUBLIC_REGISTRATION);
    });

    it('debería no firmar el perfil con null, que significa «no se sabe quién»', async () => {
      // Arrange
      const { useCase } = buildUseCase();

      // Act
      const user = await useCase.execute({ email: 'sistema@example.com', name: 'Ana López' });

      // Assert
      // Caso aparte y no un `not.toBeNull()` pegado al anterior: lo que se afirma aquí no es el
      // valor concreto sino que `null` DEJÓ de ser la respuesta. Un cambio futuro que renombre
      // el actor rompe el caso de arriba; uno que vuelva a `null` rompe este. Son dos regresiones
      // distintas y merecen dos fallos distintos.
      expect(user.createdBy).not.toBeNull();
    });
  });
});

// Helpers

const buildUseCase = (seed: User[] = []) => {
  const repository = new InMemoryUserRepository(seed);
  return { useCase: new CreateUserUseCase(repository), repository };
};
