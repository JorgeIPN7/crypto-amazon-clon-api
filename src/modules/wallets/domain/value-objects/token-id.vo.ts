import { ValueObject } from '@shared/domain/value-object.base';

import { InvalidTokenIdError } from '../errors/wallet.errors';

/**
 * Entero canónico y nada más: `0`, o un dígito no nulo seguido de dígitos. Sin punto, sin signo,
 * sin prefijo y sin espacios.
 *
 * Las dos anclas son lo único que impide aceptar un id ENCONTRÁNDOLO dentro de una cadena mayor, y
 * **no se reparten los casos por igual** — medido quitando cada una y corriendo la suite ENTERA del
 * módulo (99 casos), no solo este archivo:
 *
 * - Sin `^` caen **siete**: `'01'`, `'1.0'`, `'+1'`, `'-1'`, `' 1'`, `'0x1'` y la propiedad P2,
 *   porque en todos ellos hay un entero canónico pegado al final — `7 failed, 92 passed`.
 * - Sin `$` caen **cinco**: `'01'` —la alternativa `0` casa el primer carácter y el resto deja de
 *   importar—, `'1.0'`, `'1 '`, `'0x1'` y P2 — `5 failed, 94 passed`.
 *
 * ⚠️ La tabla de casos anotaba `' 1'` como «solo falla por el ancla `^`» y `'1 '` como «solo falla
 * por el ancla `$`». En la lectura «es el único que muere por esa ancla» las dos son falsas: son
 * siete y cinco. En la lectura «muere por esa ancla y no por la otra», `'1 '` sí es el único, pero
 * `' 1'` lo comparte con `'+1'` y `'-1'`.
 *
 * ⚠️ La cadena vacía no la caza ninguna de las dos anclas —no aparece en ninguna de las dos listas
 * de arriba, y sí en la de «sin `CANONICAL_INTEGER`» de más abajo—. Lo que la rechaza es la
 * alternación, que exige al menos un carácter.
 */
const CANONICAL_INTEGER = /^(?:0|[1-9][0-9]*)$/;

/**
 * Tope de LONGITUD, y solo eso. Los 78 son los dígitos que ocupa el máximo de un uint256 — medido,
 * no supuesto: `(2n ** 256n - 1n).toString().length` da `78`. Que el `tokenId` de EVM SEA un
 * uint256 no sale de una medición nuestra sino de sus estándares (ERC-721 y ERC-1155 lo declaran
 * así) y lo recoge la spec §3.3; aquí se cita, no se comprueba.
 *
 * El guardia mira `value.length`, no dígitos; para todo lo que además casa con `CANONICAL_INTEGER`
 * son lo mismo, porque ahí cada carácter es un dígito.
 *
 * ⚠️ **No es una comprobación de rango, y leerlo como si lo fuera sería el error caro.** Con 78
 * dígitos se escriben ids MAYORES que ese máximo y este VO los acepta: medido,
 * `BigInt('9'.repeat(78)) > 2n ** 256n - 1n` es `true`. Quien rechaza un id fuera de rango es la
 * cadena, no este VO, y hoy en el árbol no hay nadie más que lo mire: medido con
 * `grep -rn "2n \*\* 256n\|uint256\|115792089" src/`, que solo devuelve líneas de COMENTARIO —las
 * de este archivo y las de `token-amount.vo.ts`—, ni una de código. (El borde que fija el caso K3
 * —un `1` y 77 ceros— sí queda por debajo del máximo: medido, `false`. Es la diferencia con el M5
 * de `TokenAmount`, cuyo borde ya lo excedía.)
 *
 * ⚠️ **Y no lo justifica el proveedor.** Su esquema para este campo —
 * `components/schemas/TransferCustodialWallet/properties/tokenId` en
 * `docs/tatum/gas-pump/openapi.json`— declara `maxLength: 256` y **ningún `pattern`**. Es un límite
 * distinto y más laxo que el nuestro, no su origen: de las NUEVE entradas PUNTUALES que la tabla de
 * casos rechaza (K4-K12), su esquema las acepta todas — medido validándolas contra ese subesquema
 * con Ajv 8.20.0, `aceptados por el proveedor: 9 de 9`. Aquí no hay eco de un 400 suyo; el tope y la
 * regex son cerradura nuestra entera.
 */
const MAX_DIGITS = 78;

/**
 * Identificador de un token dentro de su contrato (NFT y multi-token). Viaja como **string** de
 * punta a punta por lo mismo que el importe: por encima de 2^53 el espaciado entre flotantes
 * consecutivos pasa de 1, así que dos ids DISTINTOS colapsan en el mismo `double` — medido,
 * `Number('1500000000000000001') === Number('1500000000000000000')` es `true`, y el segundo es lo
 * que devuelve `toString()` del primero. Pasar por número no redondea el último dígito: lo borra
 * sin avisar y sin que nada falle.
 *
 * ⚠️ **Acepta `"0"`, y es la asimetría deliberada con `TokenAmount`** (spec §3.3): el token 0
 * existe y se transfiere como cualquier otro, mientras que un importe de cero quema gas y no mueve
 * nada. En código, la asimetría SOBRE EL CERO es exactamente una cláusula: `TokenAmount.from()`
 * tiene una tercera comprobación, `NON_ZERO_DIGIT`, que esta no tiene. (No es la única diferencia
 * entre los dos VOs —la regex de allí admite decimales y su tope es 79—, pero sí la única que
 * decide qué pasa con el `"0"`.)
 *
 * ⚠️ «Arreglar» esa asimetría igualando los dos VOs es, por tanto, un cambio de UNA línea, y
 * rompería toda colección cuyo primer token es el 0. Medido añadiendo `|| !/[1-9]/.test(value)` a
 * la guarda y corriendo la suite entera del módulo: `2 failed, 97 passed`, tres veces seguidas.
 * Quien lo intente choca con dos casos, y solo uno de los dos es de fiar: **K1 muere siempre**,
 * mientras que P1 muere porque `tokenIdArb` lleva `fc.constant('0')` dentro de su `fc.oneof` — eso
 * es estocástico, depende de que salga el `'0'` en alguna de las 100 ejecuciones. K1 es el que
 * para el cambio; P1 solo acompaña.
 *
 * Los ceros a la izquierda se rechazan por lo mismo que en el importe: `"01"` y `"1"` son el mismo
 * token con dos strings distintos, y el string es lo que se compara, lo que se guarda y lo que se
 * envía.
 *
 * ⚠️ **No recorta espacios**, a diferencia de `EthereumAddress`. Un id con espacios no es un
 * formato alternativo de nada: es una entrada rota. Lo fijan K10 y K11, y son exactamente esos dos y
 * ningún otro — medido metiendo un `raw.trim()` al principio de `from()` y corriendo la suite entera
 * del módulo: `2 failed, 97 passed`.
 */
export class TokenId extends ValueObject<string> {
  /**
   * Las dos cláusulas cubren cosas distintas y ninguna es redundante. Medido quitando cada una y
   * corriendo la suite ENTERA del módulo (99 casos), no solo este archivo:
   *
   * | Mutante                         | Casos que mueren                    | Salida             |
   * | ------------------------------- | ----------------------------------- | ------------------ |
   * | sin `value.length > MAX_DIGITS` | **solo K4** (los 79 dígitos)        | `1 failed, 98 ok`  |
   * | `MAX_DIGITS` de 78 a 79         | **solo K4**, otra vez               | `1 failed, 98 ok`  |
   * | sin `CANONICAL_INTEGER`         | K5-K12 y la propiedad P2, **nueve** | `9 failed, 90 ok`  |
   *
   * ⚠️ Esa P2 es una propiedad de `fast-check` SIN semilla fija: el contraejemplo cambia entre
   * ejecuciones, el desenlace no. Todo valor que `leadingZeroTokenIdArb` puede producir empieza por
   * al menos un `0` seguido de un dígito no nulo, así que el mutante muere en el primero que
   * genere — repetida tres veces la fila de `CANONICAL_INTEGER`, `9 failed, 90 passed` las tres.
   *
   * El orden de las dos no cambia el resultado —el error es el mismo la dispare quien la dispare, y
   * la regex no lleva la bandera `g`, así que `test()` no arrastra estado entre llamadas—: la
   * longitud va primero solo porque es la única que no mira el contenido de la cadena. Medido
   * invirtiendo las dos cláusulas y corriendo la suite entera del módulo: `99 passed`, ni un caso
   * se mueve.
   *
   * El error lleva el valor tal cual llegó, que aquí es gratis: este VO no normaliza nada, así que
   * no existe una segunda versión del valor que pudiera colarse en el mensaje.
   */
  static from(value: string): TokenId {
    if (value.length > MAX_DIGITS || !CANONICAL_INTEGER.test(value)) {
      throw new InvalidTokenIdError(value);
    }
    return new TokenId(value);
  }
}
