import fc from 'fast-check';

import { InvalidEthereumAddressError } from '../../../domain/errors/wallet.errors';
import { EthereumAddress } from '../../../domain/value-objects/ethereum-address.vo';
import { ethereumAddressArb } from '../../helpers/arbitraries';
import { captureError } from '../../helpers/capture-error';

/** La misma dirección en sus dos cajas: la canónica EIP-55 y la normalizada. */
const LOWERCASE = '0x742d35cc6634c0532925a3b844bc454e4438f44e';
const CHECKSUMMED = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';

describe('EthereumAddress', () => {
  describe('from()', () => {
    it('debería aceptar una dirección en minúsculas y conservarla', () => {
      // Act
      const address = EthereumAddress.from(LOWERCASE);

      // Assert
      expect(address.value).toBe(LOWERCASE);
    });

    it('debería normalizar a minúsculas una dirección con checksum EIP-55', () => {
      // Act
      const address = EthereumAddress.from(CHECKSUMMED);

      // Assert
      expect(address.value).toBe(LOWERCASE);
    });

    // Recortar ANTES de validar es lo que hace pasar este caso; validar antes lo dejaría en rojo,
    // porque la regex está anclada y los espacios no son hexadecimales. Lo que el recorte NO hace
    // es abrir la puerta a A11/A12: `trim()` solo quita espacio en blanco, así que la basura sigue
    // dentro de la cadena cuando las anclas la miran.
    it('debería recortar los espacios de los extremos', () => {
      // Act
      const address = EthereumAddress.from(`  ${LOWERCASE}  `);

      // Assert
      expect(address.value).toBe(LOWERCASE);
    });

    // Este caso solo pasa si la normalización alcanza también al PREFIJO, no solo a los 40
    // hexadecimales: la regex exige el literal `0x` en minúsculas. Una implementación que
    // bajara de caja únicamente el cuerpo —`0X` + `hex.toLowerCase()`— dejaría este caso en rojo.
    it('debería aceptar el prefijo 0X en mayúsculas, normalizándolo', () => {
      // Act
      const address = EthereumAddress.from(`0X${LOWERCASE.slice(2)}`);

      // Assert
      expect(address.value).toBe(LOWERCASE);
    });

    // La forma con checksum de una dirección es ÚNICA, así que cualquier otra combinación de
    // cajas de esa misma dirección lo tiene roto. Aquí se acepta a propósito: el checksum se
    // comprueba en el validador del DTO, y este VO también recibe direcciones del proveedor, que
    // las devuelve en minúsculas — es decir, sin checksum que comprobar.
    it('debería aceptar una dirección con el checksum EIP-55 incorrecto', () => {
      // Arrange
      const brokenChecksum = '0x742D35cc6634c0532925a3b844bc454e4438f44e';

      // Act
      const address = EthereumAddress.from(brokenChecksum);

      // Assert
      expect(address.value).toBe(LOWERCASE);
    });

    it('debería rechazar una dirección sin el prefijo 0x', () => {
      // Arrange
      const withoutPrefix = LOWERCASE.slice(2);

      // Act
      const error = captureError(() => EthereumAddress.from(withoutPrefix));

      // Assert
      expect(error).toBeInstanceOf(InvalidEthereumAddressError);
      expect(error.message).toBe(`"${withoutPrefix}" is not a valid Ethereum address`);
      expect((error as InvalidEthereumAddressError).value).toBe(withoutPrefix);
    });

    it('debería rechazar una dirección de 39 hexadecimales', () => {
      // Arrange
      const tooShort = `0x${'a'.repeat(39)}`;

      // Act
      const error = captureError(() => EthereumAddress.from(tooShort));

      // Assert
      expect(error).toBeInstanceOf(InvalidEthereumAddressError);
      expect(error.message).toBe(`"${tooShort}" is not a valid Ethereum address`);
    });

    it('debería rechazar una dirección de 41 hexadecimales', () => {
      // Arrange
      const tooLong = `0x${'a'.repeat(41)}`;

      // Act
      const error = captureError(() => EthereumAddress.from(tooLong));

      // Assert
      expect(error).toBeInstanceOf(InvalidEthereumAddressError);
      expect(error.message).toBe(`"${tooLong}" is not a valid Ethereum address`);
    });

    it('debería rechazar un carácter no hexadecimal dentro de los 40', () => {
      // Arrange
      const notHex = `0x${'a'.repeat(39)}g`;

      // Act
      const error = captureError(() => EthereumAddress.from(notHex));

      // Assert
      expect(error).toBeInstanceOf(InvalidEthereumAddressError);
      expect(error.message).toBe(`"${notHex}" is not a valid Ethereum address`);
    });

    it('debería rechazar la cadena vacía', () => {
      // Act
      const error = captureError(() => EthereumAddress.from(''));

      // Assert
      expect(error).toBeInstanceOf(InvalidEthereumAddressError);
      expect(error.message).toBe('"" is not a valid Ethereum address');
    });

    // Sin el ancla `^`, la expresión encontraría la dirección EN MEDIO de la basura y aceptaría
    // esta entrada. Es el único caso de la tabla que muere por esa ancla y por nada más.
    it('debería rechazar una dirección precedida de basura', () => {
      // Arrange
      const prefixed = `zz${LOWERCASE}`;

      // Act
      const error = captureError(() => EthereumAddress.from(prefixed));

      // Assert
      expect(error).toBeInstanceOf(InvalidEthereumAddressError);
      expect(error.message).toBe(`"${prefixed}" is not a valid Ethereum address`);
    });

    // El simétrico: sin el ancla `$` la expresión casaría el prefijo y daría por buena una
    // dirección con cola. Los 41 hexadecimales de A8 matan además el cuantificador `{40}`.
    it('debería rechazar una dirección seguida de basura', () => {
      // Arrange
      const suffixed = `${LOWERCASE}zz`;

      // Act
      const error = captureError(() => EthereumAddress.from(suffixed));

      // Assert
      expect(error).toBeInstanceOf(InvalidEthereumAddressError);
      expect(error.message).toBe(`"${suffixed}" is not a valid Ethereum address`);
    });

    // El JSDoc de `from()` afirma que el error lleva el valor CRUDO, y hasta este caso NADA lo
    // protegía. Medido cambiando `new InvalidEthereumAddressError(value)` por `(normalized)` y
    // corriendo el módulo ENTERO, no solo este archivo: `1 failed, 58 passed` — este es el único
    // que cae. La causa de que los demás no se enteren es que en A6-A12 la entrada ya cumple
    // `raw === raw.trim().toLowerCase()`, así que las dos cadenas son la misma y el cambio es
    // invisible. Por eso esta entrada trae espacios Y mayúsculas a la vez: quitarle cualquiera de
    // las dos la devolvería a pasar con las dos implementaciones, que es lo que la haría
    // decorativa.
    it('debería llevar en el error el valor CRUDO, no el normalizado', () => {
      // Arrange
      const rawWithSpacesAndUppercase = `  ${CHECKSUMMED}ZZ  `;

      // Act
      const error = captureError(() => EthereumAddress.from(rawWithSpacesAndUppercase));

      // Assert
      expect(error).toBeInstanceOf(InvalidEthereumAddressError);
      expect((error as InvalidEthereumAddressError).value).toBe(rawWithSpacesAndUppercase);
      expect(error.message).toBe(`"${rawWithSpacesAndUppercase}" is not a valid Ethereum address`);
    });
  });

  describe('equals()', () => {
    // Es la invariante de la que depende que el índice único de `address` proteja algo: si las
    // dos cajas no fueran iguales, la misma dirección entraría dos veces en la tabla.
    it('debería considerar iguales la misma dirección en EIP-55 y en minúsculas', () => {
      // Act
      const result = EthereumAddress.from(CHECKSUMMED).equals(EthereumAddress.from(LOWERCASE));

      // Assert
      expect(result).toBe(true);
    });
  });

  describe('from() (property-based)', () => {
    // ⚠️ `ethereumAddressArb` genera las cajas MEZCLADAS (`HEX_DIGITS` incluye `abcdefABCDEF`),
    // así que la ida y vuelta ingenua `from(raw).value === raw` estaría en rojo con el código
    // correcto. Lo que se afirma es la normalización, no la identidad — la asimetría deliberada
    // con `WalletId`/`TransferId`, que NO normalizan.
    it('debería aceptar cualquier dirección de 40 hexadecimales y devolverla en minúsculas', () => {
      fc.assert(
        fc.property(ethereumAddressArb, (raw) => {
          // Act
          const address = EthereumAddress.from(raw);

          // Assert
          expect(address.value).toBe(raw.toLowerCase());
        }),
      );
    });

    // La idempotencia es lo que permite releer una fila de la base y volver a construir el VO sin
    // que el valor se mueva. Sin ella, el `address` guardado y el reconstruido podrían diferir y
    // el índice único dejaría de significar lo que promete.
    it('debería ser idempotente al normalizar', () => {
      fc.assert(
        fc.property(ethereumAddressArb, (raw) => {
          // Act
          const once = EthereumAddress.from(raw).value;
          const twice = EthereumAddress.from(once).value;

          // Assert
          expect(twice).toBe(once);
        }),
      );
    });
  });
});
