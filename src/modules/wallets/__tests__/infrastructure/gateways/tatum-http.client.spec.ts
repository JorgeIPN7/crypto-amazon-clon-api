import { ConfigService } from '@nestjs/config';

import {
  TatumHttpClient,
  type FetchLike,
  type TatumRequest,
} from '../../../infrastructure/gateways/tatum-http.client';

const API_URL = 'http://127.0.0.1:9';
const API_KEY = 'clave-de-prueba';

describe('TatumHttpClient', () => {
  describe('request()', () => {
    it('debería devolver el cuerpo JSON ya parseado de una respuesta 200', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(200, { txId: 'abc' })));
      const client = new TatumHttpClient(walletsConfig(), fetcher.impl);

      // Act
      const body = await client.request(derivationRequest());

      // Assert
      expect(body).toEqual({ txId: 'abc' });
    });

    it('debería enviar la clave de API, el content-type, el cuerpo serializado y la señal de timeout', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(200, [])));
      const client = new TatumHttpClient(walletsConfig(), fetcher.impl);

      // Act
      await client.request(derivationRequest());

      // Assert
      const [call] = fetcher.calls;
      expect(call?.url).toBe(`${API_URL}/v3/gas-pump`);
      expect(call?.init.headers).toEqual({
        accept: 'application/json',
        'content-type': 'application/json',
        'x-api-key': API_KEY,
      });
      expect(call?.init.body).toBe('{"chain":"ETH"}');
      expect(call?.init.signal).toBeInstanceOf(AbortSignal);
    });

    it('debería traducir el 400 de una petición con entrada del cliente a WalletProviderRejectedError', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(400, {})));
      const client = new TatumHttpClient(walletsConfig(), fetcher.impl);

      // Act + Assert
      await expect(client.request(transferRequest())).rejects.toMatchObject({
        name: 'WalletProviderRejectedError',
        reason: 'body-rejected',
        providerStatus: 400,
      });
    });

    it('debería traducir el 400 de una petición que construimos enteros a WalletProviderUnavailableError', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(400, {})));
      const client = new TatumHttpClient(walletsConfig(), fetcher.impl);

      // Act + Assert
      await expect(client.request(derivationRequest())).rejects.toMatchObject({
        name: 'WalletProviderUnavailableError',
        reason: 'misconfigured',
        providerStatus: 400,
      });
    });

    it('debería traducir un 401 a WalletProviderUnavailableError sin reintentar', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(401, {})));
      const client = new TatumHttpClient(walletsConfig(), fetcher.impl);

      // Act + Assert
      await expect(client.request(derivationRequest())).rejects.toMatchObject({
        name: 'WalletProviderUnavailableError',
        reason: 'unauthorized',
        providerStatus: 401,
      });
      expect(fetcher.calls).toHaveLength(1);
    });

    it('debería traducir un 403 a WalletProviderUnavailableError', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(403, {})));
      const client = new TatumHttpClient(walletsConfig(), fetcher.impl);

      // Act + Assert
      await expect(client.request(transferRequest())).rejects.toMatchObject({
        name: 'WalletProviderUnavailableError',
        reason: 'forbidden',
        providerStatus: 403,
      });
    });

    it.each([402, 404, 409, 429])(
      'debería traducir el %i, que el proveedor no declara, a WalletProviderUnavailableError',
      async (status) => {
        // Arrange
        const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(status, {})));
        const client = new TatumHttpClient(walletsConfig(), fetcher.impl);

        // Act + Assert
        await expect(client.request(transferRequest())).rejects.toMatchObject({
          name: 'WalletProviderUnavailableError',
          reason: 'undocumented-4xx',
          providerStatus: status,
        });
      },
    );

    it('debería traducir un 5xx a WalletProviderUnreachableError', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(500, {})));
      const client = new TatumHttpClient(walletsConfig(), fetcher.impl);

      // Act + Assert
      await expect(client.request(transferRequest())).rejects.toMatchObject({
        name: 'WalletProviderUnreachableError',
        reason: 'upstream-error',
        providerStatus: 500,
      });
    });

    it('debería traducir la expiración real de AbortSignal.timeout al motivo timeout', async () => {
      // Arrange
      const fetcher = fetchThatNeverAnswers();
      const client = new TatumHttpClient(walletsConfig(5), fetcher.impl);

      // Act + Assert
      await expect(client.request(transferRequest())).rejects.toMatchObject({
        name: 'WalletProviderUnreachableError',
        reason: 'timeout',
        providerStatus: null,
      });
    });

    it('debería tratar un AbortError ajeno como fallo de red y no como timeout', async () => {
      // Arrange
      const aborted = new DOMException('cancelada por el consumidor', 'AbortError');
      const fetcher = fakeFetch(() => Promise.reject(aborted));
      const client = new TatumHttpClient(walletsConfig(), fetcher.impl);

      // Act + Assert
      await expect(client.request(transferRequest())).rejects.toMatchObject({
        name: 'WalletProviderUnreachableError',
        reason: 'unreachable',
        providerStatus: null,
      });
    });

    it('debería traducir un cuerpo que no es JSON al motivo malformed-response', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(new Response('<html>bad gateway</html>')));
      const client = new TatumHttpClient(walletsConfig(), fetcher.impl);

      // Act + Assert
      await expect(client.request(transferRequest())).rejects.toMatchObject({
        name: 'WalletProviderUnreachableError',
        reason: 'malformed-response',
        providerStatus: 200,
      });
    });

    it('debería reintentar una vez la petición reintentable que falló con 5xx', async () => {
      // Arrange
      const fetcher = fakeFetch((call) =>
        Promise.resolve(call === 1 ? jsonResponse(500, {}) : jsonResponse(200, ['0xabc'])),
      );
      const client = new TatumHttpClient(walletsConfig(), fetcher.impl);

      // Act
      const body = await client.request(derivationRequest());

      // Assert
      expect(fetcher.calls).toHaveLength(2);
      expect(body).toEqual(['0xabc']);
    });

    // ⚠️ Sin este caso, `ATTEMPTS_WHEN_RETRYABLE` no lo fija NADIE: el caso de arriba responde
    // 200 en el segundo intento, así que mide dos llamadas tanto con 2 intentos configurados
    // como con 3. Medido subiendo la constante a 3: los 65 casos de la capa siguen en verde.
    //
    // No es cosmético: cada intento son 2 créditos del proveedor, y `infrastructure/` está fuera
    // del auditor de mutación, así que aquí el único control son los tests.
    it('debería agotar exactamente dos intentos cuando la reintentable falla siempre', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(500, {})));
      const client = new TatumHttpClient(walletsConfig(), fetcher.impl);

      // Act + Assert
      await expect(client.request(derivationRequest())).rejects.toBeInstanceOf(Error);
      expect(fetcher.calls).toHaveLength(2);
    });

    it('debería intentar una sola vez la petición no reintentable que falló con 5xx', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(500, {})));
      const client = new TatumHttpClient(walletsConfig(), fetcher.impl);

      // Act + Assert
      await expect(client.request(transferRequest())).rejects.toMatchObject({
        name: 'WalletProviderUnreachableError',
        reason: 'upstream-error',
      });
      expect(fetcher.calls).toHaveLength(1);
    });
  });
});

// Helpers

type Call = { url: string; init: RequestInit };

/**
 * Los nombres de los campos son los del contrato de configuración —`apiUrl`, `apiKey`,
 * `timeoutMs`—, no `baseUrl` ni `requestTimeoutMs`: `getOrThrow<WalletsConfig>('wallets')` es un
 * cast, así que un nombre equivocado aquí no rompería la compilación y sí dejaría al cliente
 * llamando a `undefined/v3/gas-pump`.
 */
const walletsConfig = (timeoutMs = 1_000): ConfigService =>
  new ConfigService({ wallets: { apiUrl: API_URL, apiKey: API_KEY, timeoutMs } });

/** Reintentable y con el 400 imputado a NUESTRA configuración: la derivación (§7.2). */
const derivationRequest = (): TatumRequest => ({
  method: 'POST',
  path: '/v3/gas-pump',
  body: { chain: 'ETH' },
  retryable: true,
  badRequestBlame: 'our-configuration',
});

/** No reintentable —mueve dinero— y con el 400 imputable al cliente: la transferencia. */
const transferRequest = (): TatumRequest => ({
  method: 'POST',
  path: '/v3/blockchain/sc/custodial/transfer',
  body: { chain: 'ETH' },
  retryable: false,
  badRequestBlame: 'client-input',
});

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * `fetch` escrito a mano, inyectado por constructor. NO `jest.mock('node:…')`: el doble es un
 * parámetro del SUT, así que no hay módulo que interceptar y el test no depende del cargador.
 */
const fakeFetch = (
  answer: (call: number) => Promise<Response>,
): { impl: FetchLike; calls: Call[] } => {
  const calls: Call[] = [];
  const impl: FetchLike = (url, init) => {
    calls.push({ url, init });
    return answer(calls.length);
  };
  return { impl, calls };
};

/** El proveedor que acepta la conexión y no contesta: el único que ejerce el timeout de verdad. */
const fetchThatNeverAnswers = (): { impl: FetchLike; calls: Call[] } => {
  const calls: Call[] = [];
  const impl: FetchLike = (url, init) => {
    calls.push({ url, init });
    const signal = init.signal;
    return new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => {
        reject(abortReason(signal));
      });
    });
  };
  return { impl, calls };
};

/**
 * `AbortSignal.reason` está tipado `any` y `prefer-promise-reject-errors` exige un `Error`, así
 * que hay un cast — y NO un `instanceof Error`, que aquí sería un falso negativo.
 *
 * Medido bajo `jest-environment-node` (jest 30.4.1, Node 24.19.0) con una sonda temporal: el
 * motivo es un `DOMException` con `name === 'TimeoutError'`, `instanceof DOMException === true` y
 * **`instanceof Error === false`** — el `Error` del realm del test no es el del host, aunque
 * ejecutado fuera de jest ese mismo `instanceof Error` dé `true` (medido con `node -e`).
 *
 * Y el estrechamiento no es inocuo: sustituyendo la línea de abajo por
 * `signal.reason instanceof Error ? signal.reason : new Error('abortado')`, este doble rechaza con
 * un `Error` fabricado —sin `name` `TimeoutError`—, el motivo pasa a `unreachable` y la suite sale
 * **cae **un** caso**, con «debería traducir la expiración real de
 * AbortSignal.timeout al motivo timeout» como único fallo. Es exactamente la razón por la que el
 * cliente discrimina por `err.name`.
 */
const abortReason = (signal: AbortSignal): Error => signal.reason as Error;
