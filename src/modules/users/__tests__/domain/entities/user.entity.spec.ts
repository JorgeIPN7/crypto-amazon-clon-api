import { fc, test as fcTest } from '@fast-check/jest';

import { Email } from '../../../domain/value-objects/email.vo';
import { InvalidUserNameError } from '../../../domain/errors/user.errors';
import { User } from '../../../domain/entities/user.entity';
import { UserId } from '../../../domain/value-objects/user-id.vo';

const NOW = new Date('2026-07-27T10:00:00.000Z');
const LATER = new Date('2026-07-27T11:00:00.000Z');

describe('User', () => {
  describe('create()', () => {
    it('debería nacer activo con las marcas de tiempo iguales', () => {
      // Act
      const user = buildUser();

      // Assert
      expect(user.active).toBe(true);
      expect(user.createdAt).toEqual(NOW);
      expect(user.updatedAt).toEqual(NOW);
    });

    it('debería recortar los espacios del nombre', () => {
      // Act
      const user = buildUser({ name: '  María González  ' });

      // Assert
      expect(user.name).toBe('María González');
    });

    it.each([
      ['demasiado corto', 'A'],
      ['solo espacios', '   '],
      ['vacío', ''],
    ])('debería rechazar un nombre %s', (_caso, name) => {
      // Act + Assert
      expect(() => buildUser({ name })).toThrow(InvalidUserNameError);
    });

    it('debería rechazar un nombre de más de 120 caracteres', () => {
      // Act + Assert
      expect(() => buildUser({ name: 'a'.repeat(121) })).toThrow(InvalidUserNameError);
    });

    // Los límites exactos: la suite probaba 1 y 121, nunca 2 ni 120. Un `<`/`<=` invertido
    // en `assertName` pasaba inadvertido, y 120 es además el ancho de `varchar(120)`.
    it.each([2, 120])('debería aceptar un nombre de exactamente %i caracteres', (length) => {
      // Act
      const user = buildUser({ name: 'a'.repeat(length) });

      // Assert
      expect(user.name).toHaveLength(length);
    });

    // El recorte ocurre antes de medir, así que un nombre de 120 con espacios alrededor
    // es válido aunque la cadena cruda tenga 124.
    it('debería medir la longitud después de recortar, no antes', () => {
      // Arrange
      const padded = `  ${'a'.repeat(120)}  `;

      // Act
      const user = buildUser({ name: padded });

      // Assert
      expect(padded).toHaveLength(124);
      expect(user.name).toHaveLength(120);
    });

    it('debería crear usuarios siempre con rol user', () => {
      // Arrange + Act
      const user = buildUser();

      // Assert
      expect(user.role).toBe('user');
    });

    it('debería no llevar credencial: el perfil no conoce el password', () => {
      // Arrange + Act
      const user = buildUser();

      // Assert
      expect(user).not.toHaveProperty('passwordHash');
    });
  });

  describe('rename()', () => {
    it('debería cambiar el nombre y mover updatedAt', () => {
      // Arrange
      const user = buildUser();

      // Act
      user.rename('Nuevo Nombre', LATER);

      // Assert
      expect(user.name).toBe('Nuevo Nombre');
      expect(user.updatedAt).toEqual(LATER);
      expect(user.createdAt).toEqual(NOW);
    });

    it('debería rechazar un nombre inválido sin alterar el estado', () => {
      // Arrange
      const user = buildUser({ name: 'Nombre Original' });

      // Act + Assert
      expect(() => user.rename('x', LATER)).toThrow(InvalidUserNameError);
      expect(user.name).toBe('Nombre Original');
      expect(user.updatedAt).toEqual(NOW);
    });
  });

  describe('changeEmail()', () => {
    it('debería actualizar el email y mover updatedAt', () => {
      // Arrange
      const user = buildUser();

      // Act
      user.changeEmail(Email.from('nuevo@example.com'), LATER);

      // Assert
      expect(user.email.value).toBe('nuevo@example.com');
      expect(user.updatedAt).toEqual(LATER);
    });

    it('debería ser idempotente cuando el email no cambia', () => {
      // Arrange
      const user = buildUser({ email: 'same@example.com' });

      // Act
      user.changeEmail(Email.from('SAME@example.com'), LATER);

      // Assert
      expect(user.updatedAt).toEqual(NOW);
    });
  });

  describe('deactivate()', () => {
    it('debería desactivar al usuario y mover updatedAt', () => {
      // Arrange
      const user = buildUser();

      // Act
      user.deactivate(LATER);

      // Assert
      expect(user.active).toBe(false);
      expect(user.updatedAt).toEqual(LATER);
    });

    it('debería ser idempotente si ya está inactivo', () => {
      // Arrange
      const user = buildUser();
      user.deactivate(LATER);
      const afterFirst = user.updatedAt;

      // Act
      user.deactivate(new Date('2026-07-27T12:00:00.000Z'));

      // Assert
      expect(user.updatedAt).toEqual(afterFirst);
    });
  });

  describe('activate()', () => {
    it('debería reactivar a un usuario desactivado', () => {
      // Arrange
      const user = buildUser();
      user.deactivate(LATER);

      // Act
      user.activate(new Date('2026-07-27T12:00:00.000Z'));

      // Assert
      expect(user.active).toBe(true);
    });

    it('debería ser idempotente si ya está activo', () => {
      // Arrange
      const user = buildUser();

      // Act
      user.activate(LATER);

      // Assert
      expect(user.updatedAt).toEqual(NOW);
    });
  });

  describe('promoteToAdmin()', () => {
    it('debería promover a admin y tocar updatedAt', () => {
      // Arrange
      const user = buildUser();
      const later = new Date('2026-08-05T12:00:00Z');

      // Act
      user.promoteToAdmin(later);

      // Assert
      expect(user.role).toBe('admin');
      expect(user.toSnapshot().updatedAt).toEqual(later);
    });

    it('debería ser idempotente la promoción repetida', () => {
      // Arrange
      const user = buildUser();
      const first = new Date('2026-08-05T12:00:00Z');
      const second = new Date('2026-08-05T13:00:00Z');
      user.promoteToAdmin(first);

      // Act
      user.promoteToAdmin(second);

      // Assert
      expect(user.role).toBe('admin');
      expect(user.toSnapshot().updatedAt).toEqual(first);
    });
  });

  describe('toSnapshot()', () => {
    it('debería exponer valores primitivos en lugar de value objects', () => {
      // Arrange
      const user = buildUser({ email: 'snap@example.com', name: 'Snapshot User' });

      // Act
      const snapshot = user.toSnapshot();

      // Assert
      expect(typeof snapshot.id).toBe('string');
      expect(snapshot.email).toBe('snap@example.com');
      expect(snapshot.name).toBe('Snapshot User');
      expect(snapshot.active).toBe(true);
    });

    /**
     * El `it` decía «debería incluir hash y rol en el snapshot». Cambió de texto porque el
     * hash dejó de ser del agregado en el ciclo 4: afirmarlo aquí sería afirmar algo falso.
     * Lo que se conserva —y se refuerza— es la mitad que sigue siendo cierta (el rol) más la
     * negativa que el ciclo introduce.
     */
    it('debería incluir el rol y ningún rastro de credencial en el snapshot', () => {
      // Arrange + Act
      const snapshot = buildUser().toSnapshot();

      // Assert
      expect(snapshot.role).toBe('user');
      expect(snapshot).not.toHaveProperty('passwordHash');
    });
  });

  describe('rehydrate()', () => {
    it('debería reconstruir el agregado sin aplicar las reglas de creación', () => {
      // Arrange: un nombre que `create()` rechazaría por ser demasiado corto.
      const params = {
        id: UserId.generate(),
        email: Email.from('legacy@example.com'),
        name: 'A',
        role: 'user' as const,
        active: false,
        createdAt: NOW,
        updatedAt: LATER,
      };

      // Act
      const user = User.rehydrate(params);

      // Assert
      expect(user.name).toBe('A');
      expect(user.active).toBe(false);
    });
  });

  describe('create() (property-based)', () => {
    // La regla completa, en una sola aserción: se acepta exactamente cuando la longitud
    // del nombre recortado cae en [2, 120]. `fc.string()` mete marcas combinantes, RTL,
    // surrogates sueltos y espacios unicode, que ninguna batería de ejemplos alcanzaría.
    it('debería aceptar un nombre si y solo si su longitud recortada está en [2, 120]', () => {
      fc.assert(
        fc.property(fc.string({ maxLength: 200 }), (raw) => {
          // Arrange
          const trimmed = raw.trim();
          const fits = trimmed.length >= 2 && trimmed.length <= 120;

          // Act + Assert
          if (fits) {
            expect(buildUser({ name: raw }).name).toBe(trimmed);
          } else {
            expect(() => buildUser({ name: raw })).toThrow(InvalidUserNameError);
          }
        }),
      );
    });
  });

  // Decisión explícita, porque el código la toma en silencio: `assertName` mide con
  // `String.prototype.length`, es decir en unidades de código UTF-16. Un emoji compuesto
  // como '👨‍👩‍👧' cuenta 8 y no 1.
  //
  // Se deja así a propósito. Postgres cuenta `varchar(120)` en puntos de código, que
  // siempre son ≤ unidades UTF-16, de modo que todo lo que el dominio acepta cabe en la
  // columna. La regla es más restrictiva que la base, nunca al revés — que es el lado
  // seguro del error.
  describe('create() con nombres unicode', () => {
    it('debería contar los emoji compuestos por unidades UTF-16, no por grafemas', () => {
      // Arrange
      const family = '👨‍👩‍👧';

      // Act
      const user = buildUser({ name: family });

      // Assert
      expect(family).toHaveLength(8);
      expect(user.name).toBe(family);
    });

    it('debería rechazar un nombre de un solo grafema que ocupa una sola unidad', () => {
      // Act + Assert
      expect(() => buildUser({ name: 'á' })).toThrow(InvalidUserNameError);
    });
  });

  describe('round-trip (property-based)', () => {
    // El `it` decía «conservar hash y rol»; conserva solo el rol desde el ciclo 4, porque
    // el hash ya no viaja en el snapshot.
    fcTest.prop([userArbitrary()])(
      'debería conservar el rol en el round-trip snapshot→rehydrate',
      (user) => {
        // Arrange + Act
        const revived = User.rehydrate({
          ...user.toSnapshot(),
          id: UserId.from(user.id.value),
          email: Email.from(user.toSnapshot().email),
        });

        // Assert
        expect(revived.toSnapshot()).toEqual(user.toSnapshot());
      },
    );
  });
});

// Helpers

const buildUser = (overrides: { email?: string; name?: string } = {}): User =>
  User.create({
    id: UserId.generate(),
    email: Email.from(overrides.email ?? 'maria@example.com'),
    name: overrides.name ?? 'María González',
    now: NOW,
  });

/** Arbitrario CONSTRUIDO (no filtrado): roles y promociones desde constantes. */
function userArbitrary() {
  return fc
    .record({ name: fc.constantFrom('Ana López', 'Juan Pérez', 'Eva Ruiz'), promote: fc.boolean() })
    .map(({ name, promote }) => {
      const user = buildUser({ email: 'arb@example.com', name });
      if (promote) {
        user.promoteToAdmin(LATER);
      }
      return user;
    });
}
