import fc from 'fast-check';

import { SnakeNamingStrategy, toSnakeCase } from '../snake-naming.strategy';

describe('toSnakeCase', () => {
  describe('las formas que aparecen de verdad en las ORM entities del repo', () => {
    it.each([
      ['createdAt', 'created_at'],
      ['updatedAt', 'updated_at'],
      ['createdBy', 'created_by'],
      ['passwordHash', 'password_hash'],
      ['userId', 'user_id'],
      ['amountCents', 'amount_cents'],
      ['placedAt', 'placed_at'],
      ['processedAt', 'processed_at'],
      ['id', 'id'],
      ['email', 'email'],
    ])('debería convertir %s en %s', (input, expected) => {
      // Arrange & Act
      const result = toSnakeCase(input);

      // Assert
      expect(result).toBe(expected);
    });
  });

  describe('las formas que todavía no aparecen pero aparecerán', () => {
    it('debería separar un acrónimo de la palabra que le sigue', () => {
      // Arrange & Act
      // La regla ingenua (`/([a-z])([A-Z])/`) daría `httpstatus_code`: no hay minúscula antes
      // de la `S`. Sin la segunda pasada, cualquier propiedad con siglas nacería mal.
      const result = toSnakeCase('HTTPStatusCode');

      // Assert
      expect(result).toBe('http_status_code');
    });

    it('debería no partir un dígito de la letra que lo precede', () => {
      // Arrange & Act
      // `auth0Id` es el caso real de `bridge-fital-pti-api`: si el dígito se separase, la
      // columna nacería `auth_0_id` y no coincidiría con ninguna tabla existente.
      const result = toSnakeCase('auth0Id');

      // Assert
      expect(result).toBe('auth0_id');
    });

    it('debería dejar intacto lo que ya está en snake_case', () => {
      // Arrange & Act
      const result = toSnakeCase('user_id');

      // Assert
      expect(result).toBe('user_id');
    });
  });

  describe('propiedades', () => {
    it('debería ser idempotente: aplicarla dos veces da lo mismo que una', () => {
      // Arrange
      const identifierArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,20}$/);

      // Act & Assert
      // Es la garantía que hace seguro dejar `name:` explícitos en el árbol mientras se migra:
      // una columna ya escrita en snake pasa por la estrategia sin cambiar.
      fc.assert(
        fc.property(identifierArb, (name) => toSnakeCase(toSnakeCase(name)) === toSnakeCase(name)),
      );
    });

    it('debería no producir nunca dos guiones bajos seguidos ni empezar por uno', () => {
      // Arrange
      const identifierArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,20}$/);

      // Act & Assert
      fc.assert(
        fc.property(identifierArb, (name) => {
          const result = toSnakeCase(name);
          return !result.includes('__') && !result.startsWith('_');
        }),
      );
    });
  });
});

describe('SnakeNamingStrategy', () => {
  const strategy = new SnakeNamingStrategy();

  describe('columnName()', () => {
    it('debería derivar el nombre de la propiedad cuando no hay uno explícito', () => {
      // Arrange & Act
      const name = strategy.columnName('createdAt', undefined, []);

      // Assert
      expect(name).toBe('created_at');
    });

    it('debería respetar un name explícito tal cual, sin convertirlo', () => {
      // Arrange & Act
      const name = strategy.columnName('createdAt', 'created_at', []);

      // Assert
      // Es lo que permite que la adopción sea gradual: los `name:` que quedan en el árbol
      // siguen mandando, y quitarlos no cambia el resultado.
      expect(name).toBe('created_at');
    });

    it('debería no tocar un name explícito que NO esté en snake_case', () => {
      // Arrange & Act
      const name = strategy.columnName('whatever', 'LegacyColumn', []);

      // Assert
      // Una columna heredada con nombre raro debe poder nombrarse tal cual. Si la estrategia
      // la convirtiera, `name:` dejaría de ser un escape y sería solo una sugerencia.
      expect(name).toBe('LegacyColumn');
    });

    it('debería anteponer los prefijos de un embebido, también en snake_case', () => {
      // Arrange & Act
      const name = strategy.columnName('city', undefined, ['homeAddress']);

      // Assert
      // No hay embebidos en el repo hoy. El caso existe porque el comportamiento por defecto
      // de TypeORM concatena en camelCase (`homeAddressCity`), que rompería la convención en
      // cuanto alguien use `@Column(() => Address)`.
      expect(name).toBe('home_address_city');
    });
  });

  describe('tableName()', () => {
    it('debería respetar el nombre explícito de la tabla', () => {
      // Arrange & Act
      const name = strategy.tableName('UserOrmEntity', 'users');

      // Assert
      // Las cuatro entidades del repo lo declaran así, y deben seguir mandando.
      expect(name).toBe('users');
    });

    it('debería derivar en snake_case cuando la entidad no declara nombre', () => {
      // Arrange & Act
      const name = strategy.tableName('UserOrmEntity', undefined);

      // Assert
      // ⚠️ Sale `user_orm_entity`, con el sufijo incluido: la estrategia no sabe que
      // `OrmEntity` es decoración nuestra. Se fija aquí para que quede escrito que el
      // `@Entity({ name })` explícito NO es opcional en este repo.
      expect(name).toBe('user_orm_entity');
    });
  });
});
