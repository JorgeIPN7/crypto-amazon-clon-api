import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import type { WalletsConfig } from '@config/wallets.config';
import { createTestApp } from '@test/helpers/create-test-app';
import { resetThrottler } from '@test/helpers/reset-throttler';
import { TatumStubServer } from '@test/helpers/tatum-stub-server';

/** Cumple `@MinLength(8)` de `RegisterAccountDto`; el valor en sí es irrelevante. */
const DEFAULT_PASSWORD = 'contrasena-larga-de-prueba';

/**
 * La master del entorno de test. Es el vector canónico de secp256k1 (clave = 1) que fija
 * `test/setup-env.ts`, y `MasterKeyStartupCheck` ya verificó al arrancar que la clave configurada
 * deriva exactamente esta dirección — si no, el `AppModule` no habría arrancado y no habría suite.
 */
const MASTER_ADDRESS = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf';

/**
 * Direcciones que SOLO el stub puede producir. Los casos felices afirman sobre el CONTENIDO y no
 * sobre el status: un 200 con la dirección equivocada pasaría una aserción de status.
 */
const DERIVED_ADDRESS = `0xdeadbeef${'0'.repeat(31)}1`;
const SECOND_ADDRESS = `0xdeadbeef${'0'.repeat(31)}2`;

/**
 * ⚠️ Los dos txId van SIN el prefijo `0x`, como el ejemplo del proveedor. Que las aserciones
 * esperen `0x` + esto es lo que prueba la normalización de `readTxId` en
 * `infrastructure/gateways/tatum-custodial-address.gateway.ts`; sin ella `TransactionHash.from`
 * lanzaría y el 502 llegaría con el gas ya pagado.
 */
const ACTIVATION_TX = 'ac'.repeat(32);
const TRANSFER_TX = '7a'.repeat(32);
const SECOND_TRANSFER_TX = 'bb'.repeat(32);

/** Todo en minúsculas: sin mayúsculas no hay checksum EIP-55 que comprobar, y se acepta. */
const RECIPIENT = '0xabcdef0123456789abcdef0123456789abcdef01';

/**
 * La forma EIP-55 correcta de `RECIPIENT` con UN carácter de caso cambiado (`C` -> `c`, posición 3
 * del cuerpo). Medido en este repo con el mismo `toChecksumAddress` que usa el validador
 * (`node -e` sobre `@noble/hashes`):
 *   0xabcdef0123456789abcdef0123456789abcdef01 -> 0xabCDeF0123456789AbcdEf0123456789aBCDEF01
 */
const BROKEN_CHECKSUM_RECIPIENT = '0xabcDeF0123456789AbcdEf0123456789aBCDEF01';

/** Un envío nativo válido: `amount` viaja como string, nunca como número (18 decimales). */
const NATIVE_TRANSFER = { recipient: RECIPIENT, kind: 'native', amount: '1000000000000000' };

type WalletRow = { status: string; address: string; activation_tx_id: string | null };
type TransferRow = { status: string; tx_id: string | null; reason_code: string | null };

/**
 * Los cinco endpoints contra la aplicación real, PostgreSQL real y el proveedor custodial
 * doblado por `test/helpers/tatum-stub-server.ts`, que es un servidor HTTP de verdad en loopback.
 *
 * ⚠️ **Ninguna llamada sale a internet, y eso es un requisito de seguridad y no de velocidad**:
 * `POST /wallets/me/transfers` contra la API real movería dinero de la master. El control es la
 * línea `TATUM_API_URL` de `test/setup-env.ts`, y el guardián de esa línea es el último caso de
 * este archivo, que afirma sobre la configuración YA RESUELTA por la aplicación.
 *
 * **Cuatro capas impiden que un escenario afirme sobre una respuesta que nadie escribió**, y
 * ninguna sustituye a las otras: (1) una ruta sin programar responde 418, (2) `stub.unstubbed` la
 * NOMBRA y el `afterEach` exige que la lista quede vacía, (3) los casos felices comparan el
 * contenido literal que solo el stub produce, y (4) el registro `stub.calls` cuenta las llamadas.
 * La capa 1 por sí sola no distingue nada: medido en el JSDoc de `UNSTUBBED_STATUS`, un 418 y un
 * 404 salen los dos como el mismo 503 con el mismo mensaje fijo.
 */
describe('Wallets (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let prefix: string;
  let stub: TatumStubServer;
  let userToken: string;
  let secondToken: string;
  let adminToken: string;
  let goneToken: string;

  beforeAll(async () => {
    // El stub arranca ANTES que la app. Hoy ningún adaptador de `wallets` llama al proveedor al
    // construirse, así que el orden no es obligatorio; se fija igual para que, si algún día lo
    // hiciera, el fallo sea el suyo y no un ECONNREFUSED del arranque.
    stub = await TatumStubServer.start();
    ({ app, prefix } = await createTestApp());
    dataSource = app.get(DataSource);

    // Arranque limpio de las cuentas y UN solo login por cuenta para toda la suite: el
    // presupuesto de `@Throttle` de auth es 10/min y esta suite hace muchas peticiones.
    await dataSource.query('TRUNCATE TABLE wallet_transfers');
    await dataSource.query('TRUNCATE TABLE wallets');
    await dataSource.query('TRUNCATE TABLE auth_credentials');
    await dataSource.query('TRUNCATE TABLE users CASCADE');

    userToken = await registerAndLogin('duena@example.com');
    secondToken = await registerAndLogin('segunda@example.com');
    adminToken = await registerAndLogin('admin.wallets@example.com');
    await dataSource.query(`UPDATE users SET role = 'admin' WHERE email = $1`, [
      'admin.wallets@example.com',
    ]);
    // El rol viaja EN el token, así que hay que volver a firmarlo tras promover.
    adminToken = await login('admin.wallets@example.com');

    // Cuenta con token válido y perfil desactivado, para el 403. Se desactiva aquí y para
    // siempre: el `beforeEach` solo trunca las dos tablas de `wallets`, así que ningún caso la
    // reactiva por accidente y ninguno tiene que acordarse de restaurarla.
    goneToken = await registerAndLogin('desactivada@example.com');
    await dataSource.query(`UPDATE users SET active = false WHERE email = $1`, [
      'desactivada@example.com',
    ]);
  });

  beforeEach(async () => {
    // Solo las tablas de wallets: truncar users mataría a los dueños de los tokens.
    // La secuencia de índices NO se reinicia. Reiniciarla es exactamente el desastre que el
    // índice único sobre `address_index` existe para convertir en un 500 con nombre, y ninguna
    // aserción de aquí necesita que el índice valga cero: el primer caso afirma que es un NÚMERO
    // entero no negativo, que además es lo que caza el bug del `int8` entregado como string.
    await dataSource.query('TRUNCATE TABLE wallet_transfers');
    await dataSource.query('TRUNCATE TABLE wallets');
    // ⚠️ Los dos endpoints que mueven gas o dinero —`POST /wallets/me/activation` y
    // `POST /wallets/me/transfers`— llevan su propio `@Throttle({ limit: 10, ttl: 60_000 })`, y
    // `ThrottlerGuard` cuenta por clase Y handler. Esta suite hace más de diez llamadas a cada
    // uno contra la MISMA app, así que sin el reset se autoenvenena: los últimos casos reciben
    // 429 donde esperan 200 o 202, y el rojo habla del presupuesto de peticiones del test y no
    // del código bajo prueba. Ningún `describe` de aquí mide el 429, así que vaciar el contador
    // no borra nada que se esté midiendo.
    resetThrottler(app);
  });

  afterEach(() => {
    // Reset primero, aserción después: si la aserción falla, el estado del stub ya está limpio
    // y el siguiente test habla de sí mismo.
    const missed = [...stub.unstubbed];
    stub.reset();
    expect(missed).toEqual([]);
  });

  afterAll(async () => {
    await app?.close();
    await stub?.stop();
  });

  // Helpers. Viven DENTRO del `describe` porque leen `app`, `prefix`, `stub` y `dataSource`, que
  // son sus variables. Ninguno se ejecuta durante la recolección: solo los llaman los hooks y los
  // cuerpos de los `it`.

  const postWallet = (token: string) =>
    request(app.getHttpServer())
      .post(`${prefix}/wallets`)
      .set('Authorization', `Bearer ${token}`)
      .send();

  const getWallet = (token: string) =>
    request(app.getHttpServer())
      .get(`${prefix}/wallets/me`)
      .set('Authorization', `Bearer ${token}`);

  const postActivation = (token: string) =>
    request(app.getHttpServer())
      .post(`${prefix}/wallets/me/activation`)
      .set('Authorization', `Bearer ${token}`)
      .send();

  const postTransfer = (token: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`${prefix}/wallets/me/transfers`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const stubDerive = (address: string): void => {
    stub.stub('POST', '/v3/gas-pump', { status: 200, body: [address] });
  };

  const stubActivate = (txId: string): void => {
    stub.stub('POST', '/v3/gas-pump/activate', { status: 200, body: { txId } });
  };

  /**
   * Comodín por prefijo: la ruta real lleva el índice que asignó la secuencia
   * (`/v3/gas-pump/activated/ETH/<master>/<índice>`), y el guion no puede saberlo de antemano
   * porque la secuencia no se reinicia entre tests.
   */
  const stubActivationCheck = (activated: boolean): void => {
    stub.stub('GET', '/v3/gas-pump/activated/*', { status: 200, body: { activated } });
  };

  /**
   * Deja al usuario con una wallet en `activating`: alta, comprobación que dice «todavía no» y
   * envío de la activación.
   *
   * ⚠️ **No la deja en `active`, y el nombre lo dice para no mentir.** Quien la pasa a `active` es
   * la reconciliación perezosa de `TransferAssetUseCase.ensureCanSend`, que corre DENTRO de la
   * propia transferencia cuando `stubActivationCheck(true)` está programado — por eso cada caso de
   * transferencia lo programa en su `// Arrange`. Es el camino real y por eso se prueba así: fijar
   * `status='active'` con un UPDATE probaría la tabla, no el sistema.
   *
   * ⚠️ Y tampoco programa la respuesta de la transferencia ni la comprobación de activación. Las
   * colas del stub son FIFO POR RUTA y se comparten entre helper y caso, así que una programación
   * del helper se cuela DELANTE de la del caso y este acaba recibiendo una respuesta que no
   * escribió. Medido metiendo en el helper `stubActivationCheck(true)` + un 200 de transferencia:
   * caen TRES casos y ninguno por su motivo —el del timeout con `Expected 502 / Received 200`
   * (recibe el 200 del helper en vez del `hang`), el del 400 del proveedor con
   * `Expected 400 / Received 200`, y el del listado con `Received length: 0`, porque el
   * `activated:false` del segundo alta se cruza con el `true` que el helper dejó pendiente del
   * primero—.
   */
  const giveActivatingWallet = async (token: string, address = DERIVED_ADDRESS): Promise<void> => {
    stubDerive(address);
    await postWallet(token);
    stubActivationCheck(false);
    stubActivate(ACTIVATION_TX);
    await postActivation(token);
  };

  const submitTransfer = async (token: string, txId: string): Promise<void> => {
    stubActivationCheck(true);
    stub.stub('POST', '/v3/blockchain/sc/custodial/transfer', { status: 200, body: { txId } });
    await postTransfer(token, NATIVE_TRANSFER);
  };

  const countTransfers = async (): Promise<number> => {
    const rows = await dataSource.query<{ count: number }[]>(
      'SELECT COUNT(*)::int AS count FROM wallet_transfers',
    );
    return rows[0]?.count ?? 0;
  };

  async function login(email: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post(`${prefix}/auth/login`)
      .send({ email, password: DEFAULT_PASSWORD })
      .expect(200);
    return response.body.data.accessToken as string;
  }

  async function registerAndLogin(email: string): Promise<string> {
    await request(app.getHttpServer())
      .post(`${prefix}/auth/register`)
      .send({ email, name: 'Duena E2E', password: DEFAULT_PASSWORD })
      .expect(201);
    return login(email);
  }

  describe('POST /wallets', () => {
    it('debería devolver 200 con la dirección derivada y un índice numérico al pedir la wallet por primera vez', async () => {
      // Arrange
      stubDerive(DERIVED_ADDRESS);

      // Act
      const response = await postWallet(userToken);

      // Assert
      expect(response.status).toBe(200);
      expect(Object.keys(response.body as Record<string, unknown>).sort()).toEqual([
        'data',
        'request',
        'success',
      ]);
      expect(response.body.data.address).toBe(DERIVED_ADDRESS);
      // `typeof number` no es celo: `nextval` devuelve un `bigint` y el driver de PostgreSQL
      // entrega los `int8` COMO STRING, así que lo que sale del asignador es `"12"` hasta que
      // alguien lo convierte.
      //
      // ⚠️ Lo que este par de aserciones fija es que lo PUBLICADO sea un entero, no que el
      // proveedor rechazaría un string. Medido quitando el `Number(...)` de
      // `sequence-address-index.allocator.ts`: caen 11 de los 18 casos del archivo y el alta
      // responde 500, porque `AddressIndex.from` rechaza el string con `InvalidAddressIndexError`
      // ANTES de que el índice llegue a viajar a ninguna parte. El índice como texto nunca sale
      // del proceso; el defecto que quedaría vivo sin esta línea es un `index` de tipo string en
      // una respuesta que el documento publica como `integer`.
      expect(typeof response.body.data.index).toBe('number');
      expect(Number.isInteger(response.body.data.index)).toBe(true);
      expect(response.body.data.index).toBeGreaterThanOrEqual(0);
    });

    it('debería devolver la misma dirección sin llamar al proveedor cuando se repite la petición', async () => {
      // Arrange
      stubDerive(DERIVED_ADDRESS);
      const first = await postWallet(userToken);

      // Act — nada programado para esta segunda llamada: si el caso de uso llamara al proveedor,
      // el stub respondería 418 y `unstubbed` dejaría de estar vacío. Medido quitando el
      // `if (existing) return existing;` de `AssignWalletUseCase`: este es el único caso rojo del
      // archivo, con `Expected: 200 / Received: 503` — el 418 traducido — y el `afterEach` de la
      // higiene del guion detrás.
      const second = await postWallet(userToken);

      // Assert
      expect(second.status).toBe(200);
      expect(second.body.data.address).toBe(first.body.data.address);
      expect(stub.calls.filter((call) => call.path === '/v3/gas-pump')).toHaveLength(1);
    });

    it('debería no devolver nunca una dirección igual a la master configurada', async () => {
      // Arrange
      stubDerive(DERIVED_ADDRESS);
      stubDerive(SECOND_ADDRESS);

      // Act
      const first = await postWallet(userToken);
      const second = await postWallet(secondToken);

      // Assert
      // ⚠️ Lo que este caso aporta, dicho sin inflarlo: es el ÚNICO de los controles de la
      // invariante «una sola EOA» que mira lo que el cliente recibe de verdad, atravesando el
      // caso de uso, el mapper, el DTO y el interceptor de sobre. Los que la hacen IMPOSIBLE
      // están en otro sitio y se miden allí: `deriveAddress` rechaza la master con
      // `WalletAddressIsMasterError` (su spec de pasarela) y la base con
      // `ck_wallets_address_not_master` (el E2E del repositorio). Con el stub devolviendo
      // direcciones que no son la master, este caso NO puede ponerse rojo por un fallo de esos
      // dos; lo que sí caza es que la respuesta se componga con la dirección equivocada. Medido
      // haciendo que `assign()` devuelva `WalletResponseDto.forMaster(...)`: caen DOS casos, este
      // con `Received array: ["0x7e5f…bdf", "0x7e5f…bdf"]` y el primero del archivo.
      expect([first.body.data.address, second.body.data.address]).not.toContain(MASTER_ADDRESS);
    });

    it('debería responder 409 al rol admin, que ya tiene la master', async () => {
      // Act
      const response = await postWallet(adminToken);

      // Assert
      expect(response.status).toBe(409);
      const rows = await dataSource.query<{ count: number }[]>(
        'SELECT COUNT(*)::int AS count FROM wallets',
      );
      expect(rows[0]?.count).toBe(0);
    });

    it('debería responder 403 al pedir la wallet con el perfil del dueño desactivado', async () => {
      // Act — el token sigue firmado y sin caducar: el 403 lo decide el directorio, no el guard.
      const response = await postWallet(goneToken);

      // Assert
      expect(response.status).toBe(403);
      // Ni fila ni llamada al proveedor: el directorio se consulta ANTES de reservar el índice,
      // que es irreversible, y antes de gastar el crédito de la derivación.
      const rows = await dataSource.query<{ count: number }[]>(
        'SELECT COUNT(*)::int AS count FROM wallets',
      );
      expect(rows[0]?.count).toBe(0);
      expect(stub.calls).toEqual([]);
    });

    it('debería responder 401 al pedir la wallet sin token', async () => {
      // Act
      const response = await request(app.getHttpServer()).post(`${prefix}/wallets`).send();

      // Assert
      expect(response.status).toBe(401);
    });
  });

  describe('GET /wallets/me', () => {
    it('debería devolver la wallet del usuario con kind custodial', async () => {
      // Arrange
      stubDerive(DERIVED_ADDRESS);
      await postWallet(userToken);

      // Act
      const response = await getWallet(userToken);

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.data.kind).toBe('custodial');
      expect(response.body.data.address).toBe(DERIVED_ADDRESS);
      expect(typeof response.body.data.index).toBe('number');
    });

    it('debería devolver la master con kind master e index nulo para el admin', async () => {
      // Act
      const response = await getWallet(adminToken);

      // Assert
      // Un 404 aquí sería mentira a medias: el admin SÍ tiene dirección y es la que sostiene
      // todo el fondo de gas. Su EOA no está en la tabla, vive en la configuración.
      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        kind: 'master',
        index: null,
        address: MASTER_ADDRESS,
      });
    });

    it('debería responder 404 al consultar la wallet de un usuario que no la ha pedido', async () => {
      // Act
      const response = await getWallet(userToken);

      // Assert
      expect(response.status).toBe(404);
    });
  });

  describe('POST /wallets/me/activation', () => {
    it('debería responder 202 y dejar la fila en activating con el txId prefijado con 0x', async () => {
      // Arrange
      stubDerive(DERIVED_ADDRESS);
      await postWallet(userToken);
      stubActivationCheck(false);
      stubActivate(ACTIVATION_TX);

      // Act
      const response = await postActivation(userToken);

      // Assert
      // 202 y no 200: la transacción está ENVIADA, no minada.
      expect(response.status).toBe(202);
      const rows = await dataSource.query<WalletRow[]>(
        'SELECT status, address, activation_tx_id FROM wallets',
      );
      expect(rows[0]).toMatchObject({
        status: 'activating',
        activation_tx_id: `0x${ACTIVATION_TX}`,
      });
    });

    it('debería responder 409 al activar una wallet que el proveedor ya da por activada', async () => {
      // Arrange
      stubDerive(DERIVED_ADDRESS);
      await postWallet(userToken);
      stubActivationCheck(true);

      // Act
      const response = await postActivation(userToken);

      // Assert
      expect(response.status).toBe(409);
      const rows = await dataSource.query<WalletRow[]>('SELECT status FROM wallets');
      // La reconciliación es perezosa y va DENTRO de activar: la misma llamada que sirve de
      // precondición cura el estado. Por eso la fila acaba en `active` pese al 409.
      expect(rows[0]?.status).toBe('active');
    });
  });

  describe('POST /wallets/me/transfers', () => {
    it('debería responder 409 al transferir desde una wallet que el proveedor no da por activada', async () => {
      // Arrange
      stubDerive(DERIVED_ADDRESS);
      await postWallet(userToken);
      stubActivationCheck(false);

      // Act
      const response = await postTransfer(userToken, NATIVE_TRANSFER);

      // Assert
      expect(response.status).toBe(409);
      // La escritura por delante ocurre DESPUÉS de la precondición: si no, el libro se llenaría
      // de rechazos que nunca salieron del proceso.
      expect(await countTransfers()).toBe(0);
    });

    it('debería registrar la transferencia como submitted con el txId del proveedor prefijado con 0x', async () => {
      // Arrange
      await giveActivatingWallet(userToken);
      stubActivationCheck(true);
      stub.stub('POST', '/v3/blockchain/sc/custodial/transfer', {
        status: 200,
        body: { txId: TRANSFER_TX },
      });

      // Act
      const response = await postTransfer(userToken, NATIVE_TRANSFER);

      // Assert
      expect(response.status).toBe(200);
      const rows = await dataSource.query<TransferRow[]>(
        'SELECT status, tx_id, reason_code FROM wallet_transfers',
      );
      expect(rows).toEqual([{ status: 'submitted', tx_id: `0x${TRANSFER_TX}`, reason_code: null }]);
    });

    it('debería dejar la fila en unknown cuando la llamada al proveedor expira', async () => {
      // Arrange
      await giveActivatingWallet(userToken);
      stubActivationCheck(true);
      // El stub acepta la conexión y NO responde jamás. Es la única forma de provocar el
      // timeout de verdad: un 504 simulado ejercitaría otra rama del adaptador —`translateStatus`
      // con un 5xx, no el `AbortSignal.timeout` de `call()`—.
      stub.stub('POST', '/v3/blockchain/sc/custodial/transfer', { status: 200, hang: true });

      // Act
      const response = await postTransfer(userToken, NATIVE_TRANSFER);

      // Assert
      expect(response.status).toBe(502);
      const rows = await dataSource.query<TransferRow[]>(
        'SELECT status, tx_id, reason_code FROM wallet_transfers',
      );
      // ⚠️ Este es el caso del libro: tras un timeout la fila tiene que EXISTIR y decir
      // `unknown`. `rejected` afirmaría que la cadena no se tocó, y un timeout no permite afirmar
      // eso; `submitting` sería el estado del que nadie sabe salir; ausente sería no tener rastro
      // de un envío que pudo minarse.
      //
      // Que la aserción MIDE está comprobado rompiendo el código: cambiando el
      // `transfer.markUnknown(...)` de `transfer-asset.use-case.ts` por `markRejected(...)`, este
      // es el ÚNICO caso rojo del archivo, con `Expected "unknown" / Received "rejected"` (y en
      // la unitaria del mismo código, `transfer-asset.use-case.spec.ts`, cae exactamente uno:
      // «debería registrar unknown cuando la llamada no deja saber el resultado»).
      //
      // ⚠️ **Lo que este caso NO mide, y decirlo importa porque el nombre del patrón invita a
      // creer lo contrario: no distingue la escritura POR DELANTE de una escritura posterior.**
      // Medido sustituyendo por un comentario el `await this.transfers.save(transfer)` previo a
      // la llamada: este archivo se queda en 18/18 VERDE, porque el `catch` llama igualmente a
      // `recordOutcome()` y la fila acaba existiendo con `unknown`. La escritura por delante solo
      // se nota si el proceso muere ENTRE el INSERT y la respuesta, y eso ningún E2E lo alcanza.
      // Quien la guarda es la unitaria —con esa misma sonda caen SEIS de sus casos, uno de ellos
      // «debería escribir la fila del libro ANTES de llamar al proveedor», que espía el orden de
      // las llamadas al doble—. Los dos son necesarios: aquel fija el ORDEN, este fija que el
      // estado que acaba EN POSTGRESQL, atravesando mapper y repositorio, es `unknown`.
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('unknown');
      expect(rows[0]?.tx_id).toBeNull();
    });

    it('debería registrar la transferencia como rejected con un código propio cuando el proveedor devuelve 400', async () => {
      // Arrange
      await giveActivatingWallet(userToken);
      stubActivationCheck(true);
      const providerMessage = "Unable to find valid subscription for 'clave-del-proveedor'";
      stub.stub('POST', '/v3/blockchain/sc/custodial/transfer', {
        status: 400,
        body: { errorCode: 'transaction.invalid', message: providerMessage },
      });

      // Act
      const response = await postTransfer(userToken, NATIVE_TRANSFER);

      // Assert
      expect(response.status).toBe(400);
      const rows = await dataSource.query<TransferRow[]>(
        'SELECT status, tx_id, reason_code FROM wallet_transfers',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('rejected');
      expect(rows[0]?.reason_code).toEqual(expect.any(String));
      // ⚠️ El motivo es un código de una lista CERRADA, nunca el `message` del proveedor: el
      // texto del 401 de Tatum interpola la clave de API, y esta tabla se publica por
      // `GET /wallets/me/transfers`. Guardarlo escribiría un secreto en una respuesta pública.
      expect(JSON.stringify(rows)).not.toContain(providerMessage);
      expect(JSON.stringify(response.body)).not.toContain(providerMessage);
    });

    it('debería responder 400 sin llamar al proveedor cuando el checksum EIP-55 del destinatario está roto', async () => {
      // Arrange
      await giveActivatingWallet(userToken);
      const callsBefore = stub.calls.length;

      // Act
      const response = await postTransfer(userToken, {
        ...NATIVE_TRANSFER,
        recipient: BROKEN_CHECKSUM_RECIPIENT,
      });

      // Assert
      expect(response.status).toBe(400);
      // Todo 400 muere sin gastar créditos: la validación de entrada va ANTES de tocar la red.
      expect(stub.calls).toHaveLength(callsBefore);
      expect(await countTransfers()).toBe(0);
    });
  });

  describe('GET /wallets/me/transfers', () => {
    it('debería listar solo las transferencias del usuario autenticado, paginadas', async () => {
      // Arrange
      await giveActivatingWallet(userToken);
      await giveActivatingWallet(secondToken, SECOND_ADDRESS);
      await submitTransfer(userToken, TRANSFER_TX);
      await submitTransfer(secondToken, SECOND_TRANSFER_TX);

      // Act
      const response = await request(app.getHttpServer())
        .get(`${prefix}/wallets/me/transfers?page=1&limit=20`)
        .set('Authorization', `Bearer ${userToken}`);

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.data.items).toHaveLength(1);
      expect(response.body.data.meta.total).toBe(1);
      // El txId y no solo la cuenta: dos filas del mismo tamaño no distinguen de quién son. Este
      // es el literal que solo el envío del usuario autenticado pudo producir.
      expect(response.body.data.items[0].txId).toBe(`0x${TRANSFER_TX}`);
      // Y las DOS filas existen en la base: sin esta línea, un montaje en el que la transferencia
      // del segundo usuario nunca llegara a escribirse dejaría el caso verde afirmando un filtrado
      // que nadie ejerció. Que el filtro se mide de verdad está comprobado quitando el
      // `where: { ownerId }` de `WalletTransferTypeOrmRepository.findByOwner`: este caso es el
      // único rojo del archivo, con `Expected length: 1 / Received length: 2`.
      expect(await countTransfers()).toBe(2);
    });
  });

  describe('configuración resuelta', () => {
    it('debería resolver la configuración del proveedor contra loopback', () => {
      // Arrange
      const config = app.get(ConfigService).getOrThrow<WalletsConfig>('wallets');

      // Act
      const apiUrl = config.apiUrl;

      // Assert
      // ⚠️ El guardián del guardián. Sin este caso, borrar la línea `TATUM_API_URL` de
      // `test/setup-env.ts` dejaría toda la suite en verde mientras las transferencias salen a la
      // API real y gastan ETH de la master. Afirma sobre la config YA RESUELTA por la aplicación,
      // no sobre `process.env`: entre las dos está `ConfigModule`, que es donde el default de
      // `env.schema.ts` (`https://api.tatum.io`) podría ganar.
      expect(apiUrl).toMatch(/^http:\/\/127\.0\.0\.1:/);
    });
  });
});
