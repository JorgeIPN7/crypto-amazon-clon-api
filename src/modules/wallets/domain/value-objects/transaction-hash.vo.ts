import { ValueObject } from '@shared/domain/value-object.base';

import { InvalidTransactionHashError } from '../errors/wallet.errors';

/**
 * Se comprueba sobre el valor YA recortado y en minúsculas, de ahí que no incluya `A-F` ni acepte
 * `0X`: quien admite las mayúsculas es la normalización, no esta expresión. Mismo trato que en
 * `ethereum-address.vo.ts`, con 64 dígitos en lugar de 40.
 *
 * Las dos anclas son lo único que impide aceptar el hash ENCONTRÁNDOLO dentro de una cadena mayor,
 * y **no se reparten los casos por igual** — medido borrando cada una y corriendo el módulo ENTERO,
 * no solo los dos casos de «basura»:
 *
 * - Sin `^`, `'zz0x…'` casaría, y **H10 es el único caso que muere** (`1 failed, 112 passed`).
 * - Sin `$`, mueren **DOS**: H11 (`'0x…zz'`) y también H7, los 65 hexadecimales — porque sus
 *   primeros 64 casan y el sobrante deja de importar (`2 failed, 111 passed`).
 */
const TRANSACTION_HASH = /^0x[0-9a-f]{64}$/;

/**
 * Hash de una transacción de la cadena: el de la activación (`activationTxId` de `Wallet`) y el de
 * la transferencia (`txId` de `WalletTransfer`). Se normaliza a minúsculas por la misma razón que
 * `EthereumAddress`: el mismo hash escrito en dos cajas es el mismo hash, y sin normalizar releer
 * una fila devolvería un VO que no `equals()` al que se guardó.
 *
 * ⚠️ **El proveedor lo devuelve SIN el prefijo `0x`, así que prefijarlo es tarea del ADAPTADOR y
 * NO de este VO.** Medido abriendo `docs/tatum/gas-pump/openapi.json`, no citado de oídas:
 * `components/schemas/TransactionHash` es un `type: object` con una propiedad requerida `txId`, y
 * es esa propiedad la que declara `type: string`, sin `pattern` y con
 * `example: "c83f8818db43d9ba4accfe454aa44fc33123d47a4f89d47b314d6748eb0e9bc9"` — 64 hexadecimales
 * pelados. Como PROPIEDAD de un esquema, `txId` aparece una sola vez —ahí—, pero el literal
 * `"txId"` sale **tres** veces en el documento (`grep -c '"txId"'` → 3): las otras dos son el
 * array `required` del propio esquema y, la que importa, el **parámetro de ruta** de
 * `GET /v3/gas-pump/address/{chain}/{txId}` — la operación que leerá el `invalid[]` de una
 * activación fallida, hoy fuera de alcance. Decir «una sola vez en todo el documento» escondía
 * justo esa, y las otras once
 * cadenas de 64 hexadecimales que contiene son todas `fromPrivateKey`, no hashes: medido
 * recorriendo el JSON entero y listando la ruta de cada aparición. Ese esquema lo referencian
 * cuatro respuestas `200`; las dos que el contrato congelado hace nuestras son
 * `POST /v3/gas-pump/activate` (`enableSending`) y `POST /v3/blockchain/sc/custodial/transfer`
 * (`send`) — las otras dos, `transfer/batch` y `approve`, no están en el puerto.
 *
 * **El fallo que esto evita:** si el adaptador entrega el `txId` tal cual, `from()` lanza
 * `InvalidTransactionHashError` DESPUÉS de que la cadena haya cobrado el gas — la transacción está
 * enviada y lo que el cliente recibe es un error. El dominio no puede taparlo: no conoce la forma
 * del proveedor, y taparlo aquí significaría aceptar hashes sin prefijo también por HTTP.
 *
 * ⚠️ **Hoy ese adaptador NO existe**, así que la normalización no está puesta en ninguna parte:
 * `find src/modules/wallets -mindepth 1 -maxdepth 1` devuelve solo `domain` y `__tests__` —no hay
 * capa `infrastructure`—, y `find src -name "tatum-custodial-address.gateway.ts"` no devuelve nada.
 * Es una deuda abierta, no una protección activa; quien escriba ese archivo tiene que prefijar
 * antes de llamar a `from()`.
 */
export class TransactionHash extends ValueObject<string> {
  /**
   * Recorta ANTES de validar, y ese orden decide la tabla: al revés, `'  0x…  '` sería rechazado
   * porque los espacios no son hexadecimales (H3). Lo que el recorte no puede hacer es colar
   * H10/H11: `trim()` solo quita espacio en blanco, así que la basura sigue ahí cuando las anclas
   * miran.
   *
   * `toLowerCase()` se aplica a la cadena ENTERA, prefijo incluido — es lo único por lo que `0X`
   * se acepta (H4), ya que la expresión exige el literal `0x`.
   *
   * El error lleva el valor CRUDO, no el normalizado: quien lea ese 500 en un log quiere ver lo
   * que llegó. **Lo protege H13**, hermano del A14 de `ethereum-address.vo.ts` y añadido por
   * confirmación tras la revisión, porque sin él el comportamiento no lo fijaba nadie: las siete
   * entradas de rechazo de la tabla original ya cumplían `raw === raw.trim().toLowerCase()`, así
   * que las dos cadenas eran la misma y el cambio resultaba invisible.
   *
   * Medido las dos veces, con el módulo entero: **sin** H13, sustituir
   * `new InvalidTransactionHashError(value)` por `(normalized)` deja `113 passed` y no cae ni uno;
   * **con** H13, ese mismo cambio da `1 failed, 113 passed` y el único que cae es H13.
   *
   * ⚠️ La mutación tampoco lo cazaría: Stryker no genera el mutante «cambia un identificador por
   * otro del mismo ámbito». Este caso no aporta score, aporta la única protección que existe.
   */
  static from(value: string): TransactionHash {
    const normalized = value.trim().toLowerCase();
    if (!TRANSACTION_HASH.test(normalized)) {
      throw new InvalidTransactionHashError(value);
    }
    return new TransactionHash(normalized);
  }
}
