import fc from 'fast-check';

import { InvalidTransactionHashError } from '../../../domain/errors/wallet.errors';
import { TransactionHash } from '../../../domain/value-objects/transaction-hash.vo';
import { transactionHashArb } from '../../helpers/arbitraries';
import { captureError } from '../../helpers/capture-error';

/** Un hash de 64 hexadecimales ya en su forma canónica: `LOWERCASE.toLowerCase() === LOWERCASE`. */
const LOWERCASE = '0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060';

describe('TransactionHash', () => {
  describe('from()', () => {
    it('debería aceptar un hash en minúsculas y conservarlo', () => {
      // Act
      const hash = TransactionHash.from(LOWERCASE);

      // Assert
      expect(hash.value).toBe(LOWERCASE);
    });

    it('debería normalizar a minúsculas un hash en mayúsculas', () => {
      // Act
      const hash = TransactionHash.from(LOWERCASE.toUpperCase());

      // Assert
      expect(hash.value).toBe(LOWERCASE);
    });

    // Recortar ANTES de validar es lo que hace pasar este caso: la regex está anclada y el espacio
    // en blanco no es hexadecimal, así que validar primero lo dejaría en rojo. Lo que el recorte NO
    // hace es colar H10/H11 — `trim()` solo quita espacio en blanco, y la basura sigue dentro de la
    // cadena cuando las anclas la miran.
    it('debería recortar los espacios de los extremos', () => {
      // Act
      const hash = TransactionHash.from(`  ${LOWERCASE}  `);

      // Assert
      expect(hash.value).toBe(LOWERCASE);
    });

    // Este caso solo pasa si la normalización alcanza también al PREFIJO, no solo a los 64
    // hexadecimales: la regex exige el literal `0x` en minúsculas. Una implementación que bajara de
    // caja únicamente el cuerpo —`0X` + `hex.toLowerCase()`— dejaría este caso en rojo.
    it('debería aceptar el prefijo 0X en mayúsculas, normalizándolo', () => {
      // Act
      const hash = TransactionHash.from(`0X${LOWERCASE.slice(2)}`);

      // Assert
      expect(hash.value).toBe(LOWERCASE);
    });

    // Este es EL caso que el adaptador tiene que evitar, y no es hipotético: abierto
    // `docs/tatum/gas-pump/openapi.json`, el único ejemplo de hash de transacción de todo el
    // documento es `components/schemas/TransactionHash/properties/txId/example` y vale
    // `"c83f8818db43d9ba4accfe454aa44fc33123d47a4f89d47b314d6748eb0e9bc9"` — 64 hexadecimales
    // pelados, `type: string`, sin `pattern`. (Las otras once cadenas de 64 hexadecimales del
    // documento son todas `fromPrivateKey`, no hashes; medido recorriendo el JSON entero.)
    // Construir el VO con ese valor tal cual muere aquí, con el gas ya pagado. El VO no lo arregla
    // a propósito: quien conoce la forma del proveedor es el adaptador, no el dominio.
    it('debería rechazar un hash sin el prefijo 0x, que es como lo devuelve el proveedor', () => {
      // Arrange
      const withoutPrefix = LOWERCASE.slice(2);

      // Act
      const error = captureError(() => TransactionHash.from(withoutPrefix));

      // Assert
      expect(error).toBeInstanceOf(InvalidTransactionHashError);
      expect(error.message).toBe(`"${withoutPrefix}" is not a valid transaction hash`);
      expect((error as InvalidTransactionHashError).value).toBe(withoutPrefix);
    });

    it('debería rechazar un hash de 63 hexadecimales', () => {
      // Arrange
      const tooShort = `0x${'a'.repeat(63)}`;

      // Act
      const error = captureError(() => TransactionHash.from(tooShort));

      // Assert
      expect(error).toBeInstanceOf(InvalidTransactionHashError);
      expect(error.message).toBe(`"${tooShort}" is not a valid transaction hash`);
    });

    it('debería rechazar un hash de 65 hexadecimales', () => {
      // Arrange
      const tooLong = `0x${'a'.repeat(65)}`;

      // Act
      const error = captureError(() => TransactionHash.from(tooLong));

      // Assert
      expect(error).toBeInstanceOf(InvalidTransactionHashError);
      expect(error.message).toBe(`"${tooLong}" is not a valid transaction hash`);
    });

    it('debería rechazar un carácter no hexadecimal dentro de los 64', () => {
      // Arrange
      const notHex = `0x${'a'.repeat(63)}g`;

      // Act
      const error = captureError(() => TransactionHash.from(notHex));

      // Assert
      expect(error).toBeInstanceOf(InvalidTransactionHashError);
      expect(error.message).toBe(`"${notHex}" is not a valid transaction hash`);
    });

    it('debería rechazar la cadena vacía', () => {
      // Act
      const error = captureError(() => TransactionHash.from(''));

      // Assert
      expect(error).toBeInstanceOf(InvalidTransactionHashError);
      expect(error.message).toBe('"" is not a valid transaction hash');
    });

    // Sin el ancla `^`, la expresión encontraría el hash EN MEDIO de la basura y aceptaría esta
    // entrada. Es el único caso del archivo que muere por esa ancla: medido borrando `^` y
    // corriendo el módulo ENTERO —no solo este archivo—, `1 failed, 112 passed`.
    it('debería rechazar un hash precedido de basura', () => {
      // Arrange
      const prefixed = `zz${LOWERCASE}`;

      // Act
      const error = captureError(() => TransactionHash.from(prefixed));

      // Assert
      expect(error).toBeInstanceOf(InvalidTransactionHashError);
      expect(error.message).toBe(`"${prefixed}" is not a valid transaction hash`);
    });

    // El simétrico, y NO es simétrico en cuántos casos lo protegen: sin `$` mueren DOS —este y H7,
    // los 65 hexadecimales, porque sus primeros 64 casan y el sobrante deja de importar
    // (`2 failed, 111 passed`, misma medición sobre el módulo entero). La asimetría es la misma que
    // ya está medida en `ethereum-address.vo.ts`, y por eso aquí no se escribe «solo falla por el
    // ancla `$`»: sería falso.
    it('debería rechazar un hash seguido de basura', () => {
      // Arrange
      const suffixed = `${LOWERCASE}zz`;

      // Act
      const error = captureError(() => TransactionHash.from(suffixed));

      // Assert
      expect(error).toBeInstanceOf(InvalidTransactionHashError);
      expect(error.message).toBe(`"${suffixed}" is not a valid transaction hash`);
    });

    // ⚠️ Hermano del caso A14 de `ethereum-address.vo.spec.ts`, y por el mismo motivo medido:
    // sin él, sustituir `new InvalidTransactionHashError(value)` por `(normalized)` deja el
    // módulo entero en verde (`113 passed`), porque las siete entradas de rechazo de la tabla ya
    // cumplen `raw === normalized`. Stryker tampoco lo caza: no intercambia identificadores.
    // La entrada trae espacios Y mayúsculas a la vez para que crudo y normalizado difieran.
    it('debería llevar en el error el valor CRUDO, no el normalizado', () => {
      // Arrange
      const rawWithSpacesAndUppercase = `  0X${'A'.repeat(63)}ZZ  `;

      // Act
      const error = captureError(() => TransactionHash.from(rawWithSpacesAndUppercase));

      // Assert
      expect(error).toBeInstanceOf(InvalidTransactionHashError);
      expect((error as InvalidTransactionHashError).value).toBe(rawWithSpacesAndUppercase);
    });
  });

  describe('equals()', () => {
    // Es la invariante que sostiene la comparación de `activationTxId` y `txId`: el mismo hash
    // escrito en dos cajas tiene que ser el mismo hash, o releer una fila daría un VO distinto del
    // que se guardó.
    it('debería considerar iguales el mismo hash en mayúsculas y en minúsculas', () => {
      // Act
      const result = TransactionHash.from(LOWERCASE.toUpperCase()).equals(
        TransactionHash.from(LOWERCASE),
      );

      // Assert
      expect(result).toBe(true);
    });
  });

  describe('from() (property-based)', () => {
    // ⚠️ `transactionHashArb` genera las cajas MEZCLADAS (`HEX_DIGITS` incluye `abcdefABCDEF`), así
    // que la ida y vuelta ingenua `from(raw).value === raw` estaría en rojo con el código correcto.
    // Lo que se afirma es la normalización, no la identidad.
    it('debería aceptar cualquier hash de 64 hexadecimales y devolverlo en minúsculas', () => {
      fc.assert(
        fc.property(transactionHashArb, (raw) => {
          // Act
          const hash = TransactionHash.from(raw);

          // Assert
          expect(hash.value).toBe(raw.toLowerCase());
        }),
      );
    });

    // La idempotencia es lo que permite releer `activation_tx_id` de la base y reconstruir el VO
    // sin que el valor se mueva. Sin ella, el hash guardado y el reconstruido podrían diferir.
    it('debería ser idempotente al normalizar', () => {
      fc.assert(
        fc.property(transactionHashArb, (raw) => {
          // Act
          const once = TransactionHash.from(raw).value;
          const twice = TransactionHash.from(once).value;

          // Assert
          expect(twice).toBe(once);
        }),
      );
    });
  });
});
