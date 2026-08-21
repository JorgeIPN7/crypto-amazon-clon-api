/**
 * Lector de metadata de `@nestjs/swagger` compartido por los specs de decoradores/DTOs de
 * OpenAPI de `common/`. `ApiResponse` guarda las respuestas bajo `RESPONSE_META`, indexadas por
 * status code, y `ApiSecurity` (base de `ApiBearerAuth`) guarda los security requirements bajo
 * `SECURITY_META` — ambas sobre la propia función del método (`descriptor.value`) o sobre el
 * constructor cuando el decorador se aplica a la clase. Verificado contra @nestjs/swagger 11.4.6.
 *
 * Vivía triplicado en `api-standard-errors.decorator.spec.ts`, `api-envelope.dto.spec.ts` y
 * `auth.decorator.spec.ts` — CLAUDE.md: «Nunca copiar un builder en varios specs».
 */

export const RESPONSE_META = 'swagger/apiResponse';
export const SECURITY_META = 'swagger/apiSecurity';
/** `@ApiProperty` escribe la lista de propiedades en el PROTOTIPO, con los nombres prefijados por `:`. */
export const MODEL_PROPERTIES_ARRAY_META = 'swagger/apiModelPropertiesArray';
/** …y las opciones de cada una bajo la misma clave, indexadas por `propertyKey`. */
export const MODEL_PROPERTIES_META = 'swagger/apiModelProperties';

export type SchemaFragment = {
  $ref?: string;
  type?: string;
  items?: SchemaFragment;
  allOf?: SchemaFragment[];
  properties?: Record<string, SchemaFragment>;
};

export type ResponseEntry = {
  description?: string;
  type?: unknown;
  example?: unknown;
  schema?: SchemaFragment;
};

// Se tipa por el `prototype` y no como `new () => unknown`: en esa forma `prototype` es `any`
// y `Reflect.getMetadata` dispara `no-unsafe-argument`.
export type DecoratedClass = { prototype: object };

const handlerOf = (target: DecoratedClass, method: string): object => {
  const handler: unknown = (target.prototype as Record<string, unknown>)[method];
  if (typeof handler !== 'function') {
    throw new Error(`No existe el método "${method}": el test está mal escrito.`);
  }
  return handler;
};

/** Las respuestas que los decoradores registraron en un portador de metadata. */
export const responsesOf = (carrier: object): Record<string, ResponseEntry> =>
  (Reflect.getMetadata(RESPONSE_META, carrier) as Record<string, ResponseEntry> | undefined) ?? {};

/** Igual, para un método concreto de una clase: el portador es la propia función. */
export const declaredResponses = (
  target: DecoratedClass,
  method: string,
): Record<string, ResponseEntry> => responsesOf(handlerOf(target, method));

/** La respuesta registrada para un status code concreto de un método. */
export const declaredResponse = (
  target: DecoratedClass,
  method: string,
  status: number,
): ResponseEntry | undefined => declaredResponses(target, method)[String(status)];

/** Los status code de un conjunto de respuestas, ordenados. */
export const statusesIn = (responses: Record<string, ResponseEntry>): number[] =>
  Object.keys(responses)
    .map(Number)
    .filter((status) => !Number.isNaN(status))
    .sort((a, b) => a - b);

/** Lee los status code que los decoradores de respuesta registraron en el método. */
export const declaredStatuses = (target: DecoratedClass, method: string): number[] =>
  statusesIn(declaredResponses(target, method));

/** Los security requirements (`ApiBearerAuth`/`ApiSecurity`) registrados en el método. */
export const securityOf = (target: DecoratedClass, method: string): unknown =>
  Reflect.getMetadata(SECURITY_META, handlerOf(target, method)) as unknown;

/**
 * Opciones de un `@ApiProperty` tal y como quedan en la metadata (incluido el `type` inferido).
 *
 * El `& Record<string, unknown>` NO es un adorno defensivo: `createPropertyDecorator` guarda
 * `{ type, ...pickBy(options, definidas) }`, o sea CUALQUIER opción que el autor haya escrito
 * —`required`, `nullable`, `minLength`, `maxLength`, `isArray`, `deprecated`…—, y todas ellas
 * llegan a `components.schemas`. Nombrar solo cuatro claves aquí invitaba a compararlas solo a
 * ellas, que es exactamente el agujero que tenía el sello de paridad de los DTO gemelos.
 * Las cuatro nombradas siguen porque hay lecturas puntuales que las tipan (`role.enum`).
 */
export type ModelPropertyEntry = {
  description?: string;
  example?: unknown;
  format?: string;
  enum?: unknown;
  type?: unknown;
} & Record<string, unknown>;

/**
 * Las propiedades que `@ApiProperty` registró en un DTO, por nombre.
 *
 * `@nestjs/swagger` guarda la LISTA en el prototipo (`[':id', ':email', …]`) y las opciones
 * de cada una bajo `propertyKey`. Se lee la metadata real y no el schema generado porque el
 * schema exige construir el documento entero —y con él `AppModule` y PostgreSQL—, mientras
 * que la comparación que interesa (dos DTO gemelos por contrato) es puramente estática.
 */
export const modelPropertiesOf = (
  target: DecoratedClass,
): Record<string, ModelPropertyEntry | undefined> => {
  const names =
    (Reflect.getMetadata(MODEL_PROPERTIES_ARRAY_META, target.prototype) as string[] | undefined) ??
    [];
  return Object.fromEntries(
    names.map((prefixed) => {
      const name = prefixed.replace(/^:/, '');
      return [
        name,
        Reflect.getMetadata(MODEL_PROPERTIES_META, target.prototype, name) as
          ModelPropertyEntry | undefined,
      ];
    }),
  );
};
