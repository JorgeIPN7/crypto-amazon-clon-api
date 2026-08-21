import { Reflector } from '@nestjs/core';

import { Public } from '../../decorators/public.decorator';

/**
 * Lo que hay que probar del decorador es que `@Public()` deja `true` en la metadata que
 * `JwtAuthGuard` va a leer, sin importar el argumento que reciba — es un interruptor, no una
 * bandera con valor por defecto como `SkipTransform`.
 */
describe('Public', () => {
  it('debería dejar la metadata true en el handler decorado', () => {
    // Arrange
    class Probe {
      @Public()
      handler(): void {
        // Solo existe para portar la metadata del decorador.
      }
    }

    // Act
    const value = metadataOf(Probe.prototype.handler);

    // Assert
    expect(value).toBe(true);
  });

  it('debería estampar true incluso con @Public(false)', () => {
    // Arrange
    class Probe {
      @Public(false)
      handler(): void {
        // Solo existe para portar la metadata del decorador.
      }
    }

    // Act
    const value = metadataOf(Probe.prototype.handler);

    // Assert
    // El transform es `() => true` — ignora el argumento a propósito, a diferencia de
    // `value ?? true` en SkipTransform. Un mutante que lo revirtiera a esa forma haría que
    // `@Public(false)` volviera a proteger el endpoint en silencio, y este `it` es lo único
    // que lo detecta.
    expect(value).toBe(true);
  });

  it('debería poder aplicarse a nivel de clase', () => {
    // Arrange
    @Public()
    class Probe {}

    // Act
    const value = new Reflector().get(Public, Probe);

    // Assert
    expect(value).toBe(true);
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
});

// Helpers

const metadataOf = (handler: () => void): boolean | undefined =>
  new Reflector().get(Public, handler);
