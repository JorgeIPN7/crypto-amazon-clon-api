import fc from 'fast-check';

import { InvalidTransferIdError } from '../../../domain/errors/wallet.errors';
import { TransferId } from '../../../domain/value-objects/transfer-id.vo';
import { captureError } from '../../helpers/capture-error';

describe('TransferId', () => {
  describe('generate()', () => {
    // Misma aserción que en `wallet-id.vo.spec.ts` y por la misma razón: se comprueba contra la
    // RFC 4122 —dígito 15 la versión, dígito 20 la variante—, nunca contra la regex de `from()`.
    it('debería producir un UUID de versión 4 y variante RFC 4122', () => {
      // Act
      const value = TransferId.generate().value;

      // Assert
      expect(value).toHaveLength(36);
      expect(value[14]).toBe('4');
      expect('89ab').toContain(value[19]);
    });

    it('debería producir un identificador distinto en cada llamada', () => {
      // Act
      const first = TransferId.generate();
      const second = TransferId.generate();

      // Assert
      expect(first.value).not.toBe(second.value);
    });
  });

  describe('from()', () => {
    it('debería aceptar un UUID v4 bien formado y conservarlo', () => {
      // Arrange
      const value = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

      // Act
      const id = TransferId.from(value);

      // Assert
      expect(id.value).toBe(value);
    });

    it('debería rechazar una cadena vacía con el error y el mensaje exactos', () => {
      // Act
      const error = captureError(() => TransferId.from(''));

      // Assert
      expect(error).toBeInstanceOf(InvalidTransferIdError);
      expect(error.message).toBe('"" is not a valid transfer id');
      expect((error as InvalidTransferIdError).value).toBe('');
    });
  });

  describe('from() (property-based)', () => {
    it('debería aceptar cualquier UUID v4 bien formado', () => {
      fc.assert(
        fc.property(fc.uuid({ version: 4 }), (value) => {
          // Act
          const id = TransferId.from(value);

          // Assert
          expect(id.value).toBe(value);
        }),
      );
    });
  });
});
