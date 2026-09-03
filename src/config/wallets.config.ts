import { registerAs } from '@nestjs/config';

import { envSchema, type Env } from './env.schema';

/**
 * La cadena que este ciclo envía al proveedor custodial.
 *
 * ⚠️ Es decisión NUESTRA, no una restricción suya. Este ciclo usa cuatro operaciones y las cuatro
 * ofrecen varias cadenas — medido sobre `docs/tatum/gas-pump/openapi.json` leyendo el `enum` del
 * `chain` de cada una:
 *
 *  · `POST /v3/gas-pump` (`CreateGasPump`), en el cuerpo: 7 — BSC, CELO, ETH, MATIC, KLAY, ONE, TRON
 *  · `POST /v3/gas-pump/activate`, en el cuerpo: 5 en `ActivateGasPump`, 6 en `ActivateGasPumpTatum`
 *  · `POST /v3/blockchain/sc/custodial/transfer` (`TransferCustodialWallet`), en el cuerpo: 6
 *  · `GET /v3/gas-pump/activated/{chain}/{owner}/{index}`, en la RUTA: 7
 *
 * La intersección de las cinco listas —calculada, no estimada— son CINCO cadenas: BSC, ETH, MATIC,
 * KLAY y ONE. Cualquiera de ellas recorrería el ciclo entero sin tocar el proveedor. ETH sale de
 * nuestro alcance, no de su contrato.
 *
 * Y la RED —testnet o mainnet— no viaja en ninguna de las dos posiciones: la decide la API key.
 * Medido buscando en los 32 esquemas del fichero una propiedad que case `/network|testnet|mainnet/i`
 * — cero resultados. Por eso `WALLETS_NETWORK` es una etiqueta y no un control, y por eso no hay
 * nada más que fijar aquí.
 *
 * Es una CONSTANTE y no un campo de `WalletsConfig` a propósito: un campo de configuración
 * parecería cambiable, y añadir una segunda cadena no es cambiar un valor. La tabla `wallets` no
 * guarda la cadena, así que su índice único de `address` pasaría a ser ambiguo y haría falta una
 * pareja expand/contract sobre él.
 */
export const TATUM_CHAIN = 'ETH';

/**
 * Los tres placeholders de desarrollo. Mismo criterio que `resolveJwtSecret()` en
 * `auth.config.ts`: fuera de `development`/`test` el refine de `env.schema.ts` ya impidió arrancar
 * sin credenciales, así que esta rama no se alcanza en staging ni en production.
 *
 * ⚠️ La clave son `0x` + 64 CEROS y la entropía nula es el punto, no un descuido. Dos
 * consecuencias, las dos buscadas:
 *
 *  1. Puede vivir en un archivo versionado sin que un humano la confunda con una clave real. El
 *     escáner que sí lo distinguiría es **gitleaks** (job `gitleaks` de
 *     `.github/workflows/security.yml`), cuya regla genérica combina palabra clave con entropía de
 *     Shannon. `secretlint` —el gate de pre-commit— NO sirve para esto: medido pasándole
 *     `--secretlintrc .secretlintrc.json` a un fichero con `WALLETS_MASTER_PRIVATE_KEY=` seguida de
 *     una clave con aspecto realista y a otro con la de ceros, sale EXIT=0 y cero avisos en LOS
 *     DOS. `preset-recommend` dispara con formas conocidas y no trae regla de entropía.
 *     (gitleaks no se ejecutó aquí: no está instalado en local, solo corre en CI.)
 *  2. Cero está fuera del rango `[1, n-1]` que secp256k1 exige a una clave privada, así que no
 *     puede firmar nada por accidente. (Hecho matemático de la curva; no se ha medido cómo lo
 *     rechaza exactamente la librería que acabe firmando.)
 *
 * La dirección es la dirección cero, la única que todo el ecosistema lee como «esto no es una
 * cuenta». No se deriva de la clave —no se puede, ver el punto 2— y por eso existe
 * `usingDevPlaceholders`.
 */
const DEV_ONLY_API_KEY = 'development-placeholder-without-credits';
const DEV_ONLY_MASTER_ADDRESS = `0x${'0'.repeat(40)}`;
const DEV_ONLY_MASTER_PRIVATE_KEY = `0x${'0'.repeat(64)}`;

export type TatumCredentials = {
  apiKey: string;
  masterAddress: string;
  /**
   * ⚠️ String plano, y no puede ser otra cosa: el gate de fronteras solo permite
   * `config → config` —regla `from: { element: { type: 'config' } }` de `eslint.boundaries.js`,
   * cuyo `allow` es exactamente `to: { element: { type: 'config' } }`—, así que desde aquí no se
   * alcanza ni el kernel compartido ni un módulo, y el value object que envuelve el secreto no
   * puede vivir en esta carpeta. Lo envuelve el adaptador en su constructor. Es un hecho de la
   * matriz de fronteras, no una preferencia.
   *
   * Este archivo es el único sitio donde el valor pasa del entorno a un objeto de la aplicación.
   * Medido con `grep -rln WALLETS_MASTER_PRIVATE_KEY src/ --include='*.ts' | grep -v __tests__`:
   * **cuatro** archivos, y solo este TRANSPORTA el valor. Los otros tres nombran la VARIABLE, no
   * la leen: `env.schema.ts` valida su formato, y `master-address.derivation.ts` y
   * `master-key-startup.check.ts` la citan dentro de mensajes de error fijos para decirle al
   * operador cuál corregir. (Eran dos hasta el 2026-08-31, cuando aterrizó la comprobación de
   * arranque; el número anterior está aquí porque el grep es la medida y cambió.) Sin excluir los
   * tests salen más, y solo nombran la variable para CONSTRUIR entornos de prueba.
   *
   * Por eso el VALOR no se loguea, no se interpola en ningún mensaje de error y no viaja en ningún
   * `cause`.
   */
  masterPrivateKey: string;
  /**
   * `true` cuando los tres valores de arriba son los placeholders de desarrollo.
   *
   * Existe para una cosa concreta, y desde el 2026-08-31 esa cosa **existe**:
   * `src/modules/wallets/infrastructure/security/master-key-startup.check.ts` deriva la dirección
   * desde la clave privada al arrancar y la compara con `masterAddress`. Sobre el placeholder no
   * puede, porque la clave de 64 ceros no es un escalar válido de secp256k1 —cero está fuera del
   * rango `[1, n-1]`, y `@noble/curves` responde `invalid private key: out of range [1..N-1]`,
   * medido—, así que ese archivo consulta este flag y se salta la comprobación. Sin el flag habría
   * que elegir entre no comprobar nunca o romper `pnpm start:dev` en un clon recién hecho.
   *
   * (Este JSDoc decía «hoy inexistente», con su `find` de respaldo. Al aterrizar la pieza el
   * comentario no se quedó obsoleto: se quedó INVERTIDO, negando una protección que sí corre.)
   *
   * No viene de ninguna variable de entorno: es derivado, y por eso no está en la tabla de
   * variables del `.env.example`.
   */
  usingDevPlaceholders: boolean;
};

export type WalletsConfig = TatumCredentials & {
  apiUrl: string;
  timeoutMs: number;
  /**
   * Cuál de los dos cuerpos se envía a `POST /v3/gas-pump/activate`: `'tatum'` cobra la comisión
   * de la activación contra la cuota de créditos (esquema `ActivateGasPumpTatum`, con
   * `feesCovered: true`) y `'master'` la paga en ETH firmando con la clave de la master (esquema
   * `ActivateGasPump`, con `fromPrivateKey`).
   *
   * Son los dos únicos aplicables a ETH **sin el sistema de gestión de claves del proveedor**.
   * Medido sobre `docs/tatum/gas-pump/openapi.json`: el `oneOf` de ese endpoint tiene 7 esquemas y
   * TRES aceptan `chain: ETH` —los dos de arriba y `ActivateGasPumpKMS`—; el tercero exige
   * `signatureId`, que es la condición de salida que el veto de `WALLETS_NETWORK` deja fuera de
   * este ciclo.
   */
  activationPayer: Env['WALLETS_ACTIVATION_PAYER'];
  /**
   * Solo puede valer `'testnet'`: el refine de `env.schema.ts` veta `mainnet` al arrancar. El
   * tipo conserva la unión en vez de estrecharse con un `as` porque un `as` afirmaría en el tipo
   * lo que de verdad garantiza una validación en tiempo de ejecución — y si alguien retira ese
   * refine, el compilador debe volver a enseñar las dos ramas.
   */
  network: Env['WALLETS_NETWORK'];
};

/**
 * ⚠️ Con una credencial a medias se cae a los placeholders ENTEROS, no a una mezcla. Mezclar una
 * API key real con una clave que no puede firmar gastaría créditos del plan para acabar en un
 * error del proveedor; el aviso nombra las que faltan porque, si no, el operador vería su API key
 * ignorada sin ninguna pista de por qué.
 *
 * El aviso nombra VARIABLES, nunca valores: ver el comentario de `masterPrivateKey`.
 */
export const resolveTatumCredentials = (
  env: Pick<
    Env,
    'NODE_ENV' | 'TATUM_API_KEY' | 'WALLETS_MASTER_ADDRESS' | 'WALLETS_MASTER_PRIVATE_KEY'
  >,
): TatumCredentials => {
  const missing = (
    [
      ['TATUM_API_KEY', env.TATUM_API_KEY],
      ['WALLETS_MASTER_ADDRESS', env.WALLETS_MASTER_ADDRESS],
      ['WALLETS_MASTER_PRIVATE_KEY', env.WALLETS_MASTER_PRIVATE_KEY],
    ] as const
  )
    .filter(([, value]) => value === undefined)
    .map(([name]) => name);

  if (
    env.TATUM_API_KEY !== undefined &&
    env.WALLETS_MASTER_ADDRESS !== undefined &&
    env.WALLETS_MASTER_PRIVATE_KEY !== undefined
  ) {
    return {
      apiKey: env.TATUM_API_KEY,
      // Quien copia la dirección de un explorador la copia con checksum EIP-55, y `envSchema` la
      // acepta así a propósito (`/^0x[0-9a-fA-F]{40}$/`). Este es el único punto por el que entra
      // al sistema, así que normalizarla aquí es lo que hace que ninguna comparación posterior
      // dependa de cómo la escribió el operador. La clave privada NO se toca: el hexadecimal es
      // indiferente a mayúsculas para el proveedor, y transformarla solo añadiría un sitio más
      // donde el secreto se lee y se copia.
      masterAddress: env.WALLETS_MASTER_ADDRESS.toLowerCase(),
      masterPrivateKey: env.WALLETS_MASTER_PRIVATE_KEY,
      usingDevPlaceholders: false,
    };
  }

  // `NODE_ENV` va en la firma para documentar la precondición —el refine de `env.schema.ts` ya
  // vetó staging/production sin credenciales—, no para ramificar por entorno. Mismo criterio que
  // `resolveJwtSecret()`.
  console.warn(
    `[wallets] ${missing.join(', ')} sin definir: usando los placeholders de desarrollo. ` +
      'La clave de relleno son 64 ceros y no puede firmar, así que los endpoints de /wallets ' +
      'fallarán en la primera llamada al proveedor. No sirve para staging/production (el ' +
      'arranque fallaría).',
  );

  return {
    apiKey: DEV_ONLY_API_KEY,
    masterAddress: DEV_ONLY_MASTER_ADDRESS,
    masterPrivateKey: DEV_ONLY_MASTER_PRIVATE_KEY,
    usingDevPlaceholders: true,
  };
};

export const buildWalletsConfig = (env: Env): WalletsConfig => ({
  apiUrl: env.TATUM_API_URL,
  timeoutMs: env.TATUM_TIMEOUT_MS,
  activationPayer: env.WALLETS_ACTIVATION_PAYER,
  network: env.WALLETS_NETWORK,
  ...resolveTatumCredentials(env),
});

export const walletsConfig = registerAs('wallets', (): WalletsConfig =>
  buildWalletsConfig(envSchema.parse(process.env)),
);
