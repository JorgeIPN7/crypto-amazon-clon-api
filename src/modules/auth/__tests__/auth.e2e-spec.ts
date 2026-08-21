import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { buildErrorExample } from '@common/dto/error-example.factory';
import type { ErrorPayload } from '@common/filters/all-exceptions.filter';
import { createTestApp } from '@test/helpers/create-test-app';
import { resetThrottler } from '@test/helpers/reset-throttler';

/** Cumple `@MinLength(12)` de `RegisterAccountDto`; el valor en sí es irrelevante. */
const DEFAULT_PASSWORD = 'contrasena-larga-de-prueba';

/**
 * E2E contra PostgreSQL real, no contra un doble. Cubre lo que ningún unitario puede: que el
 * alta escriba en las DOS tablas (perfil en `users`, credencial en `auth_credentials`), que
 * el login lea de ambas, y que la compensación deje el sistema sin perfiles huérfanos.
 *
 * Requiere la base levantada: `pnpm db:up`. Corre contra `nest_base_template_test`, no
 * contra la base de desarrollo — lo fija `test/setup-env.ts`.
 */
describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let prefix: string;

  beforeAll(async () => {
    ({ app, prefix } = await createTestApp());
    dataSource = app.get(DataSource);
    // Saneo defensivo ANTES del primer test. El trigger que envenena `auth_credentials` es
    // fixture del `describe` de compensación, pero una muerte del worker ahí (Ctrl-C) lo deja
    // vivo en `nest_base_template_test`, y entonces son los `it` de MÁS ARRIBA los que
    // revientan con un 500 opaco: el `beforeEach` de aquel describe ya no llega a tiempo.
    // Sin esto la única salida era un `pnpm db:reset` a ciegas.
    await dropCompensationTriggerFixture();
  });

  beforeEach(async () => {
    // Las dos tablas y en este orden: la credencial referencia al perfil por `user_id`.
    // Sin vaciar, el índice único del email devolvería 409 donde el test espera 201.
    await dataSource.query('TRUNCATE TABLE auth_credentials');
    await dataSource.query('TRUNCATE TABLE users CASCADE');
    // `/auth/register` comparte el límite de 10/min del login: sin esto, la suite se
    // quedaría sin cupo a mitad. El `describe` que MIDE el 429 usa otra app y no resetea.
    resetThrottler(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /auth/register', () => {
    it('debería registrar la cuenta y devolver 201 con su id', async () => {
      // Act
      const response = await postRegister({
        email: 'maria@example.com',
        name: 'María González',
        password: DEFAULT_PASSWORD,
      });

      // Assert
      expect(response.status).toBe(201);
      expect(response.body.data.user.id).toEqual(expect.any(String));
      expect(response.body.data.user.email).toBe('maria@example.com');
      expect(response.body.data.user.active).toBe(true);
    });

    // El cuerpo real es el que declara `ApiEnvelope`, no el DTO desnudo: un SDK generado
    // desde `/api/docs-json` debe poder deserializarlo tal cual.
    it('debería envolver la respuesta en el envelope de éxito', async () => {
      // Act
      const response = await postRegister({
        email: 'envelope@example.com',
        name: 'Envuelto',
        password: DEFAULT_PASSWORD,
      });

      // Assert
      expect(response.body.success).toBe(true);
      expect(Object.keys(response.body as Record<string, unknown>).sort()).toEqual([
        'data',
        'request',
        'success',
      ]);
      expect(response.body.request.path).toBe(`${prefix}/auth/register`);
    });

    // El corazón del ciclo: DOS tablas, DOS dueños. Se leen crudas porque comprobarlo por
    // los mappers que las escriben no distinguiría un alta correcta de una a medias.
    it('debería escribir el perfil en users y la credencial en auth_credentials', async () => {
      // Act
      const response = await postRegister({
        email: 'dostablas@example.com',
        name: 'Dos Tablas',
        password: DEFAULT_PASSWORD,
      });

      // Assert
      const userId = response.body.data.user.id as string;
      const users = await dataSource.query<{ id: string; email: string }[]>(
        'SELECT id, email FROM users',
      );
      expect(users).toEqual([{ id: userId, email: 'dostablas@example.com' }]);

      const credentials = await dataSource.query<{ user_id: string; password_hash: string }[]>(
        'SELECT user_id, password_hash FROM auth_credentials',
      );
      expect(credentials).toHaveLength(1);
      expect(credentials[0]?.user_id).toBe(userId);
      expect(credentials[0]?.password_hash.startsWith('$argon2id$')).toBe(true);
    });

    it('debería normalizar el email a minúsculas al guardarlo', async () => {
      // Act
      await postRegister({
        email: 'MAYUSCULAS@Example.COM',
        name: 'Usuario Mayúsculas',
        password: DEFAULT_PASSWORD,
      });

      // Assert
      const rows = await dataSource.query<{ email: string }[]>('SELECT email FROM users');
      expect(rows[0]?.email).toBe('mayusculas@example.com');
    });

    it('debería responder 409 cuando el email ya está registrado', async () => {
      // Arrange
      await postRegister({
        email: 'duplicado@example.com',
        name: 'Primero',
        password: DEFAULT_PASSWORD,
      }).expect(201);

      // Act
      const response = await postRegister({
        email: 'duplicado@example.com',
        name: 'Segundo',
        password: DEFAULT_PASSWORD,
      });

      // Assert
      expect(response.status).toBe(409);
      const credentials = await dataSource.query<{ count: number }[]>(
        'SELECT COUNT(*)::int AS count FROM auth_credentials',
      );
      expect(credentials[0]?.count).toBe(1);
    });

    it('debería responder 400 cuando el email no es válido', async () => {
      // Act
      const response = await postRegister({
        email: 'sin-arroba',
        name: 'Usuario',
        password: DEFAULT_PASSWORD,
      });

      // Assert
      expect(response.status).toBe(400);
    });

    it('debería responder 400 cuando faltan campos obligatorios', async () => {
      // Act
      const response = await postRegister({});

      // Assert
      expect(response.status).toBe(400);
    });

    /**
     * `forbidNonWhitelisted` es la guarda contra mass-assignment, y es además la única
     * cobertura que tiene `applyGlobals()`, excluido del umbral de la suite unitaria.
     */
    it('debería responder 400 cuando el cuerpo trae un campo no declarado', async () => {
      // Act
      const response = await postRegister({
        email: 'extra@example.com',
        name: 'Usuario Extra',
        password: DEFAULT_PASSWORD,
        role: 'admin',
      });

      // Assert
      expect(response.status).toBe(400);
      const rows = await dataSource.query<{ count: number }[]>(
        'SELECT COUNT(*)::int AS count FROM users',
      );
      expect(rows[0]?.count).toBe(0);
    });

    /**
     * Con `enableImplicitConversion: true`, class-transformer aplicaba `String(value)`
     * ANTES de validar, así que un objeto se convertía en la cadena "[object Object]" —15
     * caracteres— y pasaba `@IsString`, `@MinLength(2)` y `@MaxLength(120)` sin una queja.
     * `whitelist` no ayudaba: la propiedad existe, solo cambia de tipo.
     */
    it.each([
      ['un objeto', { $ne: null }],
      ['un número', 12345],
      ['un booleano', true],
      ['un array', ['a', 'b']],
    ])('debería responder 400 cuando el nombre es %s y no una cadena', async (_caso, name) => {
      // Act
      const response = await postRegister({
        email: 'tipos@example.com',
        name,
        password: DEFAULT_PASSWORD,
      });

      // Assert
      expect(response.status).toBe(400);
      const rows = await dataSource.query<{ count: number }[]>(
        'SELECT COUNT(*)::int AS count FROM users',
      );
      expect(rows[0]?.count).toBe(0);
    });

    /**
     * Altas simultáneas del mismo email. Cuál de las dos defensas actúa —el pre-check de
     * `CreateUserUseCase` o el índice único traducido en el repositorio— depende de cómo se
     * entrelacen las peticiones. Aquí se afirma solo el invariante observable: una sola fila
     * en CADA tabla y nunca un 5xx. La traducción del `23505` se prueba de forma
     * determinista en `users/…/user.typeorm.repository.e2e-spec.ts`.
     */
    it('debería no devolver 5xx nunca ante altas simultáneas del mismo email', async () => {
      // Arrange
      const payload = {
        email: 'carrera@example.com',
        name: 'Usuario Concurrente',
        password: DEFAULT_PASSWORD,
      };

      // Act
      const responses = await Promise.all(Array.from({ length: 6 }, () => postRegister(payload)));

      // Assert
      const statuses = responses.map((response) => response.status);
      expect(statuses.filter((status) => status === 201)).toHaveLength(1);
      expect(statuses.every((status) => status === 201 || status === 409)).toBe(true);
      const counts = await dataSource.query<{ users: number; credentials: number }[]>(
        `SELECT (SELECT COUNT(*)::int FROM users) AS users,
                (SELECT COUNT(*)::int FROM auth_credentials) AS credentials`,
      );
      expect(counts[0]).toEqual({ users: 1, credentials: 1 });
    });
  });

  /**
   * La compensación del registro, ejercitada de verdad.
   *
   * **Mecanismo elegido y por qué es honesto:** se ocupa la PK de la credencial con una fila
   * envenenada. `auth_credentials.id` lo acuña `Credential.create()` con `randomUUID()`, así
   * que no se puede predecir; lo que sí se puede es dejar la tabla en un estado donde
   * CUALQUIER inserción falla — un trigger `BEFORE INSERT` que lanza. Es un fallo real del
   * motor en la segunda escritura, exactamente la forma que tendría un disco lleno o una
   * violación de constraint, y no un `jest.mock` del repositorio: mockear el adaptador
   * probaría el mock, no la transacción entre dos contextos.
   *
   * Alternativas descartadas: (a) forzar un hash inválido — imposible sin tocar el hasher
   * real, que es quien produce el hash; (b) doble insert de la misma PK — la PK es aleatoria
   * y no hay forma de conocerla antes de que el caso de uso la genere.
   */
  describe('POST /auth/register — compensación cuando la credencial falla', () => {
    beforeEach(async () => {
      await dataSource.query(`
        CREATE OR REPLACE FUNCTION reject_credential() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'credential storage unavailable'; END;
        $$ LANGUAGE plpgsql
      `);
      // `IF EXISTS` previo, igual de auto-sanable que el `CREATE OR REPLACE` de la función:
      // sin él, un trigger superviviente hacía fallar el propio `CREATE` con
      // `trigger … already exists` y el describe no se recuperaba nunca por sí solo.
      await dataSource.query('DROP TRIGGER IF EXISTS reject_credential_insert ON auth_credentials');
      await dataSource.query(`
        CREATE TRIGGER reject_credential_insert BEFORE INSERT ON auth_credentials
        FOR EACH ROW EXECUTE FUNCTION reject_credential()
      `);
    });

    afterEach(async () => {
      await dropCompensationTriggerFixture();
    });

    // Segunda red: si el `afterEach` fallara (la conexión cae a mitad del DROP), sin esto el
    // trigger sobreviviría al `describe` entero y envenenaría lo que venga después en la MISMA
    // ejecución. Es idempotente, así que correrlo dos veces no cuesta nada.
    afterAll(async () => {
      await dropCompensationTriggerFixture();
    });

    it('debería no dejar perfil huérfano cuando la credencial no puede escribirse', async () => {
      // Act
      const response = await postRegister({
        email: 'compensado@example.com',
        name: 'Usuario Compensado',
        password: DEFAULT_PASSWORD,
      });

      // Assert: el alta falla…
      expect(response.status).toBe(500);
      // …y NADA queda: ni el perfil que sí se había creado ni la credencial que falló.
      const counts = await dataSource.query<{ users: number; credentials: number }[]>(
        `SELECT (SELECT COUNT(*)::int FROM users) AS users,
                (SELECT COUNT(*)::int FROM auth_credentials) AS credentials`,
      );
      expect(counts[0]).toEqual({ users: 0, credentials: 0 });
    });

    // La consecuencia observable de que la compensación funcione: el email vuelve a estar
    // libre. Sin ella, el perfil huérfano bloquearía ese email para siempre por el índice
    // único, y su dueño no podría registrarse nunca más ni entrar (no tiene credencial).
    it('debería dejar el email libre para un alta posterior', async () => {
      // Arrange
      await postRegister({
        email: 'reintento@example.com',
        name: 'Usuario Reintento',
        password: DEFAULT_PASSWORD,
      }).expect(500);
      await dataSource.query('DROP TRIGGER reject_credential_insert ON auth_credentials');

      // Act
      const response = await postRegister({
        email: 'reintento@example.com',
        name: 'Usuario Reintento',
        password: DEFAULT_PASSWORD,
      });

      // Assert
      expect(response.status).toBe(201);
    });
  });

  describe('POST /auth/login', () => {
    it('debería responder 401 con el cuerpo documentado ante credenciales malas', async () => {
      // Arrange
      const path = `${prefix}/auth/login`;

      // Act
      const response = await request(app.getHttpServer())
        .post(path)
        .send({ email: 'nadie@example.com', password: 'password-incorrecta-larga' });

      // Assert
      expect(response.status).toBe(401);
      expect(response.body.message).toBe('Invalid credentials');
      const body = response.body as ErrorPayload;
      const documented = buildErrorExample(401, { path, message: 'Invalid credentials' });
      expect({ ...body, timestamp: documented.timestamp, requestId: documented.requestId }).toEqual(
        documented,
      );
    });

    it('debería emitir un token para una cuenta recién registrada', async () => {
      // Arrange
      await postRegister({
        email: 'entra@example.com',
        name: 'Usuario Entra',
        password: DEFAULT_PASSWORD,
      }).expect(201);

      // Act
      const login = await postLogin('entra@example.com', DEFAULT_PASSWORD);

      // Assert
      expect(login.status).toBe(200);
      expect(login.body.data.accessToken).toEqual(expect.any(String));
      expect(login.body.data.user.email).toBe('entra@example.com');
    });

    // El caso que solo existe desde que perfil y credencial tienen dueños distintos: un
    // perfil sin credencial (una compensación que no llegó a completarse) no puede entrar,
    // y responde igual que cualquier otra credencial mala.
    it('debería responder 401 ante un perfil sin credencial', async () => {
      // Arrange
      await postRegister({
        email: 'sin.credencial@example.com',
        name: 'Sin Credencial',
        password: DEFAULT_PASSWORD,
      }).expect(201);
      await dataSource.query('DELETE FROM auth_credentials');

      // Act
      const login = await postLogin('sin.credencial@example.com', DEFAULT_PASSWORD);

      // Assert
      expect(login.status).toBe(401);
      expect(login.body.message).toBe('Invalid credentials');
    });

    it('debería responder 401 ante un usuario desactivado con la contraseña correcta', async () => {
      // Arrange
      await postRegister({
        email: 'inactivo@example.com',
        name: 'Usuario Inactivo',
        password: DEFAULT_PASSWORD,
      }).expect(201);
      await dataSource.query(`UPDATE users SET active = false WHERE email = $1`, [
        'inactivo@example.com',
      ]);

      // Act
      const login = await postLogin('inactivo@example.com', DEFAULT_PASSWORD);

      // Assert
      expect(login.status).toBe(401);
      expect(login.body.message).toBe('Invalid credentials');
    });

    it('debería acuñar en el token la misma expiración que anuncia la respuesta', async () => {
      // Arrange
      await postRegister({
        email: 'expiracion@example.com',
        name: 'Usuario Expiración',
        password: DEFAULT_PASSWORD,
      }).expect(201);

      // Act
      const login = await postLogin('expiracion@example.com', DEFAULT_PASSWORD).expect(200);

      // Assert
      // `expiresInSeconds` (lo responde NestJwtTokenSigner) y el `exp` real del token
      // (signOptions del JwtModule) se cablean en dos puntos distintos que leen la misma
      // config: si alguna vez divergen, esto se pone rojo.
      const claims = decodeJwtPayload(login.body.data.accessToken as string);
      expect(claims.exp - claims.iat).toBe(login.body.data.expiresInSeconds);
    });

    it('debería no filtrar el hash de la contraseña en el alta ni en el login', async () => {
      // Arrange
      const created = await postRegister({
        email: 'sin.hash@example.com',
        name: 'Usuario Sin Hash',
        password: DEFAULT_PASSWORD,
      });

      // Act
      const login = await postLogin('sin.hash@example.com', DEFAULT_PASSWORD).expect(200);

      // Assert
      // Todo hash argon2id serializado empieza por `$argon2`: si la cadena aparece en
      // cualquier rincón del cuerpo, algo serializó el agregado sin pasar por el DTO.
      expect(JSON.stringify(created.body)).not.toContain('argon2');
      expect(JSON.stringify(login.body)).not.toContain('argon2');
    });
  });

  /**
   * El 429 vive en una app PROPIA: el límite de 10/min del login usa storage en memoria
   * compartido por app, y agotarlo aquí con la app principal dejaría en 429 a cualquier
   * login posterior de la suite. Con contadores aislados, este describe no contamina.
   */
  describe('POST /auth/login — límite de peticiones propio', () => {
    let throttledApp: INestApplication<App>;
    let throttledPrefix: string;

    beforeAll(async () => {
      ({ app: throttledApp, prefix: throttledPrefix } = await createTestApp());
    });

    afterAll(async () => {
      await throttledApp.close();
    });

    it('debería responder 429 a la undécima petición dentro del minuto', async () => {
      // Arrange
      const attempt = () =>
        request(throttledApp.getHttpServer())
          .post(`${throttledPrefix}/auth/login`)
          .send({ email: 'throttle@example.com', password: 'password-incorrecta-larga' });

      // Act
      const statuses: number[] = [];
      for (let index = 0; index < 11; index += 1) {
        statuses.push((await attempt()).status);
      }

      // Assert
      // Las 10 primeras pasan el throttler y mueren en credenciales (401); la undécima ya
      // no llega al handler.
      expect(statuses.slice(0, 10)).toEqual(Array.from({ length: 10 }, () => 401));
      expect(statuses[10]).toBe(429);
    });

    // El `@Throttle` está en la CLASE, y aun así los contadores son POR HANDLER: la clave
    // que genera `ThrottlerGuard` incluye el nombre del método. Sin este caso, mover el
    // decorador a la clase podría haber puesto a los dos endpoints a compartir cupo en
    // silencio — y agotar el login dejaría además sin poder registrarse.
    it('debería contar el registro aparte del login pese al @Throttle compartido', async () => {
      // Arrange: agotar el cupo del LOGIN aquí dentro, y AFIRMARLO. Antes este caso heredaba
      // el 429 del `it` anterior sin comprobarlo, así que aislado (`jest -t "contar el
      // registro aparte"` → `22 skipped, 1 passed`) pasaba en vacío: sin login agotado, un
      // 201 en el registro no demuestra nada. Es idempotente respecto del `it` anterior —
      // si el cupo ya estaba agotado, estas peticiones siguen devolviendo 429.
      let loginStatus = 0;
      for (let index = 0; index < 11; index += 1) {
        loginStatus = (
          await request(throttledApp.getHttpServer())
            .post(`${throttledPrefix}/auth/login`)
            .send({ email: 'contador.aparte@example.com', password: 'password-incorrecta-larga' })
        ).status;
      }
      expect(loginStatus).toBe(429);

      // Act
      const response = await request(throttledApp.getHttpServer())
        .post(`${throttledPrefix}/auth/register`)
        .send({
          email: 'contador.aparte@example.com',
          name: 'Contador Aparte',
          password: DEFAULT_PASSWORD,
        });

      // Assert: con el login en 429, el registro sigue teniendo cupo propio.
      expect(response.status).toBe(201);
    });
  });

  // Helpers

  /**
   * Borra el fixture del describe de compensación. Idempotente y usado en cuatro sitios
   * —`beforeAll` de la suite, `afterEach` y `afterAll` del describe—: el trigger es lo único
   * de esta suite que sobrevive al proceso, así que su limpieza no puede depender de que un
   * solo hook llegue a ejecutarse.
   */
  const dropCompensationTriggerFixture = async () => {
    await dataSource.query('DROP TRIGGER IF EXISTS reject_credential_insert ON auth_credentials');
    await dataSource.query('DROP FUNCTION IF EXISTS reject_credential()');
  };

  const postRegister = (payload: Record<string, unknown>) =>
    request(app.getHttpServer()).post(`${prefix}/auth/register`).send(payload);

  const postLogin = (email: string, password: string) =>
    request(app.getHttpServer()).post(`${prefix}/auth/login`).send({ email, password });

  /** Payload del JWT sin verificar firma: aquí solo interesan los claims temporales. */
  function decodeJwtPayload(token: string): { iat: number; exp: number } {
    const payload = token.split('.')[1] ?? '';
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      iat: number;
      exp: number;
    };
  }
});
