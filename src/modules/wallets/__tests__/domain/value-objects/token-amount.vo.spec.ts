import fc from 'fast-check';

import { InvalidTokenAmountError } from '../../../domain/errors/wallet.errors';
import { TokenAmount } from '../../../domain/value-objects/token-amount.vo';
import { allZeroAmountArb, tokenAmountArb } from '../../helpers/arbitraries';
import { captureError } from '../../helpers/capture-error';

describe('TokenAmount', () => {
  describe('from()', () => {
    it('debería aceptar un entero canónico', () => {
      // Act
      const amount = TokenAmount.from('1');

      // Assert
      expect(amount.value).toBe('1');
    });

    it('debería aceptar un entero grande en unidades mínimas', () => {
      // Act
      const amount = TokenAmount.from('1500000000000000000');

      // Assert
      expect(amount.value).toBe('1500000000000000000');
    });

    it('debería aceptar un decimal canónico', () => {
      // Act
      const amount = TokenAmount.from('1.5');

      // Assert
      expect(amount.value).toBe('1.5');
    });

    // La parte entera `0` sí es legal: lo que se rechaza es que TODO sea cero.
    it('debería aceptar un importe menor que uno, con parte entera cero', () => {
      // Act
      const amount = TokenAmount.from('0.5');

      // Assert
      expect(amount.value).toBe('0.5');
    });

    it('debería aceptar un importe de exactamente 79 caracteres', () => {
      // Arrange
      const exact = `1${'0'.repeat(78)}`;

      // Act
      const amount = TokenAmount.from(exact);

      // Assert
      expect(amount.value).toHaveLength(79);
    });

    it('debería rechazar un importe de 80 caracteres', () => {
      // Arrange
      const tooLong = `1${'0'.repeat(79)}`;

      // Act
      const error = captureError(() => TokenAmount.from(tooLong));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenAmountError);
      expect(error.message).toBe(`"${tooLong}" is not a valid token amount`);
    });

    it('debería rechazar el cero, que quema gas sin mover nada', () => {
      // Act
      const error = captureError(() => TokenAmount.from('0'));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenAmountError);
      expect(error.message).toBe('"0" is not a valid token amount');
      expect((error as InvalidTokenAmountError).value).toBe('0');
    });

    it('debería rechazar un cero escrito con decimales', () => {
      // Act
      const error = captureError(() => TokenAmount.from('0.0'));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenAmountError);
      expect(error.message).toBe('"0.0" is not a valid token amount');
    });

    it('debería rechazar un importe con cero a la izquierda', () => {
      // Act
      const error = captureError(() => TokenAmount.from('01'));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenAmountError);
      expect(error.message).toBe('"01" is not a valid token amount');
    });

    it('debería rechazar el signo + que el patrón del proveedor sí acepta', () => {
      // Act
      const error = captureError(() => TokenAmount.from('+1'));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenAmountError);
      expect(error.message).toBe('"+1" is not a valid token amount');
    });

    it('debería rechazar un importe sin parte entera', () => {
      // Act
      const error = captureError(() => TokenAmount.from('.5'));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenAmountError);
      expect(error.message).toBe('".5" is not a valid token amount');
    });

    it('debería rechazar un importe con punto y sin decimales', () => {
      // Act
      const error = captureError(() => TokenAmount.from('1.'));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenAmountError);
      expect(error.message).toBe('"1." is not a valid token amount');
    });

    it('debería rechazar un importe negativo', () => {
      // Act
      const error = captureError(() => TokenAmount.from('-1'));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenAmountError);
      expect(error.message).toBe('"-1" is not a valid token amount');
    });

    it('debería rechazar la cadena vacía', () => {
      // Act
      const error = captureError(() => TokenAmount.from(''));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenAmountError);
      expect(error.message).toBe('"" is not a valid token amount');
    });

    // Sin el ancla `^` la expresión encontraría el `1` final y daría por bueno `' 1'`. No es el
    // único caso que cae por esa causa: son SEIS, medidos y listados en el JSDoc de
    // `CANONICAL_DECIMAL`. Lo que este caso aporta es el espacio, que ningún otro trae.
    it('debería rechazar un importe con un espacio delante', () => {
      // Act
      const error = captureError(() => TokenAmount.from(' 1'));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenAmountError);
      expect(error.message).toBe('" 1" is not a valid token amount');
    });

    // El simétrico: sin `$` la expresión casaría el `1` inicial y aceptaría `'1 '`. Por esa ancla
    // caen CUATRO casos, también medidos en ese JSDoc.
    it('debería rechazar un importe con un espacio detrás', () => {
      // Act
      const error = captureError(() => TokenAmount.from('1 '));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenAmountError);
      expect(error.message).toBe('"1 " is not a valid token amount');
    });

    it('debería rechazar la notación exponencial', () => {
      // Act
      const error = captureError(() => TokenAmount.from('1e18'));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenAmountError);
      expect(error.message).toBe('"1e18" is not a valid token amount');
    });
  });

  describe('from() (property-based)', () => {
    // El valor se conserva CARÁCTER a carácter: es el string el que viaja a la cadena, así que
    // cualquier reescritura —recortar, reformatear— cambiaría el importe enviado. Es la asimetría
    // deliberada con `EthereumAddress`, que sí normaliza.
    it('debería aceptar cualquier importe canónico no nulo', () => {
      fc.assert(
        fc.property(tokenAmountArb, (raw) => {
          // Act
          const amount = TokenAmount.from(raw);

          // Assert
          expect(amount.value).toBe(raw);
        }),
      );
    });

    it('debería rechazar cualquier importe formado solo por ceros', () => {
      fc.assert(
        fc.property(allZeroAmountArb, (raw) => {
          // Act
          const error = captureError(() => TokenAmount.from(raw));

          // Assert
          expect(error).toBeInstanceOf(InvalidTokenAmountError);
          expect(error.message).toBe(`"${raw}" is not a valid token amount`);
        }),
      );
    });
  });
});
