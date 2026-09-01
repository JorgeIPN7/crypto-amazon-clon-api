import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SecretValueObject } from '@shared/domain/secret-value-object.base';

import { TATUM_CHAIN, type WalletsConfig } from '@config/wallets.config';

import {
  WalletAddressIsMasterError,
  WalletProviderUnreachableError,
} from '../../domain/errors/wallet.errors';
// ⚠️ `SendCommand` es un DATO que acompaña al puerto, así que su forma natural sería el `type`
// inline —`import { CustodialAddressGateway, type SendCommand }`—, y aquí no lo lleva porque su
// nombre todavía NO está en la lista cerrada del segundo selector de `no-restricted-syntax`
// (`eslint.config.mjs`, hoy: CreateProfileResult, DirectoryUser, FindUsersCriteria, SignedToken,
// TokenClaims, UserPage, UserSummary). Medido escribiéndolo con `type` y corriendo
// `npx eslint` sobre este archivo: `error … no-restricted-syntax` en la columna del specifier.
// La salida mientras tanto es importarlo como VALOR, que es la que prescribe el JSDoc del puerto
// y la que `list-wallet-transfers.use-case.ts` ya escribe para `TransferPage`. Quien añada los
// cuatro nombres del contexto a esa lista es la tarea dueña de `eslint.config.mjs`; este archivo
// no lo toca.
import { CustodialAddressGateway, SendCommand } from '../../domain/ports/custodial-address.gateway';
import { AddressIndex } from '../../domain/value-objects/address-index.vo';
import { EthereumAddress } from '../../domain/value-objects/ethereum-address.vo';
import { TransactionHash } from '../../domain/value-objects/transaction-hash.vo';

import { mapAssetToTatumFields } from './tatum-asset.mapper';
import { TatumHttpClient } from './tatum-http.client';

/**
 * La clave privada de la master, envuelta para que no se rinda a texto por accidente.
 * `SecretValueObject` tapa las TRES superficies que escriben sin que nadie las escriba:
 * `toString()`, `toJSON()` —la que usa pino— y `util.inspect`.
 *
 * Vive aquí y no en `src/config/` porque la matriz de fronteras solo permite `config → config`
 * —regla `from: { element: { type: 'config' } }` de `eslint.boundaries.js`, cuyo `allow` es
 * exactamente `to: { element: { type: 'config' } }`—: desde la configuración no se alcanza el
 * kernel compartido. La config guarda un string plano y este adaptador lo envuelve en su
 * constructor.
 *
 * Y no tiene archivo propio a pesar de la regla 1:1 spec↔archivo porque su spec sería nominal:
 * las tres superficies las mide de verdad `secret-value-object.base.spec.ts`. Lo único que aquí
 * hace falta fijar —que esta clase extiende ESA base y no `ValueObject`— es un caso del spec de
 * este archivo (`describe('MasterPrivateKey')`).
 *
 * ⚠️ No es una caja fuerte: `.value` sigue devolviendo el original, porque el cuerpo que va a
 * `fetch` lo necesita. Protege del `console.log` y del logger, no de quien va a buscar el dato.
 */
export class MasterPrivateKey extends SecretValueObject<string> {
  static from(raw: string): MasterPrivateKey {
    return new MasterPrivateKey(raw);
  }
}

/**
 * Implementa el puerto que `wallets` definió componiendo el transporte (`TatumHttpClient`) y el
 * mapper puro (`tatum-asset.mapper`), y aportando lo único que ninguno de los dos conoce: la
 * master y su clave.
 *
 * `implements` y no `extends`: `useClass` funciona igual con las dos, pero `extends` quemaría el
 * único hueco de herencia y exigiría un `super()` vacío, y `implements` es lo ÚNICO que
 * comprueba la conformidad — `ClassProvider.provide` está tipado `any`, así que el archivo del
 * module no verifica nada.
 *
 * ⚠️ **La clave se lee en EXACTAMENTE DOS sitios de todo el módulo**, los dos de este archivo y
 * los dos construyendo el objeto que va directo a `fetch`: `send`, y `enableSending` **solo en su
 * rama `'master'`**. La rama `'tatum'` de la activación es la única operación del módulo que no
 * toca el secreto, porque su cuerpo (`ActivateGasPumpTatum`) no lo lleva — medido sobre
 * `docs/tatum/gas-pump/openapi.json`: su `required` es
 * `["chain","owner","from","to","feesCovered"]` y `fromPrivateKey` no está entre sus
 * `properties`. Ese objeto no se guarda, no se loguea y no se adjunta a ningún error. La
 * comprobación es greppable: `rg -n "masterPrivateKey\.value" src/modules/wallets` devuelve dos
 * líneas, las dos de aquí; si aparece una tercera, hay que justificarla o hay una fuga.
 *
 * ⚠️ **No medido:** la master viaja a las rutas en minúsculas, tal como la normaliza
 * `EthereumAddress`, mientras que los ejemplos de Tatum la muestran con checksum EIP-55 (su
 * `CreateGasPump.owner` trae `example: "0x2b5a0bE5940B63dE1eDdCCCa7bd977357e2488eD"`). No hay
 * API key en el repo para comprobar si el proveedor distingue; quien haga la prueba de humo
 * contra testnet es quien lo va a descubrir.
 */
@Injectable()
export class TatumCustodialAddressGateway implements CustodialAddressGateway {
  private readonly master: EthereumAddress;
  private readonly masterPrivateKey: MasterPrivateKey;
  private readonly activationPayer: WalletsConfig['activationPayer'];

  constructor(
    configService: ConfigService,
    private readonly client: TatumHttpClient,
  ) {
    const config = configService.getOrThrow<WalletsConfig>('wallets');
    this.master = EthereumAddress.from(config.masterAddress);
    this.masterPrivateKey = MasterPrivateKey.from(config.masterPrivateKey);
    this.activationPayer = config.activationPayer;
  }

  masterAddress(): EthereumAddress {
    return this.master;
  }

  /**
   * `from == to`: se pide UN índice, así que la respuesta tiene que traer UNA dirección. Y la
   * dirección derivada no puede ser la master: sería entregarle a un usuario el fondo de gas de
   * la plataforma, y al siguiente el mismo. El error lleva la dirección devuelta y sale **500** al
   * `ErrorReporter`, no 400 — así lo escribe la tabla §3.5 del spec, y lo hace cierto la fila
   * `[WalletAddressIsMasterError, internalServerError]` de `wallets-domain-exception.filter.ts`,
   * con su caso «debería traducir WalletAddressIsMasterError a 500». (Este paréntesis decía que
   * ese filtro «todavía no existe», con un `ls` como medición; el archivo aterrizó y la frase
   * habría quedado INVERTIDA —negando una protección que sí existe—, así que se corrige en vez de
   * borrarse.) Su cuerpo además sale saneado: el 500 publica `Internal server error` y la
   * dirección viaja solo en el `cause`.
   *
   * Los dos controles de este método están medidos por separado:
   *  · Borrando el `if` de la master: cae **un** caso, «debería rechazar con nombre una
   *    derivación que devuelve la propia master».
   *  · Sustituyendo el `EthereumAddress.from(config.masterAddress)` del constructor por un objeto
   *    que lleva el string de la configuración tal cual: caen **2** casos — ese mismo caso y
   *    «debería normalizar a minúsculas una master escrita con checksum EIP-55».
   *    ⚠️ **El primero de los dos NO cae por el casing**, y decirlo importa porque la explicación
   *    fácil es falsa: `ValueObject.equals` compara también `constructor`, así que un objeto plano
   *    nunca es igual a una `EthereumAddress` y el `if` deja de disparar por eso. Lo que el
   *    `from()` del constructor evita de verdad es el segundo caso — una master copiada de un
   *    explorador en EIP-55 viajaría en mayúsculas a la ruta del `GET`, a los cuerpos y a
   *    `Wallet.assertOwnedBy()`.
   */
  async deriveAddress(index: AddressIndex): Promise<EthereumAddress> {
    const body = await this.client.request({
      method: 'POST',
      path: '/v3/gas-pump',
      body: {
        chain: TATUM_CHAIN,
        owner: this.master.value,
        from: index.value,
        to: index.value,
      },
      retryable: true,
      badRequestBlame: 'our-configuration',
    });
    const address = readAddress(readSingleAddress(body));
    if (address.equals(this.master)) {
      throw new WalletAddressIsMasterError(address.value);
    }
    return address;
  }

  /**
   * No reintentable: un segundo intento es una segunda transacción y la comisión se paga dos
   * veces —en ETH o en créditos, según quién pague—.
   *
   * ⚠️ El cuerpo tiene DOS formas EXCLUYENTES, y lo decide `activationPayer`. Son las dos ramas
   * del `oneOf` de `POST /v3/gas-pump/activate` aplicables a ETH sin el gestor de claves del
   * proveedor:
   *
   * - `'tatum'` → esquema `ActivateGasPumpTatum`, con `feesCovered: true` y **sin
   *   `fromPrivateKey`**. La comisión sale de la cuota de créditos; en testnet es 1 crédito y no
   *   exige plan de pago. Es la ÚNICA operación de este módulo que no lee la clave privada, y
   *   añadírsela «por simetría» sería mandar el secreto a la red en la petición que no lo pide.
   * - `'master'` → esquema `ActivateGasPump`, con `fromPrivateKey` y **sin `feesCovered`**. El gas
   *   sale en ETH de la master.
   *
   * Lo que se rompería sin la rama: el default de la configuración es `'tatum'`, así que un
   * cuerpo fijo con `fromPrivateKey` pagaría en ETH contradiciendo lo configurado, y dejaría
   * falso el cálculo de coste de la entrada #4 del backlog —que acepta la ventana de la
   * activación duplicada porque en testnet cuesta 3 créditos y ningún ETH—.
   *
   * Los dos defectos que se pueden escribir aquí están medidos, cada uno con su mutante:
   *  · Cuerpo fijo con `fromPrivateKey` (la rama borrada): cae **un** caso, «debería activar
   *    con feesCovered y sin la clave privada cuando paga tatum».
   *  · Cuerpo con `feesCovered` **y** `fromPrivateKey` a la vez —el que saca el secreto a la red en
   *    la petición que no lo pide—: caen **2** casos, ese mismo y el de la rama `'master'`.
   *    Lo caza el `toEqual` del cuerpo COMPLETO; un `toMatchObject` lo habría dado por verde.
   *
   * Y el `retryable: false` también: poniéndolo a `true`, cae **un** caso, «debería intentar
   * la activación una sola vez, porque un reintento paga la comisión dos veces».
   */
  async enableSending(index: AddressIndex): Promise<TransactionHash> {
    const range = {
      chain: TATUM_CHAIN,
      owner: this.master.value,
      from: index.value,
      to: index.value,
    };
    const body = await this.client.request({
      method: 'POST',
      path: '/v3/gas-pump/activate',
      body:
        this.activationPayer === 'tatum'
          ? { ...range, feesCovered: true }
          : // Lectura 1 de 2 de la clave, y SOLO en esta rama. Va directa al cuerpo de `fetch` y
            // no se guarda en ningún sitio.
            { ...range, fromPrivateKey: this.masterPrivateKey.value },
      retryable: false,
      badRequestBlame: 'our-configuration',
    });
    return readTxId(body);
  }

  /** `GET` que no escribe en la cadena: reintentable, 1 crédito por intento. */
  async isSendingEnabled(index: AddressIndex): Promise<boolean> {
    const body = await this.client.request({
      method: 'GET',
      path: `/v3/gas-pump/activated/${TATUM_CHAIN}/${this.master.value}/${index.value}`,
      retryable: true,
      badRequestBlame: 'our-configuration',
    });
    return readActivated(body);
  }

  /**
   * El origen es `command.from` —la dirección de la WALLET—, nunca la master: la master FIRMA,
   * no envía. Los campos excluyentes del activo los pone el mapper, así que aquí no hay forma de
   * escribir un `amount` en un NFT.
   *
   * Medido con `custodialAddress: this.master.value` —enviar desde el fondo de gas de la
   * plataforma, el defecto caro—: caen **2** casos, los dos casos de `send()`. Y con
   * `retryable: true`: `1 failed`, «debería intentar la transferencia una sola vez, porque un
   * reintento mueve el dinero dos veces».
   */
  async send(command: SendCommand): Promise<TransactionHash> {
    const body = await this.client.request({
      method: 'POST',
      path: '/v3/blockchain/sc/custodial/transfer',
      body: {
        chain: TATUM_CHAIN,
        custodialAddress: command.from.value,
        recipient: command.recipient.value,
        ...mapAssetToTatumFields(command.asset),
        // Lectura 2 de 2 de la clave. Misma regla: directa al cuerpo, y nada más.
        fromPrivateKey: this.masterPrivateKey.value,
      },
      retryable: false,
      badRequestBlame: 'client-input',
    });
    return readTxId(body);
  }
}

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/**
 * Normalización 1 de 4: el esquema de la derivación declara `type: array` de `GasPumpAddress`
 * SIN cardinalidad —medido sobre `docs/tatum/gas-pump/openapi.json`, `paths['/v3/gas-pump'].post
 * .responses['200']`—, y con `noUncheckedIndexedAccess` el `[0]` es `string | undefined`. Se
 * exige exactamente uno porque se pidió un rango de uno; cero o dos es un 200 que no satisface el
 * esquema —el motivo `malformed-response` de la lista cerrada—, no entrada inválida del cliente,
 * y por eso sale 502 y va al APM.
 *
 * El `providerStatus` es `null` y no 200: el cliente devuelve el CUERPO de una respuesta que ya
 * dio por buena, así que aquí el status exacto no está disponible. Inventarlo sería un dato
 * falso en el log.
 *
 * El `only === undefined` no es una rama alcanzable —`isStringArray` ya garantiza que todos los
 * elementos son strings—: es lo que exige `noUncheckedIndexedAccess` para poder devolverlo.
 *
 * ⚠️ **La igualdad es `!== 1` y no `< 1`, y la diferencia está medida**: con `< 1` sale
 * cae **un** caso y el que cae es «debería exigir exactamente un elemento en la respuesta de
 * derivación». Lo que se colaría es la respuesta de MÁS —un rango mal pedido devolvería dos
 * direcciones y entregaríamos la primera—, no la vacía.
 */
const readSingleAddress = (body: unknown): string => {
  const addresses = isStringArray(body) ? body : [];
  const [only] = addresses;
  if (addresses.length !== 1 || only === undefined) {
    throw new WalletProviderUnreachableError('malformed-response', null);
  }
  return only;
};

/**
 * Normalización 2 de 4, y **la que el borrador de esta tarea no tenía**: una cadena que el
 * proveedor devuelve y `EthereumAddress` rechaza es un 200 que no satisface el esquema, igual que
 * la cardinalidad de arriba, y no una entrada inválida del cliente.
 *
 * **El fallo que evita, medido en la tabla §3.5 del spec:** sin este envoltorio,
 * `EthereumAddress.from('no-soy-una-direccion')` lanza `InvalidEthereumAddressError`, que está en
 * la fila «**400** por el fallback de `DomainExceptionFilter`». O sea: se publicaría como entrada
 * inválida del cliente un cuerpo que construimos nosotros enteros y que rompió el proveedor, y
 * —lo caro— se escondería del `ErrorReporter`, que solo ve 5xx.
 *
 * El `catch` sin filtrar por clase es EXACTO, no perezoso: `EthereumAddress.from` tiene un solo
 * `throw` en todo el archivo y es el de `InvalidEthereumAddressError` (medido:
 * `grep -c "throw" src/modules/wallets/domain/value-objects/ethereum-address.vo.ts` → 1). Filtrar
 * con un `instanceof` añadiría una rama de re-lanzado que ningún caso puede alcanzar.
 *
 * Medido volviendo al `EthereumAddress.from(readSingleAddress(body))` del borrador:
 * cae **un** caso, y el único que cae es «debería tratar una dirección derivada ilegible
 * como respuesta que no satisface el esquema».
 */
const readAddress = (raw: string): EthereumAddress => {
  try {
    return EthereumAddress.from(raw);
  } catch {
    throw new WalletProviderUnreachableError('malformed-response', null);
  }
};

/**
 * Normalización 3 de 4: el `txId` del proveedor viene SIN prefijo `0x` —medido en
 * `components/schemas/TransactionHash`: `txId` es `type: string`, sin `pattern`, con
 * `example: "c83f8818db43d9ba4accfe454aa44fc33123d47a4f89d47b314d6748eb0e9bc9"`, 64 hexadecimales
 * pelados—, mientras que `TransactionHash` lo exige. Sin este prefijo, el camino feliz moriría en
 * un `InvalidTransactionHashError` CON EL GAS YA PAGADO.
 *
 * Un 200 sin `txId` —la respuesta de KMS trae `signatureId`, que este ciclo no usa— es un cuerpo
 * que no satisface el esquema: 502 con `malformed-response`, no un hash inventado.
 *
 * ⚠️ **Y el `TransactionHash.from` va DENTRO del mismo `catch`, que es la cuarta normalización y
 * tampoco estaba en el borrador.** El fallo que evita es peor que el de la dirección:
 * `InvalidTransactionHashError` **no** desciende de `WalletProviderError`, así que
 * `TransferAssetUseCase` lo dejaría caer por su rama `else` —la que propaga sin anotar— y la fila
 * del libro se quedaría en `submitting` sin `reason_code`, con el dinero ya movido. Traducido a
 * `malformed-response`, esa misma fila acaba en `markUnknown('malformed-response')`, que es
 * exactamente lo que sabemos. El `catch` vuelve a ser exacto por la misma medición:
 * `grep -c "throw" …/transaction-hash.vo.ts` → 1.
 *
 * Los dos trozos están medidos por separado, cada uno con un mutante propio:
 *  · Quitando el prefijo (`const prefixed = body.txId;`): `5 failed`, y son los cinco casos que
 *    leen un hash o un cuerpo de activación/transferencia — el prefijo lo tocan TODOS.
 *  · Prefijando siempre (`` `0x${body.txId}` `` sin el `startsWith`): `1 failed`, «debería dejar
 *    intacto un txId que ya llegara con el prefijo en vez de duplicarlo».
 *  · Quitando el `try/catch`: `1 failed`, «debería tratar un txId ilegible como respuesta que no
 *    satisface el esquema».
 */
const readTxId = (body: unknown): TransactionHash => {
  if (
    typeof body === 'object' &&
    body !== null &&
    'txId' in body &&
    typeof body.txId === 'string'
  ) {
    const prefixed = body.txId.startsWith('0x') ? body.txId : `0x${body.txId}`;
    try {
      return TransactionHash.from(prefixed);
    } catch {
      throw new WalletProviderUnreachableError('malformed-response', null);
    }
  }
  throw new WalletProviderUnreachableError('malformed-response', null);
};

/**
 * La última normalización: el esquema `Activated` NO declara `required` —medido sobre
 * `docs/tatum/gas-pump/openapi.json`: `components.schemas.Activated` solo tiene
 * `properties.activated`, y no hay array `required`—, así que `{}` es un 200 válido. Las dos
 * lecturas por defecto son destructivas y el estado es monótono: leerlo como `false` quema gas
 * activando una dirección quizá ya activa, y leerlo como `true` cura a un estado del que no se
 * retrocede. La ausencia no es un booleano: es un cuerpo que no satisface el esquema.
 *
 * Medido sustituyendo el cuerpo por el `return body?.activated === true` que lee la ausencia como
 * `false`: caen **2** casos, y caen «debería tratar un activated ausente como respuesta que no
 * satisface el esquema y no como false» y «debería tratar un activated que no es booleano…».
 */
const readActivated = (body: unknown): boolean => {
  if (
    typeof body === 'object' &&
    body !== null &&
    'activated' in body &&
    typeof body.activated === 'boolean'
  ) {
    return body.activated;
  }
  throw new WalletProviderUnreachableError('malformed-response', null);
};
