import { Reflector } from '@nestjs/core';

import { SkipTransform } from '../../decorators/skip-transform.decorator';

/**
 * Lo que hay que probar del decorador es su `transform: (value) => value ?? true`, que es
 * lo que permite escribir `@SkipTransform()` sin argumento. El spec anterior vivía en
 * `transform.interceptor.spec.ts` y se limitaba a `expect(typeof SkipTransform).toBe('function')`,
 * es decir, afirmaba que `Reflector.createDecorator()` devuelve una función.
 */
describe('SkipTransform', () => {
  it('debería activarse por defecto cuando se aplica sin argumento', () => {
    // Arrange
    class Probe {
      @SkipTransform()
      handler(): void {
        // Solo existe para portar la metadata del decorador.
      }
    }

    // Act
    const value = metadataOf(Probe.prototype.handler);

    // Assert
    expect(value).toBe(true);
  });

  it('debería respetar el valor explícito cuando se pasa false', () => {
    // Arrange
    class Probe {
      @SkipTransform(false)
      handler(): void {
        // Solo existe para portar la metadata del decorador.
      }
    }

    // Act
    const value = metadataOf(Probe.prototype.handler);

    // Assert
    expect(value).toBe(false);
  });

  it('debería devolver undefined cuando el handler no está decorado', () => {
    // Arrange
    class Probe {
      handler(): void {
        // Solo existe para portar la metadata del decorador.
      }
    }

    // Act
    const value = metadataOf(Probe.prototype.handler);

    // Assert
    expect(value).toBeUndefined();
  });

  // Es un decorador de clase además de método: `HealthController` lo aplica a la clase
  // entera para que ningún endpoint de salud pase por el envelope.
  it('debería poder aplicarse a nivel de clase', () => {
    // Arrange
    @SkipTransform()
    class Probe {}

    // Act
    const value = new Reflector().get(SkipTransform, Probe);

    // Assert
    expect(value).toBe(true);
  });
});

// Helpers

const metadataOf = (handler: () => void): boolean | undefined =>
  new Reflector().get(SkipTransform, handler);
