/**
 * Lo mínimo que hace falta para leer la forma de un puerto: los nombres propios de su prototipo y
 * la aridad de su constructor. Vive aquí y no copiado en los cinco specs porque `CLAUDE.md` lo
 * pide así («nunca copies un builder en varios specs»).
 *
 * Se tipa por ESTRUCTURA porque así el parámetro nombra exactamente los dos miembros que se leen.
 * ⚠️ El motivo que traía el plan —«un tipo con solo firma de construcción no expone
 * `length`»— es **FALSO**, y se corrige aquí en vez de propagarse: medido con
 * `tsc 6.0.3 --noEmit --strict` sobre `type C = abstract new (...args: never[]) => object`,
 * `c.length` compila y es `number`, porque el tipo aparente de una firma de construcción es
 * `Function`. Lo que sí cambia es `c.prototype`, que ahí llega como `any` —`const p: null =
 * c.prototype` no da error, mientras que `const n: null = c.length` da
 * `TS2322: Type 'number' is not assignable to type 'null'`—, y `prototype` es justo lo que este
 * helper desreferencia.
 *
 * **El fallo que este helper existe para cazar** —y es el motivo principal de los cinco specs—:
 * convertir un puerto en `type` + `Symbol`. Medido rompiéndolo a propósito sobre
 * `owner.directory.ts`, la llamada da doble rojo:
 *   - `pnpm typecheck` → `TS2693: 'OwnerDirectory' only refers to a type, but is being used as a
 *     value here.` (más `TS6133`, porque el import deja de leerse como valor)
 *   - `pnpm test` → `TypeError: Cannot read properties of undefined (reading 'prototype')`, porque
 *     `@swc/jest` borra los tipos sin comprobarlos y el import se elide.
 * El segundo rojo es el que importa, y es la misma FORMA de fallo que `CLAUDE.md` documenta para un
 * puerto importado con `import type` en un archivo con decoradores: el símbolo llega `undefined` en
 * ejecución. No está medido contra Nest —eso exige un módulo, y aquí no hay ninguno—.
 *
 * Qué caza el caso que usa este helper, y qué NO — no promete más de lo que mide. Las dos filas
 * intermedias se midieron juntas en el segundo rojo de esta tarea: un stub con
 * `constructor(readonly probe: string)` y un `ping()` concreto disparó **las dos mitades** de la
 * aserción (`constructorArity: 1` y `prototypeMembers: ['constructor', 'ping']`).
 *
 * | Lo que rompe                                   | ¿Lo caza? | Por qué                                                         |
 * | ---------------------------------------------- | --------- | --------------------------------------------------------------- |
 * | Convertirlo en `type` + `Symbol`               | **Sí**    | Doble rojo, medido arriba. Es su valor principal                |
 * | Añadirle un método o getter CONCRETO           | **Sí**    | `prototypeMembers` deja de ser `['constructor']`                |
 * | Añadirle una **parameter property**            | **Sí**    | `constructorArity` deja de ser 0                                |
 * | Añadirle un **campo declarado** sin inicializar | **No**    | No emite nada en el prototipo. Lo cazaría el compilador en un fake por objeto literal (`TS2741`, medido en `users/domain/ports/user.repository.ts`) — no este caso |
 * | Un `protected constructor()` VACÍO             | **No, y no hace falta** | No emite nada distinguible ni rompe los fakes; se prohíbe por ser código muerto: los adaptadores hacen `implements`, así que no se ejecuta |
 */
type PortClass = { readonly prototype: object; readonly length: number };

export const readPortShape = (
  port: PortClass,
): { prototypeMembers: string[]; constructorArity: number } => ({
  prototypeMembers: Object.getOwnPropertyNames(port.prototype),
  constructorArity: port.length,
});
