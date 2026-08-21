import type { IncomingMessage, ServerResponse } from 'node:http';

import { DOCS_CSP_DIRECTIVES, createNonceMiddleware } from '../docs-csp';

describe('createNonceMiddleware', () => {
  it('debería generar un nonce distinto en cada petición', () => {
    // Arrange
    const middleware = createNonceMiddleware();
    const first = fakeResponse();
    const second = fakeResponse();

    // Act
    middleware({} as never, first as never, () => undefined);
    middleware({} as never, second as never, () => undefined);

    // Assert
    // Un nonce reutilizado entre peticiones deja de ser un nonce: quien lo capture una vez
    // puede inyectar scripts en cualquier respuesta posterior.
    expect(first.locals.cspNonce).toBeDefined();
    expect(second.locals.cspNonce).not.toBe(first.locals.cspNonce);
  });

  it('debería ceder el paso al siguiente middleware', () => {
    // Arrange
    const middleware = createNonceMiddleware();
    let called = false;

    // Act
    middleware({} as never, fakeResponse() as never, () => {
      called = true;
    });

    // Assert
    expect(called).toBe(true);
  });
});

describe('DOCS_CSP_DIRECTIVES', () => {
  it('debería declarar default-src none y script-src sin unsafe-eval', () => {
    // Arrange
    const response = fakeResponse({ cspNonce: 'n' });

    // Act
    const scriptSrc = DOCS_CSP_DIRECTIVES.scriptSrc.map((entry) =>
      typeof entry === 'function'
        ? entry({} as IncomingMessage, response as unknown as ServerResponse)
        : entry,
    );

    // Assert
    expect(DOCS_CSP_DIRECTIVES.defaultSrc).toEqual(["'none'"]);
    expect(scriptSrc).toEqual(["'self'", "'nonce-n'"]);
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it('debería mantener style-src con unsafe-inline y SIN nonce', () => {
    // Arrange
    const styleSrc = DOCS_CSP_DIRECTIVES.styleSrc;

    // Act
    const serialized = JSON.stringify(styleSrc);

    // Assert
    // En CSP Level 3, una directiva que contiene un nonce hace que `'unsafe-inline'` se ignore.
    // Scalar emite atributos `style="…"`, que un nonce no puede autorizar: añadirlo aquí
    // rompería el layout entero sin un solo error de JavaScript, y ningún test de cabeceras lo
    // detectaría. Este test existe para impedir esa «mejora».
    expect(styleSrc).toEqual(["'unsafe-inline'"]);
    expect(serialized).not.toContain('nonce');
  });

  it('debería restituir las directivas que la política global aportaba', () => {
    // Arrange
    const directives = DOCS_CSP_DIRECTIVES;

    // Act
    const restored = {
      baseUri: directives.baseUri,
      objectSrc: directives.objectSrc,
      frameAncestors: directives.frameAncestors,
      formAction: directives.formAction,
    };

    // Assert
    // helmet usa `setHeader`: esta cabecera sobrescribe la global en vez de sumarse. Sin
    // declararlas aquí, desaparecerían justo en la única página HTML que sirve el servicio.
    expect(restored).toEqual({
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
    });
  });

  it('debería restringir a self todo origen de red', () => {
    // Arrange
    const directives = DOCS_CSP_DIRECTIVES;

    // Act
    const network = [directives.connectSrc, directives.fontSrc, directives.imgSrc].flat();

    // Assert
    // El backstop de la decisión tomada en `buildScalarConfig`: si alguna opción de terceros
    // volviera a colarse, el navegador la corta.
    expect(network.filter((source) => source.startsWith('http'))).toEqual([]);
  });
});

// Helpers

/**
 * Lo mínimo que estas dos APIs miran del `res`: su `locals`. El cast se hace en cada punto de
 * uso porque `createNonceMiddleware` recibe el `Response` de Express y las directivas de helmet
 * el `ServerResponse` de `node:http` — en runtime es el mismo objeto.
 */
const fakeResponse = (
  locals: Record<string, unknown> = {},
): { locals: Record<string, unknown> } => ({
  locals,
});
