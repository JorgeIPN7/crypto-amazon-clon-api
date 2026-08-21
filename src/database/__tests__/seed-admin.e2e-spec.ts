import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { createTestApp } from '@test/helpers/create-test-app';

import { seedAdmin } from '../seeds/seed-admin';

/** Cumple `ADMIN_PASSWORD: z.string().min(12)` de `env.schema`; el valor en sí es irrelevante. */
const ADMIN_PASSWORD = 'Password-Segura-1';
const ADMIN_EMAIL = 'primer.admin@example.com';

/**
 * E2E contra PostgreSQL real: `seedAdmin` habla SQL crudo directamente —no pasa por
 * `UserMapper`, `CredentialMapper` ni sus repositorios—, así que mockear la base eliminaría
 * justo lo que hay que verificar: que ese SQL, contra el esquema real, hace lo que dice.
 *
 * Desde el ciclo 4 el seed escribe DOS tablas en una transacción (perfil + credencial), y
 * esta suite lo comprueba en las dos direcciones: que ambas filas aparecen, y que el admin
 * puede autenticarse de verdad con el password sembrado.
 *
 * `process.env.ADMIN_EMAIL`/`ADMIN_PASSWORD` se guardan una vez y se restauran tras
 * cada test: es la única forma de inyectar el par en un flujo de CLI, que no tiene
 * puerto HTTP que apuntar. El `TRUNCATE` en cada `beforeEach` seguido de un `dataSource`
 * crudo —y no `.clear()` sobre las ORM entities— porque el propio seed nunca pasa por el
 * ORM: mantener el test en el mismo registro (SQL) que el código bajo prueba.
 */
describe('seedAdmin (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let prefix: string;
  let originalAdminEmail: string | undefined;
  let originalAdminPassword: string | undefined;

  beforeAll(async () => {
    ({ app, prefix } = await createTestApp());
    dataSource = app.get(DataSource);
    originalAdminEmail = process.env.ADMIN_EMAIL;
    originalAdminPassword = process.env.ADMIN_PASSWORD;
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE auth_credentials');
    await dataSource.query('TRUNCATE TABLE users CASCADE');
  });

  afterEach(() => {
    restoreEnv();
  });

  afterAll(async () => {
    restoreEnv();
    await app.close();
  });

  it('debería crear el admin en la primera ejecución y permitir loguear con ese password', async () => {
    // Arrange
    setEnv(ADMIN_EMAIL, ADMIN_PASSWORD);

    // Act
    const result = await seedAdmin(dataSource);

    // Assert
    expect(result).toBe('created');
    const rows = await queryUser(ADMIN_EMAIL);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role).toBe('admin');

    const login = await request(app.getHttpServer())
      .post(`${prefix}/auth/login`)
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.data.user.role).toBe('admin');
  });

  // El caso que el ciclo 4 añade: sin la credencial, el admin existiría pero no podría
  // entrar — y el login de arriba ya no bastaría para distinguir «no la escribió» de «la
  // escribió mal», porque ambos fallan igual. Aquí se mira la fila cruda.
  it('debería escribir la credencial del admin en auth_credentials, ligada a su perfil', async () => {
    // Arrange
    setEnv(ADMIN_EMAIL, ADMIN_PASSWORD);

    // Act
    await seedAdmin(dataSource);

    // Assert
    const rows = await dataSource.query<{ user_id: string; password_hash: string }[]>(
      `SELECT c.user_id, c.password_hash FROM auth_credentials c
       JOIN users u ON u.id = c.user_id WHERE u.email = $1`,
      [ADMIN_EMAIL],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.password_hash.startsWith('$argon2id$')).toBe(true);
  });

  it('debería devolver "promoted" y no duplicar la fila en una segunda ejecución', async () => {
    // Arrange
    setEnv(ADMIN_EMAIL, ADMIN_PASSWORD);
    await seedAdmin(dataSource);

    // Act
    const result = await seedAdmin(dataSource);

    // Assert
    expect(result).toBe('promoted');
    const rows = await queryUser(ADMIN_EMAIL);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role).toBe('admin');
    const credentials = await dataSource.query<{ count: number }[]>(
      'SELECT COUNT(*)::int AS count FROM auth_credentials',
    );
    expect(credentials[0]?.count).toBe(1);
  });

  it('debería promover a un usuario preexistente con ese email conservando su nombre', async () => {
    // Arrange
    const existingName = 'Usuario Preexistente';
    await dataSource.query(
      `INSERT INTO users (id, email, name, role, active, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'user', true, now(), now())`,
      [randomUUID(), ADMIN_EMAIL, existingName],
    );
    setEnv(ADMIN_EMAIL, ADMIN_PASSWORD);

    // Act
    const result = await seedAdmin(dataSource);

    // Assert
    expect(result).toBe('promoted');
    const rows = await queryUser(ADMIN_EMAIL);
    expect(rows[0]?.name).toBe(existingName);
    expect(rows[0]?.role).toBe('admin');
  });

  // El perfil preexistente no tenía credencial (nació antes de este ciclo, o su alta se
  // compensó a medias): el seed debe DARLE una, no solo cambiarle el rol. Sin el
  // `ON CONFLICT`… `INSERT` del upsert, promover dejaría un admin que no puede entrar.
  it('debería crear la credencial de un usuario preexistente que no la tenía', async () => {
    // Arrange
    await dataSource.query(
      `INSERT INTO users (id, email, name, role, active, "createdAt", "updatedAt")
       VALUES ($1, $2, 'Sin Credencial', 'user', true, now(), now())`,
      [randomUUID(), ADMIN_EMAIL],
    );
    setEnv(ADMIN_EMAIL, ADMIN_PASSWORD);

    // Act
    await seedAdmin(dataSource);

    // Assert
    const login = await request(app.getHttpServer())
      .post(`${prefix}/auth/login`)
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(login.status).toBe(200);
  });

  // El escenario de rescate, y el único en el que este seed es la herramienta documentada:
  // se desactiva por error la única cuenta admin y todo endpoint `@Auth('admin')` queda
  // inalcanzable. La aserción es el login y no `active` en la fila: `LoginUseCase` rechaza al
  // inactivo con el mismo `InvalidCredentialsError` que una contraseña mala, así que el 200 es
  // lo único que distingue "rescatado" de "sigue sin poder entrar". Sin `active = true` en el
  // UPDATE, el seed devuelve 'promoted' —éxito aparente— y esto sigue en 401.
  it('debería reactivar al admin desactivado y dejarlo entrar', async () => {
    // Arrange
    await dataSource.query(
      `INSERT INTO users (id, email, name, role, active, "createdAt", "updatedAt")
       VALUES ($1, $2, 'Admin Desactivado', 'admin', false, now(), now())`,
      [randomUUID(), ADMIN_EMAIL],
    );
    setEnv(ADMIN_EMAIL, ADMIN_PASSWORD);

    // Act
    const result = await seedAdmin(dataSource);

    // Assert
    expect(result).toBe('promoted');
    const login = await request(app.getHttpServer())
      .post(`${prefix}/auth/login`)
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.data.user.active).toBe(true);
  });

  it('debería rechazar cuando faltan ADMIN_EMAIL o ADMIN_PASSWORD en el entorno', async () => {
    // Arrange
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_PASSWORD;

    // Act + Assert
    await expect(seedAdmin(dataSource)).rejects.toThrow(
      'seed:admin necesita ADMIN_EMAIL y ADMIN_PASSWORD en el entorno (ambas).',
    );
    const rows = await dataSource.query<{ count: number }[]>(
      'SELECT COUNT(*)::int AS count FROM users',
    );
    expect(rows[0]?.count).toBe(0);
  });

  // Helpers

  function setEnv(email: string, password: string): void {
    process.env.ADMIN_EMAIL = email;
    process.env.ADMIN_PASSWORD = password;
  }

  function restoreEnv(): void {
    if (originalAdminEmail === undefined) {
      delete process.env.ADMIN_EMAIL;
    } else {
      process.env.ADMIN_EMAIL = originalAdminEmail;
    }
    if (originalAdminPassword === undefined) {
      delete process.env.ADMIN_PASSWORD;
    } else {
      process.env.ADMIN_PASSWORD = originalAdminPassword;
    }
  }

  function queryUser(email: string): Promise<{ name: string; role: string }[]> {
    return dataSource.query<{ name: string; role: string }[]>(
      'SELECT name, role FROM users WHERE email = $1',
      [email],
    );
  }
});
