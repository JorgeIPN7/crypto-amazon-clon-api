import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
  TypeOrmHealthIndicator,
  type HealthCheckResult,
} from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';

import { ApiStandardErrors } from '@common/decorators/api-standard-errors.decorator';
import { Public } from '@common/decorators/public.decorator';
import { SkipTransform } from '@common/decorators/skip-transform.decorator';
import type { AppConfig } from '@config/app.config';

/**
 * `@HealthCheck()` registra por su cuenta un `ApiOkResponse` y un `ApiServiceUnavailableResponse`
 * si detecta `@nestjs/swagger`, y ambos describen el formato **nativo de Terminus**. El de 200 es
 * correcto; el de 503 no, porque `AllExceptionsFilter` reescribe ese cuerpo antes de enviarlo
 * (ver `serviceUnavailableSchema`).
 *
 * Medido: los decoradores se aplican de abajo arriba, así que el de Terminus corría el último y
 * su `schema` machacaba el declarado aquí — el documento publicaba un esquema de Terminus junto a
 * un ejemplo del filtro, contradiciéndose entre sí. Sus `description` en inglés, además, se
 * concatenaban a las de aquí.
 *
 * Apagarlo es la única forma de que esto no dependa del orden de los decoradores. `noCache: true`
 * va explícito porque el valor por defecto solo se aplica cuando se omite el objeto entero: sin
 * él se perdería la cabecera `Cache-Control: no-cache, no-store, must-revalidate`.
 */
const HEALTH_CHECK_OPTIONS = { noCache: true, swaggerDocumentation: false } as const;

const UP = { status: 'up' } as const;

/** Los tres indicadores que ejecutan `check()` y `readiness()`, todos en verde. */
const ALL_INDICATORS_UP = {
  memory_heap: UP,
  memory_rss: UP,
  database: UP,
} as const;

/** Mapa `clave del indicador → resultado`, la forma de `info`, `error` y `details`. */
const indicatorMapSchema = (description: string, statusExample: 'up' | 'down') => ({
  type: 'object',
  description,
  additionalProperties: {
    type: 'object',
    required: ['status'],
    properties: {
      status: { type: 'string', example: statusExample },
      message: {
        type: 'string',
        description: 'Solo cuando el indicador aporta motivo; un fallo de query no lo trae.',
      },
    },
  },
});

/**
 * Cuerpo de un chequeo correcto: el formato nativo de Terminus, sin envelope.
 * `@SkipTransform()` es lo que lo mantiene así — con envelope, un orquestador que espera
 * `status` en la raíz dejaría de encontrarlo.
 */
const HEALTH_CHECK_OK_SCHEMA = {
  type: 'object',
  required: ['status', 'info', 'error', 'details'],
  properties: {
    // Solo `ok`: `error` y `shutting_down` lanzan `ServiceUnavailableException`, así que
    // nunca viajan con un 200.
    status: { type: 'string', enum: ['ok'], example: 'ok' },
    info: indicatorMapSchema('Indicadores en verde.', 'up'),
    error: indicatorMapSchema(
      'Siempre vacío en un 200: si algo falla, la respuesta es 503.',
      'down',
    ),
    details: indicatorMapSchema('Todos los indicadores ejecutados.', 'up'),
  },
};

const okExample = (indicators: Record<string, { status: 'up' }>) => ({
  status: 'ok',
  info: indicators,
  error: {},
  details: indicators,
});

/**
 * Un chequeo fallido **no** devuelve el formato de Terminus. `HealthCheckService.check()` lanza
 * `ServiceUnavailableException(result)`, y `AllExceptionsFilter` —global, y del que
 * `@SkipTransform()` no exime porque solo salta el interceptor de éxito— reescribe el cuerpo:
 * toma `error` del `body.error` de la excepción, que aquí es el **objeto** de indicadores caídos,
 * y descarta `status`, `info` y `details`. Medido con la app real, no supuesto.
 *
 * Por eso este esquema no reutiliza `ErrorResponseDto`: allí `error` es `string`, y aquí es un
 * objeto. Declararlo con ese DTO publicaría un tipo que el cuerpo real nunca satisface.
 */
const serviceUnavailableSchema = (path: string) => ({
  type: 'object',
  required: ['statusCode', 'message', 'error', 'timestamp', 'path', 'requestId'],
  properties: {
    statusCode: { type: 'number', example: 503 },
    message: {
      type: 'string',
      description:
        'Siempre `Service Unavailable Exception`: es el mensaje por defecto de la excepción de ' +
        'Nest, porque el cuerpo de Terminus no trae ninguna clave `message`.',
      example: 'Service Unavailable Exception',
    },
    error: indicatorMapSchema(
      'Indicadores caídos, indexados por su clave. Va vacío cuando el 503 lo provoca el apagado ' +
        'ordenado (`shutting_down`) y no un indicador concreto.',
      'down',
    ),
    timestamp: { type: 'string', format: 'date-time', example: '2026-08-01T10:15:00.000Z' },
    path: { type: 'string', example: path },
    requestId: { type: 'string', example: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' },
  },
});

/**
 * Esquema y ejemplo del 503 en una sola llamada: comparten el `path`, y separarlos ya había
 * dejado el esquema de las tres sondas anunciando `/api/v1/health`.
 */
const serviceUnavailable = ({
  path,
  description,
  error,
}: {
  path: string;
  description: string;
  error: Record<string, unknown>;
}) => ({
  description,
  schema: serviceUnavailableSchema(path),
  example: {
    statusCode: 503,
    message: 'Service Unavailable Exception',
    error,
    timestamp: '2026-08-01T10:15:00.000Z',
    path,
    requestId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  },
});

@ApiTags('Health')
@SkipTransform()
@SkipThrottle({ default: true })
// Las sondas del orquestador no llevan token: un guard que las rechazara sacaría el pod
// de rotación por un 401, no por estar caído.
@Public()
@Controller('health')
export class HealthController {
  private readonly heapLimitBytes: number;
  private readonly rssLimitBytes: number;

  constructor(
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
    private readonly database: TypeOrmHealthIndicator,
    configService: ConfigService,
  ) {
    const appCfg = configService.getOrThrow<AppConfig>('app');
    this.heapLimitBytes = appCfg.healthHeapLimitBytes;
    this.rssLimitBytes = appCfg.healthRssLimitBytes;
  }

  @Get()
  @HealthCheck(HEALTH_CHECK_OPTIONS)
  @ApiOperation({
    operationId: 'healthCheck',
    summary: 'Chequeo agregado (memoria + base de datos)',
    description:
      'Comprueba heap, RSS y conectividad con PostgreSQL. Devuelve 503 si alguno falla. ' +
      'No pasa por el interceptor de envelope: el cuerpo de éxito es el formato nativo de ' +
      'Terminus. Se sirve con `Cache-Control: no-cache, no-store, must-revalidate`.',
  })
  @ApiOkResponse({
    description: 'Todos los indicadores en verde.',
    schema: HEALTH_CHECK_OK_SCHEMA,
    example: okExample(ALL_INDICATORS_UP),
  })
  @ApiServiceUnavailableResponse(
    serviceUnavailable({
      path: '/api/v1/health',
      description:
        'Uno o más indicadores fallaron, o el proceso está apagándose. El cuerpo es el de ' +
        '`AllExceptionsFilter`, no el de Terminus.',
      error: { database: { status: 'down', message: 'Timeout of 1000ms exceeded' } },
    }),
  )
  @ApiStandardErrors({ throttled: false })
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      ...this.memoryIndicators(),
      () => this.database.pingCheck('database'),
    ]);
  }

  /**
   * Liveness responde a "¿hay que reiniciar el proceso?", así que no consulta ninguna
   * dependencia externa: si Postgres cae, reiniciar el pod no arregla nada y solo añade
   * un arranque en frío. Por eso aquí no va el ping a la base.
   */
  @Get('liveness')
  @HealthCheck(HEALTH_CHECK_OPTIONS)
  @ApiOperation({
    operationId: 'livenessProbe',
    summary: 'Sonda de vida — confirma que el event loop responde',
    description:
      'No ejecuta ningún indicador: que la respuesta llegue ya demuestra que el proceso ' +
      'atiende peticiones. Por eso `info`, `error` y `details` van vacíos, y por eso no ' +
      'depende de la base de datos: reiniciar el pod no arreglaría un Postgres caído.',
  })
  @ApiOkResponse({
    description: 'El proceso responde. Sin indicadores, los tres mapas van vacíos.',
    schema: HEALTH_CHECK_OK_SCHEMA,
    example: okExample({}),
  })
  /**
   * Sí declara 503, pese a no consultar dependencias externas. Con cero indicadores
   * `errors.length` es siempre 0, pero `HealthCheckExecutor` implementa
   * `beforeApplicationShutdown` y `main.ts` llama a `enableShutdownHooks()`: entre el SIGTERM y
   * el cierre del servidor el resultado pasa a `shutting_down` y `check()` lanza el 503 con
   * `error` vacío. Verificado sobre la app real. Es exactamente lo que saca el pod de rotación
   * en un despliegue, así que omitirlo dejaría sin documentar la única respuesta distinta de
   * 200 que esta sonda emite.
   */
  @ApiServiceUnavailableResponse(
    serviceUnavailable({
      path: '/api/v1/health/liveness',
      description:
        'El proceso está apagándose (`shutting_down`). `error` va vacío: no falló ningún ' +
        'indicador, es el apagado ordenado.',
      error: {},
    }),
  )
  @ApiStandardErrors({ throttled: false })
  liveness(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  /**
   * Readiness responde a "¿puede este pod atender tráfico?". Sin el ping a la base
   * devolvía 200 con Postgres caído, el orquestador mantenía el pod en el Service y el
   * 100 % de las peticiones a `/users` acababa en 500: la sonda no podía sacarlo de
   * rotación, que es justamente su única razón de existir.
   */
  @Get('readiness')
  @HealthCheck(HEALTH_CHECK_OPTIONS)
  @ApiOperation({
    operationId: 'readinessProbe',
    summary: 'Sonda de disponibilidad — verifica que el servicio puede atender tráfico',
    description:
      'Ejecuta los mismos indicadores que el chequeo agregado, incluido el ping a PostgreSQL. ' +
      'Devuelve 503 en cuanto uno falla, para que el orquestador saque el pod de rotación en ' +
      'vez de enviarle peticiones que acabarían en 500.',
  })
  @ApiOkResponse({
    description: 'El servicio puede atender tráfico.',
    schema: HEALTH_CHECK_OK_SCHEMA,
    example: okExample(ALL_INDICATORS_UP),
  })
  // Un fallo de la query no lleva `message`: `TypeOrmHealthIndicator` solo lo añade en el camino
  // de timeout y en el de MongoDB. Los demás terminan en `check.down()` sin argumento.
  @ApiServiceUnavailableResponse(
    serviceUnavailable({
      path: '/api/v1/health/readiness',
      description:
        'El servicio no puede atender tráfico: falló algún indicador o el proceso se está ' +
        'apagando.',
      error: { database: { status: 'down' } },
    }),
  )
  @ApiStandardErrors({ throttled: false })
  readiness(): Promise<HealthCheckResult> {
    return this.health.check([
      ...this.memoryIndicators(),
      () => this.database.pingCheck('database'),
    ]);
  }

  private memoryIndicators() {
    return [
      () => this.memory.checkHeap('memory_heap', this.heapLimitBytes),
      () => this.memory.checkRSS('memory_rss', this.rssLimitBytes),
    ];
  }
}
