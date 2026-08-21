import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { buildErrorExample } from '@common/dto/error-example.factory';
import type { ErrorPayload } from '@common/filters/all-exceptions.filter';
import { createTestApp } from '@test/helpers/create-test-app';
import { resetThrottler } from '@test/helpers/reset-throttler';

import { UserOrmEntity } from '../infrastructure/persistence/user.orm-entity';

/** Cumple `@MinLength(12)` de `RegisterAccountDto`; el valor en sí es irrelevante. */
const DEFAULT_PASSWORD = 'contrasena-larga-de-prueba';

/**
 * E2E contra PostgreSQL real, no contra un doble. Mockear el ORM aquí eliminaría
 * justamente lo que este test valida: el mapeo, el índice único del email y la
 * traducción de errores de dominio a códigos HTTP.
 *
 * Desde el ciclo 4 esta suite NO prueba el alta ni el login: ambos se fueron a
 * `auth/__tests__/auth.e2e-spec.ts` con sus endpoints. Aquí quedan la consulta, la
 * paginación, la desactivación y la autorización de los endpoints de `users` — que sigue
 * dependiendo de un token, y por eso el `beforeAll` se registra por `/auth/register`.
 *
 * Requiere la base levantada: `pnpm db:up`. Corre contra `nest_base_template_test`, no
 * contra la base de desarrollo — lo fija `test/setup-env.ts`.
 */
describe('Users (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let prefix: string;
  let userToken: string;
  let adminToken: string;

  beforeAll(async () => {
    ({ app, prefix } = await createTestApp());
    dataSource = app.get(DataSource);

    // Los tokens se obtienen UNA sola vez: el login tiene su propio límite de 10/min con
    // storage en memoria compartido por toda la app, y la suite debe quedar muy por
    // debajo. El TRUNCATE de cada `beforeEach` borra las filas de estos usuarios, pero el
    // JWT es stateless: los tokens siguen valiendo; cada it crea sus propios datos.
    await truncateAccounts();
    userToken = await registerAndLogin('token.user@example.com');
    await postRegister({
      email: 'token.admin@example.com',
      name: 'E2E Admin',
      password: DEFAULT_PASSWORD,
    }).expect(201);
    await promoteToAdmin(dataSource, 'token.admin@example.com');
    // El relogin va DESPUÉS de promover: el claim `role` se acuña al firmar el token, no
    // se relee de la base en cada petición.
    adminToken = await loginAs('token.admin@example.com', DEFAULT_PASSWORD);
  });

  beforeEach(async () => {
    // TRUNCATE de las dos tablas de la cuenta. Es necesario, no una precaución: la suite
    // afirma conteos exactos y, sin vaciar, el índice único devolvería 409 donde el primer
    // test espera 201 en la segunda corrida.
    await truncateAccounts();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /users/:id', () => {
    it('debería devolver el usuario creado', async () => {
      // Arrange
      const created = await postRegister({
        email: 'buscado@example.com',
        name: 'Usuario Buscado',
        password: DEFAULT_PASSWORD,
      });
      const id = created.body.data.user.id as string;

      // Act
      const response = await request(app.getHttpServer())
        .get(`${prefix}/users/${id}`)
        .set('Authorization', `Bearer ${userToken}`);

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.data.email).toBe('buscado@example.com');
    });

    it('debería responder 404 cuando el usuario no existe', async () => {
      // Act
      const response = await request(app.getHttpServer())
        .get(`${prefix}/users/3f2504e0-4f89-41d3-9a0c-0305e82c3301`)
        .set('Authorization', `Bearer ${userToken}`);

      // Assert
      expect(response.status).toBe(404);
    });

    it('debería responder 400 cuando el id no es un UUID', async () => {
      // Act
      const response = await request(app.getHttpServer())
        .get(`${prefix}/users/no-es-uuid`)
        .set('Authorization', `Bearer ${userToken}`);

      // Assert
      expect(response.status).toBe(400);
    });

    it('debería devolver un 404 con la misma forma que documenta el OpenAPI', async () => {
      // Arrange
      const path = `${prefix}/users/3f2504e0-4f89-41d3-9a0c-0305e82c3301`;

      // Act
      const response = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${userToken}`);

      // Assert
      // Se compara contra la misma factoría de la que salen los `example` del controller, así que
      // el ejemplo publicado y la respuesta real no pueden divergir sin que esto se ponga rojo.
      // Fue justo esa divergencia la que colaba `error: 'UserNotFoundError'` en la documentación
      // cuando el servidor devuelve `'Not Found'`.
      const body = response.body as ErrorPayload;
      const documented = buildErrorExample(404, { path, message: body.message });

      // `timestamp` y `requestId` cambian en cada petición; se igualan para que la comparación
      // sea sobre lo estable: el juego exacto de claves, el `statusCode`, el `error` y el `path`.
      expect({ ...body, timestamp: documented.timestamp, requestId: documented.requestId }).toEqual(
        documented,
      );
    });

    // El perfil dejó de conocer el hash en el ciclo 4: ni siquiera un endpoint autenticado
    // que devuelve el usuario completo puede filtrarlo, porque ya no está en el agregado.
    it('debería no exponer ningún rastro de credencial en el perfil', async () => {
      // Arrange
      const created = await postRegister({
        email: 'sin.credencial@example.com',
        name: 'Sin Credencial',
        password: DEFAULT_PASSWORD,
      });
      const id = created.body.data.user.id as string;

      // Act
      const response = await request(app.getHttpServer())
        .get(`${prefix}/users/${id}`)
        .set('Authorization', `Bearer ${userToken}`);

      // Assert
      expect(response.body.data).not.toHaveProperty('passwordHash');
      expect(JSON.stringify(response.body)).not.toContain('argon2');
    });
  });

  describe('GET /users', () => {
    it('debería listar los usuarios con su total', async () => {
      // Arrange
      await createUsers(3);

      // Act
      const response = await request(app.getHttpServer())
        .get(`${prefix}/users`)
        .set('Authorization', `Bearer ${adminToken}`);

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.data.items).toHaveLength(3);
      expect(response.body.data.meta.total).toBe(3);
    });

    it('debería respetar el tamaño de página', async () => {
      // Arrange
      await createUsers(3);

      // Act
      const response = await request(app.getHttpServer())
        .get(`${prefix}/users?page=1&limit=2`)
        .set('Authorization', `Bearer ${adminToken}`);

      // Assert
      expect(response.body.data.items).toHaveLength(2);
      expect(response.body.data.meta.totalPages).toBe(2);
    });

    it('debería devolver una lista vacía cuando no hay usuarios', async () => {
      // Act
      const response = await request(app.getHttpServer())
        .get(`${prefix}/users`)
        .set('Authorization', `Bearer ${adminToken}`);

      // Assert
      expect(response.body.data.items).toEqual([]);
      expect(response.body.data.meta.total).toBe(0);
    });

    // `pagination.dto.spec.ts` prueba el DTO aislado, pero el `ValidationPipe` que lo
    // aplica se instala en `main.ts`: solo por HTTP se demuestra que rechaza de verdad.
    it.each([
      ['limit por encima del máximo', 'page=1&limit=101'],
      ['page por debajo del mínimo', 'page=0&limit=10'],
      ['limit en cero', 'page=1&limit=0'],
      ['page no numérica', 'page=abc'],
    ])('debería responder 400 con %s', async (_caso, query) => {
      // Act
      const response = await request(app.getHttpServer())
        .get(`${prefix}/users?${query}`)
        .set('Authorization', `Bearer ${adminToken}`);

      // Assert
      expect(response.status).toBe(400);
    });

    it('debería devolver una página vacía, con anterior, más allá del final', async () => {
      // Arrange
      await createUsers(3);

      // Act
      const response = await request(app.getHttpServer())
        .get(`${prefix}/users?page=9&limit=10`)
        .set('Authorization', `Bearer ${adminToken}`);

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.data.items).toEqual([]);
      expect(response.body.data.meta.hasPreviousPage).toBe(true);
      expect(response.body.data.meta.hasNextPage).toBe(false);
    });
  });

  describe('DELETE /users/:id', () => {
    it('debería desactivar al usuario sin borrar la fila', async () => {
      // Arrange
      const created = await postRegister({
        email: 'desactivar@example.com',
        name: 'Usuario Activo',
        password: DEFAULT_PASSWORD,
      });
      const id = created.body.data.user.id as string;

      // Act
      const response = await request(app.getHttpServer())
        .delete(`${prefix}/users/${id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.data.active).toBe(false);
      const rows = await dataSource.getRepository(UserOrmEntity).find();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.active).toBe(false);
    });

    it('debería responder 404 al desactivar un usuario inexistente', async () => {
      // Act
      const response = await request(app.getHttpServer())
        .delete(`${prefix}/users/3f2504e0-4f89-41d3-9a0c-0305e82c3301`)
        .set('Authorization', `Bearer ${adminToken}`);

      // Assert
      expect(response.status).toBe(404);
    });
  });

  describe('autenticación y autorización', () => {
    it('debería responder 401 en GET /users sin token', async () => {
      // Act
      const response = await request(app.getHttpServer()).get(`${prefix}/users`);

      // Assert
      expect(response.status).toBe(401);
    });

    it('debería responder 401 en GET /users con un token inválido', async () => {
      // Act
      const response = await request(app.getHttpServer())
        .get(`${prefix}/users`)
        .set('Authorization', 'Bearer no-es-un-jwt');

      // Assert
      expect(response.status).toBe(401);
    });

    it('debería devolver el 401 del guard con la misma forma que documenta el OpenAPI', async () => {
      // Arrange
      const path = `${prefix}/users`;

      // Act
      const response = await request(app.getHttpServer()).get(path);

      // Assert
      // Misma técnica que el 404 de arriba: `timestamp` y `requestId` cambian en cada
      // petición y se igualan para comparar lo estable. Cierra el lazo ejemplo↔realidad
      // para el 401 que `@Auth` documenta desde `common/`.
      const body = response.body as ErrorPayload;
      const documented = buildErrorExample(401, { path, message: 'Unauthorized' });
      expect({ ...body, timestamp: documented.timestamp, requestId: documented.requestId }).toEqual(
        documented,
      );
    });

    it('debería responder 403 en GET /users con un token de rol user', async () => {
      // Act
      const response = await request(app.getHttpServer())
        .get(`${prefix}/users`)
        .set('Authorization', `Bearer ${userToken}`);

      // Assert
      expect(response.status).toBe(403);
    });

    it('debería responder 403 en DELETE /users/:id con un token de rol user', async () => {
      // El guard corre antes que pipes y handler: el id ni siquiera necesita existir.
      // Act
      const response = await request(app.getHttpServer())
        .delete(`${prefix}/users/3f2504e0-4f89-41d3-9a0c-0305e82c3301`)
        .set('Authorization', `Bearer ${userToken}`);

      // Assert
      expect(response.status).toBe(403);
    });

    // El token de admin sale del flujo promote+relogin del beforeAll: el claim `role` se
    // acuña al firmar, así que solo un login POSTERIOR a la promoción porta 'admin'.
    it('debería responder 200 en GET /users con el token de admin', async () => {
      // Act
      const response = await request(app.getHttpServer())
        .get(`${prefix}/users`)
        .set('Authorization', `Bearer ${adminToken}`);

      // Assert
      expect(response.status).toBe(200);
    });

    it('debería mantener el health público, sin token', async () => {
      // Act
      const response = await request(app.getHttpServer()).get(`${prefix}/health`);

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
    });

    // El guard global lo registra `auth.module` desde el ciclo 4. Este caso es el que
    // detectaría que se hubiera perdido en la mudanza: sin guard, `POST /users` ya no
    // existe pero `GET /users` respondería 200 sin token, no 401.
    it('debería mantener público el registro, que ahora vive en /auth/register', async () => {
      // Act
      const response = await postRegister({
        email: 'registro.publico@example.com',
        name: 'Registro Público',
        password: DEFAULT_PASSWORD,
      });

      // Assert
      expect(response.status).toBe(201);
    });

    // `POST /users` desapareció con el ciclo 4. Un 404 (y no un 401) demuestra que la ruta
    // ya no está registrada, en vez de estar protegida: si volviera a existir en silencio,
    // habría dos altas con reglas distintas.
    it('debería no exponer ya POST /users', async () => {
      // Act
      const response = await request(app.getHttpServer())
        .post(`${prefix}/users`)
        .send({ email: 'fantasma@example.com', name: 'Fantasma', password: DEFAULT_PASSWORD });

      // Assert
      expect(response.status).toBe(404);
    });
  });

  // Helpers

  const postRegister = (payload: Record<string, unknown>) =>
    request(app.getHttpServer()).post(`${prefix}/auth/register`).send(payload);

  const truncateAccounts = async (): Promise<void> => {
    await dataSource.query('TRUNCATE TABLE auth_credentials');
    await dataSource.query('TRUNCATE TABLE users CASCADE');
    // `/auth/register` comparte el límite de 10/min del login y esta suite da de alta más de
    // diez cuentas en total: sin vaciar el contador, los últimos tests recibirían 429.
    resetThrottler(app);
  };

  const createUsers = async (count: number): Promise<void> => {
    for (let index = 0; index < count; index += 1) {
      await postRegister({
        email: `user${index}@example.com`,
        name: `Usuario ${index}`,
        password: DEFAULT_PASSWORD,
      });
    }
  };

  async function registerAndLogin(email: string, password = DEFAULT_PASSWORD): Promise<string> {
    await postRegister({ email, name: 'E2E User', password }).expect(201);
    return loginAs(email, password);
  }

  async function loginAs(email: string, password: string): Promise<string> {
    const login = await request(app.getHttpServer())
      .post(`${prefix}/auth/login`)
      .send({ email, password })
      .expect(200);
    return login.body.data.accessToken as string;
  }

  async function promoteToAdmin(source: DataSource, email: string): Promise<void> {
    // UPDATE directo y no un endpoint: promover no tiene (ni debe tener) ruta HTTP, y el
    // seed del primer admin es CLI. El E2E reproduce exactamente ese camino de operación.
    await source.query(`UPDATE users SET role = 'admin' WHERE email = $1`, [email]);
  }
});
