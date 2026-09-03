import {
  TATUM_CHAIN,
  buildWalletsConfig,
  resolveTatumCredentials,
  walletsConfig,
} from '../wallets.config';
import { envSchema } from '../env.schema';

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('TATUM_CHAIN', () => {
  it('debería fijar ETH como la única cadena que este ciclo envía', () => {
    // Arrange + Act + Assert
    // Es decisión NUESTRA, no restricción del proveedor: medido sobre
    // docs/tatum/gas-pump/openapi.json, `CreateGasPump` admite 7 cadenas, `ActivateGasPump` 5 y
    // `TransferCustodialWallet` 6. La wallet no guarda la cadena, así que una segunda exigiría
    // una pareja expand/contract sobre el índice único.
    expect(TATUM_CHAIN).toBe('ETH');
  });
});

describe('resolveTatumCredentials', () => {
  // `console.warn` es global: un spy que sobreviva a su test se lleva por delante la salida de
  // las suites siguientes. Mismo cuidado que en `auth.config.spec.ts`.
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('debería usar las credenciales del entorno cuando las tres están definidas', () => {
    // Arrange
    const env = buildCredentialsEnv({
      NODE_ENV: 'production',
      TATUM_API_KEY: 'real-api-key',
      WALLETS_MASTER_ADDRESS: `0x${'b'.repeat(40)}`,
      WALLETS_MASTER_PRIVATE_KEY: PRIVATE_KEY_OF_ZEROS,
    });

    // Act
    const credentials = resolveTatumCredentials(env);

    // Assert
    expect(credentials.apiKey).toBe('real-api-key');
    expect(credentials.masterPrivateKey).toBe(PRIVATE_KEY_OF_ZEROS);
    expect(credentials.usingDevPlaceholders).toBe(false);
  });

  it('debería normalizar la master address a minúsculas', () => {
    // Arrange
    const env = buildCredentialsEnv({
      TATUM_API_KEY: 'real-api-key',
      WALLETS_MASTER_ADDRESS: `0x${'B'.repeat(40)}`,
      WALLETS_MASTER_PRIVATE_KEY: PRIVATE_KEY_OF_ZEROS,
    });

    // Act
    const credentials = resolveTatumCredentials(env);

    // Assert
    // Quien copia la dirección de un explorador la copia con checksum EIP-55. Este es el único
    // punto por el que entra al sistema, así que normalizarla aquí es lo que hace que ninguna
    // comparación posterior dependa de cómo la escribió el operador.
    expect(credentials.masterAddress).toBe(`0x${'b'.repeat(40)}`);
  });

  it('debería no tocar la clave privada, ni siquiera para normalizar mayúsculas', () => {
    // Arrange
    const key = `0x${'AB'.repeat(32)}`;
    const env = buildCredentialsEnv({
      TATUM_API_KEY: 'real-api-key',
      WALLETS_MASTER_ADDRESS: `0x${'b'.repeat(40)}`,
      WALLETS_MASTER_PRIVATE_KEY: key,
    });

    // Act
    const credentials = resolveTatumCredentials(env);

    // Assert
    // El proveedor no distingue mayúsculas en el hexadecimal, así que transformarla no arregla
    // nada y sí añade un sitio más donde el secreto se lee y se copia.
    expect(credentials.masterPrivateKey).toBe(key);
  });

  it('debería caer a los placeholders y avisar cuando faltan las tres credenciales', () => {
    // Arrange
    // Esta rama avisa por consola a propósito. Se silencia para no ensuciar la salida, y se
    // AFIRMA en lugar de solo taparse: sin la aserción, borrar el `console.warn` dejaría la
    // suite verde y el aviso desaparecería.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const env = buildCredentialsEnv({ NODE_ENV: 'development' });

    // Act
    const credentials = resolveTatumCredentials(env);

    // Assert
    expect(credentials.usingDevPlaceholders).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('TATUM_API_KEY');
    expect(String(warn.mock.calls[0]?.[0])).toContain('WALLETS_MASTER_ADDRESS');
    expect(String(warn.mock.calls[0]?.[0])).toContain('WALLETS_MASTER_PRIVATE_KEY');
  });

  it('debería nombrar en el aviso solo la credencial que falta', () => {
    // Arrange
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const env = buildCredentialsEnv({
      TATUM_API_KEY: 'real-api-key',
      WALLETS_MASTER_ADDRESS: `0x${'b'.repeat(40)}`,
    });

    // Act
    resolveTatumCredentials(env);

    // Assert
    // Con una credencial a medias se cae a los placeholders ENTEROS: mezclar una API key real
    // con una clave que no firma gastaría créditos para acabar en un 500. El aviso nombra la que
    // falta porque, si no, el operador vería su API key ignorada sin saber por qué.
    expect(String(warn.mock.calls[0]?.[0])).toContain('WALLETS_MASTER_PRIVATE_KEY');
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('TATUM_API_KEY');
  });

  it('debería usar 64 ceros como clave de relleno, con entropía nula a propósito', () => {
    // Arrange
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const env = buildCredentialsEnv({ NODE_ENV: 'development' });

    // Act
    const credentials = resolveTatumCredentials(env);

    // Assert
    // Es lo que permite que el placeholder viva en un archivo versionado: una cadena de ceros no
    // la confunde con una clave real ni un humano ni la regla de entropía de gitleaks. Y como
    // cero está fuera del rango [1, n-1] de secp256k1, tampoco puede firmar nada por accidente.
    expect(credentials.masterPrivateKey).toBe(PRIVATE_KEY_OF_ZEROS);
  });
});

describe('buildWalletsConfig', () => {
  it('debería trasladar el transporte, el pagador y la red tal cual desde el entorno', () => {
    // Arrange
    const env = envSchema.parse({
      ...CREDENTIALS_IN_ENV,
      TATUM_API_URL: 'http://127.0.0.1:34567',
      TATUM_TIMEOUT_MS: '7000',
      WALLETS_ACTIVATION_PAYER: 'master',
    });

    // Act
    const config = buildWalletsConfig(env);

    // Assert
    expect(config.apiUrl).toBe('http://127.0.0.1:34567');
    expect(config.timeoutMs).toBe(7_000);
    expect(config.activationPayer).toBe('master');
    expect(config.network).toBe('testnet');
  });

  it('debería no publicar la cadena como campo de configuración', () => {
    // Arrange
    const env = envSchema.parse({ ...CREDENTIALS_IN_ENV });

    // Act
    const config = buildWalletsConfig(env);

    // Assert
    // La cadena es la constante `TATUM_CHAIN` y el adaptador la importa. Publicarla también como
    // campo daría dos fuentes para el mismo dato, y la de configuración parecería cambiable
    // cuando cambiarla exige una pareja expand/contract sobre el índice único de `address`.
    expect(Object.keys(config)).not.toContain('chain');
  });
});

describe('walletsConfig', () => {
  it('debería registrarse bajo el namespace "wallets"', () => {
    // Arrange + Act
    const namespace = walletsConfig.KEY;

    // Assert
    // `registerAs` construye el token como `CONFIGURATION(<namespace>)`. Si el namespace no
    // coincide, `configService.get('wallets.…')` devuelve `undefined` sin error.
    expect(namespace).toContain('wallets');
  });

  it('debería leer el entorno en el momento de invocarse, no al importarse', () => {
    // Arrange
    process.env = { ...ORIGINAL_ENV, ...CREDENTIALS_IN_ENV, TATUM_TIMEOUT_MS: '3000' };

    // Act
    const config = walletsConfig();

    // Assert
    expect(config.timeoutMs).toBe(3_000);
  });
});

// Helpers

const PRIVATE_KEY_OF_ZEROS = `0x${'0'.repeat(64)}`;

const CREDENTIALS_IN_ENV: Readonly<Record<string, string>> = {
  TATUM_API_KEY: 'test-api-key',
  WALLETS_MASTER_ADDRESS: `0x${'b'.repeat(40)}`,
  WALLETS_MASTER_PRIVATE_KEY: PRIVATE_KEY_OF_ZEROS,
};

/**
 * `resolveTatumCredentials` recibe un `Pick` del entorno ya validado. Se construye aquí en vez
 * de parsear todo el schema porque el SUT es una función pura y no debe depender de defaults
 * que no lee.
 */
const buildCredentialsEnv = (
  overrides: {
    NODE_ENV?: 'development' | 'test' | 'staging' | 'production';
    TATUM_API_KEY?: string;
    WALLETS_MASTER_ADDRESS?: string;
    WALLETS_MASTER_PRIVATE_KEY?: string;
  } = {},
): Parameters<typeof resolveTatumCredentials>[0] => ({
  NODE_ENV: 'development',
  TATUM_API_KEY: undefined,
  WALLETS_MASTER_ADDRESS: undefined,
  WALLETS_MASTER_PRIVATE_KEY: undefined,
  ...overrides,
});
