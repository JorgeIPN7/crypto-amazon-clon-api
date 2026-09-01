import {
  MASKED_SECRET,
  TATUM_STUB_BASE_URL,
  TatumStubServer,
  UNSTUBBED_STATUS,
} from '@test/helpers/tatum-stub-server';

/**
 * ⚠️ Este spec vive en `src/__tests__/` y NO junto al helper que prueba. `jest.config.mjs` fija
 * `roots: ['<rootDir>/src']`, así que un `*.spec.ts` dentro de `test/` no se descubre: se quedaría
 * sin ejecutar y nadie lo notaría. Medido copiando este archivo a `test/helpers/`: `npx jest
 * --listTests` no lo lista, y ejecutarlo por ruta responde `Pattern: test/helpers/…spec.ts - 0
 * matches` tras revisar 337 archivos. El precedente exacto es
 * `src/__tests__/secretlint.spec.ts`, que prueba `.secretlintrc.json`, otro archivo de fuera de
 * `src/`.
 */
describe('TatumStubServer', () => {
  let stub: TatumStubServer;

  beforeAll(async () => {
    stub = await TatumStubServer.start();
  });

  afterEach(() => {
    stub.reset();
  });

  afterAll(async () => {
    await stub.stop();
  });

  describe('stub()', () => {
    it('debería devolver la respuesta programada para una ruta exacta', async () => {
      // Arrange
      stub.stub('POST', '/v3/gas-pump', { status: 200, body: ['0xabc'] });

      // Act
      const response = await post('/v3/gas-pump', { chain: 'ETH' });

      // Assert
      expect({ status: response.status, body: await response.json() }).toEqual({
        status: 200,
        body: ['0xabc'],
      });
    });

    it('debería casar una ruta comodín por prefijo', async () => {
      // Arrange
      stub.stub('GET', '/v3/gas-pump/activated/*', { status: 200, body: { activated: true } });

      // Act
      const response = await fetch(`${TATUM_STUB_BASE_URL}/v3/gas-pump/activated/ETH/0xaa/7`);

      // Assert
      expect(await response.json()).toEqual({ activated: true });
    });

    it('debería consumir las respuestas de una misma ruta en orden FIFO', async () => {
      // Arrange
      stub.stub('POST', '/v3/gas-pump', { status: 200, body: ['primera'] });
      stub.stub('POST', '/v3/gas-pump', { status: 200, body: ['segunda'] });

      // Act
      const first = await (await post('/v3/gas-pump', {})).json();
      const second = await (await post('/v3/gas-pump', {})).json();

      // Assert
      expect([first, second]).toEqual([['primera'], ['segunda']]);
    });
  });

  describe('rutas sin programar', () => {
    it('debería fijar 418 como el status de una ruta sin programar', () => {
      // Arrange + Act + Assert
      // El literal, y no `expect(response.status).toBe(UNSTUBBED_STATUS)`, que es TAUTOLÓGICO:
      // medido cambiando la constante a 500, la suite entera se queda en verde (11 passed) y la
      // decisión en la que se apoya la capa 1 deja de estar guardada. Mismo patrón que
      // `expect(TATUM_CHAIN).toBe('ETH')` en `wallets.config.spec.ts`. El motivo del 418 —y el
      // hecho, medido, de que NO cambie el status que el adaptador publica— está en el JSDoc de
      // la constante.
      expect(UNSTUBBED_STATUS).toBe(418);
    });

    it('debería responder 418 cuando la ruta golpeada no tiene respuesta programada', async () => {
      // Act
      const response = await post('/v3/blockchain/sc/custodial/transfer', {});

      // Assert
      // 418 a propósito. No porque el adaptador lo traduzca distinto —no lo hace: sale 503, igual
      // que un 404, medido— sino porque las siete operaciones del proveedor declaran solo
      // `200, 400, 401, 403, 500`, así que este status no puede venir de él, y porque un 4xx no
      // dispara el reintento que un 5xx sí. El razonamiento completo, con la sonda, está en el
      // JSDoc de `UNSTUBBED_STATUS`.
      expect(response.status).toBe(UNSTUBBED_STATUS);
    });

    it('debería registrar la ruta golpeada sin respuesta programada', async () => {
      // Act
      await post('/v3/gas-pump/activate', {});

      // Assert
      expect(stub.unstubbed).toEqual(['POST /v3/gas-pump/activate']);
    });
  });

  describe('calls', () => {
    it('debería guardar la clave privada ENMASCARADA en el registro de llamadas', async () => {
      // Arrange
      stub.stub('POST', '/v3/blockchain/sc/custodial/transfer', {
        status: 200,
        body: { txId: 'ab' },
      });
      const secret = `0x${'1'.repeat(64)}`;

      // Act
      await post('/v3/blockchain/sc/custodial/transfer', { chain: 'ETH', fromPrivateKey: secret });

      // Assert
      // Sobre el registro ENTERO serializado: comprobar solo `calls[0].body.fromPrivateKey`
      // dejaría pasar una copia de la clave en cualquier otro campo.
      expect(JSON.stringify(stub.calls)).not.toContain(secret);
      expect(stub.calls[0]?.body).toEqual({ chain: 'ETH', fromPrivateKey: MASKED_SECRET });
    });

    it('debería enmascarar la clave privada también cuando viaja anidada', async () => {
      // Arrange
      // Ningún cuerpo de este ciclo anida la clave, y ese es justo el punto: sin este caso, un
      // enmascarado de un solo nivel deja el otro caso VERDE mientras el JSDoc del helper afirma
      // que enmascara «la clave privada». Comprobado que mide: con `maskValue` sustituido por la
      // identidad, este caso cae y el anterior sigue en verde.
      stub.stub('POST', '/v3/gas-pump', { status: 200, body: [] });
      const secret = `0x${'2'.repeat(64)}`;

      // Act
      await post('/v3/gas-pump', { batch: [{ fromPrivateKey: secret }] });

      // Assert
      expect(JSON.stringify(stub.calls)).not.toContain(secret);
      expect(stub.calls[0]?.body).toEqual({ batch: [{ fromPrivateKey: MASKED_SECRET }] });
    });

    it('debería registrar si la petición llevaba cabecera x-api-key sin guardar su valor', async () => {
      // Arrange
      stub.stub('POST', '/v3/gas-pump', { status: 200, body: [] });

      // Act
      await post('/v3/gas-pump', {}, { 'x-api-key': 'una-clave-de-api' });

      // Assert
      expect(stub.calls[0]).toEqual({
        method: 'POST',
        path: '/v3/gas-pump',
        body: {},
        apiKeyPresent: true,
      });
      expect(JSON.stringify(stub.calls)).not.toContain('una-clave-de-api');
    });
  });

  describe('hang', () => {
    it('debería no responder nunca cuando la respuesta programada es hang', async () => {
      // Arrange
      stub.stub('POST', '/v3/blockchain/sc/custodial/transfer', { status: 200, hang: true });

      // Act
      const failure = await post('/v3/blockchain/sc/custodial/transfer', {}, {}, 300).catch(
        (error: unknown) => error,
      );

      // Assert
      // `AbortSignal.timeout` rechaza con un DOMException cuyo `name` es "TimeoutError" — NO
      // "AbortError", y por eso se discrimina por `name` y nunca por `instanceof`. Es el mismo
      // hecho que `tatum-http.client.ts` mide en su `transportReason`.
      expect((failure as Error).name).toBe('TimeoutError');
    });
  });

  describe('reset()', () => {
    it('debería vaciar la cola, el registro de llamadas y las rutas sin programar', async () => {
      // Arrange
      stub.stub('POST', '/v3/gas-pump', { status: 200, body: [] });
      await post('/v3/gas-pump', {});
      await post('/v3/gas-pump/activate', {});

      // Act
      stub.reset();

      // Assert
      expect({ calls: stub.calls, unstubbed: stub.unstubbed }).toEqual({
        calls: [],
        unstubbed: [],
      });
    });

    it('debería descartar las respuestas que quedaron sin consumir', async () => {
      // Arrange
      // Sin esto, una respuesta programada por un escenario y nunca golpeada la consumiría el
      // SIGUIENTE, que afirmaría sobre un cuerpo que él no programó. Comprobado que mide:
      // quitando `this.queues.clear()` de `reset()`, este caso cae con `status 200` y el resto de
      // la suite sigue en verde.
      stub.stub('POST', '/v3/gas-pump', { status: 200, body: ['sobrante'] });

      // Act
      stub.reset();
      const response = await post('/v3/gas-pump', {});

      // Assert
      expect(response.status).toBe(UNSTUBBED_STATUS);
    });
  });
});

// Helpers

const post = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
  timeoutMs = 5_000,
): Promise<Response> =>
  fetch(`${TATUM_STUB_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
