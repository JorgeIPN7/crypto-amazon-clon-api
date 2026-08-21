import {
  buildDatabaseConfig,
  resolveMigrationsRun,
  resolveSsl,
  resolveSynchronize,
} from '../database.config';
import { envSchema, type Env } from '../env.schema';

describe('resolveSynchronize', () => {
  // Esta es la guarda que impide que un `.env` mal copiado deje a TypeORM alterar el
  // esquema de producción. Si estos tests se caen, hay riesgo de pérdida de datos.
  it('debería permitir synchronize en development cuando la variable está activa', () => {
    // Act
    const result = resolveSynchronize({ NODE_ENV: 'development', DB_SYNCHRONIZE: true });

    // Assert
    expect(result).toBe(true);
  });

  it('debería respetar la variable apagada aun estando en development', () => {
    // Act
    const result = resolveSynchronize({ NODE_ENV: 'development', DB_SYNCHRONIZE: false });

    // Assert
    expect(result).toBe(false);
  });

  it.each(['production', 'staging', 'test'] as const)(
    'debería forzar synchronize a false en %s aunque la variable esté activa',
    (nodeEnv) => {
      // Act
      const result = resolveSynchronize({ NODE_ENV: nodeEnv, DB_SYNCHRONIZE: true });

      // Assert
      expect(result).toBe(false);
    },
  );
});

describe('resolveMigrationsRun', () => {
  it.each(['production', 'staging', 'test'] as const)(
    'debería ejecutar migraciones al arrancar en %s cuando está activo',
    (nodeEnv) => {
      // Act
      const result = resolveMigrationsRun({ NODE_ENV: nodeEnv, DB_MIGRATIONS_RUN: true });

      // Assert
      expect(result).toBe(true);
    },
  );

  it('debería no ejecutar migraciones automáticamente en development', () => {
    // Act
    const result = resolveMigrationsRun({ NODE_ENV: 'development', DB_MIGRATIONS_RUN: true });

    // Assert
    expect(result).toBe(false);
  });

  it('debería respetar la variable apagada en producción', () => {
    // Act
    const result = resolveMigrationsRun({ NODE_ENV: 'production', DB_MIGRATIONS_RUN: false });

    // Assert
    expect(result).toBe(false);
  });
});

describe('resolveSsl', () => {
  it('debería devolver false cuando DB_SSL está apagado', () => {
    // Act
    const result = resolveSsl({
      DB_SSL: false,
      DB_SSL_REJECT_UNAUTHORIZED: true,
      DB_SSL_CA: undefined,
    });

    // Assert
    expect(result).toBe(false);
  });

  it('debería activar TLS verificando el certificado por defecto', () => {
    // Act
    const result = resolveSsl({
      DB_SSL: true,
      DB_SSL_REJECT_UNAUTHORIZED: true,
      DB_SSL_CA: undefined,
    });

    // Assert
    expect(result).toEqual({ ca: undefined, rejectUnauthorized: true });
  });

  it('debería permitir desactivar la verificación del certificado', () => {
    // Act
    const result = resolveSsl({
      DB_SSL: true,
      DB_SSL_REJECT_UNAUTHORIZED: false,
      DB_SSL_CA: undefined,
    });

    // Assert
    expect(result).toEqual({ ca: undefined, rejectUnauthorized: false });
  });

  it('debería leer el bundle de CA cuando se indica una ruta', () => {
    // Arrange
    const readCa = jest.fn().mockReturnValue('----- CERT -----');

    // Act
    const result = resolveSsl(
      {
        DB_SSL: true,
        DB_SSL_REJECT_UNAUTHORIZED: true,
        DB_SSL_CA: '/etc/ssl/rds.pem',
      },
      readCa,
    );

    // Assert
    expect(readCa).toHaveBeenCalledWith('/etc/ssl/rds.pem');
    expect(result).toEqual({ ca: '----- CERT -----', rejectUnauthorized: true });
  });

  it('debería no leer ningún archivo cuando TLS está apagado', () => {
    // Arrange
    const readCa = jest.fn();

    // Act
    resolveSsl(
      { DB_SSL: false, DB_SSL_REJECT_UNAUTHORIZED: true, DB_SSL_CA: '/etc/ssl/rds.pem' },
      readCa,
    );

    // Assert
    expect(readCa).not.toHaveBeenCalled();
  });
});

describe('buildDatabaseConfig', () => {
  it('debería mapear las variables de conexión', () => {
    // Arrange
    const env = buildEnv({
      DB_HOST: 'mi-db.rds.amazonaws.com',
      DB_PORT: '5433',
      DB_USERNAME: 'app_user',
      DB_PASSWORD: 's3cret',
      DB_DATABASE: 'produccion',
      DB_SCHEMA: 'app',
    });

    // Act
    const config = buildDatabaseConfig(env);

    // Assert
    expect(config.host).toBe('mi-db.rds.amazonaws.com');
    expect(config.port).toBe(5433);
    expect(config.username).toBe('app_user');
    expect(config.password).toBe('s3cret');
    expect(config.database).toBe('produccion');
    expect(config.schema).toBe('app');
  });

  it('debería exponer los parámetros del pool', () => {
    // Arrange
    const env = buildEnv({ DB_POOL_MAX: '25', DB_CONNECTION_TIMEOUT_MS: '4000' });

    // Act
    const config = buildDatabaseConfig(env);

    // Assert
    expect(config.poolMax).toBe(25);
    expect(config.connectionTimeoutMs).toBe(4000);
  });

  it('debería aplicar la guarda de synchronize al construir la configuración', () => {
    // Arrange
    // JWT_SECRET es obligatorio en production por el refine de auth en env.schema.ts;
    // no tiene relación con lo que este caso comprueba (la guarda de synchronize).
    const env = buildEnv({
      NODE_ENV: 'production',
      DB_SYNCHRONIZE: 'true',
      JWT_SECRET: 'x'.repeat(32),
    });

    // Act
    const config = buildDatabaseConfig(env);

    // Assert
    expect(config.synchronize).toBe(false);
  });
});

// Helpers

const buildEnv = (overrides: Record<string, string> = {}): Env => envSchema.parse({ ...overrides });
