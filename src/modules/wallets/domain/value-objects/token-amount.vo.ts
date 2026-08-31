import { ValueObject } from '@shared/domain/value-object.base';

import { InvalidTokenAmountError } from '../errors/wallet.errors';

/**
 * Decimal canónico: parte entera `0` o sin ceros a la izquierda, y parte decimal opcional pero
 * nunca vacía. Ni signo, ni exponente, ni espacios.
 *
 * Las dos anclas son lo único que impide que el importe se acepte ENCONTRÁNDOLO dentro de una
 * cadena mayor, y **no se reparten los casos por igual** — medido quitando cada una y corriendo la
 * suite ENTERA del módulo (85 casos), no solo los dos casos de espacios:
 *
 * - Sin `^` caen **seis**: `'01'`, `'+1'`, `'.5'`, `'-1'`, `' 1'` y `'1e18'`, porque en todos ellos
 *   hay un importe canónico pegado al final (`1`, `5`, `18`) — `6 failed, 79 passed`.
 * - Sin `$` caen **cuatro**: `'01'` —la alternativa `0` casa el primer carácter y el resto deja de
 *   importar—, `'1.'`, `'1 '` y `'1e18'` — `4 failed, 81 passed`.
 *
 * ⚠️ El plan de esta tarea afirmaba que `' 1'` era «el único caso de la tabla que muere solo por
 * esa ancla». La medición de arriba lo desmiente en sus dos lecturas posibles: por `^` no cae uno
 * sino SEIS, y de esos seis hay CUATRO —`'+1'`, `'.5'`, `'-1'` y `' 1'`— que siguen en verde al
 * quitar `$`, así que `' 1'` tampoco es el único que depende de `^` y de nada más.
 */
const CANONICAL_DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

/**
 * «No todo ceros» se comprueba buscando UN dígito distinto de cero, y no con una segunda expresión
 * anclada, porque aquí solo llega lo que YA casó con `CANONICAL_DECIMAL`: la forma está decidida y
 * lo único que queda por saber es si algún dígito no es `0`. Una regex de más sería una regex de
 * más que anclar, que probar y que mutar.
 */
const NON_ZERO_DIGIT = /[1-9]/;

/**
 * Tope de LONGITUD, y solo eso. Lo fija la spec (§3.3, «hasta 79 caracteres») y su tamaño sale de
 * los 78 dígitos que ocupa el máximo de un uint256 —medido, no supuesto:
 * `(2n ** 256n - 1n).toString().length` da `78`— más un carácter para el punto decimal.
 *
 * ⚠️ **No es una comprobación de rango, y leerlo como si lo fuera sería el error caro.** El propio
 * caso M5 que fija el borde —`1` seguido de 78 ceros— ya es MAYOR que ese máximo: medido,
 * `BigInt('1' + '0'.repeat(78)) > 2n ** 256n - 1n` es `true`. Quien rechaza un importe fuera de
 * rango es la cadena, no este VO, y hoy en el árbol no hay nadie más que lo mire.
 *
 * ⚠️ **Y tampoco lo justifica el proveedor.** Una versión anterior decía que el tope evita que una
 * cadena larga «vuelva como un 400 suyo»: es falso, medido sobre su propio esquema —
 * `components/schemas/TransferCustodialWallet/properties/amount` de `openapi.json` **no declara
 * `maxLength`**, solo un `pattern`—. Lo que el tope hace de verdad es acotar la entrada antes de
 * que nada salga a la red: es una cerradura nuestra, no el eco de una suya.
 */
const MAX_LENGTH = 79;

/**
 * Importe a transferir. Este VO valida la FORMA y nada más: en qué unidad está el importe no lo
 * decide él, y el proveedor tampoco lo dice: la descripción de su campo `amount` es «(Only if the
 * asset is a fungible token, Multi Token, or native blockchain currency) The amount of the asset
 * to transfer. Do not use if the asset is an NFT.», con `"100000"` de ejemplo. Ni una palabra
 * sobre la unidad — y lo omitido en una cita anterior no era relleno: decía para qué clases de
 * activo aplica el campo, que es justo lo que `TransferAsset` tendrá que hacer cumplir (Task 8).
 *
 * Viaja como **string** de punta a punta, y esa es la decisión de fondo: por encima de 2^53 el
 * espaciado entre flotantes consecutivos pasa de 1, así que dos importes DISTINTOS colapsan en el
 * mismo `double`. No es que «19 dígitos no quepan» —`Number('1500000000000000000')` vuelve exacto,
 * medido—: es que su vecino no sobrevive al ida y vuelta.
 *
 * ```
 * > Number('1500000000000000001').toString()
 * '1500000000000000000'
 * ```
 *
 * Los dos son el MISMO `double`: pasar por número no redondea el último dígito, lo borra sin
 * avisar y sin que nada falle. Por eso el VO envuelve un `string` y por eso el contrato congelado
 * da `amount: string | null` a `WalletTransferSnapshot` — esa pieza y su columna llegan más
 * adelante; hoy no hay nada de eso en el árbol.
 *
 * ⚠️ Es MÁS estricto que el patrón del proveedor, y se puede decir exactamente en cuánto. Su
 * patrón es `^[+]?((\d+(\.\d*)?)|(\.\d+))$` —medido en `docs/tatum/gas-pump/openapi.json`,
 * `components/schemas/TransferCustodialWallet/properties/amount`— y de las doce entradas que la
 * tabla rechaza, él acepta **siete**: `'0'`, `'0.0'`, `'01'`, `'+1'`, `'.5'`, `'1.'` y también los
 * 80 caracteres de M6, que para su patrón son un entero perfectamente válido. Las cinco restantes
 * —`'-1'`, `''`, `' 1'`, `'1 '` y `'1e18'`— el proveedor también las rechaza; ahí no somos más
 * estrictos, solo redundantes, y esa redundancia es la que hace que una entrada rota muera aquí y
 * no después de un viaje a la red.
 *
 * Y **el cero se rechaza**: un envío de cero quema gas y no mueve nada.
 *
 * ⚠️ **Esto NO da igualdad canónica completa, y afirmarlo sería falso.** Rechazar `'+1'`, `'.5'` y
 * `'1.'` quita tres maneras de escribir lo mismo, pero los ceros a la derecha siguen entrando:
 * medido, `TokenAmount.from('1')` y `TokenAmount.from('1.0')` son ambos válidos y su `equals()` es
 * `false`. Lo que este VO garantiza es que el string guardado es exactamente el que se firma, no
 * que dos importes iguales se escriban igual.
 *
 * ⚠️ **No recorta espacios**, a diferencia de `EthereumAddress`. Un importe con espacios no es un
 * formato alternativo de nada: es una entrada rota. Lo fijan M15 y M16, y son exactamente esos dos
 * y ningún otro: medido metiendo un `raw.trim()` al principio de `from()` y corriendo la suite
 * entera del módulo — `2 failed, 83 passed`.
 *
 * La asimetría con `TokenId` —que sí aceptará `"0"`, porque el token 0 existe (spec §3.3)— es
 * deliberada. Ese VO todavía no está en el árbol: lo crea la Task 6.
 */
export class TokenAmount extends ValueObject<string> {
  /**
   * Las tres cláusulas cubren cosas distintas y NINGUNA es redundante. Medido quitando cada una y
   * corriendo la suite ENTERA del módulo (85 casos), no solo este archivo:
   *
   * | Mutante                        | Casos que mueren                              | Salida             |
   * | ------------------------------ | --------------------------------------------- | ------------------ |
   * | sin `value.length > MAX_LENGTH`| **solo M6** (los 80 caracteres)               | `1 failed, 84 ok`  |
   * | sin `CANONICAL_DECIMAL`        | M9-M13 y M15-M17, **ocho**                    | `8 failed, 77 ok`  |
   * | sin `NON_ZERO_DIGIT`           | M7, M8 y la propiedad P2, **tres**            | `3 failed, 82 ok`  |
   *
   * El orden de las tres no cambia el resultado —el error es el mismo la dispare quien la dispare,
   * y ninguna regex lleva la bandera `g`, así que `test()` no arrastra estado entre llamadas—: la
   * longitud va primero solo porque es la única que no mira el contenido de la cadena.
   *
   * El error lleva el valor tal cual llegó, que aquí es gratis: a diferencia de
   * `EthereumAddress`, este VO no normaliza nada, así que no existe una segunda versión del valor
   * que pudiera colarse en el mensaje.
   */
  static from(value: string): TokenAmount {
    if (
      value.length > MAX_LENGTH ||
      !CANONICAL_DECIMAL.test(value) ||
      !NON_ZERO_DIGIT.test(value)
    ) {
      throw new InvalidTokenAmountError(value);
    }
    return new TokenAmount(value);
  }
}
