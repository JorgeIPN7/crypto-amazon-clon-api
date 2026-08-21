import { Reflector } from '@nestjs/core';

import { SkipTimeout, TimeoutMs } from '../../decorators/timeout.decorator';

describe('SkipTimeout', () => {
  it('debería activarse por defecto cuando se aplica sin argumento', () => {
    // Arrange
    const reflector = new Reflector();

    class Probe {
      @SkipTimeout()
      handler(): void {
        // Solo existe para portar la metadata del decorador.
      }
    }

    // Act
    const value = reflector.get(SkipTimeout, Probe.prototype.handler);

    // Assert
    expect(value).toBe(true);
  });

  it('debería respetar el valor explícito cuando se pasa false', () => {
    // Arrange
    const reflector = new Reflector();

    class Probe {
      @SkipTimeout(false)
      handler(): void {
        // Solo existe para portar la metadata del decorador.
      }
    }

    // Act
    const value = reflector.get(SkipTimeout, Probe.prototype.handler);

    // Assert
    expect(value).toBe(false);
  });

  it('debería devolver undefined cuando el handler no está decorado', () => {
    // Arrange
    const reflector = new Reflector();

    class Probe {
      handler(): void {
        // Solo existe para portar la metadata del decorador.
      }
    }

    // Act
    const value = reflector.get(SkipTimeout, Probe.prototype.handler);

    // Assert
    expect(value).toBeUndefined();
  });
});

describe('TimeoutMs', () => {
  it('debería conservar el número de milisegundos indicado', () => {
    // Arrange
    const reflector = new Reflector();

    class Probe {
      @TimeoutMs(5_000)
      handler(): void {
        // Solo existe para portar la metadata del decorador.
      }
    }

    // Act
    const value = reflector.get(TimeoutMs, Probe.prototype.handler);

    // Assert
    expect(value).toBe(5_000);
  });
});
