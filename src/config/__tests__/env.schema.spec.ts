import { envSchema, splitList } from '../env.schema';

describe('envSchema', () => {
  // `@nestjs/config` solo copia de vuelta a `process.env` los valores validados que son
  // `string | number | boolean`, y descarta el resto sin avisar. Como los factories de
  // `registerAs` vuelven a parsear `process.env`, un `.transform()` que produjera un
  // array haría que el valor del fichero `.env` se perdiera y se aplicara el default en
  // su lugar — en silencio. Ya pasó con `CORS_ORIGINS`: la allowlist se ignoraba y el
  // servidor aceptaba cualquier origen. Este test es el guardarraíl de esa invariante.
  it('debería emitir solo valores escalares, porque @nestjs/config descarta el resto', () => {
    // Arrange
    const raw = {
      CORS_ORIGINS: 'https://a.com,https://b.com',
      LOG_REDACT_FIELDS: 'password,token',
      TRUST_PROXY: 'loopback',
      DB_SSL_CA: '/etc/ssl/certs/rds.pem',
    };

    // Act
    const env = parseOrThrow(raw);

    // Assert
    const nonScalar = Object.entries(env).filter(
      ([, value]) => value !== undefined && !['string', 'number', 'boolean'].includes(typeof value),
    );
    expect(nonScalar).toEqual([]);
  });

  describe('valores por defecto', () => {
    it('debería aplicar todos los defaults cuando el entorno está vacío', () => {
      // Arrange
      const raw = {};

      // Act
      const env = parseOrThrow(raw);

      // Assert
      expect(env.NODE_ENV).toBe('development');
      expect(env.PORT).toBe(8888);
      expect(env.HOST).toBe('0.0.0.0');
      expect(env.GLOBAL_PREFIX).toBe('api');
      expect(env.API_VERSION).toBe('1');
      expect(env.TRUST_PROXY).toBe(0);
      expect(env.BODY_LIMIT).toBe('1mb');
    });
  });

  describe('flags booleanos', () => {
    // `.prefault()` en Zod 4 sustituye un valor de INPUT y lo pasa por el transform,
    // a diferencia de `.default()`, que corta el pipeline y espera el tipo de OUTPUT.
    it('debería resolver los flags a boolean real cuando no se define ninguna variable', () => {
      // Arrange
      const raw = {};

      // Act
      const env = parseOrThrow(raw);

      // Assert
      expect(env.CORS_ENABLED).toBe(true);
      expect(env.CORS_CREDENTIALS).toBe(false);
      expect(env.LOG_PRETTY).toBe(false);
      // La documentación arranca apagada: encenderla es una decisión explícita, no un descuido.
      expect(env.DOCS_ENABLED).toBe(false);
      expect(typeof env.CORS_ENABLED).toBe('boolean');
    });

    it.each([
      ['true', true],
      ['false', false],
      ['1', true],
      ['0', false],
    ])('debería interpretar CORS_ENABLED="%s" como %s', (input, expected) => {
      // Arrange
      const raw = { CORS_ENABLED: input };

      // Act
      const env = parseOrThrow(raw);

      // Assert
      expect(env.CORS_ENABLED).toBe(expected);
    });

    it('debería aceptar un boolean nativo además del string', () => {
      // Arrange
      const raw = { DOCS_ENABLED: false };

      // Act
      const env = parseOrThrow(raw);

      // Assert
      expect(env.DOCS_ENABLED).toBe(false);
    });

    it('debería rechazar un valor que no represente un booleano', () => {
      // Arrange
      const raw = { CORS_ENABLED: 'yes' };

      // Act
      const result = envSchema.safeParse(raw);

      // Assert
      expect(result.success).toBe(false);
    });
  });

  describe('listas separadas por coma', () => {
    it('debería conservar CORS_ORIGINS como string, sin trocearlo', () => {
      // Arrange
      const raw = { CORS_ORIGINS: 'https://a.com,https://b.com' };

      // Act
      const env = parseOrThrow(raw);

      // Assert
      expect(env.CORS_ORIGINS).toBe('https://a.com,https://b.com');
    });

    it('debería usar "*" como valor por defecto de CORS_ORIGINS', () => {
      // Arrange
      const raw = {};

      // Act
      const env = parseOrThrow(raw);

      // Assert
      expect(env.CORS_ORIGINS).toBe('*');
    });
  });

  describe('splitList', () => {
    it('debería partir la lista recortando los espacios de cada elemento', () => {
      // Arrange
      const raw = 'https://a.com, https://b.com ,https://c.com';

      // Act
      const result = splitList(raw);

      // Assert
      expect(result).toEqual(['https://a.com', 'https://b.com', 'https://c.com']);
    });

    it('debería descartar los segmentos vacíos de la lista', () => {
      // Arrange
      const raw = 'https://a.com,,  ,https://b.com';

      // Act
      const result = splitList(raw);

      // Assert
      expect(result).toEqual(['https://a.com', 'https://b.com']);
    });

    it('debería devolver una lista vacía cuando el valor solo tiene separadores', () => {
      // Arrange
      const raw = ' , , ';

      // Act
      const result = splitList(raw);

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe('coerción numérica', () => {
    it('debería convertir a número los puertos y timeouts que llegan como string', () => {
      // Arrange
      const raw = { PORT: '3000', REQUEST_TIMEOUT_MS: '5000', HEALTH_HEAP_LIMIT_MB: '512' };

      // Act
      const env = parseOrThrow(raw);

      // Assert
      expect(env.PORT).toBe(3000);
      expect(env.REQUEST_TIMEOUT_MS).toBe(5000);
      expect(env.HEALTH_HEAP_LIMIT_MB).toBe(512);
    });

    it('debería rechazar un PORT que no sea positivo', () => {
      // Arrange
      const raw = { PORT: '0' };

      // Act
      const result = envSchema.safeParse(raw);

      // Assert
      expect(result.success).toBe(false);
    });

    // Con 0 el temporizador de gracia vence en el tick siguiente al SIGTERM, antes de que
    // `app.close()` resuelva, y el proceso muere a mitad del cierre ordenado.
    it('debería rechazar SHUTDOWN_TIMEOUT_MS en cero, que rompe el cierre ordenado', () => {
      // Arrange
      const raw = { SHUTDOWN_TIMEOUT_MS: '0' };

      // Act
      const result = envSchema.safeParse(raw);

      // Assert
      expect(result.success).toBe(false);
    });

    it('debería aceptar KEEP_ALIVE_TIMEOUT_MS en cero, donde sí es significativo', () => {
      // Arrange
      const raw = { KEEP_ALIVE_TIMEOUT_MS: '0' };

      // Act
      const env = parseOrThrow(raw);

      // Assert
      expect(env.KEEP_ALIVE_TIMEOUT_MS).toBe(0);
    });

    // `Number('')` es 0, así que sin la guarda una variable vacía pasaría como cero. Es
    // un caso realista: un `.env` con `PORT=` o un task definition renderizado sin valor.
    it.each(['PORT', 'SHUTDOWN_TIMEOUT_MS', 'KEEP_ALIVE_TIMEOUT_MS', 'DB_PORT'])(
      'debería rechazar %s presente pero vacía, en vez de coercionarla a 0',
      (key) => {
        // Arrange
        const raw = { [key]: '' };

        // Act
        const result = envSchema.safeParse(raw);

        // Assert
        expect(result.success).toBe(false);
      },
    );

    it('debería aplicar el default cuando la variable está ausente, no vacía', () => {
      // Arrange
      const raw = {};

      // Act
      const env = parseOrThrow(raw);

      // Assert
      expect(env.SHUTDOWN_TIMEOUT_MS).toBe(10_000);
    });
  });

  describe('TRUST_PROXY', () => {
    it('debería aceptar un número de saltos', () => {
      // Arrange
      const raw = { TRUST_PROXY: '2' };

      // Act
      const env = parseOrThrow(raw);

      // Assert
      expect(env.TRUST_PROXY).toBe(2);
    });

    // Antes degradaba a 0 en silencio porque `Number('')` es 0. Aunque 0 sea el valor
    // seguro, una variable vacía es un error de configuración y conviene que se vea.
    it('debería rechazar una cadena vacía en vez de degradarla a 0', () => {
      // Arrange
      const raw = { TRUST_PROXY: '' };

      // Act
      const result = envSchema.safeParse(raw);

      // Assert
      expect(result.success).toBe(false);
    });

    it('debería aceptar un nombre de proxy como cadena no numérica', () => {
      // Arrange
      const raw = { TRUST_PROXY: 'loopback' };

      // Act
      const env = parseOrThrow(raw);

      // Assert
      expect(env.TRUST_PROXY).toBe('loopback');
    });
  });

  describe('enums', () => {
    it('debería rechazar un NODE_ENV fuera de la lista permitida', () => {
      // Arrange
      const raw = { NODE_ENV: 'staging-2' };

      // Act
      const result = envSchema.safeParse(raw);

      // Assert
      expect(result.success).toBe(false);
    });

    it('debería rechazar un LOG_LEVEL desconocido', () => {
      // Arrange
      const raw = { LOG_LEVEL: 'verbose' };

      // Act
      const result = envSchema.safeParse(raw);

      // Assert
      expect(result.success).toBe(false);
    });

    it.each(['development', 'test', 'staging', 'production'])(
      'debería aceptar NODE_ENV="%s"',
      (value) => {
        // Arrange
        // JWT_SECRET solo hace falta en staging/production — ver el refine de auth en
        // env.schema.ts. Aquí lo que se comprueba es el enum de NODE_ENV, no eso.
        const needsJwtSecret = value === 'staging' || value === 'production';
        const raw = { NODE_ENV: value, ...(needsJwtSecret ? { JWT_SECRET: 'x'.repeat(32) } : {}) };

        // Act
        const env = parseOrThrow(raw);

        // Assert
        expect(env.NODE_ENV).toBe(value);
      },
    );
  });

  describe('credenciales de la documentación', () => {
    it('debería aceptar ambas credenciales definidas', () => {
      // Arrange
      const raw = { DOCS_USERNAME: 'equipo', DOCS_PASSWORD: 'secreto' };

      // Act
      const result = envSchema.safeParse(raw);

      // Assert
      expect(result.success).toBe(true);
    });

    it('debería aceptar ambas credenciales ausentes', () => {
      // Arrange
      const raw = {};

      // Act
      const result = envSchema.safeParse(raw);

      // Assert
      // Sin credenciales la documentación queda abierta, que es el comportamiento actual: la
      // protección primaria en producción sigue siendo `DOCS_ENABLED=false`.
      expect(result.success).toBe(true);
    });

    it('debería rechazar una sola credencial definida', () => {
      // Arrange
      const raw = { DOCS_USERNAME: 'equipo' };

      // Act
      const result = envSchema.safeParse(raw);

      // Assert
      // Una credencial a medias es un despliegue que se cree protegido y no lo está: el
      // middleware nunca se monta y la documentación sale publicada sin pedir nada.
      expect(result.success).toBe(false);
      expect(JSON.stringify(result.error?.issues)).toContain('DOCS_PASSWORD');
    });
  });
});

// Helpers

const parseOrThrow = (raw: Record<string, unknown>) => envSchema.parse(raw);
