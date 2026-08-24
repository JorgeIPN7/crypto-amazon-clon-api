import fc from 'fast-check';

import { CredentialId } from '../../../domain/value-objects/credential-id.vo';
import { InvalidCredentialIdError } from '../../../domain/errors/auth.errors';

describe('CredentialId', () => {
  describe('generate()', () => {
    // La aserción va contra la especificación del UUID v4, no contra `from()`: comprobarlo
    // con la misma regex que usa el kernel sería probar la regex contra sí misma.
    it('debería producir un UUID de versión 4 y variante RFC 4122', () => {
      // Arrange + Act
      const id = CredentialId.generate();

      // Assert
      expect(id.value[14]).toBe('4');
      expect('89ab').toContain(id.value[19]);
    });

    it('debería producir un identificador distinto en cada llamada', () => {
      // Arrange + Act
      const one = CredentialId.generate();
      const another = CredentialId.generate();

      // Assert
      expect(one.value).not.toBe(another.value);
    });
  });

  describe('from()', () => {
    it('debería aceptar un UUID v4 bien formado', () => {
      // Arrange
      const value = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

      // Act
      const id = CredentialId.from(value);

      // Assert
      expect(id.value).toBe(value);
    });

    it('debería rechazar una cadena que no es un UUID', () => {
      // Arrange
      const value = 'no-soy-uuid';

      // Act + Assert
      expect(() => CredentialId.from(value)).toThrow(InvalidCredentialIdError);
    });
  });

  describe('from() (property-based)', () => {
    it('debería aceptar cualquier UUID v4 bien formado', () => {
      fc.assert(
        fc.property(fc.uuid({ version: 4 }), (value) => {
          // Act
          const id = CredentialId.from(value);

          // Assert
          expect(id.value).toBe(value);
        }),
      );
    });
  });
});
