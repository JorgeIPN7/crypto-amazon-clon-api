import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import fc from 'fast-check';

import {
  IsChecksummedAddress,
  isChecksummedAddress,
  toChecksumAddress,
} from '../../../../infrastructure/http/validators/is-checksummed-address.validator';
import { ethereumAddressArb } from '../../../helpers/arbitraries';

/**
 * Los cuatro vectores canónicos de la sección «Test cases» del EIP-55, copiados literalmente del
 * estándar. **Son el ancla NO circular de todo este archivo**: la propiedad de más abajo compara
 * `toChecksumAddress` consigo mismo, así que si keccak256 fuera el algoritmo equivocado seguiría
 * verde. Estos cuatro no: salen de fuera del repo y de fuera de la librería.
 *
 * Comprobados contra `@noble/hashes@1.8.0` antes de escribirlos aquí — los cuatro devuelven la
 * misma cadena que se lee arriba, y con el `sha3-256` de `node:crypto` no devolvería ninguna
 * (keccak256 de la cadena vacía da `c5d24601…5d85a470`; `sha3-256` da `a7ffc6f8…80f8434a`).
 */
const EIP55_VECTORS = [
  '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
  '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
  '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
  '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
] as const;

const LOWERCASE = '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed';

/**
 * ⚠️ **El arbitrario va ARRIBA y no en el bloque `// Helpers` del final, y no es descuido.**
 * `fc.assert` lo evalúa dentro del `it`, o sea cuando ya está inicializado, pero el fichero
 * gemelo de este módulo (`tatum-secret-surface.spec.ts`) documenta el caso contrario medido: un
 * `it.each` que consume un `const` declarado al final mata la suite entera con
 * `ReferenceError: Cannot access '…' before initialization`. Mantener los datos arriba quita la
 * necesidad de acordarse de cuál de los dos casos es este.
 *
 * Se deriva de `ethereumAddressArb` en vez de escribir otro generador de hexadecimal: ese ya está
 * construido —`fc.constantFrom` sobre dígitos, nunca `fc.string().filter()`— y reutilizarlo es lo
 * que evita que este archivo tenga su propia idea de qué es una dirección.
 */
const lowercaseAddressArb = ethereumAddressArb.map((address) => address.toLowerCase());

describe('isChecksummedAddress', () => {
  it.each(EIP55_VECTORS)('debería aceptar el vector canónico del EIP-55 %s', (address) => {
    // Arrange
    const candidate = address;

    // Act
    const result = isChecksummedAddress(candidate);

    // Assert
    expect(result).toBe(true);
  });

  it('debería aceptar una dirección toda en minúsculas, que no lleva checksum que comprobar', () => {
    // Arrange
    const candidate = LOWERCASE;

    // Act
    const result = isChecksummedAddress(candidate);

    // Assert
    expect(result).toBe(true);
  });

  it('debería aceptar una dirección toda en mayúsculas, que tampoco lleva checksum', () => {
    // Arrange
    const candidate = `0x${LOWERCASE.slice(2).toUpperCase()}`;

    // Act
    const result = isChecksummedAddress(candidate);

    // Assert
    expect(result).toBe(true);
  });

  it('debería rechazar una dirección con la caja cambiada en un solo carácter', () => {
    // Arrange
    // El vector 1 con su tercer carácter ('A') pasado a minúscula: sigue siendo mixta, así que
    // el checksum SÍ se comprueba, y ya no cuadra.
    const candidate = '0x5aaeb6053F3E94C9b9A09f33669435E7Ef1BeAed';

    // Act
    const result = isChecksummedAddress(candidate);

    // Assert
    expect(result).toBe(false);
  });

  it('debería rechazar una dirección sin el prefijo 0x', () => {
    // Arrange
    const candidate = LOWERCASE.slice(2);

    // Act
    const result = isChecksummedAddress(candidate);

    // Assert
    expect(result).toBe(false);
  });

  it('debería rechazar una dirección con el prefijo escrito 0X', () => {
    // Arrange
    // `EthereumAddress.from()` sí lo acepta —baja de caja la cadena ENTERA, prefijo incluido—,
    // pero eso pasa DESPUÉS. Aquí no puede aceptarse: el cuerpo de `0X5AAE…` y el de `0x5aae…`
    // son la misma dirección, y el prefijo en mayúscula no es una de las dos formas que el
    // EIP-55 define.
    const candidate = `0X${LOWERCASE.slice(2)}`;

    // Act
    const result = isChecksummedAddress(candidate);

    // Assert
    expect(result).toBe(false);
  });

  /**
   * Las dos anclas de `ADDRESS_SHAPE`, una por fila, y **no se reparten los casos por igual** —
   * medido quitando cada ancla y corriendo el archivo entero, no razonado:
   *
   * - Sin `^` cae **exactamente uno**: «basura por delante». ⚠️ Esta fila existe porque sin ella
   *   esa mutación no la cazaba NADIE: con las 25 pruebas anteriores y el `^` fuera, la suite
   *   entera seguía en verde. Salió de romper el código a propósito, no de leerlo.
   * - Sin `$` caen **dos**: «basura por detrás» y el de 41 hexadecimales, porque sus primeros 40
   *   casan y el sobrante deja de importar.
   */
  it.each([
    ['basura por delante', `zz${LOWERCASE}`],
    ['basura por detrás', `${LOWERCASE}zz`],
  ])('debería rechazar una dirección con %s', (_caso, candidate) => {
    // Arrange
    const value = candidate;

    // Act
    const result = isChecksummedAddress(value);

    // Assert
    expect(result).toBe(false);
  });

  it.each([
    ['39 hexadecimales', `0x${'a'.repeat(39)}`],
    ['41 hexadecimales', `0x${'a'.repeat(41)}`],
  ])('debería rechazar una dirección de %s', (_caso, candidate) => {
    // Arrange
    const value = candidate;

    // Act
    const result = isChecksummedAddress(value);

    // Assert
    expect(result).toBe(false);
  });

  it('debería rechazar una dirección con un carácter no hexadecimal', () => {
    // Arrange
    const candidate = `0x${'a'.repeat(39)}z`;

    // Act
    const result = isChecksummedAddress(candidate);

    // Assert
    expect(result).toBe(false);
  });

  it('debería rechazar una dirección con espacios alrededor, porque el transporte no recorta', () => {
    // Arrange
    // `EthereumAddress.from()` sí recorta, pero eso pasa DESPUÉS. Si el transporte recortara,
    // el checksum se calcularía sobre una cadena distinta de la que el cliente escribió.
    const candidate = ` ${LOWERCASE} `;

    // Act
    const result = isChecksummedAddress(candidate);

    // Assert
    expect(result).toBe(false);
  });

  it.each([
    ['un número', 42],
    ['null', null],
    ['undefined', undefined],
    ['un objeto', { address: LOWERCASE }],
  ])('debería rechazar %s, que no es una cadena', (_caso, candidate) => {
    // Arrange
    const value: unknown = candidate;

    // Act
    const result = isChecksummedAddress(value);

    // Assert
    expect(result).toBe(false);
  });

  it('debería aceptar siempre una dirección en minúsculas y su forma canónica EIP-55 (propiedad)', () => {
    // Arrange
    const property = fc.property(lowercaseAddressArb, (address) => {
      // Act
      const lowercaseAccepted = isChecksummedAddress(address);
      const canonicalAccepted = isChecksummedAddress(toChecksumAddress(address));

      // Assert
      expect(lowercaseAccepted).toBe(true);
      expect(canonicalAccepted).toBe(true);
    });

    // Act + Assert
    fc.assert(property);
  });

  /**
   * La propiedad que de verdad prueba este validador: sobre CUALQUIER dirección, cambiar la caja
   * de UN solo carácter de su forma canónica la invalida.
   *
   * Tres decisiones, y las tres tienen consecuencia:
   *
   * 1. **Se muta la CAJA y no el VALOR del dígito.** Cambiar el valor cambia el cuerpo, y con él
   *    el hash entero, así que el resultado solo fallaría con probabilidad ~1 − 2⁻ⁿ y la
   *    propiedad sería flaky. Voltear la caja deja intacto el cuerpo en minúsculas del que sale
   *    el checksum, así que la forma canónica no se mueve y la comparación falla de forma
   *    DETERMINISTA.
   * 2. **Se recorren TODAS las posiciones con letra**, no una elegida por un arbitrario. Con
   *    `fc.constantFrom(...posiciones)` una dirección de 40 dígitos sin ninguna letra reventaría
   *    el generador; recorriendo las posiciones, el bucle simplemente no da vueltas y la
   *    pregunta desaparece. (Esa dirección es rarísima: medido con `fc.sample` sobre 100 000
   *    muestras de este mismo arbitrario, **cero**. La forma del bucle no depende de esa
   *    medición, que es justo el motivo de escribirlo así.)
   * 3. **La expectativa es `toBe(monoCase(mutada))` y no `toBe(false)`**, y la diferencia no es
   *    cosmética: si la canónica tenía exactamente UNA letra en mayúscula, voltearla deja la
   *    dirección toda en minúsculas, que es una dirección SIN checksum y se acepta por
   *    definición. Con `toBe(false)` la propiedad sería flaky justo ahí — medido sobre 100 000
   *    direcciones al azar, **458** tienen al menos una mutación mono-caja, una de cada ~218, así
   *    que con 100 ejecuciones por corrida la suite se pondría roja sola cada pocas semanas.
   *    Escribirla así es lo que hace que la propiedad diga la verdad entera.
   */
  it('debería rechazar siempre la forma canónica con la caja de UN carácter cambiada (propiedad)', () => {
    // Arrange
    const property = fc.property(lowercaseAddressArb, (address) => {
      const canonical = toChecksumAddress(address);

      for (const index of letterPositions(canonical)) {
        // Act
        const mutated = flipCaseAt(canonical, index);

        // Assert
        expect(isChecksummedAddress(mutated)).toBe(monoCase(mutated));
      }
    });

    // Act + Assert
    fc.assert(property);
  });
});

describe('toChecksumAddress', () => {
  it('debería devolver la forma canónica de una dirección escrita en minúsculas', () => {
    // Arrange
    const address = LOWERCASE;

    // Act
    const canonical = toChecksumAddress(address);

    // Assert
    expect(canonical).toBe(EIP55_VECTORS[0]);
  });

  it('debería ser idempotente: la forma canónica de una canónica es ella misma', () => {
    // Arrange
    const address = EIP55_VECTORS[1];

    // Act
    const canonical = toChecksumAddress(toChecksumAddress(address));

    // Assert
    expect(canonical).toBe(address);
  });
});

describe('IsChecksummedAddress', () => {
  it('debería dar por válida la propiedad cuando el checksum cuadra', () => {
    // Arrange
    const dto = plainToInstance(Payload, { recipient: EIP55_VECTORS[0] });

    // Act
    const errors = validateSync(dto);

    // Assert
    expect(errors).toEqual([]);
  });

  it('debería marcar la propiedad como inválida cuando el checksum no cuadra', () => {
    // Arrange
    const dto = plainToInstance(Payload, {
      recipient: '0x5aaeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    });

    // Act
    const errors = validateSync(dto);

    // Assert
    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('recipient');
  });

  it('debería publicar un mensaje que nombra el checksum EIP-55', () => {
    // Arrange
    const dto = plainToInstance(Payload, { recipient: 'no-es-una-direccion' });

    // Act
    const errors = validateSync(dto);

    // Assert
    // El mensaje viaja en el `message` del 400 junto a los de `class-validator`, así que va en
    // inglés como ellos. Nombra el checksum porque «invalid address» no distingue una dirección
    // mal escrita de una con un carácter cambiado, que es justo lo que este validador caza.
    expect(Object.values(errors[0]?.constraints ?? {}).join()).toContain('EIP-55');
  });

  it('debería nombrar la propiedad decorada en el mensaje, no una etiqueta fija', () => {
    // Arrange
    const dto = plainToInstance(Payload, { recipient: 'no-es-una-direccion' });

    // Act
    const errors = validateSync(dto);

    // Assert
    expect(Object.values(errors[0]?.constraints ?? {}).join()).toContain('recipient');
  });
});

// Helpers

/** Índices de los caracteres que son letras: son los únicos que llevan caja. */
const letterPositions = (address: string): number[] =>
  [...address].flatMap((char, index) => (/[a-fA-F]/.test(char) ? [index] : []));

const flipCaseAt = (address: string, index: number): string => {
  const char = address[index] ?? '';
  const flipped = char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase();
  return `${address.slice(0, index)}${flipped}${address.slice(index + 1)}`;
};

/** Una dirección sin checksum que comprobar: su cuerpo está entero en una sola caja. */
const monoCase = (address: string): boolean => {
  const body = address.slice(2);
  return body === body.toLowerCase() || body === body.toUpperCase();
};

class Payload {
  @IsChecksummedAddress()
  recipient!: string;
}
