import { BadRequestException, type ExceptionFilter, type HttpException } from '@nestjs/common';

/**
 * Un mapeo es un par «clase de error de dominio → cómo se convierte en `HttpException`».
 *
 * `abstract new (...args: never[]) => E` acepta cualquier constructor, abstracto o concreto:
 * lo único que se le pide es tener `prototype`, que es lo que `instanceof` mira. Los
 * constructores de los errores de dominio tienen firmas dispares (`constructor()`,
 * `constructor(readonly value: string)`) y `never[]` las cubre todas por contravarianza.
 *
 * El callback recibe `E` —el marcador del contexto—, no la subclase concreta. Es deliberado:
 * ninguno de los seis mapeos del repo necesita una propiedad propia de la subclase; todos
 * usan `.message` o una constante. Estrechar el tipo pediría un helper genérico con un cast
 * dentro, y sería API sin consumidor.
 *
 * La forma es `readonly (…)[]` y no `ReadonlyArray<…>` porque `@typescript-eslint/array-type`
 * prohíbe la segunda con `error`: son el mismo tipo, y el gate manda sobre el borrador.
 */
export type DomainErrorMapping<E extends Error> = readonly (readonly [
  abstract new (...args: never[]) => E,
  (error: E) => HttpException,
])[];

/**
 * Base de los filtros que traducen errores de dominio al protocolo HTTP. Vive en `common/`
 * —y no en `shared/domain/`— porque importa `@nestjs/common`, que la policy de
 * `shared-domain` prohíbe expresamente. La regla la impone el gate, no el gusto.
 *
 * Cada módulo declara SOLO su mapa; el recorrido está aquí. Antes eran tres clases con la
 * misma cadena de `instanceof` escrita a mano.
 *
 * ⚠️ **El orden del mapa importa**: gana el PRIMER `instanceof` que coincide. Si un error
 * extiende a otro, el específico va antes. Está fijado por un caso del spec.
 *
 * El filtro RE-LANZA, no escribe la respuesta: quien la formatea es `AllExceptionsFilter`,
 * que es global. Y las excepciones se construyen con STRING, nunca con objeto, para que Nest
 * rellene `body.error` con el nombre canónico (`Not Found`, `Conflict`) —que es lo que
 * `buildErrorExample` deriva del status— en vez del nombre de la clase de dominio.
 *
 * El fallback 400 es deliberado y no un descuido: un error de dominio nuevo sin mapear
 * significa que el cliente pidió algo que el dominio rechaza, y eso es entrada inválida,
 * no un fallo del servidor.
 */
export abstract class DomainExceptionFilter<E extends Error> implements ExceptionFilter {
  protected abstract readonly mappings: DomainErrorMapping<E>;

  catch(exception: E): never {
    for (const [ErrorClass, toHttpException] of this.mappings) {
      if (exception instanceof ErrorClass) {
        throw toHttpException(exception);
      }
    }
    throw new BadRequestException(exception.message);
  }
}
