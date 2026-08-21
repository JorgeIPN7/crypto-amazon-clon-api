import { ApiStandardErrors } from '../../decorators/api-standard-errors.decorator';
import { ErrorResponseDto } from '../../dto/error-response.dto';
import {
  declaredResponses,
  declaredStatuses,
  responsesOf,
  statusesIn,
} from '../helpers/swagger-metadata';

describe('ApiStandardErrors', () => {
  it('debería declarar solo 500 cuando el endpoint no está limitado', () => {
    // Arrange
    class Target {
      @ApiStandardErrors({ throttled: false })
      handler(): void {
        // Solo existe para portar la metadata del decorador.
      }
    }

    // Act
    const statuses = declaredStatuses(Target, 'handler');

    // Assert
    expect(statuses).toEqual([500]);
  });

  it('debería añadir 429 por defecto, porque el throttler es global', () => {
    // Arrange
    class Target {
      @ApiStandardErrors()
      handler(): void {
        // Solo existe para portar la metadata del decorador.
      }
    }

    // Act
    const statuses = declaredStatuses(Target, 'handler');

    // Assert
    expect(statuses).toContain(429);
  });

  // El `example` es la razón de ser de este decorador: sin él Scalar muestra el esquema pero
  // no el cuerpo. Comprobar solo los status code deja pasar un `example` borrado o vaciado,
  // que es exactamente el fallo silencioso que este bloque existe para detectar.
  it.each([
    [429, 'ThrottlerException'],
    [500, 'InternalServerError'],
  ])('debería publicar en el %i un example con el error real del filtro', (status, error) => {
    // Arrange
    class Target {
      @ApiStandardErrors()
      handler(): void {
        // Solo existe para portar la metadata del decorador.
      }
    }

    // Act
    const example = declaredResponses(Target, 'handler')[String(status)]?.example;

    // Assert
    expect(example).toMatchObject({ statusCode: status, error });
  });

  // Sin `type` el generador de SDK no tiene nada que deserializar: el `example` documenta,
  // el DTO es lo que tipa. Y el 400 no puede reutilizar `ErrorResponseDto`, que declara
  // `details` y trae ejemplos de un 404.
  it.each([
    [429, ErrorResponseDto],
    [500, ErrorResponseDto],
  ])('debería tipar la respuesta %i con su DTO', (status, dto) => {
    // Arrange
    class Target {
      @ApiStandardErrors()
      handler(): void {
        // Solo existe para portar la metadata del decorador.
      }
    }

    // Act
    const declared = declaredResponses(Target, 'handler')[String(status)]?.type;

    // Assert
    expect(declared).toBe(dto);
  });

  it('debería describir cada respuesta que declara', () => {
    // Arrange
    class Target {
      @ApiStandardErrors()
      handler(): void {
        // Solo existe para portar la metadata del decorador.
      }
    }

    // Act
    const descriptions = Object.values(declaredResponses(Target, 'handler')).map(
      (response) => response.description,
    );

    // Assert
    // `ApiResponse` rellena `description` con `''` cuando no se pasa, así que una respuesta sin
    // describir no se nota en el esquema: sale como una entrada muda en Scalar.
    expect(descriptions.every((description) => Boolean(description))).toBe(true);
  });

  // Se anuncia como `ClassDecorator` además de `MethodDecorator`, y no es decorativo:
  // `exploreGlobalApiResponseMetadata` lee la metadata del controller y la fusiona en todas
  // sus operaciones, así que aplicarlo a la clase ahorra repetirlo endpoint a endpoint.
  it('debería poder aplicarse a nivel de clase', () => {
    // Arrange
    @ApiStandardErrors({ throttled: true })
    class Target {}

    // Act
    const statuses = statusesIn(responsesOf(Target));

    // Assert
    expect(statuses).toEqual([429, 500]);
  });
});
