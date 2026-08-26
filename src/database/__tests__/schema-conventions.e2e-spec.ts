import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createTestApp } from '@test/helpers/create-test-app';

type ColumnRow = { table_name: string; column_name: string };

/**
 * E2E contra PostgreSQL real, y tiene que serlo: lo que se verifica aquí no es lo que las ORM
 * entities DECLARAN sino lo que la base tiene DE VERDAD. Un test unitario sobre los decoradores
 * comprobaría el mismo modelo que produjo el esquema, así que no podría cazar la única
 * divergencia que importa — que las migraciones y las entidades hayan dejado de coincidir.
 *
 * **De dónde sale.** Hasta el 2026-08-24 el esquema mezclaba las dos convenciones y
 * `auth_credentials` llegaba a mezclarlas DENTRO DE LA MISMA TABLA: `user_id` y `password_hash`
 * en snake conviviendo con `"createdAt"` y `"updatedAt"` en camel. Nadie lo escribió a mala idea:
 * sin `NamingStrategy`, TypeORM usa el nombre de la propiedad tal cual, así que la columna nacía
 * en camel salvo que quien la escribiera se acordara del `name:` — y en cuatro casos no se acordó.
 *
 * Se arregló reescribiendo migraciones, algo que solo fue barato porque no había datos ni
 * despliegue. Con datos, cada columna habría necesitado su propia pareja expand/contract. Esta
 * suite es lo que impide pagar eso: `SnakeNamingStrategy` hace que la convención se cumpla sola,
 * y estos casos comprueban que sigue puesta.
 */
describe('convenciones del esquema (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let columns: ColumnRow[];

  beforeAll(async () => {
    // La app real y no un `DataSource` suelto: así el `DataSource` que se inspecciona es el que
    // construyó `buildTypeOrmOptions`, estrategia de nombres incluida. Con uno propio, el test
    // pasaría aunque alguien quitara la `namingStrategy` de las opciones de la aplicación.
    ({ app } = await createTestApp());
    dataSource = app.get(DataSource);
    columns = await dataSource.query<ColumnRow[]>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name <> 'migrations'
        ORDER BY table_name, ordinal_position`,
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('nombres de columna', () => {
    it('debería tener todas las columnas en snake_case, sin una sola mayúscula', () => {
      // Arrange
      const offenders = columns
        .filter((column) => /[A-Z]/.test(column.column_name))
        .map((column) => `${column.table_name}.${column.column_name}`);

      // Act & Assert
      // El mensaje nombra las columnas y no solo el número: si esto se pone rojo en CI, quien lo
      // lea necesita saber CUÁLES para decidir si toca un `name:` o una migración.
      expect(offenders).toEqual([]);
    });

    it('debería no separar ninguna palabra con guion ni con espacio', () => {
      // Arrange
      const offenders = columns
        .filter((column) => /[^a-z0-9_]/.test(column.column_name))
        .map((column) => `${column.table_name}.${column.column_name}`);

      // Act & Assert
      // Caso aparte del anterior: `user-id` y `user id` no llevan mayúsculas y pasarían el
      // primero, pero obligan igual a citar la columna en cada consulta.
      expect(offenders).toEqual([]);
    });
  });

  describe('nombres de tabla', () => {
    it('debería tener todas las tablas en snake_case', () => {
      // Arrange
      const offenders = [...new Set(columns.map((column) => column.table_name))].filter((table) =>
        /[^a-z0-9_]/.test(table),
      );

      // Act & Assert
      expect(offenders).toEqual([]);
    });
  });

  describe('la traza de auditoría', () => {
    it('debería estar completa en las tres tablas que llevan agregado', () => {
      // Arrange
      const AUDIT = ['created_at', 'updated_at', 'created_by', 'updated_by'];
      const byTable = new Map<string, string[]>();
      for (const column of columns) {
        byTable.set(column.table_name, [
          ...(byTable.get(column.table_name) ?? []),
          column.column_name,
        ]);
      }

      // Act
      const missing = ['users', 'auth_credentials', 'orders'].flatMap((table) =>
        AUDIT.filter((audit) => !byTable.get(table)?.includes(audit)).map(
          (audit) => `${table}.${audit}`,
        ),
      );

      // Assert
      // `orders_outbox` queda fuera a propósito: no es un agregado, es una cola. Sus filas no
      // tienen autor ni ciclo de vida — tienen `occurred_at` y `processed_at`, que son otra cosa.
      expect(missing).toEqual([]);
    });
  });
});
