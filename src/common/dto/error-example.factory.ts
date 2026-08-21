import { STATUS_CODES } from 'node:http';

import type { ErrorPayload } from '../filters/all-exceptions.filter';

/**
 * Fija los campos que no aportan nada al leer un ejemplo, para que dos ejemplos de endpoints
 * distintos solo difieran en lo que de verdad los distingue.
 */
const TIMESTAMP = '2026-08-01T10:15:00.000Z';
const REQUEST_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

/**
 * Status cuyo `error` **no** es el nombre canónico del status, con el motivo medido.
 *
 * `AllExceptionsFilter` calcula `error` como `body.error ?? exception.name`. Cuando una
 * `HttpException` se construye con un string —`new ConflictException('...')`, que es lo que hace
 * `UserDomainExceptionFilter`— Nest rellena `body.error` con el nombre canónico, así que el
 * nombre de la clase de dominio nunca llega al cliente. Estas dos son las excepciones reales:
 *
 * - **429:** `ThrottlerException` se construye con un string suelto, así que el filtro entra en
 *   la rama `typeof resp === 'string'` y `error` acaba siendo `exception.name`.
 * - **500:** un `Error` no-HTTP se sanea a mano en la rama `isProductionLike`.
 */
const NON_CANONICAL_ERRORS: Readonly<Record<number, string>> = {
  429: 'ThrottlerException',
  500: 'InternalServerError',
};

/** El `error` que el filtro publicaría para este status. Fuente única para código y guardián. */
export const expectedErrorName = (status: number): string =>
  NON_CANONICAL_ERRORS[status] ?? STATUS_CODES[status] ?? 'Unknown Error';

/**
 * Statuses cuya salida se ha contrastado contra `AllExceptionsFilter` de verdad.
 *
 * Cierra el lazo que `NON_CANONICAL_ERRORS` deja abierto. Esa tabla es una lista de excepciones,
 * y una lista de excepciones sin verificar es una suposición: nada obligaba a comprobar que un
 * status nuevo siguiera la regla canónica en vez de traer su propio `body.error`.
 *
 * Con este conjunto, la obligación deja de ser manual en los dos extremos:
 *
 * - `error-example.factory.spec.ts` comprueba que **cada** entrada de aquí coincide con lo que
 *   el filtro produce, así que añadir un status sin verificarlo no compila la promesa.
 * - `openapi-contract.e2e-spec.ts` comprueba que **todo** status de error publicado en el
 *   documento está aquí, así que documentar un 422 nuevo pone el guardián en rojo hasta que
 *   alguien lo contraste contra el filtro.
 */
export const VERIFIED_ERROR_STATUSES: ReadonlySet<number> = new Set([
  400, 401, 403, 404, 409, 429, 500,
]);

export type ErrorExampleOptions = {
  /** Ruta real del endpoint que documenta el ejemplo. */
  path: string;
  /** El `message` que el servidor produce en este caso concreto. */
  message: string;
  /** Solo para los errores que sí adjuntan contexto estructurado (hoy, la rama de `ZodError`). */
  details?: unknown;
};

/**
 * Construye el cuerpo de ejemplo de un error espejando a `AllExceptionsFilter`.
 *
 * Existe para eliminar una clase entera de defecto, no una instancia. Durante esta migración
 * aparecieron cuatro ejemplos que anunciaban cuerpos que el servidor no emite —`error` con el
 * nombre de la clase de dominio, un `details` que el `ValidationPipe` nunca envía, un 503 con la
 * forma de Terminus—. Escribir cada ejemplo a mano garantiza que vuelvan a divergir en cuanto
 * alguien añada un endpoint.
 *
 * Con esta factoría no pueden: el `error` se deriva del status y las claves salen de
 * `ErrorPayload`, así que un cambio en el filtro rompe la compilación aquí y arrastra a todos los
 * ejemplos a la vez. `openapi-contract.e2e-spec.ts` comprueba además que nadie se la salte.
 */
export const buildErrorExample = (
  status: number,
  { path, message, details }: ErrorExampleOptions,
): ErrorPayload => ({
  statusCode: status,
  message,
  error: expectedErrorName(status),
  ...(details !== undefined ? { details } : {}),
  timestamp: TIMESTAMP,
  path,
  requestId: REQUEST_ID,
});
