import type { AddressIndex } from '../value-objects/address-index.vo';
import type { EthereumAddress } from '../value-objects/ethereum-address.vo';
import type { TransactionHash } from '../value-objects/transaction-hash.vo';
import type { TransferAsset } from '../transfer-asset';

/**
 * Lo que hace falta para firmar un envío. `from` es la dirección de la WALLET, nunca la master: la
 * master firma, no envía (§5.3).
 *
 * El destinatario se llama **`recipient`** y no `to` por dos motivos que apuntan al mismo sitio, y
 * los dos están medidos en `docs/tatum/gas-pump/openapi.json`: es el nombre que el propio proveedor
 * le da —`TransferCustodialWallet.recipient`, «The blockchain address that receives the asset»— y
 * `to` está ocupado, porque en los endpoints de gas pump es un ÍNDICE (ver el aviso de abajo).
 * Reutilizar ese nombre para una dirección invitaría a pasar uno donde va el otro.
 *
 * ⚠️ Cuidado con el otro lado de esa moneda: nuestro `from` es una DIRECCIÓN, mientras que el `from`
 * del proveedor es un índice. El campo del proveedor que recibe esta dirección se llama
 * `custodialAddress`, y traducir el nombre es trabajo del mapper del adaptador (§6.2).
 *
 * La clave privada **no aparece aquí y no puede aparecer**: la aporta el adaptador en el único
 * punto donde se lee, y meterla en este tipo la pasearía por `application/`, que es exactamente la
 * superficie que §7.1 cierra.
 *
 * `type` y no clase: es un dato que acompaña al puerto, así que su nombre entra en la lista cerrada
 * del selector de `eslint.config.mjs`. Mientras no figure ahí, importarlo con `type` inline
 * sale rojo en `lint:check` y la salida es importarlo como valor — ver `wallet.repository.ts`.
 */
export type SendCommand = {
  from: EthereumAddress;
  recipient: EthereumAddress;
  asset: TransferAsset;
};

/**
 * El proveedor de direcciones custodiadas, nombrado por la CAPACIDAD: «gas pump» es la marca del
 * producto de Tatum —es el `tag` de sus operaciones en `openapi.json`—, no un concepto de este
 * dominio.
 *
 * `abstract class` —tipo y token en la misma referencia— por el mismo motivo que
 * `wallet.repository.ts`.
 *
 * **Uno solo y no tres**, a diferencia de la fachada de `users`: detrás hay un único adaptador
 * contra un único proveedor y ningún método es peligroso-por-descuido —que fue el motivo real de
 * partir `UsersFacade` en `UsersLookup` y `UsersProvisioning`: entregaba a `orders` un
 * `deleteProfile` que nunca pidió—. Segregarlo aquí multiplicaría el fake sin ganar una garantía
 * del compilador (§4).
 *
 * `masterAddress()` es SÍNCRONO: lee configuración ya resuelta, no sale a la red. Devolver una
 * promesa obligaría a cada llamante a un `await` antes de pasar la master a
 * `Wallet.assertOwnedBy(master)`, que es síncrono, y sugeriría un coste que no existe.
 *
 * ⚠️ **`deriveAddress`, `enableSending` e `isSendingEnabled` reciben un ÍNDICE, no una dirección.**
 * Lo arbitra la API del proveedor, no el gusto. Medido en `docs/tatum/gas-pump/openapi.json`:
 *   - `POST /v3/gas-pump` exige `["chain","owner","from","to"]`, donde `from` y `to` son
 *     `type: integer` y delimitan el rango de ÍNDICES a derivar; el `owner` de ese cuerpo es la
 *     master, no la dirección derivada.
 *   - `POST /v3/gas-pump/activate` acepta un `oneOf` de siete esquemas, y **los siete** exigen esos
 *     mismos cuatro campos con `from`/`to` `integer`; lo que cada uno añade encima es su forma de
 *     firmar (`fromPrivateKey`, `signatureId` o `feesCovered`) y, en las variantes de Celo y Tron,
 *     un campo de comisión.
 *   - `GET /v3/gas-pump/activated/{chain}/{owner}/{index}` lo lleva en la ruta.
 * Pasarles la dirección obligaría al adaptador a invertir la derivación, que no tiene inversa. Y la
 * master no viaja en la firma de `deriveAddress` porque la aporta el adaptador desde la
 * configuración: pasársela desde el caso de uso duplicaría `masterAddress()` y abriría la puerta a
 * derivar bajo una master que no es la nuestra.
 *
 * ⚠️ `isSendingEnabled` devuelve `boolean` y **nunca `null`**. El esquema `Activated` del proveedor
 * no declara `required` —medido: `components.schemas.Activated` solo tiene `properties.activated`—,
 * así que `{}` es un 200 válido; y las dos lecturas por defecto son destructivas sobre un estado
 * monótono: leerlo como `false` quema gas en una dirección quizá ya activada, leerlo como `true`
 * cura a un estado del que no se retrocede. La ausencia no es un booleano: el adaptador la traduce
 * a `WalletProviderUnreachableError` (502, al APM) antes de que el dominio la vea (§6.2).
 *
 * ⚠️ `enableSending` y `send` **no son reintentables**, y esa política vive en el adaptador, no
 * aquí: un reintento de la primera paga el gas dos veces y uno de la segunda mueve el dinero dos
 * veces. `deriveAddress` e `isSendingEnabled` sí lo son, y el argumento es «no cuesta gas», NO «es
 * determinista» — la documentación del proveedor no promete en ningún sitio que derivar
 * `(owner, índice)` sea determinista. La consecuencia práctica: **la fuente de verdad de la
 * dirección es la fila guardada**, nunca una rederivación.
 */
/**
 * ⚠️ **Los tres métodos indexados piden value objects que `Wallet` NO publica**, y conviene
 * saberlo antes de escribir los casos de uso en vez de tres tareas más tarde. Medido: los únicos
 * miembros públicos de `entities/wallet.entity.ts` son `status`, `activationTxId`, `canSend`,
 * los dos mutadores, las dos aserciones y `toSnapshot()` — no hay `get addressIndex()` ni
 * `get address()`.
 *
 * La consecuencia es que el caso de uso sacará ambos de `wallet.toSnapshot()`, que los da como
 * `number` y `string`, y tendrá que reconstruir `AddressIndex.from(...)` /
 * `EthereumAddress.from(...)` dentro de `application/` — reejecutando una validación cuyos fallos
 * son inalcanzables desde la API y saldrían como un 500.
 *
 * **No está roto y las dos superficies están congeladas.** Si ese ida y vuelta pesa, la salida es
 * añadir dos getters a `Wallet`, nunca aflojar la firma de este puerto a `number`/`string`: el
 * índice y la dirección son justo los dos datos que no deben viajar sin validar hasta una llamada
 * que cobra gas.
 */
export abstract class CustodialAddressGateway {
  abstract masterAddress(): EthereumAddress;
  abstract deriveAddress(index: AddressIndex): Promise<EthereumAddress>;
  abstract enableSending(index: AddressIndex): Promise<TransactionHash>;
  abstract isSendingEnabled(index: AddressIndex): Promise<boolean>;
  abstract send(command: SendCommand): Promise<TransactionHash>;
}
