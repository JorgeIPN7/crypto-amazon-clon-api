import { appConfig } from '../app.config';
import { authConfig } from '../auth.config';
import { corsConfig } from '../cors.config';
import { logConfig } from '../log.config';
import { docsConfig } from '../docs.config';
import { throttlerConfig } from '../throttler.config';
import { validateEnv } from '../validate-env';

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('appConfig', () => {
  it('debería derivar los flags de entorno a partir de NODE_ENV', () => {
    // Arrange
    // JWT_SECRET es obligatorio en production por el refine de auth en env.schema.ts;
    // no tiene relación con lo que este caso comprueba (los flags derivados de NODE_ENV).
    withEnv({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(32) });

    // Act
    const config = appConfig();

    // Assert
    expect(config.env).toBe('production');
    expect(config.isProduction).toBe(true);
    expect(config.isDevelopment).toBe(false);
    expect(config.isTest).toBe(false);
  });

  it('debería convertir los límites de salud de MB a bytes', () => {
    // Arrange
    withEnv({ HEALTH_HEAP_LIMIT_MB: '10', HEALTH_RSS_LIMIT_MB: '20' });

    // Act
    const config = appConfig();

    // Assert
    expect(config.healthHeapLimitBytes).toBe(10 * 1024 * 1024);
    expect(config.healthRssLimitBytes).toBe(20 * 1024 * 1024);
  });

  it('debería exponer host, puerto y prefijo tomados del entorno', () => {
    // Arrange
    withEnv({ HOST: '127.0.0.1', PORT: '9090', GLOBAL_PREFIX: 'gateway' });

    // Act
    const config = appConfig();

    // Assert
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(9090);
    expect(config.globalPrefix).toBe('gateway');
  });
});

describe('corsConfig', () => {
  it('debería habilitar todos los orígenes cuando CORS_ORIGINS es "*"', () => {
    // Arrange
    withEnv({ CORS_ORIGINS: '*', CORS_CREDENTIALS: 'false' });

    // Act
    const config = corsConfig();

    // Assert
    expect(config.options.origin).toBe(true);
    expect(config.options.credentials).toBe(false);
  });

  it('debería usar la lista explícita de orígenes cuando se define', () => {
    // Arrange
    withEnv({ CORS_ORIGINS: 'https://a.com,https://b.com' });

    // Act
    const config = corsConfig();

    // Assert
    expect(config.options.origin).toEqual(['https://a.com', 'https://b.com']);
  });

  it('debería rechazar la combinación de comodín con credenciales', () => {
    // Arrange
    withEnv({ CORS_ORIGINS: '*', CORS_CREDENTIALS: 'true' });

    // Act + Assert
    expect(() => corsConfig()).toThrow(/CORS misconfiguration/);
  });

  it('debería exponer la cabecera x-request-id al cliente', () => {
    // Arrange
    withEnv({});

    // Act
    const config = corsConfig();

    // Assert
    expect(config.options.exposedHeaders).toContain('x-request-id');
  });

  // Reproduce el round-trip real de `@nestjs/config`: valida lo que viene del fichero
  // `.env`, copia a `process.env` solo los escalares —que es lo que hace
  // `assignVariablesToProcess`— y deja que el factory vuelva a parsear desde ahí.
  // Es el mecanismo exacto por el que la allowlist se perdía en silencio.
  it('debería conservar la allowlist tras el round-trip por process.env', () => {
    // Arrange
    assignScalarsToProcessEnv(
      validateEnv({ CORS_ORIGINS: 'https://app.example.com', CORS_CREDENTIALS: 'true' }),
    );

    // Act
    const config = corsConfig();

    // Assert
    expect(config.options.origin).toEqual(['https://app.example.com']);
    expect(config.options.credentials).toBe(true);
  });

  it('debería conservar los campos a redactar tras el mismo round-trip', () => {
    // Arrange
    assignScalarsToProcessEnv(validateEnv({ LOG_REDACT_FIELDS: 'req.body.ssn' }));

    // Act
    const config = logConfig();

    // Assert
    expect(config.redact).toEqual(['req.body.ssn']);
  });
});

describe('logConfig', () => {
  it('debería reflejar el nivel y el modo pretty del entorno', () => {
    // Arrange
    withEnv({ LOG_LEVEL: 'debug', LOG_PRETTY: 'true' });

    // Act
    const config = logConfig();

    // Assert
    expect(config.level).toBe('debug');
    expect(config.pretty).toBe(true);
  });

  it('debería exponer los campos a redactar como array', () => {
    // Arrange
    withEnv({ LOG_REDACT_FIELDS: 'password,token' });

    // Act
    const config = logConfig();

    // Assert
    expect(config.redact).toEqual(['password', 'token']);
  });
});

describe('docsConfig', () => {
  it('debería reflejar el estado y la ruta configurados', () => {
    // Arrange
    withEnv({ DOCS_ENABLED: 'false', DOCS_PATH: 'openapi' });

    // Act
    const config = docsConfig();

    // Assert
    expect(config.enabled).toBe(false);
    expect(config.path).toBe('openapi');
  });
});

describe('throttlerConfig', () => {
  it('debería exponer ttl y limit como números', () => {
    // Arrange
    withEnv({ THROTTLER_TTL_MS: '30000', THROTTLER_LIMIT: '5' });

    // Act
    const config = throttlerConfig();

    // Assert
    expect(config.ttlMs).toBe(30_000);
    expect(config.limit).toBe(5);
  });
});

describe('authConfig', () => {
  // Ver la nota del spy más abajo: `console.warn` es global y un mock sin restaurar
  // contaminaría las suites siguientes.
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('debería reflejar el secret y la vida del token configurados', () => {
    // Arrange
    const secret = 'x'.repeat(32);
    withEnv({ JWT_SECRET: secret, JWT_EXPIRES_IN_S: '900' });

    // Act
    const config = authConfig();

    // Assert
    expect(config.jwtSecret).toBe(secret);
    expect(config.jwtExpiresInSeconds).toBe(900);
  });

  it('debería aplicar el secret inseguro de desarrollo cuando falta JWT_SECRET', () => {
    // Arrange
    withEnv({ NODE_ENV: 'development' });
    // La ausencia se construye, no se hereda: `test/setup-env.ts` fija JWT_SECRET para
    // todas las suites (y un shell con la variable exportada rompía este caso igual).
    delete process.env.JWT_SECRET;
    // Este camino avisa por consola a propósito. Se silencia para no ensuciar la salida, y se
    // afirma para que taparlo no equivalga a perderlo: si alguien borra el `console.warn` de
    // `auth.config.ts`, este test se pone rojo en vez de quedarse verde en silencio.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    // Act
    const config = authConfig();

    // Assert
    expect(config.jwtSecret).toContain('insecure-dev-secret');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('JWT_SECRET no definido');
  });
});

// Helpers

const withEnv = (overrides: Record<string, string>): void => {
  process.env = { ...ORIGINAL_ENV, ...overrides };
};

/**
 * Réplica fiel de `assignVariablesToProcess` de `@nestjs/config`: solo `string`,
 * `number` y `boolean` llegan a `process.env`; cualquier otro tipo se descarta.
 */
const assignScalarsToProcessEnv = (validated: Record<string, unknown>): void => {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(validated)) {
    if (typeof value === 'string') {
      next[key] = value;
    } else if (typeof value === 'boolean' || typeof value === 'number') {
      next[key] = `${value}`;
    }
  }
  process.env = next;
};
