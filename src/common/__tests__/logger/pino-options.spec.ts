import type { IncomingMessage, ServerResponse } from 'node:http';

import fc from 'fast-check';
import pino, { type DestinationStream } from 'pino';
import { QueryFailedError } from 'typeorm';

import type { AppConfig } from '@config/app.config';
import type { LogConfig } from '@config/log.config';

import {
  DEFAULT_REDACT_PATHS,
  HEALTH_PATH_SUFFIXES,
  buildPinoHttpOptions,
  buildPrettyTransport,
  buildRedactPaths,
  generateRequestId,
  isHealthPath,
  serializeRequest,
  serializeResponse,
  type RequestWithId,
} from '../../logger/pino-options';

describe('isHealthPath', () => {
  it('debería devolver false cuando la url es undefined', () => {
    // Act
    const result = isHealthPath(undefined, 'api');

    // Assert
    expect(result).toBe(false);
  });

  it.each(['/health', '/healthz', '/livez', '/readyz'])(
    'debería reconocer "%s" como ruta de salud sin prefijo',
    (url) => {
      // Act
      const result = isHealthPath(url, '');

      // Assert
      expect(result).toBe(true);
    },
  );

  it('debería reconocer la ruta de salud detrás del prefijo global', () => {
    // Act
    const result = isHealthPath('/api/health/liveness', 'api');

    // Assert
    expect(result).toBe(true);
  });

  // Estas son las URL que la app sirve de verdad: `enableVersioning({type: URI})` mete
  // `/v1` entre el prefijo y la ruta. Comparar solo contra `/api/health` las dejaba fuera
  // del filtro, así que las sondas de k8s acababan en los logs pese a existir este código.
  it.each(['/api/v1/health', '/api/v1/health/liveness', '/api/v1/health/readiness'])(
    'debería reconocer "%s", que es la ruta versionada real',
    (url) => {
      // Act
      const result = isHealthPath(url, 'api');

      // Assert
      expect(result).toBe(true);
    },
  );

  it('debería reconocer un subrecurso de la ruta de salud', () => {
    // Act
    const result = isHealthPath('/health/readiness', '');

    // Assert
    expect(result).toBe(true);
  });

  it('debería ignorar el query string al clasificar la ruta', () => {
    // Act
    const result = isHealthPath('/api/v1/health?probe=liveness', 'api');

    // Assert
    expect(result).toBe(true);
  });

  it('debería devolver false para una ruta de negocio', () => {
    // Act
    const result = isHealthPath('/api/v1/invoices', 'api');

    // Assert
    expect(result).toBe(false);
  });

  // El caso que importa es sin segmento de versión: con `/api/v1/healthcare` la
  // implementación anterior acertaba por casualidad, porque comparaba contra `/api/health`
  // y ahí no encajaba. Es `/api/healthcare` la que se colaba como ruta de salud.
  it.each(['/api/healthcare', '/api/v1/healthcare', '/healthz-internal'])(
    'debería devolver false para "%s", que solo contiene el prefijo como substring',
    (url) => {
      // Act
      const result = isHealthPath(url, 'api');

      // Assert
      expect(result).toBe(false);
    },
  );

  it('debería devolver false para una ruta que empieza por "livez" sin ser esa ruta', () => {
    // Act
    const result = isHealthPath('/livezone', '');

    // Assert
    expect(result).toBe(false);
  });

  it('debería no confundir un prefijo parcial con el prefijo global', () => {
    // Act
    const result = isHealthPath('/apifoo/health', 'api');

    // Assert
    expect(result).toBe(false);
  });
});

describe('isHealthPath (property-based)', () => {
  // Función pura de dos strings, y con un defecto vivo hasta hace poco: la comparación
  // usaba `startsWith` sin exigir separador, así que cualquier ruta que empezara por
  // `/api/health` —`/api/healthcare`, `/api/healthz-internal`— se tomaba por sonda y
  // desaparecía de los logs.
  //
  // La precondición no es un adorno: `/healthz` es en sí una de las rutas de salud
  // conocidas, así que el sufijo `'z'` es un contraejemplo legítimo de la propiedad y no
  // un fallo del código. `fast-check` lo encontró; conviene dejarlo dicho.
  it('debería devolver false para un sufijo pegado que no forme otra ruta de salud', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z0-9-]{1,12}$/), (suffix) => {
        // Arrange
        fc.pre(!HEALTH_PATH_SUFFIXES.includes(`/health${suffix}`));

        // Act + Assert
        expect(isHealthPath(`/api/health${suffix}`, 'api')).toBe(false);
        expect(isHealthPath(`/api/v1/health${suffix}`, 'api')).toBe(false);
      }),
    );
  });

  it('debería reconocer todas las rutas de salud conocidas bajo prefijo y versión', () => {
    fc.assert(
      fc.property(fc.constantFrom(...HEALTH_PATH_SUFFIXES), (suffix) => {
        // Act + Assert
        expect(isHealthPath(`/api/v1${suffix}`, 'api')).toBe(true);
      }),
    );
  });

  // El complemento: cualquier subrecurso separado por barra sí es ruta de salud.
  it('debería devolver true para cualquier subrecurso de la ruta de salud', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z0-9-]{1,12}$/), (child) => {
        // Act + Assert
        expect(isHealthPath(`/api/v1/health/${child}`, 'api')).toBe(true);
      }),
    );
  });

  it('debería clasificar igual una ruta con o sin query string', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('/api/v1/health', '/api/v1/invoices', '/api/healthcare'),
        fc.stringMatching(/^[a-z]{1,8}=[a-z0-9]{1,8}$/),
        (path, query) => {
          // Act + Assert
          expect(isHealthPath(`${path}?${query}`, 'api')).toBe(isHealthPath(path, 'api'));
        },
      ),
    );
  });

  // Cualquier versión, no solo v1: la ruta la decide `API_VERSION`.
  it('debería reconocer la ruta de salud sea cual sea el número de versión', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 99 }), (version) => {
        // Act + Assert
        expect(isHealthPath(`/api/v${version}/health`, 'api')).toBe(true);
      }),
    );
  });
});

describe('generateRequestId', () => {
  it('debería reutilizar el x-request-id entrante', () => {
    // Arrange
    const req = buildRequest({ 'x-request-id': 'incoming-1' });
    const res = buildResponse();

    // Act
    const id = generateRequestId(req, res);

    // Assert
    expect(id).toBe('incoming-1');
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'incoming-1');
  });

  it('debería reutilizar x-correlation-id cuando no hay x-request-id', () => {
    // Arrange
    const req = buildRequest({ 'x-correlation-id': 'corr-9' });
    const res = buildResponse();

    // Act
    const id = generateRequestId(req, res);

    // Assert
    expect(id).toBe('corr-9');
  });

  it('debería dar prioridad a x-request-id sobre x-correlation-id', () => {
    // Arrange
    const req = buildRequest({ 'x-request-id': 'req-1', 'x-correlation-id': 'corr-1' });
    const res = buildResponse();

    // Act
    const id = generateRequestId(req, res);

    // Assert
    expect(id).toBe('req-1');
  });

  it('debería generar un UUID cuando no llega ninguna cabecera de correlación', () => {
    // Arrange
    const req = buildRequest({});
    const res = buildResponse();

    // Act
    const id = generateRequestId(req, res);

    // Assert
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', id);
  });
});

describe('serializeRequest', () => {
  it('debería exponer solo los campos relevantes de la request', () => {
    // Arrange
    const req = {
      id: 'req-1',
      method: 'GET',
      url: '/api/v1/things',
      socket: { remoteAddress: '10.0.0.1' },
      headers: { 'user-agent': 'jest', 'x-forwarded-for': '203.0.113.7' },
    } as unknown as RequestWithId;

    // Act
    const result = serializeRequest(req);

    // Assert
    expect(result).toEqual({
      id: 'req-1',
      method: 'GET',
      url: '/api/v1/things',
      remoteAddress: '10.0.0.1',
      userAgent: 'jest',
      forwardedFor: '203.0.113.7',
    });
  });

  it('debería tolerar una request sin socket', () => {
    // Arrange
    const req = { headers: {} } as unknown as RequestWithId;

    // Act
    const result = serializeRequest(req);

    // Assert
    expect(result.remoteAddress).toBeUndefined();
  });
});

describe('serializeResponse', () => {
  it('debería exponer únicamente el statusCode', () => {
    // Arrange
    const res = { statusCode: 204 } as ServerResponse;

    // Act
    const result = serializeResponse(res);

    // Assert
    expect(result).toEqual({ statusCode: 204 });
  });
});

describe('buildRedactPaths', () => {
  it('debería añadir los campos extra a los que vienen por defecto', () => {
    // Act
    const paths = buildRedactPaths(['custom.secret']);

    // Assert
    expect(paths).toContain('custom.secret');
    expect(paths).toEqual(expect.arrayContaining(DEFAULT_REDACT_PATHS));
  });

  it('debería deduplicar los campos repetidos', () => {
    // Act
    const paths = buildRedactPaths(['*.password', '*.password']);

    // Assert
    expect(paths.filter((path) => path === '*.password')).toHaveLength(1);
  });

  it('debería devolver solo los por defecto cuando no hay extras', () => {
    // Act
    const paths = buildRedactPaths([]);

    // Assert
    expect(paths).toEqual(DEFAULT_REDACT_PATHS);
  });
});

/**
 * Estos casos NO leen la lista de rutas: montan un pino real con la configuración que devuelve
 * `buildPinoHttpOptions` y le pasan un `QueryFailedError` de verdad, que es como llega al log
 * desde `AllExceptionsFilter`. Comparar la lista contra sí misma sería tautológico —diría que
 * `'err.parameters[*]'` está escrita, no que pino la entienda ni que tape el hash—, y la
 * sintaxis de comodines es justo la parte que hay que verificar contra la versión instalada.
 */
describe('DEFAULT_REDACT_PATHS (contra un pino real)', () => {
  it('debería tapar el hash argon2id que QueryFailedError arrastra en sus parameters', () => {
    // Arrange
    const error = queryFailedError([
      '541db8e3-229c-42da-8a86-fd12f1fdbc08',
      '677b470f-eee4-427c-802a-9a8f6959dc6d',
      FAKE_ARGON2_HASH,
    ]);

    // Act
    const line = captureFatal(error);

    // Assert
    expect(line).not.toContain('$argon2id$');
    expect(JSON.parse(line).err.parameters).toEqual(['[REDACTED]', '[REDACTED]', '[REDACTED]']);
  });

  // TypeORM tipa `parameters` como `any[] | ObjectLiteral | undefined`: el comodín tiene que
  // recorrer también las claves de un objeto, no solo los índices de un array.
  it('debería tapar los parameters cuando vienen en forma de objeto y no de array', () => {
    // Arrange
    const error = queryFailedError({ id: 'a-uuid', passwordHash: FAKE_ARGON2_HASH });

    // Act
    const line = captureFatal(error);

    // Assert
    expect(line).not.toContain('$argon2id$');
    expect(JSON.parse(line).err.parameters).toEqual({
      id: '[REDACTED]',
      passwordHash: '[REDACTED]',
    });
  });

  // La cara opuesta, y deliberada: `err.query` NO se redacta. La asimetría se apoya en una
  // invariante del repo —todas las consultas son parametrizadas—, así que el texto solo lleva
  // SQL y placeholders mientras el valor viaja en `parameters`, que sí se tapa. Redactarlo
  // borraría lo único que dice QUÉ consulta falló. Este caso es donde se notaría que alguien
  // interpoló valores en SQL crudo y rompió la premisa.
  it('debería conservar el texto de la consulta, que solo lleva SQL y placeholders', () => {
    // Arrange
    const error = queryFailedError([FAKE_ARGON2_HASH]);

    // Act
    const line = captureFatal(error);

    // Assert
    expect(JSON.parse(line).err.query).toBe(
      'INSERT INTO "auth_credentials"("id", "user_id", "password_hash") VALUES ($1, $2, $3)',
    );
    expect(JSON.parse(line).err.query).not.toContain('$argon2id$');
  });

  // Redactar no puede dejar el error mudo: `code` y `detail` son lo que queda, junto al texto
  // de la consulta, para diagnosticar una violación de constraint.
  it('debería conservar el diagnóstico del driver que no lleva secretos', () => {
    // Arrange
    const error = queryFailedError(['a-uuid']);

    // Act
    const line = captureFatal(error);

    // Assert
    const { err } = JSON.parse(line);
    expect(err.code).toBe('23505');
    expect(err.detail).toBe('Key (user_id)=(677b470f) already exists.');
  });
});

/**
 * La clave privada de la master viaja en el CUERPO de cada transferencia y es el único secreto
 * del ciclo que no es un hash. Estos casos no leen la lista de rutas: montan un pino real y
 * comprueban que la redacción llega, que es la parte que la sintaxis de comodines decide.
 *
 * La defensa de verdad está en que los errores del adaptador no lleven el cuerpo dentro
 * (`src/modules/wallets/__tests__/infrastructure/gateways/tatum-secret-surface.spec.ts`); esto
 * es la red por debajo.
 */
describe('DEFAULT_REDACT_PATHS (la clave privada de la master)', () => {
  it.each(['privateKey', 'masterPrivateKey', 'fromPrivateKey'])(
    'debería tapar err.%s',
    (property) => {
      // Arrange
      const error = Object.assign(new Error('fallo del proveedor'), {
        [property]: FAKE_MASTER_PRIVATE_KEY,
      });

      // Act
      const line = captureFatal(error);

      // Assert
      expect(line).not.toContain(FAKE_MASTER_PRIVATE_KEY);
      expect(JSON.parse(line)).toMatchObject({ err: { [property]: '[REDACTED]' } });
    },
  );

  // El límite, escrito en vez de descubierto: el comodín `*.x` casa a profundidad DOS y nada
  // más. Medido con pino 10.3.1: con este mismo caso, `{ request: { fromPrivateKey } }` colgado
  // del error sale del logger SIN tapar. Es la misma limitación que ya tienen `*.password` y
  // compañía, y el motivo por el que un error que arrastre la petición dentro NO queda cubierto
  // por esta lista.
  it('debería NO tapar la clave anidada a un nivel más, que es el límite del comodín', () => {
    // Arrange
    const error = Object.assign(new Error('fallo del proveedor'), {
      request: { fromPrivateKey: FAKE_MASTER_PRIVATE_KEY },
    });

    // Act
    const line = captureFatal(error);

    // Assert
    expect(line).toContain(FAKE_MASTER_PRIVATE_KEY);
  });
});

describe('buildPrettyTransport', () => {
  it('debería devolver undefined cuando pretty está deshabilitado', () => {
    // Act
    const transport = buildPrettyTransport(false);

    // Assert
    expect(transport).toBeUndefined();
  });

  it('debería apuntar a pino-pretty cuando está habilitado', () => {
    // Act
    const transport = buildPrettyTransport(true);

    // Assert
    expect(transport?.target).toBe('pino-pretty');
  });
});

describe('buildPinoHttpOptions', () => {
  it('debería componer las opciones a partir de la configuración', () => {
    // Arrange
    const logCfg = { level: 'debug', pretty: false, redact: ['x.y'] } as LogConfig;
    const appCfg = { env: 'test', globalPrefix: 'api' } as AppConfig;

    // Act
    const options = buildPinoHttpOptions(logCfg, appCfg);

    // Assert
    expect(options.level).toBe('debug');
    expect(options.base.env).toBe('test');
    expect(options.redact.paths).toContain('x.y');
    expect(options.transport).toBeUndefined();
  });

  it('debería ignorar las rutas de salud en el autologging', () => {
    // Arrange
    const logCfg = { level: 'info', pretty: false, redact: [] } as unknown as LogConfig;
    const appCfg = { env: 'test', globalPrefix: 'api' } as AppConfig;

    // Act
    const options = buildPinoHttpOptions(logCfg, appCfg);

    // Assert
    expect(options.autoLogging.ignore({ url: '/api/health' } as IncomingMessage)).toBe(true);
    expect(options.autoLogging.ignore({ url: '/api/v1/things' } as IncomingMessage)).toBe(false);
  });

  it('debería etiquetar cada log con el contexto HTTP', () => {
    // Arrange
    const logCfg = { level: 'info', pretty: false, redact: [] } as unknown as LogConfig;
    const appCfg = { env: 'test', globalPrefix: 'api' } as AppConfig;

    // Act
    const options = buildPinoHttpOptions(logCfg, appCfg);

    // Assert
    expect(options.customProps()).toEqual({ context: 'HTTP' });
  });
});

// Helpers

const buildRequest = (headers: Record<string, string>): IncomingMessage =>
  ({ headers }) as unknown as IncomingMessage;

const buildResponse = (): ServerResponse & { setHeader: jest.Mock } =>
  ({ setHeader: jest.fn() }) as unknown as ServerResponse & { setHeader: jest.Mock };

/** Forma real de un hash argon2id, con sal y digest inventados: no abre ninguna cuenta. */
const FAKE_ARGON2_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$c2FsLWRlLW1lbnRpcmE$ZGlnZXN0LWRlLW1lbnRpcmE';

/** Entropía nula a propósito: gitleaks no debe disparar sobre un archivo de test. */
const FAKE_MASTER_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;

/**
 * Un `QueryFailedError` construido igual que lo construye el `PostgresQueryRunner`: consulta,
 * parámetros y el error del driver. Los tres campos son propiedades enumerables, y además el
 * constructor de TypeORM copia encima las del driver (`code`, `detail`, …) — por eso el
 * serializador por defecto de pino las arrastra todas al log.
 */
const queryFailedError = (parameters: unknown[] | Record<string, unknown>): QueryFailedError => {
  const driverError = Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    detail: 'Key (user_id)=(677b470f) already exists.',
  });
  return new QueryFailedError(
    'INSERT INTO "auth_credentials"("id", "user_id", "password_hash") VALUES ($1, $2, $3)',
    parameters as unknown[],
    driverError,
  );
};

/** La línea JSON que pino escribiría con la configuración de redacción real de la app. */
const captureFatal = (error: unknown): string => {
  const logCfg = { level: 'fatal', pretty: false, redact: [] } as unknown as LogConfig;
  const appCfg = { env: 'test', globalPrefix: 'api' } as AppConfig;
  const lines: string[] = [];
  const destination: DestinationStream = {
    write: (line: string) => {
      lines.push(line);
    },
  };
  const logger = pino({ redact: buildPinoHttpOptions(logCfg, appCfg).redact }, destination);
  logger.fatal({ err: error }, 'unhandled');
  return lines.join('');
};
