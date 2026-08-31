import fc from 'fast-check';

import { InvalidTokenIdError } from '../../../domain/errors/wallet.errors';
import { TokenId } from '../../../domain/value-objects/token-id.vo';
import { leadingZeroTokenIdArb, tokenIdArb } from '../../helpers/arbitraries';
import { captureError } from '../../helpers/capture-error';

describe('TokenId', () => {
  describe('from()', () => {
    // La asimetría con `TokenAmount`, que sí rechaza `'0'`: el token 0 existe, el envío de cero no.
    it('debería aceptar el token 0, que sí existe', () => {
      // Act
      const tokenId = TokenId.from('0');

      // Assert
      expect(tokenId.value).toBe('0');
    });

    it('debería aceptar un id de un solo dígito', () => {
      // Act
      const tokenId = TokenId.from('7');

      // Assert
      expect(tokenId.value).toBe('7');
    });

    it('debería aceptar un id de exactamente 78 dígitos', () => {
      // Arrange
      const exact = `1${'0'.repeat(77)}`;

      // Act
      const tokenId = TokenId.from(exact);

      // Assert
      expect(tokenId.value).toHaveLength(78);
    });

    it('debería rechazar un id de 79 dígitos', () => {
      // Arrange
      const tooLong = `1${'0'.repeat(78)}`;

      // Act
      const error = captureError(() => TokenId.from(tooLong));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenIdError);
      expect(error.message).toBe(`"${tooLong}" is not a valid token id`);
    });

    it('debería rechazar un id con cero a la izquierda', () => {
      // Act
      const error = captureError(() => TokenId.from('01'));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenIdError);
      expect(error.message).toBe('"01" is not a valid token id');
      expect((error as InvalidTokenIdError).value).toBe('01');
    });

    it('debería rechazar un id con decimales, que es un importe y no un id', () => {
      // Act
      const error = captureError(() => TokenId.from('1.0'));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenIdError);
      expect(error.message).toBe('"1.0" is not a valid token id');
    });

    it('debería rechazar el signo +', () => {
      // Act
      const error = captureError(() => TokenId.from('+1'));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenIdError);
      expect(error.message).toBe('"+1" is not a valid token id');
    });

    it('debería rechazar un id negativo', () => {
      // Act
      const error = captureError(() => TokenId.from('-1'));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenIdError);
      expect(error.message).toBe('"-1" is not a valid token id');
    });

    // No muere por ninguna de las dos anclas: lo tumba la alternación, que exige al menos un
    // carácter. Medido — no aparece en ninguna de las dos listas de anclas del JSDoc de
    // `CANONICAL_INTEGER`, y sí en la de la regex entera. El otro rechazo que tampoco depende de
    // una ancla es K4, pero por otra causa: a ese lo mata el tope de longitud.
    it('debería rechazar la cadena vacía', () => {
      // Act
      const error = captureError(() => TokenId.from(''));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenIdError);
      expect(error.message).toBe('"" is not a valid token id');
    });

    // Sin el ancla `^` la expresión encontraría el `1` final y daría por bueno `' 1'`. No es el
    // único que cae por esa causa —son SIETE, medidos y listados en el JSDoc de
    // `CANONICAL_INTEGER`—; lo que este caso aporta es el espacio, que ningún otro trae.
    it('debería rechazar un id con un espacio delante', () => {
      // Act
      const error = captureError(() => TokenId.from(' 1'));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenIdError);
      expect(error.message).toBe('" 1" is not a valid token id');
    });

    // El simétrico: sin `$` la expresión casaría el `1` inicial y aceptaría `'1 '`. Por esa ancla
    // caen CINCO casos, también medidos en ese JSDoc, y este es el único de los cinco que sobrevive
    // a quitar `^` — el único de la tabla que depende de `$` y de nada más.
    it('debería rechazar un id con un espacio detrás', () => {
      // Act
      const error = captureError(() => TokenId.from('1 '));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenIdError);
      expect(error.message).toBe('"1 " is not a valid token id');
    });

    it('debería rechazar un id en hexadecimal', () => {
      // Act
      const error = captureError(() => TokenId.from('0x1'));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenIdError);
      expect(error.message).toBe('"0x1" is not a valid token id');
    });
  });

  describe('from() (property-based)', () => {
    it('debería aceptar cualquier entero canónico de hasta 78 dígitos', () => {
      fc.assert(
        fc.property(tokenIdArb, (raw) => {
          // Act
          const tokenId = TokenId.from(raw);

          // Assert
          expect(tokenId.value).toBe(raw);
        }),
      );
    });

    it('debería rechazar cualquier id con ceros a la izquierda', () => {
      fc.assert(
        fc.property(leadingZeroTokenIdArb, (raw) => {
          // Act
          const error = captureError(() => TokenId.from(raw));

          // Assert
          expect(error).toBeInstanceOf(InvalidTokenIdError);
          expect(error.message).toBe(`"${raw}" is not a valid token id`);
        }),
      );
    });
  });
});
