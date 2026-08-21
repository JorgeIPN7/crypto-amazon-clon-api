import { validateEnv } from '../validate-env';

describe('validateEnv', () => {
  it('debería devolver el entorno parseado cuando la configuración es válida', () => {
    // Arrange
    const raw = { NODE_ENV: 'test', PORT: '4000' };

    // Act
    const env = validateEnv(raw);

    // Assert
    expect(env.NODE_ENV).toBe('test');
    expect(env.PORT).toBe(4000);
  });

  it('debería lanzar un error listando la variable inválida', () => {
    // Arrange
    const raw = { PORT: 'not-a-number' };

    // Act + Assert
    expect(() => validateEnv(raw)).toThrow(/Invalid environment variables/);
    expect(() => validateEnv(raw)).toThrow(/PORT/);
  });

  it('debería incluir una línea por cada variable inválida', () => {
    // Arrange
    const raw = { PORT: 'nope', NODE_ENV: 'unknown-env' };

    // Act
    const error = captureError(() => validateEnv(raw));

    // Assert
    const lines = error.message.split('\n').filter((line) => line.trim().startsWith('-'));
    expect(lines).toHaveLength(2);
  });

  it('debería aplicar los valores por defecto sobre un entorno vacío', () => {
    // Arrange
    const raw = {};

    // Act
    const env = validateEnv(raw);

    // Assert
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(8888);
  });

  describe('migración de SWAGGER_* a DOCS_*', () => {
    it('debería rechazar el arranque si SWAGGER_ENABLED sigue presente', () => {
      // Arrange
      const raw = { SWAGGER_ENABLED: 'true' };

      // Act
      const act = () => validateEnv(raw);

      // Assert
      // Error duro y no warning: un warning en el arranque de un contenedor no lo lee nadie, y
      // el despliegue se quedaría sin documentación creyendo que la conserva. El mensaje nombra
      // la variable nueva porque el riesgo real es ese, no una fuga de seguridad.
      expect(act).toThrow(/SWAGGER_ENABLED[\s\S]*DOCS_ENABLED/);
    });

    it('debería rechazar el arranque si SWAGGER_PATH sigue presente', () => {
      // Arrange
      const raw = { SWAGGER_PATH: 'docs' };

      // Act
      const act = () => validateEnv(raw);

      // Assert
      expect(act).toThrow(/SWAGGER_PATH[\s\S]*DOCS_PATH/);
    });
  });
});

// Helpers

const captureError = (fn: () => unknown): Error => {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error('Se esperaba que la función lanzara un error y no lo hizo');
};
