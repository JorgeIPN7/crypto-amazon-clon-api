import fc from 'fast-check';

import { Email } from '../../../domain/value-objects/email.vo';
import { InvalidEmailError } from '../../../domain/errors/user.errors';
import { emailArb } from '../../helpers/arbitraries';

describe('Email', () => {
  describe('from()', () => {
    it('debería aceptar una dirección válida', () => {
      // Act
      const email = Email.from('maria.gonzalez@empresa.com.mx');

      // Assert
      expect(email.value).toBe('maria.gonzalez@empresa.com.mx');
    });

    it('debería normalizar a minúsculas', () => {
      // Act
      const email = Email.from('Maria.Gonzalez@Empresa.COM');

      // Assert
      expect(email.value).toBe('maria.gonzalez@empresa.com');
    });

    it('debería recortar los espacios de los extremos', () => {
      // Act
      const email = Email.from('  user@example.com  ');

      // Assert
      expect(email.value).toBe('user@example.com');
    });

    it('debería aceptar el signo + usado para alias', () => {
      // Act
      const email = Email.from('jgarcia+test@empresa.com.mx');

      // Assert
      expect(email.value).toBe('jgarcia+test@empresa.com.mx');
    });

    it.each([
      ['sin arroba', 'noarroba.com'],
      ['sin dominio', 'user@'],
      ['sin tld', 'user@localhost'],
      ['sin parte local', '@example.com'],
      ['con espacios internos', 'user name@example.com'],
      ['vacío', ''],
    ])('debería rechazar un email %s', (_caso, value) => {
      // Act + Assert
      expect(() => Email.from(value)).toThrow(InvalidEmailError);
    });

    it('debería rechazar una dirección que supera los 254 caracteres', () => {
      // Arrange
      const tooLong = `${'a'.repeat(250)}@example.com`;

      // Act + Assert
      expect(() => Email.from(tooLong)).toThrow(InvalidEmailError);
    });

    // El límite exacto: la suite solo probaba 262 caracteres, así que un off-by-one en la
    // comparación (`>=` en vez de `>`) habría pasado desapercibido. 254 es además el ancho
    // de la columna `varchar(254)`, de modo que aceptar uno más rompería en la base.
    it('debería aceptar una dirección de exactamente 254 caracteres', () => {
      // Arrange
      const exact = `${'a'.repeat(242)}@example.com`;

      // Act
      const email = Email.from(exact);

      // Assert
      expect(email.value).toHaveLength(254);
    });

    it('debería rechazar una dirección de 255 caracteres', () => {
      // Arrange
      const oneTooMany = `${'a'.repeat(243)}@example.com`;

      // Act + Assert
      expect(oneTooMany).toHaveLength(255);
      expect(() => Email.from(oneTooMany)).toThrow(InvalidEmailError);
    });
  });

  describe('equals()', () => {
    it('debería considerar iguales dos emails que solo difieren en mayúsculas', () => {
      // Arrange
      const one = Email.from('user@example.com');
      const other = Email.from('USER@EXAMPLE.COM');

      // Act
      const result = one.equals(other);

      // Assert
      expect(result).toBe(true);
    });

    it('debería distinguir emails diferentes', () => {
      // Arrange
      const one = Email.from('a@example.com');
      const other = Email.from('b@example.com');

      // Act
      const result = one.equals(other);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('from() (property-based)', () => {
    // La normalización tiene que ser idempotente: si no lo fuera, un email releído de la
    // base no coincidiría consigo mismo y el índice único dejaría de proteger nada.
    it('debería ser idempotente al normalizar', () => {
      fc.assert(
        fc.property(emailArb, (raw) => {
          // Act
          const once = Email.from(raw).value;
          const twice = Email.from(once).value;

          // Assert
          expect(twice).toBe(once);
        }),
      );
    });

    // Es la invariante de la que depende la detección de duplicados en `CreateUserUseCase`.
    it('debería considerar iguales dos emails que solo difieren en mayúsculas', () => {
      fc.assert(
        fc.property(emailArb, (raw) => {
          // Act
          const result = Email.from(raw).equals(Email.from(raw.toUpperCase()));

          // Assert
          expect(result).toBe(true);
        }),
      );
    });

    it('debería ignorar los espacios de los extremos sea cual sea la dirección', () => {
      fc.assert(
        fc.property(emailArb, fc.stringMatching(/^[ \t]{0,4}$/), (raw, padding) => {
          // Act
          const padded = Email.from(`${padding}${raw}${padding}`);

          // Assert
          expect(padded.value).toBe(Email.from(raw).value);
        }),
      );
    });
  });
});
