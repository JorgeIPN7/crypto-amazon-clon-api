import type { INestApplication } from '@nestjs/common';

import { DiscoveryService, Reflector } from '@nestjs/core';
import Ajv from 'ajv/dist/2020';
import type { OpenAPIObject } from '@nestjs/swagger';

import { AuthRoles } from '@common/decorators/auth.decorator';
import { Public } from '@common/decorators/public.decorator';
import { expectedErrorName, VERIFIED_ERROR_STATUSES } from '@common/dto/error-example.factory';
import { buildOpenApiDocument } from '../openapi-document';
import type { ErrorPayload } from '@common/filters/all-exceptions.filter';
import { createTestApp } from '@test/helpers/create-test-app';

/**
 * Guardián del contrato publicado.
 *
 * Recorre todas las operaciones del documento OpenAPI y rompe el build si alguna no cumple el
 * estándar de `CLAUDE.md`. Tiene dos desviaciones conscientes de las convenciones del repo:
 *
 *  1. **No hay relación 1:1 con un archivo fuente.** Su sujeto es el documento completo, que
 *     ningún archivo produce por sí solo.
 *  2. **Vive en la suite E2E.** Construir el documento exige compilar `AppModule`, que importa
 *     `DatabaseModule` y necesita PostgreSQL. Dejarlo en `*.spec.ts` haría que `pnpm test`
 *     dejara de funcionar sin `pnpm db:up`, cambiando el contrato del repo. `pnpm test:e2e:ci`
 *     es obligatorio en cada PR, así que sigue rompiendo el build igual.
 *
 * El grupo «coherencia con AllExceptionsFilter» es el que más valor tiene: durante la migración
 * aparecieron cuatro ejemplos que anunciaban cuerpos que el servidor no emite. Todos eran
 * detectables comparando el ejemplo con el filtro, sin lanzar una sola petición.
 */
describe('contrato OpenAPI', () => {
  let document: OpenAPIObject;
  let operations: Entry[];
  let skipThrottleOperations: Set<string>;
  let authMetadata: Map<string, AuthMetadata>;

  beforeAll(async () => {
    const { app, appConfig } = await createTestApp();

    // Se usa la misma funcion que el runtime, no un `createDocument` propio: con dos
    // llamadas, el guardian auditaba un documento que la aplicacion no publicaba.
    document = buildOpenApiDocument(app, appConfig);
    operations = collectOperations(document);
    skipThrottleOperations = collectSkipThrottleOperations(app);
    authMetadata = collectAuthMetadata(app);

    await app.close();
  });

  it('debería encontrar al menos una operación que auditar', () => {
    // Arrange
    // (el documento se construye en beforeAll)

    // Act
    const total = operations.length;

    // Assert
    // Sin esto, un documento vacío dejaría en verde todas las comprobaciones de abajo: recorrer
    // cero operaciones nunca produce infractores.
    expect(total).toBeGreaterThan(0);
  });

  it('debería asignar un operationId único a cada operación', () => {
    // Arrange
    const ids = operations.map((entry) => entry.op.operationId);

    // Act
    const duplicated = ids.filter((id, index) => id !== undefined && ids.indexOf(id) !== index);

    // Assert
    expect(ids.every(Boolean)).toBe(true);
    expect(duplicated).toEqual([]);
  });

  describe('cada operación', () => {
    it('debería llevar summary y description no vacíos', () => {
      // Arrange
      const offenders = operations.filter(
        (entry) => !entry.op.summary?.trim() || !entry.op.description?.trim(),
      );

      // Act
      const names = offenders.map(describeEntry);

      // Assert
      expect(names).toEqual([]);
    });

    it('debería incluir un ejemplo en toda respuesta con cuerpo', () => {
      // Arrange
      const offenders: string[] = [];

      // Act
      for (const entry of operations) {
        for (const [status, response] of Object.entries(entry.op.responses ?? {})) {
          // 204 y 304 no tienen cuerpo: no hay nada que ejemplificar.
          if (status === '204' || status === '304') {
            continue;
          }
          const content = (response as ResponseObject).content;
          if (!content) {
            continue;
          }
          const hasExample = Object.values(content).some(
            (media) => media.example !== undefined || media.examples !== undefined,
          );
          if (!hasExample) {
            offenders.push(`${describeEntry(entry)} → ${status}`);
          }
        }
      }

      // Assert
      expect(offenders).toEqual([]);
    });

    it('debería declarar 500 siempre', () => {
      // Arrange
      const offenders = operations.filter((entry) => !entry.op.responses?.['500']);

      // Act
      const names = offenders.map(describeEntry);

      // Assert
      expect(names).toEqual([]);
    });

    it('debería declarar 400 exactamente cuando la operación acepta entrada', () => {
      // Arrange
      const offenders: string[] = [];

      // Act
      for (const entry of operations) {
        // Solo cuentan los parámetros que el servidor valida. Una cabecera documentada con
        // `@ApiHeader` —un `X-Request-Id` opcional, por ejemplo— no hace que el endpoint pueda
        // devolver 400, y contarla obligaría a declarar un 400 imposible: justo la ficción que
        // este guardián existe para impedir.
        const validatedParameters = (entry.op.parameters ?? []).filter((parameter) =>
          VALIDATED_PARAM_LOCATIONS.has((parameter as ParameterObject).in ?? ''),
        );
        const acceptsInput = validatedParameters.length > 0 || entry.op.requestBody !== undefined;
        const declares400 = Boolean(entry.op.responses?.['400']);
        // Bidireccional a propósito, y leído del DOCUMENTO, no de la metadata de
        // `ApiStandardErrors`: los controllers declaran su 400 con `@ApiBadRequestResponse`
        // propio para poder dar el mensaje real, así que mirar la opción `validation` del
        // decorador dejaría al guardián ciego.
        if (acceptsInput !== declares400) {
          offenders.push(
            `${describeEntry(entry)} (acepta entrada: ${acceptsInput}, declara 400: ${declares400})`,
          );
        }
      }

      // Assert
      expect(offenders).toEqual([]);
    });

    it('debería declarar 429 exactamente cuando el endpoint está sujeto al throttler', () => {
      // Arrange
      const offenders: string[] = [];

      // Act
      for (const entry of operations) {
        const operationId = entry.op.operationId;
        // Si una operacion no trae `operationId` no se puede resolver su exencion. Se registra
        // como infractora en vez de asumir "no exenta": una resolucion fallida que se silencia
        // convierte al guardian en algo que aprueba lo que no ha podido comprobar.
        if (!operationId) {
          offenders.push(
            `${describeEntry(entry)} (sin operationId: no se puede resolver la exencion)`,
          );
          continue;
        }
        const skipsThrottle = skipThrottleOperations.has(operationId);
        const declares429 = Boolean(entry.op.responses?.['429']);
        // Simétrica a la del 400. La exención se resuelve por `operationId`, así que cubre por
        // igual el decorador puesto en la clase —el caso de `HealthController`— y en un handler
        // suelto, sin depender de emparejar rutas.
        if (skipsThrottle === declares429) {
          offenders.push(
            `${describeEntry(entry)} (SkipThrottle: ${skipsThrottle}, declara 429: ${declares429})`,
          );
        }
      }

      // Assert
      expect(offenders).toEqual([]);
    });

    // ⚠️ VERIFICADO, no simplificar: en un parámetro de query `description` vive a nivel de
    // parámetro pero `example` vive DENTRO de `schema`, junto a `minimum`, `maximum` y `default`.
    // Reducir la condición a `p.example` daría un guardián que falla sobre código correcto.
    it('debería describir y ejemplificar todos sus parámetros', () => {
      // Arrange
      const offenders: string[] = [];

      // Act
      for (const entry of operations) {
        for (const parameter of entry.op.parameters ?? []) {
          const p = parameter as ParameterObject;
          const hasExample = p.example !== undefined || p.schema?.example !== undefined;
          if (!p.description?.trim() || !hasExample) {
            offenders.push(`${describeEntry(entry)} → ${p.name ?? '(sin nombre)'}`);
          }
        }
      }

      // Assert
      expect(offenders).toEqual([]);
    });

    it('debería incluir al menos un ejemplo de cuerpo cuando acepta requestBody', () => {
      // Arrange
      const offenders: string[] = [];

      // Act
      for (const entry of operations) {
        const body = entry.op.requestBody as ResponseObject | undefined;
        if (!body?.content) {
          continue;
        }
        const hasExample = Object.values(body.content).some(
          (media) => media.example !== undefined || media.examples !== undefined,
        );
        if (!hasExample) {
          offenders.push(describeEntry(entry));
        }
      }

      // Assert
      expect(offenders).toEqual([]);
    });
  });

  it('debería publicar ejemplos que satisfacen su propio esquema', () => {
    // Arrange
    // El documento se publica como **OpenAPI 3.0.0**, cuyo dialecto no es exactamente JSON
    // Schema 2020-12. Se valida con el compilador de 2020-12 igualmente porque el subconjunto de
    // constructos que este documento usa —`type`, `properties`, `required`, `allOf`, `oneOf`,
    // `items`, `$ref`— es idéntico en ambos.
    //
    // Alcance medido, para que nadie le atribuya más de lo que hace:
    //
    //   • SÍ detecta `exclusiveMinimum` booleano y un `type` inválido: violan el meta-esquema.
    //   • **NO detecta `nullable`**, la divergencia 3.0/3.1 más probable. Ajv la ignora en
    //     silencio tanto con `strict: true` como con `false` — comprobado.
    //   • `strict: true` añadiría detección de keywords inventadas, pero obliga a declarar todo
    //     el vocabulario de OpenAPI (`example`, `xml`, `discriminator`…) y cada adición futura
    //     rompería el guardián con un error que no habla del defecto real.
    //
    // Cerrar ese flanco de verdad exige validar el documento entero contra el meta-esquema de
    // OpenAPI, que es también el requisito previo para poder declarar 3.1 algún día. Hoy no se
    // declara 3.1 a propósito: la versión no es una afirmación sobre este documento, es una
    // promesa a generadores de SDK y gateways cuyo soporte de 3.1 sigue siendo desigual.
    //
    // Los `$ref` apuntan a `#/components/schemas/...`, de ahí que se embeban los `components`
    // del documento en cada esquema compilado: así resuelven contra sí mismos.
    const ajv = new Ajv({ strict: false, allErrors: true });

    // Ajv 8 no trae NINGÚN formato de serie: viven en el paquete `ajv-formats`. Sin registrarlos,
    // cada `format` del documento se ignora —con un `console.warn` por cada compilación, que era
    // el ruido que sepultaba la salida de la suite— y esta comprobación dejaba de mirar
    // precisamente los campos que más fácil se documentan mal. El documento usa tres:
    // `date-time`, `uuid` y `email`.
    //
    // Van a mano y no con `ajv-formats` porque aquí no se valida entrada de usuarios sino los
    // EJEMPLOS de la documentación: basta con distinguir una fecha ISO de «ayer» y un UUID de
    // «abc», y evita añadir una dependencia al árbol por tres expresiones. Son deliberadamente
    // laxas por el mismo motivo — quien las endurezca para validar datos reales se estará
    // equivocando de sitio: eso es trabajo de `class-validator` en los DTO.
    //
    // Al activarlas (2026-08-13) los 19 casos siguieron en verde: ningún ejemplo publicado
    // violaba su formato. Lo que estaba roto era la comprobación, no la documentación.
    ajv.addFormat('date-time', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);
    ajv.addFormat('uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    ajv.addFormat('email', /^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    const offenders: string[] = [];

    // Act
    for (const entry of operations) {
      for (const [status, response] of Object.entries(entry.op.responses ?? {})) {
        const media = (response as ResponseObject).content?.['application/json'];
        if (!media?.schema || media.example === undefined) {
          continue;
        }
        const validate = ajv.compile({
          ...(media.schema as Record<string, unknown>),
          components: document.components,
        });
        if (!validate(media.example)) {
          offenders.push(`${describeEntry(entry)} → ${status}: ${ajv.errorsText(validate.errors)}`);
        }
      }
    }

    // Assert
    // Es la tercera arista del triángulo. Ya estaban cubiertas ejemplo↔factoría y
    // ejemplo↔realidad; faltaba ejemplo↔esquema, y es la única que habría cazado por sí sola el
    // `items: { type: 'array' }` de `PaginatedResponseDto`: el ejemplo era satisfacible, el
    // esquema no, y nadie los comparaba. El mismo `allOf` sobre `data` en `ApiEnvelopeDto` es
    // estructuralmente idéntico y hasta ahora tampoco lo verificaba nadie.
    expect(offenders).toEqual([]);
  });

  describe('operaciones protegidas por JwtAuthGuard', () => {
    it('debería exigir bearer exactamente en las operaciones protegidas', () => {
      // Arrange
      const offenders: string[] = [];

      // Act
      for (const entry of operations) {
        const meta = authMetaOf(entry, authMetadata);
        if (!meta) {
          offenders.push(`${describeEntry(entry)} (sin metadata de auth resuelta)`);
          continue;
        }
        const isProtected = !meta.isPublic;
        const declaresBearer = (entry.op.security ?? []).some(
          (requirement) => 'bearer' in requirement,
        );
        // Bidireccional a propósito: una operación pública con security bearer promete al
        // cliente un token que JwtAuthGuard nunca exige (@Public hace bypass antes de mirar
        // el header), y una protegida sin bearer no le da forma de saber que debe autenticarse.
        if (isProtected !== declaresBearer) {
          offenders.push(
            `${describeEntry(entry)} (protegida: ${isProtected}, declara bearer: ${declaresBearer})`,
          );
        }
      }

      // Assert
      expect(offenders).toEqual([]);
    });

    it('debería declarar 401 en toda operación protegida', () => {
      // Arrange
      const offenders: string[] = [];

      // Act
      for (const entry of operations) {
        const meta = authMetaOf(entry, authMetadata);
        if (!meta) {
          offenders.push(`${describeEntry(entry)} (sin metadata de auth resuelta)`);
          continue;
        }
        const isProtected = !meta.isPublic;
        const declares401 = Boolean(entry.op.responses?.['401']);
        // Solo una dirección: 401 NO implica protegida. `login` es `@Public` y declara 401
        // legítimamente para credenciales inválidas — es el contraejemplo que descarta la
        // lectura bidireccional ingenua.
        if (isProtected && !declares401) {
          offenders.push(`${describeEntry(entry)} (protegida sin declarar 401)`);
        }
      }

      // Assert
      expect(offenders).toEqual([]);
    });

    it('debería declarar 403 en toda operación con roles', () => {
      // Arrange
      const offenders: string[] = [];

      // Act
      for (const entry of operations) {
        const meta = authMetaOf(entry, authMetadata);
        if (!meta) {
          offenders.push(`${describeEntry(entry)} (sin metadata de auth resuelta)`);
          continue;
        }
        const hasRoles = (meta.roles?.length ?? 0) > 0;
        const declares403 = Boolean(entry.op.responses?.['403']);
        // Solo una dirección (enmienda 2026-08-06, plan orders-minimal — mismo criterio que
        // el check de 401 del bloque anterior, y ahora el mismo fraseo: «en toda operación
        // con roles», no «exactamente»): roles SIEMPRE implica 403 documentado, porque
        // `@Auth('admin', ...)` lo adjunta solo con roles. Pero 403 ya NO implica roles —
        // `placeOrder` es el contraejemplo que descarta la lectura bidireccional ingenua:
        // `@Auth()` sin roles y aun así puede responder 403 cuando `CustomerGoneError` llega
        // al filter del contexto (el usuario del token dejó de existir o de estar activo).
        // La dirección que se pierde (403 declarado sin motivo real) no protegía nada nuevo:
        // hasta este endpoint, `@Auth(...)` era la única fuente de 403 en todo el repo.
        if (hasRoles && !declares403) {
          offenders.push(
            `${describeEntry(entry)} (con roles: ${hasRoles}, declara 403: ${declares403})`,
          );
        }
      }

      // Assert
      expect(offenders).toEqual([]);
    });

    it('debería rechazar la combinación @Public con roles', () => {
      // Arrange
      const offenders: string[] = [];

      // Act
      for (const entry of operations) {
        const meta = authMetaOf(entry, authMetadata);
        if (!meta) {
          offenders.push(`${describeEntry(entry)} (sin metadata de auth resuelta)`);
          continue;
        }
        // `JwtAuthGuard` hace bypass total en cuanto ve `@Public`, antes de leer `AuthRoles`:
        // un `@Auth(...)` en la misma operación (con o sin roles) es metadata muerta que nunca
        // se evalúa, y documentarla (bearer/401/403) publicaría una protección que no existe.
        if (meta.isPublic && meta.roles !== undefined) {
          offenders.push(
            `${describeEntry(entry)} (@Public junto a @Auth, roles: ${JSON.stringify(meta.roles)})`,
          );
        }
      }

      // Assert
      expect(offenders).toEqual([]);
    });
  });

  describe('coherencia de los ejemplos de error con AllExceptionsFilter', () => {
    it('debería usar en cada ejemplo exactamente las claves de ErrorPayload', () => {
      // Arrange
      // Se enumeran a partir de un valor tipado: añadir una clave a `ErrorPayload` rompe la
      // compilación aquí hasta que se añada también al literal.
      const reference: Required<ErrorPayload> = {
        statusCode: 0,
        message: '',
        error: '',
        details: undefined,
        timestamp: '',
        path: '',
        requestId: '',
      };
      const allowed = new Set(Object.keys(reference));
      const required = new Set(Object.keys(reference).filter((key) => key !== 'details'));
      const offenders: string[] = [];

      // Act
      for (const { entry, status, example, key } of errorExamples(operations)) {
        if (KNOWN_ERROR_SHAPE_ANOMALIES.has(key)) {
          continue;
        }
        const keys = Object.keys(example);
        const extra = keys.filter((key) => !allowed.has(key));
        const missing = [...required].filter((key) => !keys.includes(key));
        if (extra.length > 0 || missing.length > 0) {
          offenders.push(
            `${describeEntry(entry)} → ${status} (sobran: ${extra.join()}, faltan: ${missing.join()})`,
          );
        }
      }

      // Assert
      expect(offenders).toEqual([]);
    });

    it('debería derivar el campo error del status y no del nombre de la clase de dominio', () => {
      // Arrange
      const offenders: string[] = [];

      // Act
      for (const { entry, status, example, key } of errorExamples(operations)) {
        if (KNOWN_ERROR_SHAPE_ANOMALIES.has(key)) {
          continue;
        }
        const expected = expectedErrorName(Number(status));
        if (example.error !== expected) {
          offenders.push(
            `${describeEntry(entry)} → ${status} (dice «${String(example.error)}», el filtro publica «${expected}»)`,
          );
        }
      }

      // Assert
      // Esta comprobación es la que habría cazado dos de las cuatro ficciones de la migración:
      // los ejemplos anunciaban `EmailAlreadyTakenError` y `UserNotFoundError`, pero
      // `AllExceptionsFilter` calcula `error` como `body.error ?? exception.name`, y una
      // `HttpException` construida con un string ya trae `body.error` con el nombre canónico.
      //
      // Alcance real, medido: caza los ejemplos escritos a mano que se apartan de la factoría,
      // no los errores DE la factoría. Si `expectedErrorName` empezara a devolver algo falso,
      // los ejemplos lo heredarían y esta comparación seguiría en verde por comparar la factoría
      // consigo misma. Lo que cubre ese flanco es el E2E de `users` —`debería devolver un 404 con
      // la misma forma que documenta el OpenAPI`—, que contrasta la factoría contra una respuesta
      // real del servidor. Las dos piezas son complementarias; ninguna basta sola.
      expect(offenders).toEqual([]);
    });

    it('debería publicar solo status de error contrastados contra el filtro', () => {
      // Arrange
      const offenders: string[] = [];

      // Act
      for (const { key, status } of errorExamples(operations)) {
        if (KNOWN_ERROR_SHAPE_ANOMALIES.has(key)) {
          continue;
        }
        if (!VERIFIED_ERROR_STATUSES.has(Number(status))) {
          offenders.push(key);
        }
      }

      // Assert
      // Documentar un status nuevo —un 422, un 403— obliga a contrastarlo antes contra
      // `AllExceptionsFilter` en `error-example.factory.spec.ts` y añadirlo a
      // `VERIFIED_ERROR_STATUSES`. Sin esto, la cobertura del backstop dependía de que alguien
      // se acordara de ampliar aquella tabla, que es la clase de disciplina que no se sostiene.
      expect(offenders).toEqual([]);
    });

    it('debería tener todas sus anomalías conocidas todavía vigentes', () => {
      // Arrange
      const matched = new Set<string>();

      // Act
      for (const { key } of errorExamples(operations)) {
        if (KNOWN_ERROR_SHAPE_ANOMALIES.has(key)) {
          matched.add(key);
        }
      }
      const zombies = [...KNOWN_ERROR_SHAPE_ANOMALIES].filter((key) => !matched.has(key));

      // Assert
      // Una exención que ya no empareja con nada es una exención zombi: sigue eximiendo a un
      // futuro caso que reutilice ese `operationId`, y hace creer que el defecto que describe
      // sigue vivo. Cuando se arregle el 503 de health, esta comprobación es la que obliga a
      // borrar la entrada en vez de dejarla ahí para siempre.
      expect(zombies).toEqual([]);
    });

    it('debería declarar en cada ejemplo el mismo statusCode bajo el que se publica', () => {
      // Arrange
      const offenders: string[] = [];

      // Act
      for (const { entry, status, example, key } of errorExamples(operations)) {
        if (KNOWN_ERROR_SHAPE_ANOMALIES.has(key)) {
          continue;
        }
        if (example.statusCode !== Number(status)) {
          offenders.push(
            `${describeEntry(entry)} → ${status} (el cuerpo dice ${String(example.statusCode)})`,
          );
        }
      }

      // Assert
      expect(offenders).toEqual([]);
    });
  });
});

// Helpers

// `@nestjs/swagger` no exporta `OperationObject`, asi que se declara aqui con exactamente los
// campos que este guardian inspecciona. Mas estrecho que el tipo real y suficiente.
type OperationObject = {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: unknown[];
  requestBody?: unknown;
  responses?: Record<string, unknown>;
  security?: Record<string, string[]>[];
};

type Entry = { method: string; path: string; op: OperationObject };

/** `isPublic`/`roles` tal y como los lee `JwtAuthGuard` en runtime, por `operationId`. */
type AuthMetadata = { isPublic: boolean; roles: readonly string[] | undefined };

type MediaType = { example?: unknown; examples?: unknown; schema?: unknown };
type ResponseObject = { content?: Record<string, MediaType> };
type ParameterObject = {
  name?: string;
  in?: string;
  description?: string;
  example?: unknown;
  schema?: { example?: unknown };
};

/** Dónde vive un parámetro que el `ValidationPipe` puede rechazar con un 400. */
const VALIDATED_PARAM_LOCATIONS = new Set(['path', 'query', 'cookie']);

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const;

/** `THROTTLER_SKIP` de `@nestjs/throttler`; la clave real lleva el nombre del throttler pegado. */
const THROTTLER_SKIP_PREFIX = 'THROTTLER:SKIP';

/** Donde `@ApiOperation` guarda sus opciones, `operationId` incluido. */
const API_OPERATION_META = 'swagger/apiOperation';

/**
 * Respuestas que se apartan del contrato de `ErrorPayload`, con el motivo medido.
 *
 * **No es una vía de escape para documentación perezosa**: cada entrada describe una anomalía
 * real del servidor, no una excusa. Si alguien añade una aquí sin poder explicar qué hace el
 * runtime de distinto, el sitio correcto era arreglar el ejemplo.
 *
 * `/health` 503 → `HealthCheckService` lanza `ServiceUnavailableException(result)` con el objeto
 * de Terminus, así que `body.error` es el mapa de indicadores caídos y `AllExceptionsFilter` lo
 * copia tal cual a `error`, que en el resto de la API es un string. El mismo endpoint responde
 * con forma de Terminus en 200 y con forma del filtro en 503: un cliente que parsee `details`
 * funciona hasta que algo falla, que es cuando lo necesita.
 *
 * Corregirlo queda fuera de este trabajo —§9 del spec excluye cambiar el formato de error— y
 * merece su propio ticket. Cuando se haga, el criterio es reutilizar el mecanismo de exención
 * que el interceptor de envelope ya aplica a health (`@SkipTransform`), no inventar un segundo.
 * Al arreglarlo, esta excepción debe desaparecer.
 */
const KNOWN_ERROR_SHAPE_ANOMALIES = new Set([
  'healthCheck → 503',
  'livenessProbe → 503',
  'readinessProbe → 503',
]);

const describeEntry = (entry: Entry): string => `${entry.method} ${entry.path}`;

/**
 * Metadata de auth de una operación, resuelta por `operationId` contra lo que recolectó
 * `collectAuthMetadata`. `undefined` cubre tanto la operación sin `operationId` como la que,
 * teniéndolo, no tiene metadata asociada: los cuatro checks del bloque «operaciones protegidas»
 * la registran como infractora en vez de asumir «no protegida», mismo criterio que ya aplica el
 * check del 429 para su propia exención.
 */
const authMetaOf = (
  entry: Entry,
  authMetadata: Map<string, AuthMetadata>,
): AuthMetadata | undefined =>
  entry.op.operationId ? authMetadata.get(entry.op.operationId) : undefined;

const collectOperations = (document: OpenAPIObject): Entry[] => {
  const entries: Entry[] = [];
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = (item as Record<string, OperationObject | undefined>)[method];
      if (op) {
        entries.push({ method: method.toUpperCase(), path, op });
      }
    }
  }
  return entries;
};

/**
 * Nombres de operacion (`Controller_metodo`) exentos del throttler.
 *
 * Se resuelve por `operationId` y no emparejando rutas: el `operationIdFactory` de
 * `setupOpenApi` produce exactamente `${controllerKey}_${methodKey}`, asi que la
 * correspondencia es exacta. Emparejar por segmento de ruta era fragil con
 * `@Controller({ path, version })` o con varios paths por controller.
 *
 * Lee la metadata real, no una lista escrita a mano —que se desincroniza justo cuando el
 * guardian tendria que avisar— y cubre las **dos** ubicaciones del decorador:
 * `@SkipThrottle()` sobre la clase y sobre un handler suelto. Verificado que ambas formas, con
 * objeto y sin argumentos, escriben la misma clave `THROTTLER:SKIPdefault`.
 */
const collectSkipThrottleOperations = (app: INestApplication): Set<string> => {
  const exempt = new Set<string>();
  const controllers = app.get(DiscoveryService, { strict: false }).getControllers();

  for (const wrapper of controllers) {
    const metatype = wrapper.metatype as (new (...args: never[]) => unknown) | undefined;
    if (!metatype) {
      continue;
    }

    const prototype = metatype.prototype as Record<string, unknown>;
    const controllerSkips = readSkipThrottle(metatype);

    for (const methodName of methodNamesOf(prototype)) {
      if (typeof prototype[methodName] !== 'function') {
        continue;
      }
      // El método manda sobre la clase, que es la precedencia real de Nest. Con un `||` un
      // `@SkipThrottle({ default: false })` sobre un handler de una clase exenta quedaría
      // marcado como exento: la clase ganaría y el guardián dejaría de exigir el 429 que ese
      // endpoint sí devuelve. El `??` distingue «el método no dice nada» de «dice que no».
      if (readSkipThrottle(prototype[methodName]) ?? controllerSkips) {
        // El `operationId` explícito de `@ApiOperation` gana sobre el `operationIdFactory`, y los
        // controllers de este repo lo declaran: el documento dice `healthCheck`, no
        // `HealthController_check`. Se lee el mismo valor que acaba publicado y el factory queda
        // solo como respaldo para un handler sin `@ApiOperation`.
        const declared = Reflect.getMetadata(API_OPERATION_META, prototype[methodName]) as
          { operationId?: string } | undefined;
        exempt.add(declared?.operationId ?? `${metatype.name}_${methodName}`);
      }
    }
  }
  return exempt;
};

/**
 * Metadata de autenticación por `operationId`: `{ isPublic, roles }`.
 *
 * Lee `Public` y `AuthRoles` con el mismo `Reflector.getAllAndOverride` y el mismo orden
 * `[handler, clase]` —handler gana sobre clase— que `JwtAuthGuard` usa en runtime
 * (`jwt-auth.guard.ts`). Una divergencia aquí, como un `Reflect.getMetadata` plano o el orden
 * invertido, haría que este guardián verificara un contrato distinto del que el guard real
 * aplica: el mismo riesgo que el comentario de `collectSkipThrottleOperations` ya señala para el
 * throttler, aquí con consecuencias de seguridad si la lectura divergiera.
 *
 * `roles` se propaga en sus tres formas —`undefined` (nunca hubo `@Auth`), `[]` (`@Auth()`
 * sin roles) o con elementos (`@Auth('admin')`)— porque los cuatro checks de abajo distinguen
 * las tres.
 *
 * Mismo resuelve-por-`operationId` que `collectSkipThrottleOperations`: el `operationId`
 * explícito de `@ApiOperation` gana sobre el fallback `Controller_metodo`.
 */
const collectAuthMetadata = (app: INestApplication): Map<string, AuthMetadata> => {
  const metadata = new Map<string, AuthMetadata>();
  const reflector = new Reflector();
  const controllers = app.get(DiscoveryService, { strict: false }).getControllers();

  for (const wrapper of controllers) {
    const metatype = wrapper.metatype as (new (...args: never[]) => unknown) | undefined;
    if (!metatype) {
      continue;
    }

    const prototype = metatype.prototype as Record<string, unknown>;

    for (const methodName of methodNamesOf(prototype)) {
      const handler = prototype[methodName];
      if (typeof handler !== 'function') {
        continue;
      }
      const isPublic = reflector.getAllAndOverride(Public, [handler, metatype]);
      const roles = reflector.getAllAndOverride(AuthRoles, [handler, metatype]);
      const declared = Reflect.getMetadata(API_OPERATION_META, handler) as
        { operationId?: string } | undefined;
      metadata.set(declared?.operationId ?? `${metatype.name}_${methodName}`, {
        isPublic: Boolean(isPublic),
        roles,
      });
    }
  }
  return metadata;
};

/**
 * Qué dice `@SkipThrottle` sobre este objetivo: `true`, `false`, o `undefined` si no lo lleva.
 *
 * Devolver `boolean | undefined` y no `boolean` es lo que permite respetar la precedencia
 * método-sobre-clase: sin el tercer estado no se puede distinguir «este método no opina» de
 * «este método dice explícitamente que no se salte el límite».
 *
 * `@SkipThrottle` no guarda un objeto bajo `THROTTLER:SKIP`: escribe una clave por throttler,
 * con su nombre pegado (`THROTTLER:SKIPdefault`). Buscar por prefijo cubre cualquier nombre y
 * las dos formas del decorador, con objeto y sin argumentos.
 */
const readSkipThrottle = (target: object): boolean | undefined => {
  const key = Reflect.getMetadataKeys(target).find((candidate) =>
    String(candidate).startsWith(THROTTLER_SKIP_PREFIX),
  );
  return key === undefined ? undefined : Reflect.getMetadata(key, target) === true;
};

/**
 * Nombres de método del controller, herencia incluida.
 *
 * `Object.getOwnPropertyNames` a secas perdería los handlers que un controller herede de una
 * clase base, y esos sí aparecen en el documento.
 */
const methodNamesOf = (prototype: object): string[] => {
  const names = new Set<string>();
  for (let current = prototype; current && current !== Object.prototype;) {
    for (const name of Object.getOwnPropertyNames(current)) {
      if (name !== 'constructor') {
        names.add(name);
      }
    }
    current = Object.getPrototypeOf(current) as object;
  }
  return [...names];
};
/** Aplana todos los ejemplos de respuestas de error (status ≥ 400) del documento. */
function* errorExamples(
  operations: Entry[],
): Generator<{ entry: Entry; status: string; example: Partial<ErrorPayload>; key: string }> {
  for (const entry of operations) {
    for (const [status, response] of Object.entries(entry.op.responses ?? {})) {
      if (Number(status) < 400) {
        continue;
      }
      const content = (response as ResponseObject).content;
      if (!content) {
        continue;
      }
      for (const media of Object.values(content)) {
        // Los envelopes de éxito no pasan por aquí, y un ejemplo con nombre (`examples`) solo
        // se usa hoy en cuerpos de petición, así que basta con el `example` plano.
        if (media.example === undefined) {
          continue;
        }
        yield {
          entry,
          status,
          example: media.example as Partial<ErrorPayload>,
          // Clave por `operationId`, no por ruta: el path lleva el prefijo global y la versión,
          // así que una lista de excepciones indexada por ruta se rompería al cambiar
          // `GLOBAL_PREFIX` o `API_VERSION`. Misma convención que las exenciones del throttler.
          key: `${entry.op.operationId ?? describeEntry(entry)} → ${status}`,
        };
      }
    }
  }
}
