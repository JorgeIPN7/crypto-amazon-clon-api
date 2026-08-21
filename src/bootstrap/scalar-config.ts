import type { NestJSReferenceConfiguration } from '@scalar/nestjs-api-reference';

export type ScalarConfigParams = {
  /** Ruta del bundle en el propio origen, con hash de contenido. */
  bundleUrl: string;
  /** Ruta del documento OpenAPI crudo. Scalar lo descarga desde ahí. */
  documentUrl: string;
  /** Nonce de la petición, para que el `<script>` inline pase la CSP. */
  nonce: string;
  title: string;
};

/**
 * Construye la configuración de Scalar.
 *
 * Vive aparte y es pura por un motivo concreto: los tests aseveran sobre **este** objeto. Con las
 * opciones inline en `setupOpenApi()` habría que reconstruirlas en el test, y entonces se estaría
 * aseverando sobre una copia — el día que alguien cambiara `proxyUrl` en el runtime y no en el
 * test, pasaría en verde con la documentación hablando con `proxy.scalar.com`.
 *
 * El tipo de retorno tampoco es cosmético. `NestJSReferenceConfiguration` es lo que rechaza en
 * compilación una clave que no exista: durante el diseño de esta función se llegó a escribir
 * `agentEnabled`, que **no** forma parte del esquema público —es estado interno del componente
 * Vue—. Scalar la habría ignorado en silencio y los tests habrían pasado igual, aseverando sobre
 * un objeto propio. La clave real es `agent.disabled`.
 *
 * Cada dependencia de terceros se apaga aquí, explícitamente. La CSP es el backstop, no el
 * mecanismo: `connect-src 'self'` no *desactiva* el proxy, lo *bloquea*, y quien abriera la
 * documentación vería un botón «Test Request» roto en vez de una decisión de diseño.
 */
export function buildScalarConfig({
  bundleUrl,
  documentUrl,
  nonce,
  title,
}: ScalarConfigParams): NestJSReferenceConfiguration {
  return {
    // Solo `url`, sin `content`: el renderizador descarta `content` cuando hay `url` (ver
    // `getConfiguration` en `@scalar/client-side-rendering`), así que incluirlo solo inflaría
    // cada respuesta HTML con el documento entero.
    url: documentUrl,
    // Ruta del mismo origen, nunca el CDN. El paquete no permite adjuntar un hash `integrity`,
    // así que servirlo desde aquí es la única forma de saber qué código se ejecuta.
    cdn: bundleUrl,
    nonce,
    pageTitle: title,
    // Default del esquema de Scalar: `https://proxy.scalar.com`.
    proxyUrl: '',
    // Sin esto carga Inter y JetBrains Mono desde `fonts.scalar.com`.
    withDefaultFonts: false,
    telemetry: false,
    // Su default se autodetecta por la URL, así que en `localhost` estaría encendido.
    agent: { disabled: true },
    documentDownloadType: 'direct',
    // Font stack del sistema: mismo resultado visual, cero peticiones externas y cero peso.
    customCss:
      ':root { --scalar-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, ' +
      '"Helvetica Neue", Arial, sans-serif; --scalar-font-code: ui-monospace, SFMono-Regular, ' +
      'Menlo, Consolas, "Liberation Mono", monospace; }',
  };
}
