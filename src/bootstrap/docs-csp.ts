import { randomBytes } from 'node:crypto';

import type { IncomingMessage, ServerResponse } from 'node:http';

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import helmet from 'helmet';

/**
 * helmet tipa sus directivas dinámicas con los tipos de `node:http`, no con los de Express, y
 * `ServerResponse` no declara `locals`. En ejecución es el mismo objeto —Express extiende esa
 * clase— así que la lectura es segura; este tipo lo hace explícito en lugar de esconderlo tras
 * un `as any`.
 */
type ResponseWithLocals = ServerResponse & { locals?: { cspNonce?: string } };

/**
 * Política completa —no incremental— para la ruta de la documentación.
 *
 * helmet usa `res.setHeader`, así que esta cabecera **sobrescribe** la global en lugar de sumarse
 * a ella: no hay intersección de políticas, pero tampoco se hereda nada. Por eso están declaradas
 * todas las directivas, incluidas `base-uri`, `object-src` y `frame-ancestors`, que la global
 * aportaba y que si no desaparecerían justo en la única página HTML que sirve este servicio.
 *
 * `script-src` sin `'unsafe-eval'` es viable **verificado, no supuesto**: el bundle de Scalar
 * tiene cero ocurrencias de `eval(` y `new Function`, y cero de `new Worker` / `serviceWorker`,
 * así que tampoco hace falta `worker-src`.
 */
export const DOCS_CSP_DIRECTIVES = {
  defaultSrc: ["'none'"],
  scriptSrc: [
    "'self'",
    (_req: IncomingMessage, res: ServerResponse): string =>
      `'nonce-${(res as ResponseWithLocals).locals?.cspNonce ?? ''}'`,
  ],
  // ⚠️ NO añadir el nonce aquí, por simétrico que parezca con `scriptSrc`.
  //
  // Lo documenta el propio proveedor, en
  // `node_modules/@scalar/client-side-rendering/dist/html-rendering.d.ts`:
  //
  //   "Note: `style-src` still needs `'unsafe-inline'`, because the reference renders inline
  //    `style="..."` attributes that a CSP nonce cannot authorize."
  //
  // En CSP Level 3, una directiva que contiene un nonce hace que `'unsafe-inline'` se **ignore**
  // en esa directiva. Los `<style>` de Scalar seguirían funcionando —llevan nonce—, pero todos
  // los atributos `style="…"` dejarían de aplicarse, y eso es justo lo que Scalar emite.
  //
  // El resultado sería una página que carga, sin un solo error de JavaScript, con el layout
  // destrozado. Ningún test de cabeceras lo detecta: `docs-csp.spec.ts` vigila esta directiva.
  styleSrc: ["'unsafe-inline'"],
  fontSrc: ["'self'"],
  imgSrc: ["'self'", 'data:'],
  connectSrc: ["'self'"],
  baseUri: ["'self'"],
  objectSrc: ["'none'"],
  frameAncestors: ["'none'"],
  formAction: ["'self'"],
} as const;

/** Genera un nonce por petición y lo deja en `res.locals`, para helmet y para Scalar. */
export const createNonceMiddleware =
  (): RequestHandler =>
  (_req: Request, res: Response, next: NextFunction): void => {
    res.locals.cspNonce = randomBytes(16).toString('base64');
    next();
  };

/**
 * CSP y `Referrer-Policy` acotadas a la ruta de la documentación.
 *
 * Se aplican también en desarrollo, a propósito: lo que rompa, que rompa en local. Hasta ahora la
 * CSP global estaba desactivada en dev porque estorbaba a Swagger UI, y eso significaba que un
 * problema de CSP solo se manifestaba al desplegar.
 *
 * `Referrer-Policy: no-referrer` evita que la URL de la documentación —que puede incluir un
 * hostname interno— viaje en la cabecera `Referer` de cualquier recurso que la página solicite.
 */
export const createDocsCsp = (): RequestHandler[] => [
  createNonceMiddleware(),
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      // El `as const` de arriba congela los arrays a `readonly`, y helmet los pide mutables.
      // La copia es superficial a propósito: solo desanda el `readonly`, no clona valores.
      directives: Object.fromEntries(
        Object.entries(DOCS_CSP_DIRECTIVES).map(([key, value]) => [key, [...value]]),
      ),
    },
    referrerPolicy: { policy: 'no-referrer' },
  }),
];
