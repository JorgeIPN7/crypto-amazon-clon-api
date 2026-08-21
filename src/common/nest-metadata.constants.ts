/**
 * Claves de metadatos internas de Nest que este repo necesita leer, copiadas aquí en vez de
 * importadas de `@nestjs/common/constants`.
 *
 * ⚠️ Ese import era profundo y a un entrypoint **no declarado**: medido sobre
 * `@nestjs/common@11.2.1`, el paquete no publica `exports`, ni `main`, ni `types`, así que
 * `@nestjs/common/constants` resolvía únicamente por el algoritmo legacy de Node. El día que
 * Nest publique un mapa de `exports` —un cambio de minor rutinario y compatible— la aplicación
 * muere al arrancar con `ERR_PACKAGE_PATH_NOT_EXPORTED` mientras `pnpm typecheck` sigue verde,
 * porque los tipos se resuelven por el mismo camino que se rompe.
 *
 * Y la variante blanda es PEOR que la dura: si la constante se renombra en vez de
 * desaparecer, `reflector.get(undefined, …)` no lanza, devuelve `undefined`. `isSse` se queda
 * en `false` para siempre y el primer endpoint `@Sse()` que alguien añada recibe en silencio
 * el sobre de respuesta y un `timeout()` sobre un stream infinito. Hoy no hay ninguna ruta
 * `@Sse()`, así que el daño presente es nulo — y por eso hay que cerrarlo ahora, no cuando lo
 * haya.
 *
 * El literal no se queda huérfano: `__tests__/nest-metadata.constants.spec.ts` lo ancla al
 * decorador PÚBLICO que lo escribe, así que un renombrado en Nest se ve como un rojo de
 * `pnpm test` en vez de como una función que deja de hacer nada. `eslint.config.mjs` prohíbe
 * el import profundo para que no vuelva por la puerta de atrás.
 */

/** Escrita por `@Sse()` sobre el método del handler. */
export const SSE_METADATA = '__sse__';

/** Escrita por los decoradores de parámetro (`@Req()`, `@Body()`, …) sobre la clase. */
export const ROUTE_ARGS_METADATA = '__routeArguments__';
