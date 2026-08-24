import { randomUUID } from 'node:crypto';

import { ValueObject } from './value-object.base';

/**
 * UUID v4 estricto: exige el dígito de versión `4` y la variante RFC 4122 (`8`, `9`, `a` o
 * `b`). Es la misma expresión que vivía DUPLICADA byte a byte en `user-id.vo.ts` y
 * `order-id.vo.ts`.
 */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Base de los identificadores de agregado. Aporta el formato; NO aporta el error, porque el
 * kernel no puede conocer `InvalidUserIdError` ni `InvalidOrderIdError` —viven en un módulo
 * y `shared-domain` no importa de `modules/`—. Por eso `assertUuid` recibe una FÁBRICA de
 * error: quien llama decide qué se lanza, y así el id inválido de un cliente sigue siendo un
 * 400 de su contexto y no un 500 genérico.
 *
 * Es una fábrica y no la clase del error (`assertUuid(value, InvalidUserIdError)`) porque eso
 * NO compila: una clase como valor tiene firma de construcción, no de llamada, y tiparla como
 * `new (value: string) => Error` fijaría la forma del constructor a exactamente ese parámetro.
 * Hay contraejemplos vivos en `auth.errors.ts`: `InvalidCredentialsError` no recibe ninguno e
 * `InvalidProfileError` recibe un mensaje, no el valor. La arrow es necesaria, no ceremonia.
 *
 * La validación va en una factoría estática y no en el constructor por dos razones, y ninguna
 * es la que decía la primera versión de este comentario —«habría que ejecutar sentencias antes
 * de `super()`, legal solo bajo condiciones sutiles»—, que es **falsa**: medido compilando con
 * el `tsc` del proyecto en seis variantes (con y sin parameter properties, con fields
 * inicializados, con private identifiers, bajo ES2017 y ES2023), TypeScript acepta cualquier
 * sentencia antes de `super()`. Lo único que prohíbe es tocar `this` o `super` antes de la
 * llamada (TS17009), y eso sería un error en cualquier caso. Las razones reales:
 *   1. El constructor tendría que aceptar la fábrica como parámetro, y `generate()` —que no
 *      puede fallar, porque acuña el UUID él mismo— quedaría obligado a inventarse una
 *      fábrica de error que no se dispara nunca.
 *   2. Un estático se invoca desde donde convenga sin arrastrar la cadena de `super()`.
 *
 * `equals()` y `toString()` los pone `ValueObject`, con su comprobación de clase incluida:
 * dos ids de agregados distintos con el mismo UUID no son iguales.
 */
export abstract class UuidId extends ValueObject<string> {
  /**
   * Acuña un identificador nuevo. Vive aquí y no en cada VO porque el formato y la generación
   * tienen que cambiar A LA VEZ: si `UUID_V4` pasara algún día a exigir v7 y cada `generate()`
   * siguiera llamando a `randomUUID()` —que emite v4— los tres value objects se romperían de
   * golpe y habría que ir a buscarlos uno a uno. Juntos en este archivo, es un solo cambio
   * coherente. No es indirección por simetría: es poner en el mismo sitio las dos mitades de
   * una misma decisión.
   */
  protected static newUuid(): string {
    return randomUUID();
  }

  protected static assertUuid(value: string, invalid: (value: string) => Error): string {
    if (!UUID_V4.test(value)) {
      throw invalid(value);
    }
    return value;
  }
}
