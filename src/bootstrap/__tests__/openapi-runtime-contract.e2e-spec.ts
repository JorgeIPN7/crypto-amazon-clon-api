import type { INestApplication } from '@nestjs/common';
import Ajv, { type ValidateFunction } from 'ajv/dist/2020';
import type { OpenAPIObject } from '@nestjs/swagger';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { createTestApp } from '@test/helpers/create-test-app';
import { resetThrottler } from '@test/helpers/reset-throttler';
import { TatumStubServer } from '@test/helpers/tatum-stub-server';

import type { AppConfig } from '@config/app.config';

import { buildOpenApiDocument } from '../openapi-document';

/** Cumple `@MinLength(8)` de `RegisterAccountDto`; el valor en sí es irrelevante. */
const PASSWORD = 'contrasena-larga-de-prueba';

/** Un UUID v4 válido que no existe en la base: sirve para provocar 404 sin provocar 400. */
const ABSENT_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

type Scenario = {
  /** Clave de la operación en el documento: `METHOD path`, con el path de OpenAPI. */
  readonly operation: string;
  readonly status: number;
  readonly describe: string;
  readonly run: (context: Context) => Promise<request.Response>;
};

type Context = {
  readonly app: INestApplication<App>;
  readonly prefix: string;
  readonly userToken: string;
  readonly adminToken: string;
  readonly userId: string;
  readonly disposableId: string;
};

/**
 * El guard que faltaba: **la respuesta REAL del servidor validada contra el esquema publicado**.
 *
 * ## Qué hueco cierra, dicho con precisión
 *
 * `openapi-contract.e2e-spec.ts` ya comprueba muchísimo, pero todo lo hace sobre el DOCUMENTO:
 * que cada operación lleve `summary`, que declare los status que puede devolver, que sus
 * ejemplos satisfagan su propio esquema, que esos ejemplos coincidan con lo que
 * `AllExceptionsFilter` emite. Ninguna de esas comprobaciones lanza una petición.
 *
 * Eso deja un flanco entero: **un ejemplo puede cumplir el esquema y el servidor devolver otra
 * cosa**. El ejemplo es un literal escrito a mano; la respuesta la construyen el DTO, el
 * interceptor de envoltura y el serializador. Nada los ataba. Los dos guardianes son
 * complementarios y ninguno sustituye al otro: aquel caza un contrato mal escrito, este caza un
 * contrato bien escrito que el servidor incumple.
 *
 * ## Por qué el guion va a mano y la validación no
 *
 * Cada operación necesita su propio montaje —un admin, un usuario al que borrar, un email que ya
 * exista para provocar el 409—, y eso no se puede derivar del documento. Lo que sí se deriva es
 * el esquema contra el que se valida: se saca de `document.paths[...][method].responses[status]`,
 * así que si alguien cambia el DTO y no el ejemplo, o al revés, la comparación lo ve.
 *
 * ⚠️ Y hay un caso que comprueba que **el guion cubre todas las operaciones del documento**. Sin
 * él, un endpoint nuevo entraría sin que nadie validara su respuesta y esta suite seguiría verde
 * — que es la forma en que un guardián deja de guardar sin que se note.
 */
describe('contrato OpenAPI en ejecución', () => {
  let app: INestApplication<App>;
  let prefix: string;
  let document: OpenAPIObject;
  let appConfig: AppConfig;
  let context: Context;
  let stub: TatumStubServer;
  const ajv = new Ajv({ strict: false, allErrors: true });

  /**
   * Las claves de `document.paths` llevan el PREFIJO GLOBAL (`/api/v1/users/{id}`), pero el guion
   * las escribe sin él para que se lea como la ruta que uno teclea. El prefijo se añade aquí, una
   * vez, en vez de repetirlo en cada escenario.
   */
  const compile = (operation: string, status: number): ValidateFunction => {
    const [method, route] = operation.split(' ');
    const path = `${prefix}${route}`;
    const pathItem = document.paths[path] as Record<string, unknown> | undefined;
    const op = pathItem?.[method!.toLowerCase()] as
      { responses?: Record<string, { content?: Record<string, { schema?: object }> }> } | undefined;
    const schema = op?.responses?.[String(status)]?.content?.['application/json']?.schema;
    if (!schema) {
      throw new Error(`Sin esquema publicado para ${operation} -> ${status}`);
    }
    // Los `$ref` apuntan a `#/components/schemas/...`, así que se embeben los `components` del
    // documento en el esquema compilado para que resuelvan contra sí mismos. Mismo truco que
    // `openapi-contract.e2e-spec.ts` usa para validar los ejemplos.
    return ajv.compile({ ...schema, components: document.components });
  };

  beforeAll(async () => {
    // El stub del proveedor custodial arranca ANTES que la app. Los tres escenarios de `wallets`
    // que salen a la red lo necesitan escuchando, y sin él saldrían a `TATUM_API_URL`, que en esta
    // suite apunta a loopback por `test/setup-env.ts` — o sea que la petición moriría con
    // ECONNREFUSED y el escenario hablaría del stub y no del contrato.
    stub = await TatumStubServer.start();
    ({ app, prefix, appConfig } = await createTestApp());
    document = buildOpenApiDocument(app, appConfig);
    const dataSource = app.get(DataSource);
    await dataSource.query('TRUNCATE TABLE wallet_transfers');
    await dataSource.query('TRUNCATE TABLE wallets');
    await dataSource.query('TRUNCATE TABLE auth_credentials');
    await dataSource.query('TRUNCATE TABLE users CASCADE');
    await dataSource.query('TRUNCATE TABLE orders CASCADE');

    const post = (path: string, body: object) =>
      request(app.getHttpServer()).post(`${prefix}${path}`).send(body);

    await post('/auth/register', {
      email: 'rt.user@example.com',
      name: 'RT User',
      password: PASSWORD,
    });
    await post('/auth/register', {
      email: 'rt.admin@example.com',
      name: 'RT Admin',
      password: PASSWORD,
    });
    await post('/auth/register', {
      email: 'rt.dispose@example.com',
      name: 'RT Dispose',
      password: PASSWORD,
    });
    await dataSource.query(`UPDATE users SET role = 'admin' WHERE email = $1`, [
      'rt.admin@example.com',
    ]);

    const login = async (email: string): Promise<string> => {
      const response = await post('/auth/login', { email, password: PASSWORD });
      return (response.body as { data: { accessToken: string } }).data.accessToken;
    };
    const idOf = async (email: string): Promise<string> => {
      const rows = await dataSource.query<{ id: string }[]>(
        'SELECT id FROM users WHERE email = $1',
        [email],
      );
      return rows[0]?.id ?? '';
    };

    context = {
      app,
      prefix,
      userToken: await login('rt.user@example.com'),
      adminToken: await login('rt.admin@example.com'),
      userId: await idOf('rt.user@example.com'),
      disposableId: await idOf('rt.dispose@example.com'),
    };
    resetThrottler(app);
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    // La aserción va ANTES de parar el stub: una ruta golpeada sin respuesta programada significa
    // que el guion mandó una llamada que nadie previó, y el 418 con el que el stub contestó no
    // representa nada del proveedor. Sin esto, un escenario podría estar validando contra el
    // esquema una respuesta de error que se ganó el propio doble.
    // ⚠️ Se copia la lista y se PARA el stub antes de afirmar. Con la aserción delante, un fallo
    // deja el `stop()` sin ejecutar y el puerto fijo ocupado: la siguiente suite E2E que arranque
    // el stub —misma corrida, `maxWorkers: 1`— muere con EADDRINUSE y el rojo habla del puerto en
    // vez del contrato. Es el patrón que `wallets.e2e-spec.ts` ya usa en su `afterEach`.
    const missed = [...(stub?.unstubbed ?? [])];
    await stub?.stop();
    expect(missed).toEqual([]);
  });

  const get = (context: Context, path: string, token?: string) => {
    const call = request(context.app.getHttpServer()).get(`${context.prefix}${path}`);
    return token ? call.set('Authorization', `Bearer ${token}`) : call;
  };

  const SCENARIOS: readonly Scenario[] = [
    {
      operation: 'GET /health',
      status: 200,
      describe: 'la sonda de salud completa',
      run: (context) => get(context, '/health'),
    },
    {
      operation: 'GET /health/liveness',
      status: 200,
      describe: 'la sonda de liveness',
      run: (context) => get(context, '/health/liveness'),
    },
    {
      operation: 'GET /health/readiness',
      status: 200,
      describe: 'la sonda de readiness',
      run: (context) => get(context, '/health/readiness'),
    },
    {
      operation: 'POST /auth/register',
      status: 201,
      describe: 'un alta correcta',
      run: (context) =>
        request(context.app.getHttpServer())
          .post(`${context.prefix}/auth/register`)
          .send({ email: 'rt.nuevo@example.com', name: 'RT Nuevo', password: PASSWORD }),
    },
    {
      operation: 'POST /auth/register',
      status: 409,
      describe: 'un alta con email ya registrado',
      run: (context) =>
        request(context.app.getHttpServer())
          .post(`${context.prefix}/auth/register`)
          .send({ email: 'rt.user@example.com', name: 'RT User', password: PASSWORD }),
    },
    {
      operation: 'POST /auth/login',
      status: 200,
      describe: 'un login correcto',
      run: (context) =>
        request(context.app.getHttpServer())
          .post(`${context.prefix}/auth/login`)
          .send({ email: 'rt.user@example.com', password: PASSWORD }),
    },
    {
      operation: 'POST /auth/login',
      status: 401,
      describe: 'un login con contraseña incorrecta',
      run: (context) =>
        request(context.app.getHttpServer())
          .post(`${context.prefix}/auth/login`)
          .send({ email: 'rt.user@example.com', password: 'no-es-la-contrasena' }),
    },
    {
      operation: 'GET /users',
      status: 200,
      describe: 'el listado paginado',
      run: (context) => get(context, '/users?page=1&limit=20', context.adminToken),
    },
    {
      operation: 'GET /users',
      status: 401,
      describe: 'el listado sin token',
      run: (context) => get(context, '/users'),
    },
    {
      operation: 'GET /users',
      status: 403,
      describe: 'el listado con un token sin rol admin',
      run: (context) => get(context, '/users', context.userToken),
    },
    {
      operation: 'GET /users/{id}',
      status: 200,
      describe: 'la consulta por id',
      run: (context) => get(context, `/users/${context.userId}`, context.userToken),
    },
    {
      operation: 'GET /users/{id}',
      status: 404,
      describe: 'la consulta de un id inexistente',
      run: (context) => get(context, `/users/${ABSENT_ID}`, context.userToken),
    },
    {
      operation: 'GET /users/{id}',
      status: 400,
      describe: 'la consulta con un id que no es UUID',
      run: (context) => get(context, '/users/no-es-uuid', context.userToken),
    },
    {
      operation: 'DELETE /users/{id}',
      status: 200,
      describe: 'la desactivación',
      run: (context) =>
        request(context.app.getHttpServer())
          .delete(`${context.prefix}/users/${context.disposableId}`)
          .set('Authorization', `Bearer ${context.adminToken}`),
    },
    {
      operation: 'POST /orders',
      status: 201,
      describe: 'una orden colocada',
      run: (context) =>
        request(context.app.getHttpServer())
          .post(`${context.prefix}/orders`)
          .set('Authorization', `Bearer ${context.userToken}`)
          .send({ concept: 'Pedido de prueba', amountCents: 1250 }),
    },
    {
      operation: 'POST /orders',
      status: 400,
      describe: 'una orden con importe inválido',
      run: (context) =>
        request(context.app.getHttpServer())
          .post(`${context.prefix}/orders`)
          .set('Authorization', `Bearer ${context.userToken}`)
          .send({ concept: 'Pedido de prueba', amountCents: -1 }),
    },
    // Los cinco de `wallets`, EN ESTE ORDEN. `it.each` conserva el orden del array y Jest los
    // corre en serie, así que cada uno deja el estado que el siguiente necesita: la wallet existe
    // antes de leerla, está activándose antes de transferir, y el libro tiene una fila antes de
    // listarlo. El stub se programa DENTRO de cada `run`, que es lo único que mantiene el
    // escenario autocontenido — un stub «por defecto» en el `beforeAll` volvería inútil el
    // registro `unstubbed` que el `afterAll` comprueba.
    //
    // Que los cinco VALIDAN de verdad la respuesta está medido rompiendo los dos DTO: quitando
    // `dto.status` de `WalletResponseDto.fromDomain` caen los tres que devuelven una wallet, con
    // `must have required property 'status'` y `schemaPath
    // "#/components/schemas/WalletResponseDto/required"`; quitando `dto.txId` de
    // `WalletTransferResponseDto.fromDomain` caen los dos del libro, con el mensaje equivalente.
    {
      operation: 'POST /wallets',
      status: 200,
      describe: 'el alta de la wallet custodiada',
      run: (context) => {
        stub.stub('POST', '/v3/gas-pump', {
          status: 200,
          body: [`0xdeadbeef${'0'.repeat(31)}1`],
        });
        return request(context.app.getHttpServer())
          .post(`${context.prefix}/wallets`)
          .set('Authorization', `Bearer ${context.userToken}`)
          .send();
      },
    },
    {
      operation: 'GET /wallets/me',
      status: 200,
      describe: 'la consulta de la wallet propia',
      run: (context) => get(context, '/wallets/me', context.userToken),
    },
    {
      operation: 'POST /wallets/me/activation',
      status: 202,
      describe: 'la activación de la wallet',
      run: (context) => {
        // El comodín por prefijo es obligatorio: la ruta lleva el índice que asignó la secuencia
        // de PostgreSQL, y el guion no puede saberlo de antemano porque la secuencia no se
        // reinicia entre suites.
        stub.stub('GET', '/v3/gas-pump/activated/*', {
          status: 200,
          body: { activated: false },
        });
        stub.stub('POST', '/v3/gas-pump/activate', {
          status: 200,
          body: { txId: 'ac'.repeat(32) },
        });
        return request(context.app.getHttpServer())
          .post(`${context.prefix}/wallets/me/activation`)
          .set('Authorization', `Bearer ${context.userToken}`)
          .send();
      },
    },
    {
      operation: 'POST /wallets/me/transfers',
      status: 200,
      describe: 'una transferencia enviada',
      run: (context) => {
        // `activated: true` reconcilia la wallet de `activating` a `active` en la misma llamada
        // que sirve de precondición: sin ella la transferencia daría 409 y este escenario
        // validaría contra el esquema equivocado.
        stub.stub('GET', '/v3/gas-pump/activated/*', { status: 200, body: { activated: true } });
        stub.stub('POST', '/v3/blockchain/sc/custodial/transfer', {
          status: 200,
          body: { txId: '7a'.repeat(32) },
        });
        return request(context.app.getHttpServer())
          .post(`${context.prefix}/wallets/me/transfers`)
          .set('Authorization', `Bearer ${context.userToken}`)
          .send({
            recipient: '0xabcdef0123456789abcdef0123456789abcdef01',
            kind: 'native',
            amount: '1000000000000000',
          });
      },
    },
    {
      operation: 'GET /wallets/me/transfers',
      status: 200,
      describe: 'el listado paginado del libro de transferencias',
      run: (context) => get(context, '/wallets/me/transfers?page=1&limit=20', context.userToken),
    },
  ];

  describe('cada respuesta real', () => {
    it.each(SCENARIOS.map((scenario) => [`${scenario.operation} -> ${scenario.status}`, scenario]))(
      'debería satisfacer el esquema publicado para %s',
      async (_label, scenario) => {
        // Arrange
        const validate = compile(scenario.operation, scenario.status);

        // Act
        const response = await scenario.run(context);

        // Assert
        // El status primero: si el servidor devuelve otro, el esquema contra el que se validaría
        // sería el equivocado y el fallo diría algo que no es.
        expect({ status: response.status, body: response.body }).toMatchObject({
          status: scenario.status,
        });
        const valid = validate(response.body);
        expect(valid ? [] : (validate.errors ?? [])).toEqual([]);
      },
      30_000,
    );
  });

  describe('cobertura del guion', () => {
    it('debería ejercitar todas las operaciones que el documento publica', () => {
      // Arrange
      const published = new Set<string>();
      for (const [path, item] of Object.entries(document.paths)) {
        for (const method of Object.keys(item)) {
          published.add(`${method.toUpperCase()} ${path.replace(prefix, '')}`);
        }
      }
      const scripted = new Set(SCENARIOS.map((scenario) => scenario.operation));

      // Act
      const missing = [...published].filter((operation) => !scripted.has(operation)).sort();

      // Assert
      // ⚠️ Esta es la línea que impide que el guardián deje de guardar en silencio: sin ella, un
      // endpoint nuevo entraría sin que nadie validara su respuesta y la suite seguiría verde.
      // El precio es que añadir un endpoint obliga a añadir su escenario, que es exactamente lo
      // que se quiere que cueste.
      expect(missing).toEqual([]);
    });
  });
});
