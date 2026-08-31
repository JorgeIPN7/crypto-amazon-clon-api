import fc from 'fast-check';

import { InvalidWalletIdError } from '../../../domain/errors/wallet.errors';
import { TransferId } from '../../../domain/value-objects/transfer-id.vo';
import { WalletId } from '../../../domain/value-objects/wallet-id.vo';
import { captureError } from '../../helpers/capture-error';

describe('WalletId', () => {
  describe('generate()', () => {
    // La aserción va contra la RFC 4122 y no contra `WalletId.from()`, que validaría con la MISMA
    // `UUID_V4` que habría que suponer correcta. El fallo que evita no es el que se escribió aquí
    // primero —«si `generate()` acuñara un v1 seguiría en verde» es FALSO, medido:
    // `UUID_V4.test('3f2504e0-4f89-11d3-9a0c-0305e82c3301')` da `false` porque la regex exige el
    // dígito de versión— sino el mutante que RELAJA esa regex: movería a la vez `from()` y la
    // comprobación, y el par quedaría consistente entre sí y mal contra la especificación.
    // La versión vive en el dígito 15 y la variante en el 20.
    it('debería producir un UUID de versión 4 y variante RFC 4122', () => {
      // Act
      const value = WalletId.generate().value;

      // Assert
      expect(value).toHaveLength(36);
      expect(value[14]).toBe('4');
      expect('89ab').toContain(value[19]);
    });

    it('debería producir un identificador distinto en cada llamada', () => {
      // Act
      const first = WalletId.generate();
      const second = WalletId.generate();

      // Assert
      expect(first.value).not.toBe(second.value);
    });
  });

  describe('from()', () => {
    it('debería aceptar un UUID v4 bien formado y conservarlo', () => {
      // Arrange
      const value = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

      // Act
      const id = WalletId.from(value);

      // Assert
      expect(id.value).toBe(value);
    });

    it('debería rechazar un UUID de versión 1 con el error y el mensaje exactos', () => {
      // Arrange
      const value = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

      // Act
      const error = captureError(() => WalletId.from(value));

      // Assert
      expect(error).toBeInstanceOf(InvalidWalletIdError);
      expect(error.message).toBe(`"${value}" is not a valid wallet id`);
      expect((error as InvalidWalletIdError).value).toBe(value);
    });
  });

  describe('equals()', () => {
    // `ValueObject.equals` compara también la clase, así que dos ids de agregados distintos con
    // el mismo UUID no son iguales. Es la razón por la que `TransferId` es una clase aparte.
    // ⚠️ Lo que esto NO hace es impedir que un `TransferId` se PASE donde se espera un
    // `WalletId`: TypeScript es estructural y las dos clases publican la misma forma
    // (`value: string`), así que el compilador no se queja. La separación es de tiempo de
    // ejecución y solo alcanza a la igualdad, que es lo que este caso fija.
    it('debería distinguir un WalletId de un TransferId con el mismo UUID', () => {
      // Arrange
      const value = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

      // Act
      const result = WalletId.from(value).equals(TransferId.from(value));

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('from() (property-based)', () => {
    // El arbitrario de UUID v4 lo genera fast-check según la especificación, no según la regex
    // del código: es una fuente de verdad independiente de la implementación.
    it('debería aceptar cualquier UUID v4 bien formado', () => {
      fc.assert(
        fc.property(fc.uuid({ version: 4 }), (value) => {
          // Act
          const id = WalletId.from(value);

          // Assert
          expect(id.value).toBe(value);
        }),
      );
    });

    // Solo «no lanza», y no «devuelve el UUID en minúsculas»: `UuidId.assertUuid` valida con una
    // regex marcada `/i` y devuelve el valor TAL CUAL. Medido, no supuesto —
    // `WalletId.from('7C9E6679-7425-40DE-944B-E07FC1F90AE7').value` devuelve esa misma cadena en
    // mayúsculas—, así que afirmar aquí una normalización pondría el test en rojo contra un
    // comportamiento correcto.
    it('debería aceptar indistintamente mayúsculas y minúsculas', () => {
      fc.assert(
        fc.property(fc.uuid({ version: 4 }), (value) => {
          // Act + Assert
          expect(() => WalletId.from(value.toUpperCase())).not.toThrow();
        }),
      );
    });
  });
});
