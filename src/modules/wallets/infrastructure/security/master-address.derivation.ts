// `@noble/curves` ya depende de `@noble/hashes`, así que estos tres imports no meten un segundo
// árbol de criptografía en la imagen. Sobre los subpaths sin extensión y qué pasa en un bump
// mayor, ver la cabecera de `../http/validators/is-checksummed-address.validator.ts`: el mismo
// hecho medido, escrito una sola vez.
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex } from '@noble/hashes/utils';

/** `0x` + 64 hexadecimales: la forma que exige el proveedor (`fromPrivateKey`, longitud 66). */
const PRIVATE_KEY_SHAPE = /^0x[0-9a-fA-F]{64}$/;

/**
 * Los dos mensajes son FIJOS y no llevan un solo fragmento de la clave. Van en español porque solo
 * los lee el operador que arranca el proceso: esto nunca llega a una respuesta HTTP.
 *
 * Son DOS y no uno a propósito: «está mal escrita» y «no es un escalar de la curva» se arreglan
 * distinto —la primera se corrige mirando el `.env`, la segunda solo regenerando la cuenta— y un
 * mensaje único obligaría al operador a adivinar cuál de las dos le ha tocado.
 */
const MALFORMED_PRIVATE_KEY = 'WALLETS_MASTER_PRIVATE_KEY no tiene la forma 0x + 64 hexadecimales';
const INVALID_PRIVATE_KEY =
  'WALLETS_MASTER_PRIVATE_KEY no es una clave privada válida de secp256k1';

export type MasterKeyPair = {
  masterAddress: string;
  masterPrivateKey: string;
};

/**
 * Dirección Ethereum de una clave privada: los 20 últimos bytes del keccak256 de la clave pública
 * SIN COMPRIMIR, quitándole su byte de prefijo `0x04`. De ahí el `false` de `getPublicKey` y el
 * `slice(1)`: con la forma comprimida —33 bytes— el hash sería otro y la dirección, otra.
 *
 * ⚠️ **La comprobación de forma es NUESTRA y ninguno de los dos errores lleva `cause`, y las dos
 * cosas tapan el mismo agujero:** el error de la librería lleva el valor que recibió dentro del
 * mensaje. Medido con `@noble/curves@1.9.7` sobre `0x` + 63 aes + `z`:
 *
 *     private key must be hex string or Uint8Array, cause: Error: hex string expected,
 *     got non-hex character "az" at index 62
 *
 * Ese `"az"` son dos caracteres de la clave privada de la master. Con `cause`,
 * `pino-std-serializers` concatena mensajes y stacks de las causas al recorrer el error, así que
 * el fragmento acabaría escrito en el log de arranque de cada despliegue. De ahí que se rechace
 * ANTES de llamar cuando se puede, y que el error de la librería se sustituya por uno propio —no
 * se reenvuelva— cuando no se puede.
 *
 * El `catch` vacío no es pereza: es la única forma de garantizar que nada de lo que la librería
 * construyó sobrevive. Su contrapartida es que la razón exacta se pierde, y por eso el mensaje que
 * lo sustituye nombra la variable y el algoritmo — lo que el operador necesita sin ver el secreto.
 */
export const deriveAddressFromPrivateKey = (privateKey: string): string => {
  if (!PRIVATE_KEY_SHAPE.test(privateKey)) {
    throw new Error(MALFORMED_PRIVATE_KEY);
  }

  let uncompressedPublicKey: Uint8Array;
  try {
    uncompressedPublicKey = secp256k1.getPublicKey(privateKey.slice(2), false);
  } catch {
    // Alcanzable de verdad, y no solo en teoría: los 64 ceros del placeholder de desarrollo de
    // `wallets.config.ts` pasan la forma y están fuera del rango `[1, n-1]` de la curva.
    throw new Error(INVALID_PRIVATE_KEY);
  }

  const hash = bytesToHex(keccak_256(uncompressedPublicKey.slice(1)));
  return `0x${hash.slice(-40)}`;
};

/**
 * Comprueba que `WALLETS_MASTER_ADDRESS` es la dirección de `WALLETS_MASTER_PRIVATE_KEY`.
 *
 * Sin esto, dos variables de EOAs distintas conviven sin que nada las contraste: el sistema deriva
 * y activa contra la DIRECCIÓN configurada y firma con la CLAVE configurada, y el desajuste solo
 * se manifiesta en la primera transferencia, con el gas ya pagado. El cuerpo de
 * `TransferCustodialWallet` no tiene ningún campo `owner` que las ate — medido sobre las diez
 * propiedades de su esquema en `docs/tatum/gas-pump/openapi.json`, ninguna se llama así.
 *
 * La comparación baja de caja los dos lados y recorta la dirección: una master escrita con
 * checksum EIP-55 —como la copia cualquier explorador— es la MISMA dirección, y un arranque roto
 * por una diferencia de caja o por un espacio invisible sería un falso positivo caro.
 *
 * El mensaje nombra las DOS direcciones y jamás la clave. Una dirección es pública —no revela su
 * clave— y sin ellas el operador no sabe cuál de las dos variables está mal; interpolar la clave,
 * en cambio, la escribiría en el log de arranque de cada despliegue.
 *
 * ⚠️ **No sabe nada de los placeholders de desarrollo, y es deliberado.** Sobre la clave de 64
 * ceros lanzaría `INVALID_PRIVATE_KEY` y tumbaría `pnpm start:dev` en un clon recién hecho. Quien
 * decide CUÁNDO preguntar es `master-key-startup.check.ts`, que es el único de los dos archivos
 * que ve la configuración entera; esta función solo sabe responder.
 */
export const assertMasterKeyMatchesAddress = ({
  masterAddress,
  masterPrivateKey,
}: MasterKeyPair): void => {
  const configured = masterAddress.trim().toLowerCase();
  const derived = deriveAddressFromPrivateKey(masterPrivateKey);

  if (configured !== derived) {
    throw new Error(
      `WALLETS_MASTER_ADDRESS (${configured}) no corresponde a WALLETS_MASTER_PRIVATE_KEY, ` +
        `cuya dirección es ${derived}`,
    );
  }
};
