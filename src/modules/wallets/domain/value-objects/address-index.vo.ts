import { ValueObject } from '@shared/domain/value-object.base';

import { InvalidAddressIndexError } from '../errors/wallet.errors';

/**
 * El máximo de un `integer` de PostgreSQL, el tipo que tendrá la columna `address_index` cuando
 * la cree la migración del módulo. Hoy esa columna todavía no existe: medido con
 * `find src/database/migrations -name '*wallet*'`, que no devuelve nada.
 *
 * **El fallo que evita:** aceptar uno más aquí no evitaría el error, lo MUDARÍA al `INSERT` —
 * donde ya no se distingue de un problema del driver y llega después de haber gastado los
 * créditos de la derivación en el proveedor (spec §5.2). Con el tope en el VO, el índice
 * imposible muere antes de que nada salga a la red.
 *
 * ⚠️ Este literal es el borde SUPERIOR de la columna, pero el inferior NO lo es. Medido contra el
 * PostgreSQL del compose, no supuesto:
 *
 * ```
 * SELECT (2147483648)::integer;   -- ERROR: integer out of range
 * SELECT (-2147483648)::integer;  -- -2147483648  ← la mitad negativa SÍ es almacenable
 * ```
 *
 * Así que rechazar los negativos es decisión NUESTRA —la secuencia del §5.1 nunca entrega un
 * índice negativo—, no un límite del tipo. Escribir aquí «exactamente el rango que la columna
 * puede guardar» sería FALSO; lo que este VO acepta es la mitad NO NEGATIVA de ese rango.
 */
const MAX_ADDRESS_INDEX = 2_147_483_647;

/**
 * Índice de derivación de una gas pump address bajo la master. Entero no negativo: el primero que
 * entrega la secuencia de PostgreSQL es el 0, y el admin no consume ninguno (opera la master).
 *
 * ⚠️ Su error DEBE salir como **500**, no como 400 (spec §3.5), y hoy eso es una decisión
 * pendiente, no un hecho: quien la hará cierta es el mapa de `wallets-domain-exception.filter.ts`,
 * que todavía no existe —la crea la migración del módulo. Sin su fila
 * explícita, el fallback del filtro lo publicaría como 400. El motivo: ningún cliente pasa un
 * índice por la API, así que si esto se dispara es la secuencia agotada o una fila corrupta, y
 * publicarlo como «entrada inválida» lo escondería del `ErrorReporter`, que solo ve 5xx.
 * Mismo contrato, y misma deuda, que `WalletId` y `TransferId`.
 */
export class AddressIndex extends ValueObject<number> {
  /**
   * Las tres cláusulas cubren cosas distintas y NINGUNA es redundante. Medido rompiendo cada una
   * y corriendo la suite ENTERA del módulo (66 casos), no solo este archivo:
   *
   * | Mutante                         | Casos que mueren        | Salida            |
   * | ------------------------------- | ----------------------- | ----------------- |
   * | `>` → `>=`                      | X2 siempre; P1 a veces  | ver el ⚠️ de abajo |
   * | sin `value > MAX_ADDRESS_INDEX` | **solo X3**             | `1 failed, 65 ok` |
   * | sin `value < 0`                 | **solo X4**             | `1 failed, 65 ok` |
   * | sin `!Number.isInteger(value)`  | **X5 y X6, los dos**    | `2 failed, 64 ok` |
   *
   * ⚠️ **La primera fila NO es determinista, y merece decirse en vez de promediarla.** Con el
   * mutante `>=`, X2 cae SIEMPRE —es el borde exacto— pero P1 cae solo A VECES: es una propiedad
   * de `fast-check` sin semilla fija, así que depende de si el muestreo llega a generar
   * 2 147 483 647. Repetida ocho veces, en seis salieron dos rojos y en dos solo uno. Una
   * versión anterior de esta tabla decía «solo X2 · 1 failed, 65 ok» y **no reproducía**.
   *
   * Quien fija el borde de forma fiable es X2. X3 caza que el tope se compruebe. Los dos hacen
   * falta y ninguno sustituye al otro.
   *
   * **El fallo que evita `Number.isInteger`, y que ninguna comparación puede evitar:** toda
   * comparación con `NaN` es `false`, así que `NaN < 0` y `NaN > MAX` son ambas falsas y `NaN`
   * entraría como índice válido. Por eso la cláusula va PRIMERO y no se puede sustituir por un
   * rango.
   *
   * ⚠️ X5 (`0.5`) y X6 (`NaN`) mueren juntos bajo ese único mutante, y eso **no demuestra** que
   * no sean redundantes — si acaso es lo que parecería redundancia. Se conservan los dos porque
   * cubren dos entradas que llegan por caminos distintos (un decimal de un cálculo, un `NaN` de
   * un `Number()` fallido), no porque una medición lo exija. Un mutante que los separase sería
   * `Number.isFinite` en lugar de `Number.isInteger`: aceptaría `0.5` y seguiría rechazando
   * `NaN`. Stryker no lo genera.
   */
  static from(value: number): AddressIndex {
    if (!Number.isInteger(value) || value < 0 || value > MAX_ADDRESS_INDEX) {
      throw new InvalidAddressIndexError(value);
    }
    return new AddressIndex(value);
  }
}
