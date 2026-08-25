import { join } from 'node:path';

import type { TypeOrmModuleOptions } from '@nestjs/typeorm';

import { SnakeNamingStrategy } from './snake-naming.strategy';

import type { DatabaseConfig } from '@config/database.config';

/**
 * Las entidades del ORM y las migraciones se descubren por glob en lugar de listarse a
 * mano: un módulo nuevo solo tiene que colocar su `*.orm-entity.ts` bajo
 * `infrastructure/persistence/` y queda registrado. Se incluyen las extensiones `.js`
 * porque en producción se ejecuta el build de `dist/`.
 */
export const ENTITIES_GLOB = join(__dirname, '..', 'modules', '**', '*.orm-entity.{ts,js}');
export const MIGRATIONS_GLOB = join(__dirname, 'migrations', '*.{ts,js}');

export const buildTypeOrmOptions = (config: DatabaseConfig): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: config.host,
  port: config.port,
  username: config.username,
  password: config.password,
  database: config.database,
  schema: config.schema,
  ssl: config.ssl,
  synchronize: config.synchronize,
  migrationsRun: config.migrationsRun,
  logging: config.logging,
  entities: [ENTITIES_GLOB],
  migrations: [MIGRATIONS_GLOB],
  migrationsTableName: 'migrations',
  // Toda columna nace en snake_case sin que nadie escriba `name:`. Se registra AQUÍ y no en
  // `data-source.ts` porque este builder es el único punto que comparten la CLI de TypeORM y el
  // runtime de Nest: ponerlo en uno solo los haría divergir, y el que divergiera generaría
  // migraciones fantasma contra el esquema del otro.
  namingStrategy: new SnakeNamingStrategy(),
  // `pg` acepta estas opciones de pool directamente.
  extra: {
    max: config.poolMax,
    idleTimeoutMillis: config.poolIdleTimeoutMs,
    connectionTimeoutMillis: config.connectionTimeoutMs,
  },
  autoLoadEntities: true,
});
