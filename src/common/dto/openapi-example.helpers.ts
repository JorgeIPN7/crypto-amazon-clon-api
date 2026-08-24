import { buildErrorExample, REQUEST_ID, TIMESTAMP } from './error-example.factory';

/**
 * Lo que `TransformInterceptor` añade a toda respuesta de éxito.
 *
 * Estaba duplicado LITERALMENTE en los tres controllers —`users`, `auth` y `orders`— con los
 * mismos dos valores escritos a mano en cada copia. Aquí sale una sola vez y de las constantes
 * de la factoría, así que el ejemplo de éxito y el de error de un mismo endpoint ya no pueden
 * anunciar instantes ni request-ids distintos.
 */
export const requestMeta = (
  path: string,
): { timestamp: string; path: string; requestId: string } => ({
  timestamp: TIMESTAMP,
  path,
  requestId: REQUEST_ID,
});

/**
 * Cuerpo de error tal y como lo emite `AllExceptionsFilter`, no como lo lanza el dominio.
 *
 * Los ejemplos de error salen SIEMPRE de la factoría, que **deriva `error` del status** en vez
 * de recibirlo. Escribirlo a mano fue el origen de dos ficciones en la primera versión de
 * `users.controller.ts`: anunciaba `EmailAlreadyTakenError` y `UserNotFoundError`, cuando el
 * filtro publica los nombres canónicos `Conflict` y `Not Found`. La causa está medida:
 * `AllExceptionsFilter` calcula `error` como `body.error ?? exception.name`, y los filtros de
 * dominio construyen la excepción de Nest **con un string** —`new NotFoundException(msg)`—, lo
 * que hace que Nest rellene `body.error` con el nombre canónico. El nombre de la clase de
 * dominio nunca llega al cliente, así que documentarlo publicaba un discriminante que ningún
 * cliente puede observar.
 *
 * Este helper es azúcar sobre `buildErrorExample`: reordena los tres datos a posicionales
 * porque es como se leen en un decorador. Todo lo que hace la factoría —derivar `error`, seguir
 * las claves de `ErrorPayload`— sigue intacto.
 */
export const errorExample = (statusCode: number, message: string, path: string) =>
  buildErrorExample(statusCode, { path, message });
