import { ValueObject } from '@shared/domain/value-object.base';

import { InvalidEthereumAddressError } from '../errors/wallet.errors';

/**
 * Se comprueba sobre el valor YA recortado y en minúsculas, de ahí que no incluya `A-F` ni acepte
 * `0X`: quien admite las mayúsculas es la normalización, no esta expresión.
 *
 * Las dos anclas son lo único que impide que la dirección se acepte ENCONTRÁNDOLA dentro de una
 * cadena mayor, y **no se reparten los casos por igual** — medido quitando cada una y corriendo
 * la suite ENTERA, no solo los dos casos de «basura»:
 *
 * - Sin `^`, `'zz0x…'` casaría, y **A11 es el único caso que muere** (cae **un** caso).
 * - Sin `$`, mueren **DOS**: A12 (`'0x…zz'`) y también A8, los 41 hexadecimales — porque sus
 *   primeros 40 casan y el sobrante deja de importar (caen **2** casos).
 *
 * ⚠️ Una versión anterior de este comentario decía «ninguno de los otros trece muere por esa
 * causa». Era falso, y se coló porque la medición se hizo filtrando con `-t` solo A11 y A12: los
 * 13 casos restantes salían como `skipped`, así que A8 nunca llegó a ejecutarse.
 */
const ETHEREUM_ADDRESS = /^0x[0-9a-f]{40}$/;

/**
 * Dirección Ethereum: forma y nada más. Se normaliza a minúsculas porque la misma dirección en
 * EIP-55 y en minúsculas ES la misma dirección, y normalizar es lo que hace que `equals()` y el
 * índice único de la tabla coincidan — mismo patrón que `Email`.
 *
 * ⚠️ **Asimetría deliberada con `WalletId` / `TransferId`, que NO normalizan**: su regex lleva
 * `/i` y `UuidId.assertUuid` devuelve el valor tal cual. Allí las dos cajas son la misma cadena
 * para PostgreSQL porque la columna es `uuid`; aquí la columna es texto, así que si el VO no
 * bajara de caja el índice único dejaría entrar la misma dirección dos veces.
 *
 * ⚠️ **No valida el checksum EIP-55, y es deliberado.** Lo que eso deja pasar tiene nombre: una
 * dirección MAL TECLEADA que el checksum habría cazado entra como válida, y una transferencia a
 * una dirección inexistente no se puede deshacer. Quien lo tapará es el validador del DTO
 * `is-checksummed-address.validator.ts`, en `infrastructure/http/`, con keccak256 de
 * `@noble/hashes`, y **solo cubrirá lo
 * que entre por HTTP** — el otro origen de direcciones es el proveedor, que las devuelve en
 * minúsculas, es decir sin checksum que comprobar.
 *
 * ⚠️ **Hoy ese validador NO existe**, así que ahora mismo NADIE comprueba el checksum en todo el
 * sistema: no hay ningún archivo bajo `infrastructure/` en este módulo y `@noble/hashes` no está
 * en `package.json`. Es una decisión pendiente, no una protección activa.
 *
 * Por qué no aquí, en dos hechos medidos y no supuestos:
 * - `node:crypto` no trae keccak256: `getHashes().filter(h => /keccak/i.test(h))` devuelve 0
 *   entradas, y su `sha3-256` es otro algoritmo — sobre la cadena vacía da
 *   `a7ffc6f8…f8434a`, mientras que keccak256 da `c5d24601…5d85a470`. Usarlo daría por rotos
 *   TODOS los checksums.
 * - La prohibición de traer `@noble/hashes` aquí es la regla en prosa de `CLAUDE.md`
 *   («`domain/` importa nada externo»), **no** el gate: su lista de externals está CERRADA
 *   (`@nestjs/*`, `typeorm`, `pino`, `class-validator`, `axios`, `argon2`) y `@noble/hashes` no
 *   está en ella. Medido con una sonda: un archivo de `domain/` que importa `zod` y `axios` a la
 *   vez solo recibe UN error de `boundaries/dependencies`, el de `axios`.
 */
export class EthereumAddress extends ValueObject<string> {
  /**
   * Recorta ANTES de validar, y ese orden decide la tabla: al revés, `'  0x…  '` sería rechazada
   * porque los espacios no son hexadecimales (A3). Lo que el recorte no puede hacer es colar
   * A11/A12: `trim()` solo quita espacio en blanco, así que la basura sigue ahí cuando las anclas
   * miran.
   *
   * `toLowerCase()` se aplica a la cadena ENTERA, prefijo incluido — es lo único por lo que `0X`
   * se acepta (A4), ya que la expresión exige el literal `0x`.
   *
   * El error lleva el valor CRUDO, no el normalizado: quien lee un 400 quiere ver lo que escribió.
   */
  static from(value: string): EthereumAddress {
    const normalized = value.trim().toLowerCase();
    if (!ETHEREUM_ADDRESS.test(normalized)) {
      throw new InvalidEthereumAddressError(value);
    }
    return new EthereumAddress(normalized);
  }
}
