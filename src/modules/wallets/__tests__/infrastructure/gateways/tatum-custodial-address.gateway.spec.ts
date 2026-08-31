import { inspect } from 'node:util';

import { ConfigService } from '@nestjs/config';

import { TransferAsset } from '../../../domain/transfer-asset';
import { AddressIndex } from '../../../domain/value-objects/address-index.vo';
import { EthereumAddress } from '../../../domain/value-objects/ethereum-address.vo';
import { TokenAmount } from '../../../domain/value-objects/token-amount.vo';
import { TokenId } from '../../../domain/value-objects/token-id.vo';
import {
  MasterPrivateKey,
  TatumCustodialAddressGateway,
} from '../../../infrastructure/gateways/tatum-custodial-address.gateway';
import {
  TatumHttpClient,
  type FetchLike,
} from '../../../infrastructure/gateways/tatum-http.client';

const MASTER = '0x2b5a0be5940b63de1eddccca7bd977357e2488ed';
const DERIVED = '0x687422eea2cb73b5d3e242ba5456b782919afc85';
const RECIPIENT = '0xe242ba5456b782919afc85687422eea2cb73b5d3';
const CONTRACT = '0x1234567890abcdef1234567890abcdef12345678';
const FAKE_KEY = `0x${'ab'.repeat(32)}`;
const BARE_TX_ID = 'c83f8818db43d9ba4accfe454aa44fc33123d47a4f89d47b314d6748eb0e9bc9';

describe('TatumCustodialAddressGateway', () => {
  describe('deriveAddress()', () => {
    it('debería derivar la dirección del índice pidiendo el rango de un solo elemento', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(200, [DERIVED])));
      const gateway = buildGateway(fetcher.impl);

      // Act
      const address = await gateway.deriveAddress(AddressIndex.from(7));

      // Assert
      expect(address.value).toBe(DERIVED);
      expect(fetcher.calls[0]?.url).toBe(`${API_URL}/v3/gas-pump`);
      expect(fetcher.calls[0]?.init.method).toBe('POST');
      expect(bodyOf(fetcher.calls[0])).toEqual({ chain: 'ETH', owner: MASTER, from: 7, to: 7 });
    });

    it('debería exigir exactamente un elemento en la respuesta de derivación', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(200, [DERIVED, RECIPIENT])));
      const gateway = buildGateway(fetcher.impl);

      // Act + Assert
      await expect(gateway.deriveAddress(AddressIndex.from(7))).rejects.toMatchObject({
        name: 'WalletProviderUnreachableError',
        reason: 'malformed-response',
        providerStatus: null,
      });
    });

    it('debería rechazar una respuesta de derivación vacía en vez de leerla como ausencia', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(200, [])));
      const gateway = buildGateway(fetcher.impl);

      // Act + Assert
      await expect(gateway.deriveAddress(AddressIndex.from(7))).rejects.toMatchObject({
        name: 'WalletProviderUnreachableError',
        reason: 'malformed-response',
      });
    });

    it('debería rechazar un cuerpo de derivación que no es una lista de cadenas', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(200, { addresses: [DERIVED] })));
      const gateway = buildGateway(fetcher.impl);

      // Act + Assert
      await expect(gateway.deriveAddress(AddressIndex.from(7))).rejects.toMatchObject({
        name: 'WalletProviderUnreachableError',
        reason: 'malformed-response',
      });
    });

    /**
     * ⚠️ Este caso NO estaba en el plan y cubre un defecto REAL que la implementación del plan
     * tenía. Sin él, `EthereumAddress.from('no-soy-una-direccion')` lanza
     * `InvalidEthereumAddressError`, que la tabla §3.5 del spec publica como **400 por el
     * fallback del filtro** — o sea, se culpa al cliente de un cuerpo que construimos nosotros
     * enteros y que rompió el PROVEEDOR, y de paso se esconde del `ErrorReporter`, que solo ve
     * 5xx. La forma correcta es la misma que la de la cardinalidad: un 200 que no satisface el
     * esquema.
     */
    it('debería tratar una dirección derivada ilegible como respuesta que no satisface el esquema', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(200, ['no-soy-una-direccion'])));
      const gateway = buildGateway(fetcher.impl);

      // Act + Assert
      await expect(gateway.deriveAddress(AddressIndex.from(7))).rejects.toMatchObject({
        name: 'WalletProviderUnreachableError',
        reason: 'malformed-response',
      });
    });

    it('debería rechazar con nombre una derivación que devuelve la propia master', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(200, [MASTER])));
      const gateway = buildGateway(fetcher.impl);

      // Act + Assert
      await expect(gateway.deriveAddress(AddressIndex.from(7))).rejects.toMatchObject({
        name: 'WalletAddressIsMasterError',
        address: MASTER,
      });
    });

    it('debería reintentar la derivación, que no cuesta gas, tras un 5xx del proveedor', async () => {
      // Arrange
      const fetcher = fakeFetch((call) =>
        Promise.resolve(call === 1 ? jsonResponse(500, {}) : jsonResponse(200, [DERIVED])),
      );
      const gateway = buildGateway(fetcher.impl);

      // Act
      const address = await gateway.deriveAddress(AddressIndex.from(7));

      // Assert
      expect(address.value).toBe(DERIVED);
      expect(fetcher.calls).toHaveLength(2);
    });

    it('debería imputar a nuestra configuración el 400 de la derivación', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(400, {})));
      const gateway = buildGateway(fetcher.impl);

      // Act + Assert
      await expect(gateway.deriveAddress(AddressIndex.from(7))).rejects.toMatchObject({
        name: 'WalletProviderUnavailableError',
        reason: 'misconfigured',
      });
    });
  });

  /**
   * Los dos casos de las ramas comparan el cuerpo COMPLETO con `toEqual` y no campo a campo:
   * lo que hay que cazar es una clave DE MÁS. Un `toMatchObject` daría verde a un cuerpo que
   * llevara `feesCovered` **y** `fromPrivateKey` a la vez —el defecto exacto: sacar el secreto
   * a la red en la petición que no lo necesita—, y el proveedor lo rechazaría con un 400 que
   * este adaptador publica como 503, ya con los créditos gastados.
   */
  describe('enableSending()', () => {
    it('debería prefijar 0x al txId pelado que devuelve la activación', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(200, { txId: BARE_TX_ID })));
      const gateway = buildGateway(fetcher.impl);

      // Act
      const hash = await gateway.enableSending(AddressIndex.from(7));

      // Assert
      expect(hash.value).toBe(`0x${BARE_TX_ID}`);
      expect(fetcher.calls[0]?.url).toBe(`${API_URL}/v3/gas-pump/activate`);
    });

    it('debería dejar intacto un txId que ya llegara con el prefijo en vez de duplicarlo', async () => {
      // Arrange
      const fetcher = fakeFetch(() =>
        Promise.resolve(jsonResponse(200, { txId: `0x${BARE_TX_ID}` })),
      );
      const gateway = buildGateway(fetcher.impl);

      // Act
      const hash = await gateway.enableSending(AddressIndex.from(7));

      // Assert
      expect(hash.value).toBe(`0x${BARE_TX_ID}`);
    });

    it('debería activar con feesCovered y sin la clave privada cuando paga tatum', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(200, { txId: BARE_TX_ID })));
      const gateway = buildGateway(fetcher.impl, 'tatum');

      // Act
      await gateway.enableSending(AddressIndex.from(7));

      // Assert
      expect(bodyOf(fetcher.calls[0])).toEqual({
        chain: 'ETH',
        owner: MASTER,
        from: 7,
        to: 7,
        feesCovered: true,
      });
    });

    it('debería firmar la activación con la clave privada de la master cuando paga la master', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(200, { txId: BARE_TX_ID })));
      const gateway = buildGateway(fetcher.impl, 'master');

      // Act
      await gateway.enableSending(AddressIndex.from(7));

      // Assert
      expect(bodyOf(fetcher.calls[0])).toEqual({
        chain: 'ETH',
        owner: MASTER,
        from: 7,
        to: 7,
        fromPrivateKey: FAKE_KEY,
      });
    });

    it('debería tratar una respuesta sin txId como respuesta que no satisface el esquema', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(200, {})));
      const gateway = buildGateway(fetcher.impl);

      // Act + Assert
      await expect(gateway.enableSending(AddressIndex.from(7))).rejects.toMatchObject({
        name: 'WalletProviderUnreachableError',
        reason: 'malformed-response',
      });
    });

    /**
     * Sin esta traducción el error sería `InvalidTransactionHashError`, que **no** desciende de
     * `WalletProviderError`: `TransferAssetUseCase` lo dejaría caer por su rama `else` y la fila
     * del libro se quedaría en `submitting` sin motivo anotado — con el gas ya cobrado.
     */
    it('debería tratar un txId ilegible como respuesta que no satisface el esquema', async () => {
      // Arrange
      const fetcher = fakeFetch(() =>
        Promise.resolve(jsonResponse(200, { txId: 'no-es-un-hash' })),
      );
      const gateway = buildGateway(fetcher.impl);

      // Act + Assert
      await expect(gateway.enableSending(AddressIndex.from(7))).rejects.toMatchObject({
        name: 'WalletProviderUnreachableError',
        reason: 'malformed-response',
      });
    });

    it('debería intentar la activación una sola vez, porque un reintento paga la comisión dos veces', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(500, {})));
      const gateway = buildGateway(fetcher.impl);

      // Act + Assert
      await expect(gateway.enableSending(AddressIndex.from(7))).rejects.toMatchObject({
        name: 'WalletProviderUnreachableError',
        reason: 'upstream-error',
      });
      expect(fetcher.calls).toHaveLength(1);
    });

    it('debería imputar a nuestra configuración el 400 de la activación', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(400, {})));
      const gateway = buildGateway(fetcher.impl);

      // Act + Assert
      await expect(gateway.enableSending(AddressIndex.from(7))).rejects.toMatchObject({
        name: 'WalletProviderUnavailableError',
        reason: 'misconfigured',
      });
    });
  });

  describe('isSendingEnabled()', () => {
    it('debería consultar la ruta con cadena, master e índice y devolver el booleano', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(200, { activated: true })));
      const gateway = buildGateway(fetcher.impl);

      // Act
      const enabled = await gateway.isSendingEnabled(AddressIndex.from(7));

      // Assert
      expect(enabled).toBe(true);
      expect(fetcher.calls[0]?.url).toBe(`${API_URL}/v3/gas-pump/activated/ETH/${MASTER}/7`);
      expect(fetcher.calls[0]?.init.method).toBe('GET');
      expect(fetcher.calls[0]?.init.body).toBeUndefined();
    });

    it('debería devolver false cuando el proveedor dice que la dirección no está activada', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(200, { activated: false })));
      const gateway = buildGateway(fetcher.impl);

      // Act
      const enabled = await gateway.isSendingEnabled(AddressIndex.from(7));

      // Assert
      expect(enabled).toBe(false);
    });

    it('debería tratar un activated ausente como respuesta que no satisface el esquema y no como false', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(200, {})));
      const gateway = buildGateway(fetcher.impl);

      // Act + Assert
      await expect(gateway.isSendingEnabled(AddressIndex.from(7))).rejects.toMatchObject({
        name: 'WalletProviderUnreachableError',
        reason: 'malformed-response',
      });
    });

    it('debería tratar un activated que no es booleano como respuesta que no satisface el esquema', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(200, { activated: 'true' })));
      const gateway = buildGateway(fetcher.impl);

      // Act + Assert
      await expect(gateway.isSendingEnabled(AddressIndex.from(7))).rejects.toMatchObject({
        name: 'WalletProviderUnreachableError',
        reason: 'malformed-response',
      });
    });

    it('debería reintentar la consulta de activación, que no escribe en la cadena, tras un 5xx', async () => {
      // Arrange
      const fetcher = fakeFetch((call) =>
        Promise.resolve(
          call === 1 ? jsonResponse(500, {}) : jsonResponse(200, { activated: true }),
        ),
      );
      const gateway = buildGateway(fetcher.impl);

      // Act
      const enabled = await gateway.isSendingEnabled(AddressIndex.from(7));

      // Assert
      expect(enabled).toBe(true);
      expect(fetcher.calls).toHaveLength(2);
    });
  });

  describe('send()', () => {
    it('debería enviar desde la dirección de la wallet y firmar con la clave de la master', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(200, { txId: BARE_TX_ID })));
      const gateway = buildGateway(fetcher.impl);

      // Act
      const hash = await gateway.send({
        from: EthereumAddress.from(DERIVED),
        recipient: EthereumAddress.from(RECIPIENT),
        asset: TransferAsset.native({ amount: TokenAmount.from('100000') }),
      });

      // Assert
      expect(hash.value).toBe(`0x${BARE_TX_ID}`);
      expect(fetcher.calls[0]?.url).toBe(`${API_URL}/v3/blockchain/sc/custodial/transfer`);
      expect(bodyOf(fetcher.calls[0])).toEqual({
        chain: 'ETH',
        custodialAddress: DERIVED,
        recipient: RECIPIENT,
        contractType: 3,
        amount: '100000',
        fromPrivateKey: FAKE_KEY,
      });
    });

    /**
     * No duplica al mapper —`tatum-asset.mapper.spec.ts` mide las cuatro clases—: lo que fija es
     * que este archivo ESPARZA lo que el mapper devuelve en vez de copiar campos, así que
     * `tokenAddress` y `tokenId` llegan al cuerpo sin que nadie los nombre aquí.
     *
     * ⚠️ **No aporta score y conviene decirlo**: ningún mutante de este archivo lo mata a él solo.
     * Los tres que probé —`custodialAddress` desde la master, `fromPrivateKey` fuera del cuerpo y
     * `chain` fuera del cuerpo— dan los tres `2 failed` y arrastran también «debería enviar desde
     * la dirección de la wallet…». Lo que aporta es la única clase de activo con `tokenId` que
     * recorre este adaptador.
     */
    it('debería componer el cuerpo del multi-token con los campos que aporta el mapper', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(200, { txId: BARE_TX_ID })));
      const gateway = buildGateway(fetcher.impl);

      // Act
      await gateway.send({
        from: EthereumAddress.from(DERIVED),
        recipient: EthereumAddress.from(RECIPIENT),
        asset: TransferAsset.multiToken({
          token: EthereumAddress.from(CONTRACT),
          amount: TokenAmount.from('5'),
          tokenId: TokenId.from('42'),
        }),
      });

      // Assert
      expect(bodyOf(fetcher.calls[0])).toEqual({
        chain: 'ETH',
        custodialAddress: DERIVED,
        recipient: RECIPIENT,
        contractType: 2,
        tokenAddress: CONTRACT,
        amount: '5',
        tokenId: '42',
        fromPrivateKey: FAKE_KEY,
      });
    });

    it('debería tratar una transferencia sin txId como respuesta que no satisface el esquema', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(200, { signatureId: 'abc' })));
      const gateway = buildGateway(fetcher.impl);

      // Act + Assert
      await expect(nativeSend(gateway)).rejects.toMatchObject({
        name: 'WalletProviderUnreachableError',
        reason: 'malformed-response',
      });
    });

    it('debería intentar la transferencia una sola vez, porque un reintento mueve el dinero dos veces', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(500, {})));
      const gateway = buildGateway(fetcher.impl);

      // Act + Assert
      await expect(nativeSend(gateway)).rejects.toMatchObject({
        name: 'WalletProviderUnreachableError',
        reason: 'upstream-error',
      });
      expect(fetcher.calls).toHaveLength(1);
    });

    it('debería imputar al cliente el 400 de la transferencia, la única que lleva entrada suya', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(400, {})));
      const gateway = buildGateway(fetcher.impl);

      // Act + Assert
      await expect(nativeSend(gateway)).rejects.toMatchObject({
        name: 'WalletProviderRejectedError',
        reason: 'body-rejected',
        providerStatus: 400,
      });
    });
  });

  describe('masterAddress()', () => {
    it('debería devolver la master de la configuración sin llamar al proveedor', () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.reject(new Error('no debería llamarse')));
      const gateway = buildGateway(fetcher.impl);

      // Act
      const master = gateway.masterAddress();

      // Assert
      expect(master.value).toBe(MASTER);
      expect(fetcher.calls).toHaveLength(0);
    });

    /**
     * `resolveTatumCredentials` ya baja de caja la dirección, así que este caso NO duplica esa
     * normalización: fija que el adaptador no dependa de ella. Sin el `EthereumAddress.from` del
     * constructor, una master con checksum EIP-55 —la forma en que la copia quien la saca de un
     * explorador— viajaría tal cual a la ruta del `GET` y a los cuerpos, y `assertOwnedBy()`
     * compararía dos cadenas distintas para la misma dirección.
     */
    it('debería normalizar a minúsculas una master escrita con checksum EIP-55', () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.reject(new Error('no debería llamarse')));
      const gateway = buildGateway(
        fetcher.impl,
        'tatum',
        '0x2B5A0BE5940B63DE1EDDCCCA7BD977357E2488ED',
      );

      // Act
      const master = gateway.masterAddress();

      // Assert
      expect(master.value).toBe(MASTER);
    });
  });

  /**
   * `MasterPrivateKey` se declara en el archivo del gateway y no en uno propio, así que no tiene
   * spec 1:1 donde fijar esto. El caso vive aquí porque es la única red que hay: cambiar
   * `extends SecretValueObject` por `extends ValueObject` compila, pasa `lint:check` y deja la
   * clave privada entrando entera en cualquier `logger.info({ key })` —pino serializa con
   * `JSON.stringify`— sin que ningún otro caso del módulo se ponga rojo.
   *
   * Medido haciendo exactamente esa sustitución: cae **un** caso y el único que cae es este.
   */
  describe('MasterPrivateKey', () => {
    it('debería redactar la clave en las tres superficies que escriben sin que nadie las escriba', () => {
      // Arrange
      const key = MasterPrivateKey.from(FAKE_KEY);

      // Act
      // `key.toString()` y no `` `${key}` ``: la interpolación es lo que dispara la superficie en
      // producción, pero `@typescript-eslint/restrict-template-expressions` la marca en rojo sobre
      // un valor que no es `string` (medido: `error  Invalid type "MasterPrivateKey" of template
      // literal expression`). Es la MISMA llamada — el operador la delega en `toString()` — sin
      // apagar una regla.
      const rendered = [key.toString(), JSON.stringify(key), inspect(key)];

      // Assert
      expect(rendered.some((text) => text.includes('ab'.repeat(32)))).toBe(false);
      expect(key.value).toBe(FAKE_KEY);
    });
  });
});

// Helpers

type Call = { url: string; init: RequestInit };

const API_URL = 'http://127.0.0.1:9';

/**
 * El gateway recibe un `TatumHttpClient` REAL con un `fetch` de mentira, no un doble del
 * cliente: así el caso ejercita también las cabeceras, el timeout y la traducción de errores.
 * Un doble del cliente dejaría sin ejecutar justo el archivo más propenso a defectos.
 *
 * Un solo `ConfigService` para los dos: el cliente lee `apiUrl`, `apiKey` y `timeoutMs`, y el
 * gateway lee `masterAddress`, `masterPrivateKey` y `activationPayer`. Los nombres son los del
 * contrato de configuración; no hay campo `chain`, que es la constante `TATUM_CHAIN`.
 *
 * `activationPayer` es un PARÁMETRO y su default es `'tatum'`, el mismo de `env.schema.ts`: los
 * casos que no hablan de quién paga se ejecutan con la configuración que va a estar puesta de
 * verdad, y los dos que sí lo dicen lo pasan explícito. Dejarlo ausente del objeto haría que el
 * adaptador leyera `undefined` y la rama que se ejercitara dependiera de un descuido.
 */
const buildGateway = (
  impl: FetchLike,
  activationPayer: 'tatum' | 'master' = 'tatum',
  masterAddress: string = MASTER,
): TatumCustodialAddressGateway => {
  const configService = new ConfigService({
    wallets: {
      apiUrl: API_URL,
      apiKey: 'clave-de-prueba',
      timeoutMs: 1_000,
      masterAddress,
      masterPrivateKey: FAKE_KEY,
      activationPayer,
    },
  });
  const client = new TatumHttpClient(configService, impl);
  return new TatumCustodialAddressGateway(configService, client);
};

/** El envío más barato de escribir, para los casos que hablan del desenlace y no del cuerpo. */
const nativeSend = (gateway: TatumCustodialAddressGateway): Promise<unknown> =>
  gateway.send({
    from: EthereumAddress.from(DERIVED),
    recipient: EthereumAddress.from(RECIPIENT),
    asset: TransferAsset.native({ amount: TokenAmount.from('100000') }),
  });

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const bodyOf = (call: Call | undefined): unknown => {
  const body = call?.init.body;
  return typeof body === 'string' ? (JSON.parse(body) as unknown) : null;
};

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
