// ⚠️ Los subpaths van SIN extensión porque así los publica la línea 1.x, y `@noble/hashes` entra
// en `dependencies` —no en `devDependencies`— porque esto corre en cada petición: desde
// `devDependencies`, el `pnpm install --prod` de la imagen no lo instalaría y el fallo sería
// `Cannot find module '@noble/hashes/sha3'` en RUNTIME, con build, lint y tests en verde.
//
// Un bump MAYOR rompe estos dos imports, y está medido, no supuesto: `npm view @noble/hashes@2
// exports` publica `./sha3.js` y `./utils.js` y **ya no** las formas sin extensión (lo mismo le
// pasa a `@noble/curves@2` con `./secp256k1.js`, que usa `../security/master-address.derivation`).
// Renovate pinea exacto (`:pinAllExceptPeerDependencies`), así que la línea mayor no la fija
// ningún rango: la fija que `pnpm typecheck` se ponga rojo con `Cannot find module` en el PR del
// bump. Subir a 2.x es añadir `.js` a los tres imports, no un cambio de librería.
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { registerDecorator, type ValidationOptions } from 'class-validator';

/**
 * Forma pelada: `0x` y 40 hexadecimales de cualquier caja. Sin esto no hay nada que verificar.
 *
 * El prefijo es el literal `0x` y no `0[xX]` a propósito: `0X…` no es ninguna de las dos formas
 * que el EIP-55 define, y aceptarla obligaría a decidir sobre qué cadena se calcula el checksum.
 * `EthereumAddress.from()` sí la acepta, porque baja de caja la cadena entera — pero eso pasa
 * DESPUÉS de este validador y sobre un valor que ya se dio por bueno.
 */
const ADDRESS_SHAPE = /^0x[0-9a-fA-F]{40}$/;

/**
 * La forma canónica EIP-55 de una dirección: el cuerpo en minúsculas se hashea con keccak256 y
 * cada dígito sube a mayúscula si el nibble correspondiente del hash es >= 8.
 *
 * `keccak_256` y NO el `sha3-256` de `node:crypto`: son algoritmos distintos —distinto padding— y
 * dan hashes distintos. Medido sobre la cadena vacía: keccak256 da `c5d24601…5d85a470` y
 * `sha3-256` da `a7ffc6f8…80f8434a`, así que con el de la biblioteca estándar TODOS los checksums
 * saldrían rotos. Esa es la razón entera por la que este archivo depende de una librería externa,
 * y por la que no puede vivir en `domain/`.
 *
 * Se exporta —no es solo un detalle interno— porque es lo que permite escribir la propiedad de su
 * spec: sin una forma canónica que generar, «mutar un carácter siempre falla» no se puede formular
 * sobre una dirección al azar, solo sobre los cuatro vectores del estándar. ⚠️ Y por eso mismo esa
 * propiedad es CIRCULAR en su mitad positiva: quien comprueba que keccak256 es el algoritmo
 * correcto son esos cuatro vectores, no ella.
 */
export const toChecksumAddress = (address: string): string => {
  const body = address.slice(2).toLowerCase();
  const hash = bytesToHex(keccak_256(utf8ToBytes(body)));
  let checksummed = '0x';
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index] ?? '';
    const nibble = Number.parseInt(hash[index] ?? '0', 16);
    checksummed += nibble >= 8 ? char.toUpperCase() : char;
  }
  return checksummed;
};

/**
 * `class-validator` ya trae `@IsEthereumAddress()`, y comprueba SOLO la forma. Con él, un
 * `0x…BeAed` con un carácter cambiado por el cliente pasa el transporte, llega al proveedor, se
 * paga el gas y el activo acaba en una dirección que no es de nadie — irreversible, porque una
 * transferencia enviada no se deshace. Esta función es lo que lo impide, y por eso no se sustituye
 * por la del paquete.
 *
 * Una dirección toda en minúsculas (o toda en mayúsculas) **no lleva checksum**: sus letras no
 * codifican ningún bit del hash, así que verificarla sería rechazar entradas legítimas —las que
 * escribe cualquier integración que no aplique EIP-55, el propio proveedor incluido, que devuelve
 * las direcciones en minúsculas—. Solo se comprueba la caja mezclada, que es lo que el estándar
 * dice.
 *
 * No recorta ni normaliza: si lo hiciera, el checksum se calcularía sobre una cadena distinta de
 * la que escribió el cliente, que es exactamente lo que este validador existe para no hacer.
 */
export const isChecksummedAddress = (value: unknown): boolean => {
  if (typeof value !== 'string' || !ADDRESS_SHAPE.test(value)) {
    return false;
  }
  const body = value.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) {
    return true;
  }
  return value === toChecksumAddress(value);
};

/**
 * Decorador de propiedad para los DTO de este contexto.
 *
 * El mensaje va en inglés, como el resto de los de `class-validator` con los que se concatena en
 * el `message` del 400 — es la excepción escrita de la convención «la prosa va en español»: la
 * alternativa es una respuesta HTTP con dos idiomas dentro. Y nombra el CHECKSUM porque «invalid
 * address» no distingue una dirección mal escrita de una con un carácter cambiado, que es
 * justamente lo que este validador caza y lo que el cliente necesita saber para arreglarla.
 */
export const IsChecksummedAddress =
  (options?: ValidationOptions): PropertyDecorator =>
  (object, propertyName): void => {
    registerDecorator({
      name: 'isChecksummedAddress',
      target: object.constructor,
      propertyName: propertyName as string,
      options,
      validator: {
        validate: (value: unknown): boolean => isChecksummedAddress(value),
        defaultMessage: (args) =>
          `${args?.property ?? 'value'} must be an Ethereum address with a valid EIP-55 checksum`,
      },
    });
  };
