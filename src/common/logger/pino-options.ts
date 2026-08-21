import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { AppConfig } from '@config/app.config';
import type { LogConfig } from '@config/log.config';

export const REQUEST_ID_HEADER = 'x-request-id';
export const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * `err.parameters[*]` no es simetría con el resto: tapa una fuga MEDIDA.
 *
 * `AllExceptionsFilter` loguea `{ err }` y pino aplica su serializador estándar, que copia
 * toda propiedad enumerable del error. El `QueryFailedError` de TypeORM expone `query`,
 * `parameters` y `driverError` —y además se asigna encima cada propiedad del error del driver
 * (`code`, `detail`, `where`…), ver `typeorm/error/QueryFailedError.js`—, así que los valores
 * del INSERT viajan enteros al log. Reproducido con la app entera (`auth.e2e-spec.ts` fuerza
 * el fallo de la escritura de la credencial con un trigger `BEFORE INSERT`): la línea de nivel
 * 60 contenía literalmente
 * `"parameters":["<id>","<userId>","$argon2id$v=19$m=65536,p=4,t=3$…"]`.
 *
 * Ninguna ruta de las de arriba lo alcanzaba: los comodines `*.password` y compañía casan por
 * NOMBRE de propiedad, y ahí el hash es el elemento 2 de un array sin nombre.
 *
 * `[*]` recorre las claves propias del contenedor, sea array u objeto —TypeORM tipa
 * `parameters` como `any[] | ObjectLiteral | undefined`, y las tres formas se comprobaron
 * contra pino 10.3.1—, y conserva la longitud: se sigue viendo cuántos parámetros llevaba.
 *
 * **`err.query` NO se redacta, y es una decisión, no un olvido.** La asimetría se sostiene
 * sobre una invariante del repo: todas las consultas son parametrizadas —las del ORM por
 * construcción, y las crudas (`seed-admin.ts`, el relay del outbox, la comprobación de
 * huérfanos de la migración) usan `$1`, `$2`…—, así que los valores viajan en `parameters` y
 * el texto de la consulta solo lleva SQL y placeholders. Redactarlo no taparía ningún secreto
 * y sí borraría lo único que hace diagnosticable un `QueryFailedError`: qué consulta falló.
 *
 * Si alguien interpola valores en SQL crudo, esa premisa se rompe —el secreto acaba en el
 * texto y `parameters` viene vacío— y hay que revisar esta lista, no confiar en ella. La regla
 * de verdad es "parametriza siempre"; la redacción de `parameters` es la red por debajo.
 */
export const DEFAULT_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
  '*.apiKey',
  '*.secret',
  'err.parameters[*]',
];

export const HEALTH_PATH_SUFFIXES = ['/health', '/healthz', '/livez', '/readyz'];

export type RequestWithId = IncomingMessage & { id?: string };

/** El segmento que inserta `enableVersioning({ type: VersioningType.URI })`, p. ej. `/v1`. */
const VERSION_SEGMENT = /^\/v\d+(?=\/|$)/;

/** Quita `/<prefix>` solo si es un segmento completo, para no morder `/apifoo`. */
const stripPrefix = (path: string, prefix: string): string => {
  if (!prefix) {
    return path;
  }
  const head = `/${prefix}`;
  if (path === head) {
    return '';
  }
  return path.startsWith(`${head}/`) ? path.slice(head.length) : path;
};

/**
 * Los endpoints de salud se sondean sin parar; loguearlos ahoga el resto de las trazas.
 *
 * La URL real que ve pino es la completa —`/api/v1/health`—, así que hay que descontar
 * el prefijo global y el segmento de versión antes de comparar. Y la comparación exige
 * separador o fin de cadena: sin eso, `/api/healthcare` se tomaría por una ruta de salud
 * y ese endpoint de negocio desaparecería de los logs.
 */
export const isHealthPath = (url: string | undefined, prefix: string): boolean => {
  if (!url) {
    return false;
  }
  // `req.url` llega con query string; `/health?probe=1` sigue siendo la ruta de salud.
  const path = url.split('?')[0] ?? '';
  const route = stripPrefix(path, prefix).replace(VERSION_SEGMENT, '');

  return HEALTH_PATH_SUFFIXES.some((suffix) => route === suffix || route.startsWith(`${suffix}/`));
};

/**
 * Reutiliza el id entrante (`x-request-id` o `x-correlation-id`) para poder correlacionar
 * trazas entre servicios, y genera uno nuevo solo si no llega ninguno. Siempre lo devuelve
 * al cliente en la cabecera de respuesta.
 */
export const generateRequestId = (req: IncomingMessage, res: ServerResponse): string => {
  const headers = req.headers;
  const existing =
    (headers[REQUEST_ID_HEADER] as string | undefined) ??
    (headers[CORRELATION_ID_HEADER] as string | undefined);
  const id = existing ?? randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
};

export const serializeRequest = (req: RequestWithId) => ({
  id: req.id,
  method: req.method,
  url: req.url,
  remoteAddress: req.socket?.remoteAddress,
  userAgent: req.headers['user-agent'],
  forwardedFor: req.headers['x-forwarded-for'],
});

export const serializeResponse = (res: ServerResponse) => ({
  statusCode: res.statusCode,
});

export const buildRedactPaths = (extra: string[]): string[] =>
  Array.from(new Set([...DEFAULT_REDACT_PATHS, ...extra]));

export const buildPrettyTransport = (pretty: boolean) =>
  pretty
    ? {
        target: 'pino-pretty',
        options: {
          singleLine: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname,context,env,service,version',
          messageFormat: '[{context}] {msg}',
        },
      }
    : undefined;

export const buildPinoHttpOptions = (logCfg: LogConfig, appCfg: AppConfig) => ({
  level: logCfg.level,
  base: {
    service: process.env.npm_package_name ?? 'nest-base-template',
    env: appCfg.env,
    version: process.env.npm_package_version ?? '0.0.0',
  },
  autoLogging: {
    ignore: (req: IncomingMessage) => isHealthPath(req.url, appCfg.globalPrefix),
  },
  redact: {
    paths: buildRedactPaths(logCfg.redact),
    censor: '[REDACTED]',
    remove: false,
  },
  genReqId: generateRequestId,
  customProps: () => ({ context: 'HTTP' }),
  serializers: {
    req: serializeRequest,
    res: serializeResponse,
  },
  transport: buildPrettyTransport(logCfg.pretty),
});
