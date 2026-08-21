import { buildDatabaseConfig as buildConfig } from '@test/helpers/config.factory';

import { buildTypeOrmOptions, ENTITIES_GLOB, MIGRATIONS_GLOB } from '../typeorm-options';

describe('buildTypeOrmOptions', () => {
  it('debería configurar el driver de postgres', () => {
    // Act
    const options = buildTypeOrmOptions(buildConfig());

    // Assert
    expect(options.type).toBe('postgres');
  });

  it('debería trasladar los datos de conexión tal cual', () => {
    // Arrange
    const config = buildConfig({
      host: 'mi-db.rds.amazonaws.com',
      port: 5433,
      username: 'app_user',
      password: 's3cret',
      database: 'produccion',
      schema: 'app',
    });

    // Act
    const options = buildTypeOrmOptions(config) as Record<string, unknown>;

    // Assert
    expect(options.host).toBe('mi-db.rds.amazonaws.com');
    expect(options.port).toBe(5433);
    expect(options.username).toBe('app_user');
    expect(options.password).toBe('s3cret');
    expect(options.database).toBe('produccion');
    expect(options.schema).toBe('app');
  });

  it('debería propagar la configuración de TLS', () => {
    // Arrange
    const config = buildConfig({ ssl: { ca: '--CERT--', rejectUnauthorized: true } });

    // Act
    const options = buildTypeOrmOptions(config) as Record<string, unknown>;

    // Assert
    expect(options.ssl).toEqual({ ca: '--CERT--', rejectUnauthorized: true });
  });

  it('debería dejar el TLS desactivado cuando la config lo indica', () => {
    // Act
    const options = buildTypeOrmOptions(buildConfig({ ssl: false })) as Record<string, unknown>;

    // Assert
    expect(options.ssl).toBe(false);
  });

  it('debería descubrir entidades y migraciones por glob', () => {
    // Act
    const options = buildTypeOrmOptions(buildConfig());

    // Assert
    expect(options.entities).toEqual([ENTITIES_GLOB]);
    expect(options.migrations).toEqual([MIGRATIONS_GLOB]);
  });

  // Nota: no se testea la *forma* de los globs (que contengan `{ts,js}` o `orm-entity`).
  // Eso solo reformula el literal de la constante: falla al renombrar y sigue en verde si
  // el glob apunta a una carpeta inexistente. Que resuelven de verdad lo demuestra
  // `users.e2e-spec.ts` al persistir una fila contra Postgres.

  it('debería trasladar los parámetros del pool a las opciones de pg', () => {
    // Arrange
    const config = buildConfig({
      poolMax: 25,
      poolIdleTimeoutMs: 15_000,
      connectionTimeoutMs: 4_000,
    });

    // Act
    const options = buildTypeOrmOptions(config) as { extra: Record<string, number> };

    // Assert
    expect(options.extra.max).toBe(25);
    expect(options.extra.idleTimeoutMillis).toBe(15_000);
    expect(options.extra.connectionTimeoutMillis).toBe(4_000);
  });

  it('debería respetar los flags de synchronize y migrationsRun ya resueltos', () => {
    // Arrange
    const config = buildConfig({ synchronize: false, migrationsRun: true });

    // Act
    const options = buildTypeOrmOptions(config);

    // Assert
    expect(options.synchronize).toBe(false);
    expect(options.migrationsRun).toBe(true);
  });

  it('debería nombrar la tabla de migraciones de forma explícita', () => {
    // Act
    const options = buildTypeOrmOptions(buildConfig()) as Record<string, unknown>;

    // Assert
    expect(options.migrationsTableName).toBe('migrations');
  });
});
