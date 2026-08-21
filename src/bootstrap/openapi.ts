import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { INestApplication } from '@nestjs/common';
// `require(esm)` está sin flag desde Node 22.12 — de ahí el pin de `engines`, que no es
// cosmético: este paquete distribuye un `index.cjs` que hace `require()` de
// `@scalar/client-side-rendering`, que es ESM puro. Sigue fallando si ese grafo introduce
// *top-level await*, y entonces el error es `ERR_REQUIRE_ASYNC_MODULE`, no `ERR_REQUIRE_ESM`.
// El remedio en ese caso es `await import()`, NUNCA bajar la versión de Node.
import { apiReference } from '@scalar/nestjs-api-reference';
import express, { type Request, type Response } from 'express';

import type { AppConfig } from '@config/app.config';
import type { DocsConfig } from '@config/docs.config';

import { createDocsAuth } from './docs-auth';
import { createDocsCsp } from './docs-csp';
import { buildOpenApiDocument } from './openapi-document';
import { buildScalarConfig } from './scalar-config';

/**
 * `public/` en la raíz, **no** `dist/public/`.
 *
 * `nest-cli.json` tiene `deleteOutDir: true`, y eso no solo afecta a `nest build`:
 * `nest start --watch` también vacía `dist` al arrancar. Con el asset ahí dentro, el hook que lo
 * copia quedaría en «copiar → borrar → compilar» y el bundle desaparecería en desarrollo,
 * mientras que en Docker sobreviviría. Fuera de `dist`, `deleteOutDir` deja de importar.
 */
const PUBLIC_DIR = join(process.cwd(), 'public');

type AssetManifest = { fileName: string; version: string; bytes: number };

const readAssetManifest = (): AssetManifest => {
  try {
    return JSON.parse(
      readFileSync(join(PUBLIC_DIR, 'scalar-asset.json'), 'utf-8'),
    ) as AssetManifest;
  } catch {
    throw new Error(
      'No se encontró el bundle de Scalar en public/. Ejecuta `pnpm assets:scalar` — lo hacen ' +
        'automáticamente `prebuild`, `prestart:dev`, `pretest:e2e` y `pretest:e2e:ci`.',
    );
  }
};

/**
 * Monta la documentación OpenAPI, renderizada por Scalar desde el propio origen.
 *
 * Devuelve la ruta montada, o `null` si está deshabilitada.
 *
 * **El orden de montaje es significativo**, y por eso lo fija un test: el middleware de Scalar
 * responde a CUALQUIER path bajo su punto de montaje, así que todo lo que tenga ruta propia va
 * antes. Registrado al revés, `<docs>/json` devolvería el HTML de la interfaz en lugar del
 * documento, y quien generase un SDK obtendría una página web.
 */
export function setupOpenApi(
  app: INestApplication,
  appCfg: AppConfig,
  docsCfg: DocsConfig,
  /**
   * Inyectable solo para los tests de montaje, que miran el orden de los middleware y no el
   * contenido del documento. Se pasa como parámetro en vez de espiar el módulo porque SWC emite
   * los exports con getters no configurables y `jest.spyOn` falla con «Cannot redefine
   * property» — y porque un fake escrito a mano es lo que pide la convención del repo.
   */
  buildDocument: typeof buildOpenApiDocument = buildOpenApiDocument,
  /**
   * Inyectable por la misma razón, y además por una propia: `public/` es un artefacto de build
   * ignorado por git que solo generan `prebuild`, `prestart:dev`, `pretest:e2e` y
   * `pretest:e2e:ci`. La suite unitaria no dispara ninguno —en CI corre antes que el E2E y que
   * el build—, así que leer el manifiesto de disco ataba `pnpm test` a un paso previo que nadie
   * ejecuta: verde en local por los restos de un build anterior, rojo en un clon limpio y rojo
   * en CI.
   *
   * `pretest:e2e:ci` es el cuarto porque faltaba, y su ausencia rompió la CI (2026-08-13): los
   * hooks de pnpm se resuelven por nombre EXACTO, así que `pretest:e2e` no se dispara con
   * `pnpm test:e2e:ci`. En local nunca se notó —`public/` sobrevive de cualquier build
   * anterior—, y en el runner limpio reventaron las 12 pruebas de `openapi.e2e-spec.ts`.
   *
   * Lo que estos tests observan es el orden de montaje, no el nombre del archivo servido. Que la
   * URL del bundle apunte al asset real lo comprueba el E2E, que sí lo tiene generado.
   */
  readManifest: () => AssetManifest = readAssetManifest,
): string | null {
  if (!docsCfg.enabled) {
    return null;
  }

  const document = buildDocument(app, appCfg);
  const path = `${appCfg.globalPrefix}/${docsCfg.path}`;
  const base = `/${path}`;
  const { fileName } = readManifest();

  // 1. Basic Auth, lo primero: protege la interfaz, el bundle y el documento crudo.
  if (docsCfg.username && docsCfg.password) {
    app.use(base, createDocsAuth({ username: docsCfg.username, password: docsCfg.password }));

    if (appCfg.trustProxy === 0) {
      // Detectable al arrancar, así que no depende de que alguien lea el README dentro de seis
      // meses. Warning y no error: la combinación es legítima en local.
      //
      // Con un proxy delante y `trust proxy` a 0, `req.ip` es la IP del proxy y todos los
      // clientes comparten contador. Lo que se degrada es la **disponibilidad** —cualquiera
      // puede dejar sin documentación al resto quemando el contador— no la protección: quien
      // ataca se auto-limita. El mismo problema afecta ya al `ThrottlerGuard`, que también
      // trackea por `req.ip`; esto no lo crea, lo extiende a una superficie sensible.
      console.warn(
        '[docs] Basic Auth activa con TRUST_PROXY=0. Si hay un reverse proxy delante, el ' +
          'limitador de intentos agrupará a todos los clientes en un solo contador.',
      );
    }
  }

  // 2. CSP + nonce por petición.
  for (const middleware of createDocsCsp()) {
    app.use(base, middleware);
  }

  // 3. El bundle. Se monta en `base`, NO en `${base}/${fileName}`: Express quita el punto de
  //    montaje de `req.url`, así que montarlo con el nombre del archivo dejaría a
  //    `express.static` recibiendo `/`, sin resolver nada y llamando a `next()` — la petición
  //    acabaría en el catch-all de Scalar, devolviendo HTML donde el navegador espera
  //    JavaScript. Montado en `base`, static resuelve el nombre y los paths que no existen como
  //    archivo caen a `next()`, así que `/json` y el catch-all siguen funcionando.
  app.use(
    base,
    express.static(PUBLIC_DIR, {
      index: false,
      // `redirect: false` es obligatorio, no una preferencia. Con su default `true`,
      // `express.static` ve la raíz del punto de montaje como un directorio y responde a
      // `/api/docs` con un 301 a `/api/docs/` en vez de dejar pasar al catch-all de Scalar.
      // Medido: la ruta sin barra devolvía «Redirecting to /api/docs/» y no la interfaz.
      redirect: false,
      // `immutable` exige una URL direccionada por contenido, y el nombre lleva hash: al subir
      // de versión cambia la URL y el navegador vuelve a pedirlo. `private` y no `public`
      // porque con Basic Auth la respuesta es autenticada y no debe quedar en un proxy.
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js')) {
          res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
        }
      },
    }),
  );

  // 4. El documento crudo, para generar SDKs y para que Scalar lo cargue.
  app.use(`${base}/json`, (_req: Request, res: Response) => {
    res.type('application/json').send(document);
  });

  // 5. Scalar (catch-all).
  app.use(base, (req: Request, res: Response) => {
    const config = buildScalarConfig({
      bundleUrl: `${base}/${fileName}`,
      documentUrl: `${base}/json`,
      nonce: String(res.locals.cspNonce ?? ''),
      title: 'Nest Base Template API',
    });
    return apiReference(config)(req, res);
  });

  return path;
}
