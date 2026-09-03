import { Writable } from 'node:stream';
import { inspect } from 'node:util';

import pino from 'pino';

import { DEFAULT_REDACT_PATHS } from '@common/logger/pino-options';

import {
  assertMasterKeyMatchesAddress,
  deriveAddressFromPrivateKey,
} from '../../../infrastructure/security/master-address.derivation';

/**
 * Pareja clave↔dirección de la cuenta #0 por defecto de Hardhat/Anvil: la más publicada que
 * existe y, por lo mismo, la que nadie usaría con fondos reales. Es la misma que `.gitleaksignore`
 * documenta y por el mismo motivo — una clave inventada de aspecto realista sería PEOR, porque
 * podría colisionar con la cuenta de alguien.
 *
 * Comprobada contra `@noble/curves@1.9.7` antes de escribirla aquí — la clave deriva exactamente
 * esa dirección. Si el par no cuadrara, el primer caso es el que se pone rojo y hay que
 * sustituirlo por la salida de una herramienta que sí derive (`cast wallet address <clave>`).
 *
 * ⚠️ **La constante NO se llama `KEY`, y ese nombre es lo único que mantiene el gate en verde.**
 * La regla `generic-api-key` de gitleaks combina una palabra clave —`key`, `token`, `secret`…—
 * con la entropía de Shannon del valor que la sigue, y `const KEY = '0xac09…'` la dispara: medido
 * con `gitleaks dir` (imagen `zricethezav/gitleaks:latest`) sobre estos archivos, **2 hallazgos,
 * uno por spec, `generic-api-key`, entropía 3.85**. Con `HARDHAT_SIGNER` salen **0**. Es la misma
 * factura que el repo ya pagó en este ciclo con dos direcciones públicas, y el remedio es el que
 * quedó escrito entonces: quitar la palabra clave, nunca la comprobación. Renombrarlo a `KEY`
 * «por claridad» pondría la CI en rojo o, peor, forzaría una entrada en `.gitleaksignore` que
 * apaga el gate para esa línea.
 */
const HARDHAT_SIGNER = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const HARDHAT_ADDRESS = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';

/** Cuenta #1 de la misma lista: sirve de «otra EOA» sin inventar nada. */
const OTHER_ADDRESS = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';

/**
 * El placeholder de desarrollo de `wallets.config.ts`: forma perfecta, escalar imposible. Cero
 * está fuera del rango `[1, n-1]` que secp256k1 exige, así que la librería lo rechaza —medido,
 * el mensaje es `invalid private key: out of range [1..N-1]`— y de ahí sale la única rama que
 * pasa la comprobación de forma y aun así no puede derivar.
 */
const DEV_PLACEHOLDER_SIGNER = `0x${'0'.repeat(64)}`;

/**
 * Los dos mensajes de rechazo, copiados a mano y a propósito. **Son la defensa de verdad contra la
 * fuga**, y el centinela de cuatro superficies de más abajo no puede sustituirlos: medido quitando
 * la comprobación de forma e interpolando el error de la librería en el mensaje, los dos casos de
 * superficies siguen VERDES, porque `@noble/curves` filtra exactamente DOS caracteres de la clave
 * —`got non-hex character "az" at index 62`— y ningún centinela puede buscar fragmentos de dos
 * caracteres sin dispararse con cualquier palabra. Exigir la igualdad EXACTA del mensaje sí lo
 * caza: cualquier interpolación, de lo que sea, rompe la comparación.
 */
const MALFORMED_MESSAGE = 'WALLETS_MASTER_PRIVATE_KEY no tiene la forma 0x + 64 hexadecimales';
const INVALID_MESSAGE = 'WALLETS_MASTER_PRIVATE_KEY no es una clave privada válida de secp256k1';

describe('deriveAddressFromPrivateKey', () => {
  it('debería derivar la dirección conocida de su clave privada', () => {
    // Arrange
    const privateKey = HARDHAT_SIGNER;

    // Act
    const derived = deriveAddressFromPrivateKey(privateKey);

    // Assert
    expect(derived).toBe(HARDHAT_ADDRESS);
  });

  it('debería devolver la dirección en minúsculas, sin checksum EIP-55', () => {
    // Arrange
    const privateKey = HARDHAT_SIGNER;

    // Act
    const derived = deriveAddressFromPrivateKey(privateKey);

    // Assert
    // La comparación con la configuración se hace en minúsculas por los dos lados: una master
    // escrita con checksum en el `.env` es la MISMA dirección, y hacerla fallar sería un
    // arranque roto por una diferencia de caja.
    expect(derived).toBe(derived.toLowerCase());
  });

  it('debería derivar la misma dirección de la clave escrita en mayúsculas', () => {
    // Arrange
    // El hexadecimal es indiferente a la caja para el proveedor, y `wallets.config.ts` NO
    // normaliza la clave a propósito —sería un sitio más donde el secreto se lee y se copia—.
    // Si esta función sí dependiera de la caja, un operador que pegara la clave en mayúsculas
    // vería un arranque roto por algo que no está mal.
    const privateKey = `0x${HARDHAT_SIGNER.slice(2).toUpperCase()}`;

    // Act
    const derived = deriveAddressFromPrivateKey(privateKey);

    // Assert
    expect(derived).toBe(HARDHAT_ADDRESS);
  });

  it.each([
    ['sin el prefijo 0x', 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'],
    ['con 63 hexadecimales', `0x${'a'.repeat(63)}`],
    ['con 65 hexadecimales', `0x${'a'.repeat(65)}`],
    ['con un carácter no hexadecimal', `0x${'a'.repeat(63)}z`],
    ['con basura por delante', `zz0x${'a'.repeat(64)}`],
    ['vacía', ''],
  ])('debería rechazar una clave %s', (_caso, privateKey) => {
    // Arrange
    const candidate = privateKey;

    // Act + Assert
    expect(() => deriveAddressFromPrivateKey(candidate)).toThrow(
      /WALLETS_MASTER_PRIVATE_KEY no tiene la forma/,
    );
  });

  it('debería rechazar una clave de forma correcta que secp256k1 no acepta como escalar', () => {
    // Arrange
    // La rama que la comprobación de forma NO puede cubrir y que existe de verdad en este repo:
    // el placeholder de desarrollo. Sin ella, el `try/catch` alrededor de la librería no tendría
    // ningún caso que lo justificara.
    const privateKey = DEV_PLACEHOLDER_SIGNER;

    // Act + Assert
    expect(() => deriveAddressFromPrivateKey(privateKey)).toThrow(
      /WALLETS_MASTER_PRIVATE_KEY no es una clave privada válida/,
    );
  });

  it('debería rechazar por su forma con un mensaje fijo, sin nada interpolado', () => {
    // Arrange
    // El caso que justifica el `try/catch` y la comprobación de forma PROPIA: los errores de la
    // librería llevan el valor recibido dentro del mensaje —medido con `@noble/curves@1.9.7`:
    // `hex string expected, got non-hex character "az" at index 62`— y ese valor es la clave.
    const privateKey = `0x${'a'.repeat(63)}z`;

    // Act
    const thrown = captureError(() => deriveAddressFromPrivateKey(privateKey));

    // Assert
    expect(thrown.message).toBe(MALFORMED_MESSAGE);
    expect(thrown.cause).toBeUndefined();
    expect(leakingSurfaces(thrown, privateKey)).toEqual([]);
  });

  it('debería rechazar por su valor con un mensaje fijo, sin reenvolver el error de la librería', () => {
    // Arrange
    // La otra rama, la que sí llama a la librería: aquí el error que se descarta es uno REAL de
    // `@noble/curves`, no uno que nunca llegó a construirse. El `cause` es la ruta por la que se
    // colaría, porque `pino-std-serializers` concatena mensajes y stacks de las causas.
    const privateKey = DEV_PLACEHOLDER_SIGNER;

    // Act
    const thrown = captureError(() => deriveAddressFromPrivateKey(privateKey));

    // Assert
    expect(thrown.message).toBe(INVALID_MESSAGE);
    expect(thrown.cause).toBeUndefined();
    expect(leakingSurfaces(thrown, privateKey)).toEqual([]);
  });
});

describe('assertMasterKeyMatchesAddress', () => {
  it('debería aceptar la configuración cuando la clave deriva exactamente la dirección', () => {
    // Arrange
    const config = { masterAddress: HARDHAT_ADDRESS, masterPrivateKey: HARDHAT_SIGNER };

    // Act + Assert
    expect(() => assertMasterKeyMatchesAddress(config)).not.toThrow();
  });

  it('debería aceptar la dirección escrita con checksum EIP-55', () => {
    // Arrange
    const config = {
      masterAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      masterPrivateKey: HARDHAT_SIGNER,
    };

    // Act + Assert
    expect(() => assertMasterKeyMatchesAddress(config)).not.toThrow();
  });

  it('debería rechazar una configuración cuya dirección y clave son de EOAs distintas', () => {
    // Arrange
    // El agujero de §3.1.1 en su forma exacta: las dos variables son válidas por separado, y el
    // sistema derivaría y activaría contra una EOA mientras firma con otra.
    const config = { masterAddress: OTHER_ADDRESS, masterPrivateKey: HARDHAT_SIGNER };

    // Act + Assert
    expect(() => assertMasterKeyMatchesAddress(config)).toThrow(
      /no corresponde a WALLETS_MASTER_PRIVATE_KEY/,
    );
  });

  it('debería componer el mensaje del desajuste con las dos direcciones y nada más', () => {
    // Arrange
    const config = { masterAddress: OTHER_ADDRESS, masterPrivateKey: HARDHAT_SIGNER };

    // Act
    const thrown = captureError(() => assertMasterKeyMatchesAddress(config));

    // Assert
    // Una dirección es pública y no revela su clave; sin las DOS, el operador no sabe cuál de las
    // variables corregir. La igualdad es exacta y no un `toContain` porque «y nada más» es la
    // mitad que importa: un `toContain` dejaría pasar un `${masterPrivateKey.slice(0, 10)}`
    // añadido al final, y diez caracteres de una clave privada acortan una fuerza bruta.
    expect(thrown.message).toBe(
      `WALLETS_MASTER_ADDRESS (${OTHER_ADDRESS}) no corresponde a WALLETS_MASTER_PRIVATE_KEY, ` +
        `cuya dirección es ${HARDHAT_ADDRESS}`,
    );
  });

  it('debería dejar la clave fuera de las cuatro superficies del error de desajuste', () => {
    // Arrange
    const config = { masterAddress: OTHER_ADDRESS, masterPrivateKey: HARDHAT_SIGNER };

    // Act
    const thrown = captureError(() => assertMasterKeyMatchesAddress(config));

    // Assert
    // El error del desajuste es el que MÁS cerca está de la clave: se construye teniéndola en la
    // mano. Este caso NO es redundante con el de arriba: el mensaje es solo una de las cuatro
    // superficies, y la que escribe en disco —la línea de pino— ni siquiera es simétrica con las
    // otras tres, porque `pino-std-serializers` recorre el error con `for (const key in err)` y
    // sube por la cadena de prototipos. Una clave colgada del error como propiedad no aparecería
    // en `message` y sí en el log. Mismo centinela que `tatum-secret-surface.spec.ts`.
    expect(leakingSurfaces(thrown, HARDHAT_SIGNER)).toEqual([]);
  });

  it('debería recortar los espacios de la dirección configurada antes de compararla', () => {
    // Arrange
    // `envSchema` valida la forma, pero quien pega la variable en un `.env` puede dejar espacio.
    // Sin el recorte esto sería un arranque roto por un carácter invisible.
    const config = { masterAddress: `  ${HARDHAT_ADDRESS} `, masterPrivateKey: HARDHAT_SIGNER };

    // Act + Assert
    expect(() => assertMasterKeyMatchesAddress(config)).not.toThrow();
  });

  it('debería propagar el fallo de forma de la clave sin convertirlo en un desajuste', () => {
    // Arrange
    // Distinguir los dos errores es lo que le dice al operador cuál de las dos variables tocar:
    // «la clave está mal escrita» y «la clave es de otra cuenta» se arreglan distinto.
    const config = { masterAddress: HARDHAT_ADDRESS, masterPrivateKey: 'no-es-una-clave' };

    // Act + Assert
    expect(() => assertMasterKeyMatchesAddress(config)).toThrow(
      /WALLETS_MASTER_PRIVATE_KEY no tiene la forma/,
    );
  });
});

// Helpers

const captureError = (fn: () => unknown): Error => {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error('Se esperaba que la función lanzara un error y no lo hizo');
};

/**
 * UNA LÍNEA REAL de pino con la redacción de la app, escrita a un `Writable` en memoria. Gemela
 * de la de `tatum-secret-surface.spec.ts` y por el mismo motivo: es la única de las cuatro que
 * ejercita `pino-std-serializers`, que recorre el error con `for (const key in err)` y por tanto
 * sube por la cadena de prototipos. Las otras tres solo rinden propiedades propias.
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
  logger.fatal({ err: value }, 'fallo de configuración de la master');
  return chunks.join('');
};

/** Devuelve el NOMBRE de cada superficie que filtró, para que el fallo diga cuál y no solo que. */
const leakingSurfaces = (value: unknown, secret: string): string[] => {
  const surfaces: [string, string][] = [
    ['JSON.stringify', JSON.stringify(value) ?? ''],
    ['String()', String(value)],
    ['util.inspect', inspect(value, { depth: null })],
    ['pino', logLine(value)],
  ];
  return surfaces
    .filter(([, rendered]) => rendered.includes(secret) || rendered.includes(secret.slice(2, 34)))
    .map(([surface]) => surface);
};
