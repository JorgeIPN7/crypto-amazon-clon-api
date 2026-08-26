import { ValueObject } from './value-object.base';

/**
 * Texto con el que se sustituye el valor en cualquier representación legible. No lleva
 * pistas del original —ni longitud, ni prefijo, ni primeros caracteres—: un `$argon2id$…`
 * recortado ya dice qué algoritmo y qué parámetros protegen la contraseña.
 */
const REDACTED = '***REDACTED***';

/**
 * `Symbol.for('nodejs.util.inspect.custom')` y NO `require('node:util').inspect.custom`.
 * Es la forma que Node documenta precisamente para no arrastrar la dependencia: el símbolo
 * está en el registro global, así que se obtiene sin importar nada. Aquí importa el doble,
 * porque este archivo vive en `domain/` y la regla de dependencia solo permite lenguaje.
 *
 * `unique symbol` es obligatorio para poder usarlo como nombre de método; medido con
 * `tsc 6.0.3 --noEmit --strict`: sin la anotación, `TS1166` («A computed property name in a
 * class property declaration must have a simple literal type or a unique symbol type»).
 */
const NODE_INSPECT: unique symbol = Symbol.for('nodejs.util.inspect.custom');

/**
 * Value object cuyo contenido es un secreto: se comporta como cualquier otro salvo que
 * **nunca se rinde a texto**.
 *
 * La idea viene de `Password.toString()` del repo `bridge-fital-pti-api`, pero allí tapa
 * UNA de las tres superficies por las que un valor llega a un log. Medido ejecutándolo, con
 * un hash real dentro de un VO que solo sobreescribe `toString()`:
 *
 *     `${vo}`        -> ***SECRET***                                    tapado
 *     JSON.stringify -> {"value":"$argon2id$v=19$m=19456,…"}            FILTRA
 *     util.inspect   -> BridgeStyle { value: '$argon2id$v=19$…' }       FILTRA
 *
 * Y la que filtra es justo la que se usa: **pino serializa con `JSON.stringify`**, así que
 * `logger.info({ credential })` habría escrito el hash entero en disco. De ahí que aquí se
 * sobreescriban las tres.
 *
 * `toJSON()` es además la que más lejos llega: `JSON.stringify` recorre el árbol y la invoca
 * en cada nodo, así que un secreto anidado a cualquier profundidad sale redactado sin que
 * ningún contenedor tenga que saber que lo lleva dentro.
 *
 * **`.value` sigue devolviendo el original**, y tiene que ser así: el adaptador de
 * persistencia necesita el hash para escribirlo. Esto no es una caja fuerte, es un
 * antiaccidente — protege del `console.log` y del logger, no de quien va a buscar el dato.
 *
 * ⚠️ **Límite conocido, medido y no cerrado:** `value` es una propiedad ENUMERABLE, así que
 * `{ ...secret }` y `Object.entries(secret)` siguen viéndola. Cerrarlo pedía guardar el valor
 * en un `WeakMap` o en un campo `#privado`, y ambos rompen `ValueObject`, que expone `value`
 * como `readonly` público y del que heredan los otros seis VOs del repo. Se acepta: un spread
 * es una línea deliberada, mientras que las tres superficies tapadas son las que se disparan
 * **sin que nadie las escriba**.
 */
export abstract class SecretValueObject<T> extends ValueObject<T> {
  override toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [NODE_INSPECT](): string {
    return REDACTED;
  }
}
