import fc from 'fast-check';

import { InvalidAddressIndexError } from '../../../domain/errors/wallet.errors';
import { AddressIndex } from '../../../domain/value-objects/address-index.vo';
import { addressIndexArb } from '../../helpers/arbitraries';
import { captureError } from '../../helpers/capture-error';

describe('AddressIndex', () => {
  describe('from()', () => {
    it('debería aceptar el índice 0, que es el primero que da la secuencia', () => {
      // Act
      const index = AddressIndex.from(0);

      // Assert
      expect(index.value).toBe(0);
    });

    // X2 y X3 son el borde superior por sus dos lados y **no son intercambiables**: cada uno mata
    // un mutante que el otro deja vivo. Medido rompiendo la implementación y corriendo el módulo
    // ENTERO (66 casos), no filtrando con `-t` — el error que ya se cometió una vez en
    // `ethereum-address.vo.ts`, donde filtrar dejó casos en `skipped` y produjo una afirmación
    // falsa. Este de aquí caza el `>=`: con `value >= MAX_ADDRESS_INDEX`, el último índice
    // utilizable se rechazaría y `1 failed, 65 passed` — este caso cae SIEMPRE (P1 también, pero solo a veces: es una propiedad sin semilla fija).
    it('debería aceptar exactamente el máximo de un integer de PostgreSQL', () => {
      // Act
      const index = AddressIndex.from(2_147_483_647);

      // Assert
      expect(index.value).toBe(2_147_483_647);
    });

    // El simétrico, y el que caza que el tope NO se compruebe: quitando la cláusula
    // `value > MAX_ADDRESS_INDEX` entera, `1 failed, 65 passed` — este es el único que cae, X2
    // sigue verde. Es también el único caso que afirma sobre `error.value`, que es lo que fija
    // que el error transporte el índice y no otra cosa.
    it('debería rechazar el primer índice que la columna ya no puede guardar', () => {
      // Act
      const error = captureError(() => AddressIndex.from(2_147_483_648));

      // Assert
      expect(error).toBeInstanceOf(InvalidAddressIndexError);
      expect(error.message).toBe('2147483648 is not a valid address index');
      expect((error as InvalidAddressIndexError).value).toBe(2_147_483_648);
    });

    // Rechazar el negativo es decisión NUESTRA, no un límite de la columna. Medido contra el
    // PostgreSQL del compose, no supuesto: `SELECT (-1)::integer` devuelve `-1` y
    // `SELECT (-2147483648)::integer` devuelve `-2147483648` — la columna guardaría el −1 sin
    // protestar. Lo que lo prohíbe es que la secuencia del §5.1 nunca entrega un índice negativo.
    // Quitando `value < 0`, `1 failed, 65 passed` — este caso es el único que cae.
    it('debería rechazar un índice negativo', () => {
      // Act
      const error = captureError(() => AddressIndex.from(-1));

      // Assert
      expect(error).toBeInstanceOf(InvalidAddressIndexError);
      expect(error.message).toBe('-1 is not a valid address index');
    });

    it('debería rechazar un índice no entero', () => {
      // Act
      const error = captureError(() => AddressIndex.from(0.5));

      // Assert
      expect(error).toBeInstanceOf(InvalidAddressIndexError);
      expect(error.message).toBe('0.5 is not a valid address index');
    });

    // `NaN` NO lo caza ninguna de las dos comparaciones: `NaN < 0` y `NaN > MAX` son las dos
    // `false`, así que sin `Number.isInteger` entraría como índice válido y acabaría en la columna.
    // Es lo que hace que X5 y X6 no sean el mismo caso repetido: quitando esa cláusula caen LOS
    // DOS (`2 failed, 64 passed`), y es la única fila de la medición donde muere más de uno.
    it('debería rechazar NaN', () => {
      // Act
      const error = captureError(() => AddressIndex.from(Number.NaN));

      // Assert
      expect(error).toBeInstanceOf(InvalidAddressIndexError);
      expect(error.message).toBe('NaN is not a valid address index');
    });
  });

  describe('from() (property-based)', () => {
    // `addressIndexArb` ya existía en `__tests__/helpers/arbitraries.ts` y es exactamente
    // `fc.integer({ min: 0, max: 2_147_483_647 })`, es decir el rango que este VO acepta. Se
    // IMPORTA en lugar de escribir aquí un `fc.integer` equivalente: si mañana el tope cambiara,
    // una copia local dejaría la propiedad verificando el rango viejo, en verde y en silencio.
    //
    // ⚠️ A diferencia de `EthereumAddress`, aquí la ida y vuelta ingenua SÍ vale: este VO no
    // normaliza nada, así que `value` es idéntico a la entrada y no una versión transformada.
    it('debería aceptar cualquier entero del rango y conservarlo', () => {
      fc.assert(
        fc.property(addressIndexArb, (value) => {
          // Act
          const index = AddressIndex.from(value);

          // Assert
          expect(index.value).toBe(value);
        }),
      );
    });
  });
});
