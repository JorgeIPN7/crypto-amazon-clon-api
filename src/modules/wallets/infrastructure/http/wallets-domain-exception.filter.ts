import {
  BadGatewayException,
  BadRequestException,
  Catch,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import {
  DomainExceptionFilter,
  type DomainErrorMapping,
} from '@common/http/domain-exception.filter';

import {
  AddressIndexAlreadyUsedError,
  AdminUsesMasterAddressError,
  InvalidAddressIndexError,
  InvalidEthereumAddressError,
  InvalidTransactionHashError,
  InvalidTransferIdError,
  InvalidWalletIdError,
  WalletActivationInProgressError,
  WalletAddressAlreadyUsedError,
  WalletAddressIsMasterError,
  WalletAlreadyActivatedError,
  WalletAssignmentLostError,
  WalletDomainError,
  WalletNotActivatedError,
  WalletNotFoundError,
  WalletOwnerGoneError,
  WalletOwnerMismatchError,
  WalletProviderRejectedError,
  WalletProviderUnavailableError,
  WalletProviderUnreachableError,
} from '../../domain/errors/wallet.errors';

/**
 * Cuerpo del 500, idéntico al que emite la rama saneada de `AllExceptionsFilter` y al que
 * publica `buildErrorExample(500, …)`. `description` es lo que Nest escribe en `body.error`, y
 * tiene que ser `InternalServerError` —el valor de `NON_CANONICAL_ERRORS`— y no el canónico HTTP
 * `Internal Server Error`, o el cuerpo real dejaría de coincidir con el documentado. Medido
 * construyendo la excepción en Node: `getResponse()` devuelve
 * `{"message":"Internal server error","error":"InternalServerError","statusCode":500}`.
 *
 * ⚠️ **El fallo que evita: el saneado lo hace ESTE archivo, no el filtro global.** La rama
 * `hidesErrorDetails` de `AllExceptionsFilter` está dentro de su `if (exception instanceof
 * Error)`, y la de `HttpException` va ANTES y devuelve el cuerpo tal cual. O sea que lo que
 * salga de aquí ya es la respuesta final: con `new InternalServerErrorException(error.message)`,
 * los nueve errores de esta familia publicarían direcciones e índices internos —`Address 0x… is
 * the master address`— en producción incluida. El detalle viaja en `cause`, que es lo único que
 * el logger ve.
 */
const internalServerError = (cause: WalletDomainError): InternalServerErrorException =>
  new InternalServerErrorException('Internal server error', {
    description: 'InternalServerError',
    cause,
  });

/** Mensaje fijo del 502. Un timeout NO es «no se ejecutó»: el resultado queda desconocido. */
const PROVIDER_UNREACHABLE =
  'The custodial provider did not answer; the result of the operation is unknown';

/** Mensaje fijo del 503. La causa es siempre nuestra: clave, plan o configuración. */
const PROVIDER_UNAVAILABLE = 'The custodial provider integration is unavailable';

/**
 * Traduce los errores del dominio de `wallets` al protocolo HTTP. El recorrido del mapa lo pone
 * `DomainExceptionFilter`; aquí solo la tabla de este contexto.
 *
 * **Todas las excepciones se construyen con un STRING** —o con string más opciones, como el 500—,
 * nunca con un objeto: así Nest rellena `body.error` con el nombre canónico del status, que es lo
 * que `buildErrorExample` deriva, y el nombre de la clase de dominio no llega jamás al cliente.
 * Además, `AllExceptionsFilter` copia a `details` las claves conocidas del cuerpo de una
 * `HttpException`: con un objeto, cualquier campo que alguien añadiera ahí saldría publicado.
 *
 * ⚠️ **El orden importa: gana el PRIMER `instanceof` que coincide.** Las tres clases de proveedor
 * comparten el padre abstracto `WalletProviderError`, que NO se mapea: mapearlo se comería a las
 * tres si alguien lo pusiera por delante.
 *
 * ⚠️ **Los cuatro `Invalid*` de identidad, índice y hash salen como 500, no como 400.** No son
 * alcanzables desde ninguna entrada del cliente: los cinco endpoints son «lo mío» y nadie pasa un
 * id de wallet, un índice ni un hash de transacción por la API. Si se disparan es corrupción de la
 * fila o agotamiento de la secuencia, y publicarlos como «entrada inválida» los escondería del
 * `ErrorReporter`, que solo ve 5xx — que es exactamente la información que hace falta cuando eso
 * pasa.
 *
 * ⚠️ `InvalidTransactionHashError` es el cuarto y **no estaba en la tabla del plan**, ni entre los
 * mapeados ni entre los del fallback: se añade porque el contrato congelado §3 lo pone en ese
 * grupo y el árbol lo confirma. Los tres `TransactionHash.from` de producción son
 * `tatum-custodial-address.gateway.ts` —que ya lo traduce a `malformed-response` dentro de su
 * propio `catch`, así que desde ahí no llega— y los dos mappers de fila. O sea que la única vía
 * por la que alcanza este filtro es una fila corrupta.
 *
 * ⚠️ **El fallback publica `exception.message` en TODOS los entornos**, no solo fuera de
 * producción: lo construye `new BadRequestException(exception.message)` en `DomainExceptionFilter`
 * y ese cuerpo ya es una `HttpException`, así que la rama saneada de `AllExceptionsFilter` —la que
 * solo pisa los `Error` no-HTTP— no lo toca. Por eso ningún error del proveedor cae en el
 * fallback: los tres se mapean explícitamente y ninguno de los tres mensajes interpola nada que
 * venga de fuera.
 *
 * **Los seis que caen en el fallback 400 a propósito**, porque son entrada del cliente que el
 * dominio rechaza y sus mensajes solo repiten el valor que el cliente escribió:
 * `InvalidEthereumAddressError`, `InvalidTokenAmountError`, `InvalidTokenIdError`,
 * `MissingAssetFieldError`, `AssetFieldNotAllowedError` y `UnknownAssetKindError`. Los tres
 * últimos son la contrapartida directa de `@ValidateIf` en `transfer-from-wallet.dto.ts`: el
 * transporte valida forma y deja pasar combinaciones que `TransferAsset.fromParts` rechaza con
 * nombre.
 *
 * ⚠️ **Y ahí está el hueco de este filtro, que se escribe en vez de disimularse: esas MISMAS
 * clases significan un 500 cuando no vienen del cuerpo del cliente sino de una FILA.**
 * `WalletTransferMapper.toDomain` rearma el activo con `TransferAsset.fromParts` desde cuatro
 * columnas, así que una fila incoherente —una escritura por SQL crudo, una migración a medias—
 * lanza `UnknownAssetKindError`, `MissingAssetFieldError` o `AssetFieldNotAllowedError` al LEER.
 * Culpar al cliente con un 400 de una fila que escribimos nosotros es mentir, y además la
 * esconde del `ErrorReporter`, que solo mira 5xx. **Este mapa no puede distinguirlas**: la clase
 * es la misma y no lleva ningún dato del origen; separarlas por clase exigiría un error nuevo,
 * y `WalletDomainError` tiene su lista cerrada.
 *
 * Donde SÍ se distingue es en el endpoint, porque el origen es distinto por endpoint: en
 * `GET /wallets/me/transfers` no hay ni un campo de activo en la entrada, así que cualquier error
 * de esta familia que salga de ahí es nuestro y debe llegar a `AllExceptionsFilter` sin pasar por
 * este filtro —que es lo que ocurre cuando el handler no lo declara—. Quien decide eso es
 * `wallets.controller.ts`, y esta nota existe para que esa decisión sea consciente y no un
 * descuido.
 */
@Catch(WalletDomainError)
export class WalletsDomainExceptionFilter extends DomainExceptionFilter<WalletDomainError> {
  protected readonly mappings: DomainErrorMapping<WalletDomainError> = [
    [WalletNotFoundError, (error) => new NotFoundException(error.message)],
    [WalletNotActivatedError, (error) => new ConflictException(error.message)],
    [WalletActivationInProgressError, (error) => new ConflictException(error.message)],
    [WalletAlreadyActivatedError, (error) => new ConflictException(error.message)],
    /**
     * El 409 del rol admin. Lo lanzan `AssignWalletUseCase`, `ActivateWalletUseCase` y
     * `TransferAssetUseCase` a partir del `ownerRole` de su entrada: la regla no es «este usuario
     * no puede», es «el sistema tiene UNA sola EOA y ya es suya», así que vive donde está la
     * invariante y no en el controlador.
     */
    [AdminUsesMasterAddressError, (error) => new ConflictException(error.message)],
    // String constante, como `CustomerGoneError` en `orders`: si el dueño fue borrado o
    // desactivado es información interna, y para el caller significa lo mismo.
    [WalletOwnerGoneError, () => new ForbiddenException('Forbidden')],
    // ⚠️ `InvalidEthereumAddressError` está aquí y no en el fallback 400, aunque el 400 sea lo
    // natural para una dirección mal escrita del CUERPO: quien la valida ahí es el DTO, que corta
    // antes. Lo único que puede hacerla llegar hasta aquí es `WalletMapper.toDomain`, que la lanza
    // en dos líneas del camino de LECTURA —`EthereumAddress.from(row.ownerAddress)` y
    // `…(row.address)`—, y una fila corrupta es un defecto NUESTRO: culpar al cliente con un 400
    // sería mentirle y además esconder el incidente del `ErrorReporter`, que solo ve 5xx.
    [InvalidEthereumAddressError, internalServerError],
    [InvalidWalletIdError, internalServerError],
    [InvalidTransferIdError, internalServerError],
    [InvalidTransactionHashError, internalServerError],
    [InvalidAddressIndexError, internalServerError],
    [AddressIndexAlreadyUsedError, internalServerError],
    [WalletAddressAlreadyUsedError, internalServerError],
    [WalletOwnerMismatchError, internalServerError],
    [WalletAddressIsMasterError, internalServerError],
    [WalletAssignmentLostError, internalServerError],
    /**
     * El único 400 que viene del proveedor, y solo en la transferencia: es el único endpoint con
     * entrada del cliente a la que culpar. `POST /wallets` y `POST /wallets/me/activation`
     * construimos su cuerpo enteros, así que un 400 ahí llega como `misconfigured` y sale 503.
     *
     * ⚠️ `error.message` se publica, y eso solo es seguro porque el mensaje de esa clase es FIJO
     * —`'The wallet provider rejected the transfer request'`, sin una sola interpolación— y su
     * `reason` sale de `PROVIDER_FAILURE_REASONS`, una lista cerrada nuestra. El `message` del
     * proveedor NUNCA: el de su 401 interpola la API key
     * (`"Unable to find valid subscription for '${apiKey}'"`, leído en
     * `docs/tatum/gas-pump/openapi.json`). Si alguien cambia esa clase para copiar el texto del
     * proveedor, este es el punto exacto por el que el secreto sale al cliente.
     */
    [WalletProviderRejectedError, (error) => new BadRequestException(error.message)],
    /**
     * ⚠️ 502 y 503 sin `cause` y con mensaje FIJO, y las dos cosas por lo mismo: la causa real es
     * un error del TRANSPORTE, y `pino-std-serializers` concatena mensajes y stacks de las causas.
     * La medición completa de ese fallo no se repite aquí: vive en el JSDoc de
     * `tatum-http.client.ts`, que la hizo contra el `fetch` real de Node 24.19.0 y encontró el
     * host del proveedor TRES veces dentro de la `cause` de un `TypeError: fetch failed`. Este
     * archivo es el otro extremo de la misma invariante: si el adaptador guardase el error de red
     * y este filtro lo encadenase, el cuerpo de la transferencia —con la clave privada de la
     * master dentro— llegaría al log por esta línea. El diagnóstico lo da el adaptador, que ya
     * escribió el código de motivo sin el cuerpo.
     */
    [WalletProviderUnreachableError, () => new BadGatewayException(PROVIDER_UNREACHABLE)],
    [WalletProviderUnavailableError, () => new ServiceUnavailableException(PROVIDER_UNAVAILABLE)],
  ];
}
