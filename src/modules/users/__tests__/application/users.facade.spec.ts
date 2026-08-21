import { UsersFacadeImpl } from '../../application/users.facade';
import { CreateUserUseCase } from '../../application/use-cases/create-user.use-case';
import type { User } from '../../domain/entities/user.entity';
import { UserId } from '../../domain/value-objects/user-id.vo';
import { InMemoryUserRepository } from '../helpers/in-memory-user.repository';
import { buildInactiveUser, buildUser, buildUserWithEmail } from '../helpers/user.factory';

/**
 * Casos acordados — Tabla F (`UsersFacadeImpl`).
 *
 * F1-F4 vienen del ciclo de `orders` (`userExists`). F5-F15 son del ciclo 4 y los definió la
 * IA por autorización expresa del usuario, 1:1 con los `it` de abajo.
 *
 * | #   | Método         | Caso                                     | Esperado                                            |
 * | --- | -------------- | ---------------------------------------- | --------------------------------------------------- |
 * | F1  | userExists     | Usuario existente y activo               | `true`                                              |
 * | F2  | userExists     | Usuario inactivo                         | `false`                                             |
 * | F3  | userExists     | Id inexistente                           | `false`                                             |
 * | F4  | userExists     | Id malformado                            | `false` sin lanzar                                  |
 * | F5  | createProfile  | Email libre                              | `{ ok: true }` con el resumen en primitivos         |
 * | F6  | createProfile  | Email libre en MAYÚSCULAS                | El resumen trae el email normalizado                |
 * | F7  | createProfile  | Email ya registrado                      | `{ ok: false, reason: 'email-taken' }` sin lanzar   |
 * | F8  | createProfile  | Email malformado                         | `{ ok: false, reason: 'invalid-profile' }` + msg    |
 * | F9  | createProfile  | Nombre de solo espacios                  | `{ ok: false, reason: 'invalid-profile' }` + msg    |
 * | F10 | createProfile  | Cualquier alta                           | El resumen NO expone la entidad (solo primitivos)   |
 * | F11 | findByEmail    | Email existente con otro uso de mayúsculas| Devuelve el resumen (normaliza con `Email.from`)   |
 * | F12 | findByEmail    | Email inexistente                        | `null`                                              |
 * | F13 | findByEmail    | Email malformado                         | `null` sin lanzar                                   |
 * | F14 | deleteProfile  | Id existente                             | Borra la fila                                       |
 * | F15 | deleteProfile  | Id inexistente o malformado              | No lanza y no borra nada                            |
 */
describe('UsersFacadeImpl', () => {
  describe('userExists()', () => {
    it('debería devolver true para un usuario existente y activo', async () => {
      // Arrange
      const user = buildUser();
      const { facade } = build([user]);

      // Act
      const result = await facade.userExists(user.id.value);

      // Assert
      expect(result).toBe(true);
    });

    it('debería devolver false para un usuario inactivo', async () => {
      // Arrange
      const user = buildInactiveUser('inactivo@example.com');
      const { facade } = build([user]);

      // Act
      const result = await facade.userExists(user.id.value);

      // Assert
      expect(result).toBe(false);
    });

    it('debería devolver false para un id inexistente', async () => {
      // Arrange
      const { facade } = build();

      // Act
      const result = await facade.userExists(UserId.generate().value);

      // Assert
      expect(result).toBe(false);
    });

    it('debería devolver false ante un id malformado sin lanzar', async () => {
      // Arrange: un `sub` corrupto en un token FIRMADO no es culpa del caller de orders —
      // convertirlo en 500 castigaría al módulo equivocado.
      const { facade } = build();

      // Act
      const result = await facade.userExists('garbage');

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('createProfile()', () => {
    it('debería crear el perfil y devolver su resumen', async () => {
      // Arrange
      const { facade, repository } = build();

      // Act
      const result = await facade.createProfile({
        email: 'maria@example.com',
        name: 'María González',
      });

      // Assert
      expect(result).toMatchObject({
        ok: true,
        user: { email: 'maria@example.com', name: 'María González', role: 'user', active: true },
      });
      expect(repository.size()).toBe(1);
    });

    it('debería devolver el email ya normalizado en el resumen', async () => {
      // Arrange
      const { facade } = build();

      // Act
      const result = await facade.createProfile({
        email: 'Maria@EXAMPLE.com',
        name: 'María González',
      });

      // Assert
      expect(result.ok && result.user.email).toBe('maria@example.com');
    });

    it('debería devolver email-taken sin lanzar cuando el email ya existe', async () => {
      // Arrange
      const { facade } = build([buildUserWithEmail('taken@example.com')]);

      // Act
      const result = await facade.createProfile({
        email: 'taken@example.com',
        name: 'Otro Usuario',
      });

      // Assert
      expect(result).toEqual({ ok: false, reason: 'email-taken' });
    });

    /**
     * El caso que justifica la tercera rama del resultado: `@IsEmail` del DTO acepta cadenas
     * que `Email.from()` rechaza, así que sin ella este camino —hoy un 400— habría pasado a
     * ser un 500 en cuanto el alta se mudó a `auth` (el filtro de users ya no está ahí).
     */
    it('debería devolver invalid-profile con el mensaje del dominio ante un email inválido', async () => {
      // Arrange
      const { facade, repository } = build();

      // Act
      const result = await facade.createProfile({ email: 'sin-arroba', name: 'Nombre Válido' });

      // Assert
      expect(result).toEqual({
        ok: false,
        reason: 'invalid-profile',
        message: '"sin-arroba" is not a valid email address',
      });
      expect(repository.size()).toBe(0);
    });

    it('debería devolver invalid-profile ante un nombre que el dominio rechaza', async () => {
      // Arrange
      const { facade } = build();

      // Act
      const result = await facade.createProfile({ email: 'nombre@example.com', name: '   ' });

      // Assert
      expect(result).toMatchObject({ ok: false, reason: 'invalid-profile' });
    });

    // Impide que el agregado (o cualquier VO suyo) cruce la frontera del contexto.
    it('debería exponer solo primitivos, nunca el agregado', async () => {
      // Arrange
      const { facade } = build();

      // Act
      const result = await facade.createProfile({ email: 'dto@example.com', name: 'Usuario DTO' });

      // Assert
      expect(result.ok).toBe(true);
      const user = result.ok ? result.user : null;
      expect(Object.keys(user ?? {}).sort()).toEqual([
        'active',
        'createdAt',
        'email',
        'id',
        'name',
        'role',
        'updatedAt',
      ]);
      expect(user).not.toHaveProperty('toSnapshot');
      expect(user).not.toHaveProperty('passwordHash');
    });
  });

  describe('findByEmail()', () => {
    it('debería encontrar al usuario normalizando el email con el mismo VO que el alta', async () => {
      // Arrange
      const user = buildUserWithEmail('buscado@example.com');
      const { facade } = build([user]);

      // Act
      const result = await facade.findByEmail('  BUSCADO@Example.COM ');

      // Assert
      expect(result?.id).toBe(user.id.value);
      expect(result?.email).toBe('buscado@example.com');
    });

    it('debería devolver null cuando el email no está registrado', async () => {
      // Arrange
      const { facade } = build();

      // Act
      const result = await facade.findByEmail('nadie@example.com');

      // Assert
      expect(result).toBeNull();
    });

    // Un email malformado no existe: para el login eso es 401 (por el hash dummy), no 400.
    // Un 400 distinguiría «email mal escrito» de «email desconocido» — enumeración.
    it('debería devolver null ante un email malformado sin lanzar', async () => {
      // Arrange
      const { facade } = build();

      // Act
      const result = await facade.findByEmail('sin-arroba');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('deleteProfile()', () => {
    it('debería borrar el perfil existente', async () => {
      // Arrange
      const user = buildUser();
      const { facade, repository } = build([user]);

      // Act
      await facade.deleteProfile(user.id.value);

      // Assert
      expect(repository.size()).toBe(0);
    });

    it.each([
      ['inexistente', '3f2504e0-4f89-41d3-9a0c-0305e82c3301'],
      ['malformado', 'garbage'],
    ])('debería no lanzar ni borrar nada con un id %s', async (_caso, id) => {
      // Arrange
      const { facade, repository } = build([buildUser()]);

      // Act
      await facade.deleteProfile(id);

      // Assert
      expect(repository.size()).toBe(1);
    });
  });
});

// Helpers

const build = (seed: User[] = []) => {
  const repository = new InMemoryUserRepository(seed);
  return { repository, facade: new UsersFacadeImpl(repository, new CreateUserUseCase(repository)) };
};
