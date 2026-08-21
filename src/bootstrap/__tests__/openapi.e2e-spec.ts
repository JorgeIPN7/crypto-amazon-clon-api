import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';

import { createTestApp } from '@test/helpers/create-test-app';

describe('OpenAPI docs (e2e)', () => {
  describe('con la documentación habilitada y sin credenciales', () => {
    let app: INestApplication<App>;
    let docsPath: string;

    beforeAll(async () => {
      // Las credenciales se borran explícitamente: `ConfigModule` lee el `.env` del proyecto, y
      // un `.env` local con `DOCS_USERNAME` puesto haría que este bloque recibiera 401 en vez de
      // 200. Un test que depende de la máquina donde corre no prueba nada.
      const created = await withEnv(
        { DOCS_ENABLED: 'true', DOCS_USERNAME: undefined, DOCS_PASSWORD: undefined },
        () => createTestApp({ withDocs: true }),
      );
      app = created.app;
      docsPath = `/${created.docsPath ?? ''}`;
    });

    afterAll(async () => {
      await app.close();
    });

    // ⚠️ LECCIÓN DEL CHECKPOINT MANUAL: se prueban **las dos formas de la URL**. `express.static`
    // con su `redirect: true` por defecto respondía a `/api/docs` con un 301 a `/api/docs/` en
    // lugar de dejar pasar al catch-all de Scalar. No lo cazó ningún test porque el E2E solo
    // probaba la forma canónica — y la que teclea una persona es la otra.
    it.each([
      ['sin barra final', ''],
      ['con barra final', '/'],
    ])('debería servir la interfaz %s', async (_caso, suffix) => {
      // Arrange
      // (app montada en beforeAll)

      // Act
      const response = await request(app.getHttpServer()).get(`${docsPath}${suffix}`);

      // Assert
      expect(response.status).toBe(200);
      expect(response.text).toContain('createApiReference');
    });

    it('debería apuntar el bundle al propio origen y nunca a un CDN', async () => {
      // Arrange
      // (app montada en beforeAll)

      // Act
      const response = await request(app.getHttpServer()).get(docsPath);

      // Assert
      expect(response.text).toContain(`${docsPath}/scalar.`);
      expect(response.text).not.toContain('jsdelivr');
    });

    it('debería usar en la cabecera CSP el mismo nonce que estampa en el script', async () => {
      // Arrange
      // (app montada en beforeAll)

      // Act
      const response = await request(app.getHttpServer()).get(docsPath);
      const header = String(response.headers['content-security-policy'] ?? '');
      const fromHeader = /'nonce-([^']+)'/.exec(header)?.[1];
      const fromHtml = /<script[^>]*\snonce="([^"]+)"/.exec(response.text)?.[1];

      // Assert
      // Asertar solo «hay una cabecera CSP» pasaría igual si la que sobrevive fuese la global sin
      // nonce. Comparar ambos valores fija a la vez unicidad, orden de montaje y propagación.
      expect(fromHeader).toBeDefined();
      expect(fromHtml).toBe(fromHeader);
      expect(header).toContain("default-src 'none'");
      expect(header).not.toContain("'unsafe-eval'");
    });

    it('debería devolver el documento OpenAPI en /json, no el HTML de la interfaz', async () => {
      // Arrange
      // (app montada en beforeAll)

      // Act
      const response = await request(app.getHttpServer()).get(`${docsPath}/json`);

      // Assert
      expect(response.status).toBe(200);
      expect(String(response.headers['content-type'])).toContain('application/json');
      expect(String((response.body as { openapi: string }).openapi)).toMatch(/^3\./);
    });

    it('debería servir el bundle como privado e inmutable', async () => {
      // Arrange
      const html = await request(app.getHttpServer()).get(docsPath);
      const bundleUrl = /src="([^"]*scalar\.[^"]+\.js)"/.exec(html.text)?.[1] ?? '';

      // Act
      const response = await request(app.getHttpServer()).get(bundleUrl);

      // Assert
      const cacheControl = String(response.headers['cache-control']);
      expect(response.status).toBe(200);
      expect(cacheControl).toContain('immutable');
      expect(cacheControl).toContain('private');
    });

    it('debería servir una configuración sin dependencias de terceros', async () => {
      // Arrange
      const html = await request(app.getHttpServer()).get(docsPath);

      // Act
      // Se parsea el objeto en vez de buscar substrings: `toContain('"telemetry": false')`
      // dependería del espaciado con que Scalar serialice y se rompería con un cambio de formato
      // que no altera el comportamiento.
      const config = extractScalarConfig(html.text);

      // Assert
      expect(config.telemetry).toBe(false);
      expect(config.withDefaultFonts).toBe(false);
      expect(config.proxyUrl).toBe('');
      expect(config.agent).toEqual({ disabled: true });
    });
  });

  describe('con credenciales configuradas', () => {
    let app: INestApplication<App>;
    let docsPath: string;
    /** Avisos emitidos al montar. Ver el test que los afirma al final de este bloque. */
    let mountWarnings: string[];

    beforeAll(async () => {
      // Montar Basic Auth con TRUST_PROXY=0 —el default— avisa por consola a propósito. Se
      // silencia aquí para no ensuciar la salida de la suite, pero se guarda lo emitido en vez
      // de descartarlo: taparlo sin afirmarlo dejaría que el aviso desapareciera sin que
      // ningún test se enterase.
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const created = await withEnv(
        { DOCS_ENABLED: 'true', DOCS_USERNAME: 'equipo', DOCS_PASSWORD: 'secreto' },
        () => createTestApp({ withDocs: true }),
      );
      mountWarnings = warn.mock.calls.map((call) => String(call[0]));
      warn.mockRestore();
      app = created.app;
      docsPath = `/${created.docsPath ?? ''}`;
    });

    afterAll(async () => {
      await app.close();
    });

    it('debería avisar al montar de que TRUST_PROXY=0 agrupa a todos los clientes', () => {
      // Arrange + Act
      // (el aviso se emite al montar la documentación, en el `beforeAll`)

      // Assert
      // Con un proxy delante y `trust proxy` a 0, el limitador de intentos mete a todos los
      // clientes en un solo contador. El aviso es la única señal de esa degradación, y sin
      // esta aserción quedaría silenciado por el spy de arriba sin que nadie lo notara.
      expect(mountWarnings.some((message) => message.includes('TRUST_PROXY=0'))).toBe(true);
    });

    it.each([
      ['la interfaz', ''],
      ['el documento crudo', '/json'],
    ])('debería exigir credenciales para %s', async (_caso, suffix) => {
      // Arrange
      // (app montada en beforeAll)

      // Act
      const response = await request(app.getHttpServer()).get(`${docsPath}${suffix}`);

      // Assert
      // El documento crudo importa tanto como la interfaz: publica el inventario completo de
      // endpoints y esquemas, que es justo lo que las credenciales protegen.
      expect(response.status).toBe(401);
      expect(String(response.headers['www-authenticate'])).toContain('Basic');
    });

    it('debería dejar pasar con las credenciales correctas', async () => {
      // Arrange
      // (app montada en beforeAll)

      // Act
      const response = await request(app.getHttpServer()).get(docsPath).auth('equipo', 'secreto');

      // Assert
      expect(response.status).toBe(200);
      expect(response.text).toContain('createApiReference');
    });

    it('debería rechazar unas credenciales incorrectas', async () => {
      // Arrange
      // (app montada en beforeAll)

      // Act
      const response = await request(app.getHttpServer()).get(docsPath).auth('equipo', 'otra');

      // Assert
      expect(response.status).toBe(401);
    });
  });

  describe('con la documentación deshabilitada', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      ({ app } = await withEnv({ DOCS_ENABLED: 'false' }, () => createTestApp({ withDocs: true })));
    });

    afterAll(async () => {
      await app.close();
    });

    it.each(['/api/docs', '/api/docs/json', '/api/docs/scalar.cualquiera.js'])(
      'debería devolver 404 en %s',
      async (route) => {
        // Arrange
        // (app montada en beforeAll)

        // Act
        const response = await request(app.getHttpServer()).get(route);

        // Assert
        // `DOCS_ENABLED=false` es la protección primaria en producción: no es que la ruta pida
        // credenciales, es que no existe.
        expect(response.status).toBe(404);
      },
    );
  });
});

// Helpers

/** Extrae y parsea el objeto que Scalar serializa en `Scalar.createApiReference('#app', {…})`. */
const extractScalarConfig = (html: string): Record<string, unknown> => {
  const match = /Scalar\.createApiReference\([^,]+,\s*(\{[\s\S]*?\})\s*\)/.exec(html);
  if (!match?.[1]) {
    throw new Error('No se encontró la configuración de Scalar en el HTML servido.');
  }
  return JSON.parse(match[1]) as Record<string, unknown>;
};

/**
 * Ejecuta algo con unas variables de entorno puestas y las restaura después.
 *
 * `ConfigModule` se construye al compilar el `AppModule`, así que las variables tienen que estar
 * en `process.env` antes de llamar a `createTestApp` — y hay que devolverlas a su sitio, o el
 * siguiente `describe` heredaría la configuración del anterior.
 */
const withEnv = async <T>(
  vars: Record<string, string | undefined>,
  run: () => Promise<T>,
): Promise<T> => {
  const previous = Object.entries(vars).map(([key]) => [key, process.env[key]] as const);

  // `undefined` **borra** la variable en vez de asignarla. Hace falta para poder afirmar «este
  // caso corre sin credenciales» con independencia de lo que tenga el `.env` de quien ejecuta.
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
};
