import fc from 'fast-check';

import { InvalidUserIdError } from '../../../domain/errors/user.errors';
import { UserId } from '../../../domain/value-objects/user-id.vo';

describe('UserId', () => {
  describe('generate()', () => {
    // La aserción va contra la especificación del UUID v4, no contra `UserId.from()`:
    // comprobarlo con la misma regex que usa `from()` es probar la regex contra sí misma,
    // así que si aceptara un v1 el test seguiría en verde. La versión vive en el dígito 15
    // y la variante en el 17, según RFC 4122.
    it('debería producir un UUID de versión 4 y variante RFC 4122', () => {
      // Act
      const value = UserId.generate().value;

      // Assert
      expect(value).toHaveLength(36);
      expect(value[14]).toBe('4');
      expect('89ab').toContain(value[19]);
    });

    it('debería producir un identificador distinto en cada llamada', () => {
      // Act
      const first = UserId.generate();
      const second = UserId.generate();

      // Assert
      expect(first.value).not.toBe(second.value);
    });
  });

  describe('from()', () => {
    it('debería aceptar un UUID v4 bien formado', () => {
      // Arrange
      const value = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

      // Act
      const id = UserId.from(value);

      // Assert
      expect(id.value).toBe(value);
    });

    it.each([
      ['cadena vacía', ''],
      ['texto libre', 'not-a-uuid'],
      ['UUID truncado', '3f2504e0-4f89-41d3-9a0c'],
      ['UUID v1', '3f2504e0-4f89-11d3-9a0c-0305e82c3301'],
    ])('debería rechazar %s', (_caso, value) => {
      // Act + Assert
      expect(() => UserId.from(value)).toThrow(InvalidUserIdError);
    });
  });

  describe('equals()', () => {
    it('debería considerar iguales dos ids con el mismo valor', () => {
      // Arrange
      const value = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

      // Act
      const result = UserId.from(value).equals(UserId.from(value));

      // Assert
      expect(result).toBe(true);
    });

    it('debería distinguir ids generados por separado', () => {
      // Act
      const result = UserId.generate().equals(UserId.generate());

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('from() (property-based)', () => {
    // El arbitrario de UUID v4 lo genera fast-check según la especificación, no según la
    // regex del código: es una fuente de verdad independiente de la implementación.
    it('debería aceptar cualquier UUID v4 bien formado', () => {
      fc.assert(
        fc.property(fc.uuid({ version: 4 }), (value) => {
          // Act
          const id = UserId.from(value);

          // Assert
          expect(id.value).toBe(value);
        }),
      );
    });

    it('debería aceptar indistintamente mayúsculas y minúsculas', () => {
      fc.assert(
        fc.property(fc.uuid({ version: 4 }), (value) => {
          // Act + Assert
          expect(() => UserId.from(value.toUpperCase())).not.toThrow();
        }),
      );
    });

    it('debería rechazar cualquier cadena que no tenga la forma de un UUID', () => {
      fc.assert(
        fc.property(
          fc.string().filter((value) => !/^[0-9a-f-]{36}$/i.test(value)),
          (value) => {
            // Act + Assert
            expect(() => UserId.from(value)).toThrow(InvalidUserIdError);
          },
        ),
      );
    });
  });
});
