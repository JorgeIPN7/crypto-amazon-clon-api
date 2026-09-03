import { Writable } from 'node:stream';
import { inspect } from 'node:util';

import { ConfigService } from '@nestjs/config';
import pino from 'pino';

import { DEFAULT_REDACT_PATHS } from '@common/logger/pino-options';

import { WalletProviderUnreachableError } from '../../../domain/errors/wallet.errors';
import { TransferAsset } from '../../../domain/transfer-asset';
import { AddressIndex } from '../../../domain/value-objects/address-index.vo';
import { EthereumAddress } from '../../../domain/value-objects/ethereum-address.vo';
import { TokenAmount } from '../../../domain/value-objects/token-amount.vo';
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

/**
 * Clave de mentira con entropía NULA —`ab` repetido 32 veces— y longitud real (66 con el
 * prefijo). No es celo: el gate de secretos del repo es gitleaks, cuya regla genérica combina
 * palabra clave y entropía, y `secretlint` con el `.secretlintrc.json` de este repo da cero
 * avisos ante una clave privada de Ethereum (medido en el spec §7.1). Un patrón repetido no
 * dispara la regla de entropía y sigue sirviendo de centinela dentro del test.
 */
const FAKE_MASTER_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
const FAKE_API_KEY = 'fake-tatum-api-key-0000';
const SECRETS = [FAKE_MASTER_PRIVATE_KEY, FAKE_API_KEY];

type Scenario = {
  label: string;
  respond: (call: number, init: RequestInit) => Promise<Response>;
  act: (gateway: TatumCustodialAddressGateway) => Promise<unknown>;
};

/**
 * Los modos de fallo del adaptador, como DATO. Va arriba y no bajo `// Helpers` porque `it.each`
 * lo consume mientras se ejecuta el cuerpo del `describe`, que jest corre durante la recogida:
 * declarado abajo caería en su zona muerta temporal. **Medido** moviéndolo al final del archivo:
 * la suite entera muere con `ReferenceError: Cannot access 'SCENARIOS' before initialization` y
 * `Test suite failed to run` —cero casos ejecutados, ni siquiera los dos que no lo usan—.
 *
 * Las funciones que guarda sí llaman a los helpers de abajo, y eso es legal: se invocan dentro
 * del caso, no al declararlo.
 */
const SCENARIOS: Scenario[] = [
  {
    label: 'la derivación responde 400',
    respond: () => Promise.resolve(jsonResponse(400, { message: 'bad request' })),
    act: (gateway) => gateway.deriveAddress(AddressIndex.from(7)),
  },
  {
    label: 'la activación responde 401 interpolando la clave de API',
    respond: () =>
      Promise.resolve(
        jsonResponse(401, { message: `Unable to find valid subscription for '${FAKE_API_KEY}'` }),
      ),
    act: (gateway) => gateway.enableSending(AddressIndex.from(7)),
  },
  {
    label: 'la transferencia responde 400',
    respond: () => Promise.resolve(jsonResponse(400, { message: 'bad request' })),
    act: (gateway) => gateway.send(transferCommand()),
  },
  /**
   * ⚠️ **Los dos escenarios de abajo son los del único camino que LEE el cuerpo de un error**
   * (`isChainRevert`, desde el 2026-09-02), y por eso son los únicos donde el secreto viaja en la
   * RESPUESTA y no en la petición. Uno por rama: con el `errorCode` que casa —se construye
   * `WalletProviderRevertedError`— y sin él —se cae a la traducción por status—. El cuerpo del
   * primero es el `message` real del 401 del proveedor metido en un 403: es el que interpola la
   * clave de API, medido en `docs/tatum/gas-pump/openapi.json`.
   */
  {
    label: 'la transferencia responde un 403 de reversión con la clave de API en el mensaje',
    respond: () =>
      Promise.resolve(
        jsonResponse(403, {
          statusCode: 403,
          errorCode: 'sc.operation.failed',
          message: `Unable to find valid subscription for '${FAKE_API_KEY}'`,
          cause: 'Returned error: execution reverted: Address: insufficient balance',
        }),
      ),
    act: (gateway) => gateway.send(transferCommand()),
  },
  {
    label: 'la transferencia responde un 403 que ecoa la clave privada de la master',
    respond: () =>
      Promise.resolve(
        jsonResponse(403, {
          statusCode: 403,
          errorCode: 'permission.denied',
          message: `Rejected fromPrivateKey ${FAKE_MASTER_PRIVATE_KEY}`,
        }),
      ),
    act: (gateway) => gateway.send(transferCommand()),
  },
  {
    label: 'la transferencia responde 500',
    respond: () => Promise.resolve(jsonResponse(500, { message: 'boom' })),
    act: (gateway) => gateway.send(transferCommand()),
  },
  {
    label: 'la transferencia devuelve un cuerpo que no es JSON',
    respond: () => Promise.resolve(new Response('<html>bad gateway</html>')),
    act: (gateway) => gateway.send(transferCommand()),
  },
  {
    label: 'la activación devuelve un cuerpo sin txId',
    respond: () => Promise.resolve(jsonResponse(200, {})),
    act: (gateway) => gateway.enableSending(AddressIndex.from(7)),
  },
  {
    label: 'la comprobación de envío devuelve un cuerpo vacío',
    respond: () => Promise.resolve(jsonResponse(200, {})),
    act: (gateway) => gateway.isSendingEnabled(AddressIndex.from(7)),
  },
  {
    label: 'la derivación devuelve más de una dirección',
    respond: () => Promise.resolve(jsonResponse(200, [DERIVED, RECIPIENT])),
    act: (gateway) => gateway.deriveAddress(AddressIndex.from(7)),
  },
  {
    label: 'la transferencia expira por timeout',
    respond: (_call, init) => neverAnswer(init),
    act: (gateway) => gateway.send(transferCommand()),
  },
];

describe('fuga de la clave privada de la master', () => {
  it.each(SCENARIOS)(
    'debería no filtrar la clave ni la API key en ninguna superficie cuando $label',
    async ({ respond, act }) => {
      // Arrange
      const gateway = buildGateway(fakeFetch(respond));

      // Act
      const error = await captureRejection(act(gateway));

      // Assert
      expect(leakingSurfaces(error)).toEqual([]);
    },
  );

  it('debería redactar la clave en las cuatro superficies del propio value object', () => {
    // Arrange
    const key = MasterPrivateKey.from(FAKE_MASTER_PRIVATE_KEY);

    // Act
    const surfaces = leakingSurfaces(key);

    // Assert
    expect(surfaces).toEqual([]);
  });

  /**
   * El caso que demuestra que los otros no pasan por casualidad. Un error al que se le adjunta
   * la petición filtra por TRES de las cuatro superficies —`String()` no, porque el `toString`
   * de `Error` solo rinde nombre y mensaje— y la de pino es la que de verdad escribe en disco.
   *
   * También fija el límite de las rutas de redacción: `*.fromPrivateKey` casa a profundidad DOS
   * (`err.fromPrivateKey`), no a la tres de `err.request.body.fromPrivateKey`. Medido con
   * pino 10.3.1: este mismo caso, cuya línea de log sale con la clave entera. Por eso la defensa
   * de verdad es que el error no lleve nada, y la redacción es la red por debajo.
   */
  it('debería cazar un error que sí arrastrara la petición dentro', () => {
    // Arrange
    const contaminated = Object.assign(new WalletProviderUnreachableError('upstream-error', 500), {
      request: { body: { fromPrivateKey: FAKE_MASTER_PRIVATE_KEY } },
    });

    // Act
    const surfaces = leakingSurfaces(contaminated);

    // Assert
    expect(surfaces).toEqual(['JSON.stringify', 'util.inspect', 'pino']);
  });

  /**
   * Por qué la cuarta superficie NO es simetría con las otras tres, medido en vez de afirmado:
   * `pino-std-serializers` recorre el error con `for (const key in err)`, que sube por la CADENA
   * DE PROTOTIPOS, mientras que `JSON.stringify` y `util.inspect` solo rinden propiedades
   * PROPIAS. Un secreto colgado del prototipo lo escribe únicamente la línea de pino — las tres
   * primeras devuelven `false` y solo ella `true`.
   *
   * Sin este caso, alguien podría sustituir `logLine()` por un `JSON.stringify` «equivalente» y
   * la suite seguiría verde: el de arriba solo exige que pino esté en la lista, no que vea MÁS
   * que los otros. Medido haciendo esa sustitución: cae **un** caso, y el único que cae es
   * este.
   *
   * ⚠️ El secreto va ANIDADO a propósito. Colgado a pelo del prototipo (`fromPrivateKey`), la
   * ruta `*.fromPrivateKey` que este ciclo añade a `DEFAULT_REDACT_PATHS` lo taparía y el caso
   * acabaría midiendo la redacción en vez de la superficie. A profundidad cuatro el comodín no
   * llega —casa a profundidad DOS— y lo que queda medido es lo que la cabecera afirma.
   *
   * No es el vector de todos los días: lo normal es una propiedad PROPIA, que ven las cuatro.
   * Este caso existe para fijar la diferencia, no para describir el accidente más probable.
   */
  it('debería cazar solo por la línea de pino un secreto heredado del prototipo', () => {
    // Arrange
    const error = new WalletProviderUnreachableError('upstream-error', 500);
    const carrier = Object.assign(Object.create(Object.getPrototypeOf(error) as object) as object, {
      request: { body: { fromPrivateKey: FAKE_MASTER_PRIVATE_KEY } },
    });
    Object.setPrototypeOf(error, carrier);

    // Act
    const surfaces = leakingSurfaces(error);

    // Assert
    expect(surfaces).toEqual(['pino']);
  });
});

// Helpers

/** Los tres campos de `SendCommand`, con el destinatario en `recipient` y no en `to`. */
const transferCommand = () => ({
  from: EthereumAddress.from(DERIVED),
  recipient: EthereumAddress.from(RECIPIENT),
  asset: TransferAsset.native({ amount: TokenAmount.from('100000') }),
});

/**
 * ⚠️ `activationPayer: 'master'` a propósito, y no el default `'tatum'`: es la rama de la
 * activación que SÍ mete la clave privada en el cuerpo, o sea el peor caso de este spec. Con
 * `'tatum'` los dos escenarios de la activación no llevarían la clave en la petición y pasarían
 * por no tener nada que filtrar — verde por vacío, que es justo lo que este archivo existe para
 * no ser. La rama `'tatum'` está medida donde toca, en el spec del gateway.
 */
const buildGateway = (impl: FetchLike): TatumCustodialAddressGateway => {
  const configService = new ConfigService({
    wallets: {
      apiUrl: 'http://127.0.0.1:9',
      apiKey: FAKE_API_KEY,
      timeoutMs: 20,
      masterAddress: MASTER,
      masterPrivateKey: FAKE_MASTER_PRIVATE_KEY,
      activationPayer: 'master',
    },
  });
  const client = new TatumHttpClient(configService, impl);
  return new TatumCustodialAddressGateway(configService, client);
};

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const fakeFetch =
  (respond: (call: number, init: RequestInit) => Promise<Response>): FetchLike =>
  (_url, init) =>
    respond(1, init);

const neverAnswer = (init: RequestInit): Promise<Response> => {
  const signal = init.signal;
  return new Promise((_resolve, reject) => {
    // Cast y no `instanceof Error`: bajo jest el `DOMException` del host da `false` contra el
    // `Error` del realm del test (medido en `tatum-http.client.spec.ts`, cuyo helper gemelo
    // documenta la sonda; jest 30.4.1 / Node 24.19.0).
    signal?.addEventListener('abort', () => {
      reject(signal.reason as Error);
    });
  });
};

const captureRejection = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('se esperaba un fallo del proveedor y la promesa se resolvió');
};

/**
 * UNA LÍNEA REAL de pino, con la configuración de redacción de la app, escrita a un `Writable`
 * en memoria. No es simetría con las otras tres superficies: es la única que ejercita el
 * serializador de errores de `pino-std-serializers`, que recorre toda propiedad enumerable del
 * error. Las otras tres no lo tocan.
 */
const logLine = (value: unknown): string => {
  const chunks: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString('utf8'));
      callback();
    },
  });
  const logger = pino(
    {
      level: 'fatal',
      redact: { paths: DEFAULT_REDACT_PATHS, censor: '[REDACTED]', remove: false },
    },
    destination,
  );
  logger.fatal({ err: value }, 'fallo del proveedor de direcciones custodiadas');
  return chunks.join('');
};

/** Devuelve el NOMBRE de cada superficie que filtró, para que el fallo diga cuál y no solo que. */
const leakingSurfaces = (value: unknown): string[] => {
  const surfaces: [string, string][] = [
    ['JSON.stringify', JSON.stringify(value) ?? ''],
    ['String()', String(value)],
    ['util.inspect', inspect(value, { depth: null })],
    ['pino', logLine(value)],
  ];
  return surfaces
    .filter(([, rendered]) => SECRETS.some((secret) => leaks(rendered, secret)))
    .map(([surface]) => surface);
};

/**
 * ⚠️ **Busca FRAGMENTOS, no solo el secreto entero, y ese es el punto del helper.**
 *
 * Una versión anterior hacía `rendered.includes(secret)` a secas, y ese es exactamente el punto
 * ciego que este ciclo ya se comió una vez: `@noble/curves` mete en su mensaje de error un
 * fragmento de la clave —`got non-hex character "az" at index 62`— y un centinela que solo mira el
 * secreto completo lo deja pasar en verde.
 *
 * La ventana es de 16 caracteres porque hay que elegir entre dos fallos opuestos: demasiado corta
 * y salta con cualquier palabra —un secreto hexadecimal contiene `ab`, `de`, `f0`…—, demasiado
 * larga y vuelve a no ver la fuga parcial. 16 sobre un hexadecimal son 64 bits: la probabilidad de
 * que aparezcan por azar en un mensaje es despreciable, y sigue cazando una fuga de un octavo de
 * la clave.
 *
 * ⚠️ Lo que NO cubre, dicho en vez de prometido: una fuga de menos de 16 caracteres —como el `"az"`
 * de dos del ejemplo— sigue siendo invisible aquí. Contra eso, la guarda es otra y vive en
 * `master-key-startup.check.spec.ts`: comparar el mensaje de error con IGUALDAD EXACTA, que rompe
 * ante cualquier interpolación, de lo que sea. Las dos son complementarias y ninguna sustituye a
 * la otra.
 */
const leaks = (rendered: string, secret: string): boolean => {
  const WINDOW = 16;
  const body = secret.startsWith('0x') ? secret.slice(2) : secret;
  for (let i = 0; i + WINDOW <= body.length; i++) {
    if (rendered.includes(body.slice(i, i + WINDOW))) {
      return true;
    }
  }
  return false;
};
