import { ApiEnvelope, ApiPaginatedEnvelope } from '../../dto/api-envelope.dto';
import { declaredResponse, declaredResponses } from '../helpers/swagger-metadata';

class Widget {}

describe('ApiEnvelope', () => {
  it('debería envolver el modelo dentro de data en vez de publicarlo desnudo', () => {
    // Arrange
    class Target {
      @ApiEnvelope(Widget)
      handler(): void {
        // Solo existe para portar la metadata del decorador.
      }
    }

    // Act
    const schema = declaredResponse(Target, 'handler', 200)?.schema;

    // Assert
    // Es el defecto que este decorador existe para corregir: el controller anotaba el DTO
    // desnudo, así que un SDK generado deserializaba `id` como `undefined`.
    expect(schema?.allOf?.[1]?.properties?.data).toEqual({
      $ref: '#/components/schemas/Widget',
    });
  });

  it('debería declarar 200 cuando no se indica otro status', () => {
    // Arrange
    class Target {
      @ApiEnvelope(Widget)
      handler(): void {
        // Solo existe para portar la metadata del decorador.
      }
    }

    // Act
    const statuses = Object.keys(declaredResponses(Target, 'handler'));

    // Assert
    expect(statuses).toEqual(['200']);
  });

  it('debería respetar el status explícito, como el 201 de un POST', () => {
    // Arrange
    class Target {
      @ApiEnvelope(Widget, { status: 201 })
      handler(): void {
        // Solo existe para portar la metadata del decorador.
      }
    }

    // Act
    const statuses = Object.keys(declaredResponses(Target, 'handler'));

    // Assert
    expect(statuses).toEqual(['201']);
  });

  // El `$ref` describe la forma pero no rellena el panel de ejemplo de Scalar. Sin propagar
  // `example` no hay forma de publicar un cuerpo completo, envelope incluido.
  it('debería propagar el example al metadata cuando se pasa', () => {
    // Arrange
    const example = { success: true, data: { id: 'w-1' }, request: { path: '/api/v1/widgets' } };
    class Target {
      @ApiEnvelope(Widget, { example })
      handler(): void {
        // Solo existe para portar la metadata del decorador.
      }
    }

    // Act
    const published = declaredResponse(Target, 'handler', 200)?.example;

    // Assert
    expect(published).toEqual(example);
  });

  it('debería no registrar la clave example cuando no se pasa', () => {
    // Arrange
    class Target {
      @ApiEnvelope(Widget)
      handler(): void {
        // Solo existe para portar la metadata del decorador.
      }
    }

    // Act
    const response = declaredResponse(Target, 'handler', 200);

    // Assert
    // `example: undefined` no es lo mismo que no declararlo: `mergeResponseEntry` funde las
    // respuestas del mismo status con `Object.assign`, así que una clave propia con valor
    // `undefined` machacaría el ejemplo que otro decorador ya hubiera registrado.
    expect(response).not.toHaveProperty('example');
  });
});

describe('ApiPaginatedEnvelope', () => {
  it('debería tipar los items de la página con el modelo', () => {
    // Arrange
    class Target {
      @ApiPaginatedEnvelope(Widget)
      handler(): void {
        // Solo existe para portar la metadata del decorador.
      }
    }

    // Act
    const schema = declaredResponse(Target, 'handler', 200)?.schema;
    const page = schema?.allOf?.[1]?.properties?.data;

    // Assert
    expect(page?.allOf?.[1]?.properties?.items).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/Widget' },
    });
  });

  it('debería propagar el example al metadata cuando se pasa', () => {
    // Arrange
    const example = {
      success: true,
      data: { items: [{ id: 'w-1' }], meta: { total: 1 } },
      request: { path: '/api/v1/widgets' },
    };
    class Target {
      @ApiPaginatedEnvelope(Widget, { example })
      handler(): void {
        // Solo existe para portar la metadata del decorador.
      }
    }

    // Act
    const published = declaredResponse(Target, 'handler', 200)?.example;

    // Assert
    expect(published).toEqual(example);
  });

  it('debería no registrar la clave example cuando no se pasa', () => {
    // Arrange
    class Target {
      @ApiPaginatedEnvelope(Widget)
      handler(): void {
        // Solo existe para portar la metadata del decorador.
      }
    }

    // Act
    const response = declaredResponse(Target, 'handler', 200);

    // Assert
    expect(response).not.toHaveProperty('example');
  });
});
