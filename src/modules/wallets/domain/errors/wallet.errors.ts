import { DomainError } from '@shared/domain/domain-error.base';

import type { WalletStatus } from '../wallet-status';

/**
 * Errores de dominio de `wallets`: de negocio, no de transporte. Traducirlos a HTTP es tarea de
 * `infrastructure/http/wallets-domain-exception.filter.ts` — mismo contrato que `user.errors.ts`,
 * `auth.errors.ts` y `order.errors.ts`. El cuerpo compartido (constructor y `new.target.name`)
 * está en `DomainError`; lo que este marcador aporta es la IDENTIDAD del contexto, que es lo que
 * `@Catch(WalletDomainError)` discrimina.
 *
 * ⚠️ El fallback del filtro es **400**. Todo error de este archivo que no sea una entrada inválida
 * del cliente necesita su fila EXPLÍCITA en el mapa del filtro (spec §3.5): sin ella un 502 se
 * publicaría como «entrada inválida» y —lo caro— se escondería del `ErrorReporter`, que solo ve
 * 5xx. Es la razón por la que los cuatro `Invalid*Error` inalcanzables desde la API —los de id de wallet,
 * id de transferencia, índice y hash de transacción— salen como 500 y no como 400.
 *
 * ⚠️ **`WalletAlreadyAssignedError` no existe.** El `23505` de `idx_wallets_user_id` es una
 * carrera normal entre dos altas, y el adaptador lo traduce al desenlace `'owner-conflict'` de
 * `WalletRepository.save()`, que el caso de uso resuelve releyendo. No hay ningún camino por el
 * que ese error llegue a HTTP, así que la clase no se escribe: añadirla sería reintroducir una
 * excepción para un caso que ya tiene respuesta.
 */
export abstract class WalletDomainError extends DomainError {}

/**
 * Lista CERRADA de motivos de fallo del proveedor. Es un código NUESTRO, jamás el `message` de
 * Tatum: el del 401 interpola la clave de API —`"Unable to find valid subscription for
 * '${apiKey}'"`, medido en `docs/tatum/gas-pump/openapi.json`— y ese valor acabaría en una tabla
 * que además se publica por `GET /wallets/me/transfers`.
 *
 * ⚠️ **Es la única lista del módulo.** `WalletTransfer` guarda exactamente este mismo código en
 * sus estados `rejected` y `unknown` (spec §3.2) y la columna se llama `reason_code`: no hay un
 * `TransferFailureReason` aparte, porque es la misma información vista desde otro sitio.
 *
 * ⚠️ **`chain-reverted` es el primer motivo que sale de LEER el cuerpo del error del proveedor, y
 * de ese cuerpo se lee `errorCode` y nada más.** Es un identificador corto y enumerable
 * —`sc.operation.failed`, `subscription.invalid`, `validation.failed`— que no interpola nada;
 * `message` y `cause` no se leen ni siquiera para clasificar. La medición de por qué esa distinción
 * es la línea entre clasificar y filtrar un secreto vive en `tatum-http.client.ts`, que es el único
 * archivo que toca ese cuerpo.
 */
export const PROVIDER_FAILURE_REASONS = [
  'body-rejected', // 400 del proveedor en la TRANSFERENCIA (culpa del cliente)
  'misconfigured', // 400 del proveedor al derivar o activar (culpa nuestra)
  'unauthorized', // 401
  'forbidden', // 403 SIN `errorCode: "sc.operation.failed"`: permisos de NUESTRA clave
  'chain-reverted', // 403 CON ese `errorCode`: la cadena revirtió y no se minó nada
  'undocumented-4xx', // 404, 429, 402, 409… nada de esto está en su contrato
  'upstream-error', // 5xx
  'unreachable', // DNS / TCP / TLS
  'timeout',
  'malformed-response', // cuerpo no-JSON, o 200 que no satisface el esquema
] as const;
export type ProviderFailureReason = (typeof PROVIDER_FAILURE_REASONS)[number];

export class InvalidWalletIdError extends WalletDomainError {
  constructor(readonly value: string) {
    super(`"${value}" is not a valid wallet id`);
  }
}

export class InvalidTransferIdError extends WalletDomainError {
  constructor(readonly value: string) {
    super(`"${value}" is not a valid transfer id`);
  }
}

export class InvalidEthereumAddressError extends WalletDomainError {
  constructor(readonly value: string) {
    super(`"${value}" is not a valid Ethereum address`);
  }
}

export class InvalidAddressIndexError extends WalletDomainError {
  constructor(readonly value: number) {
    super(`${value} is not a valid address index`);
  }
}

export class InvalidTokenAmountError extends WalletDomainError {
  constructor(readonly value: string) {
    super(`"${value}" is not a valid token amount`);
  }
}

export class InvalidTokenIdError extends WalletDomainError {
  constructor(readonly value: string) {
    super(`"${value}" is not a valid token id`);
  }
}

export class InvalidTransactionHashError extends WalletDomainError {
  constructor(readonly value: string) {
    super(`"${value}" is not a valid transaction hash`);
  }
}

/**
 * ⚠️ **Recibe el CAMPO primero y la CLASE después, y el mensaje los nombra al revés.** Los dos
 * parámetros son `string`, así que invertir la llamada compila y publica «Asset of kind "amount"
 * requires the field "fungible"» — literalmente al revés, y ningún tipo lo caza. El caso E8 lo
 * fija, y `TransferAsset.requiredField` (`transfer-asset.ts:260`) es el único sitio de `src/`
 * fuera de los tests que lo construye. La medición y el mutante que lo demuestran viven en el
 * JSDoc de ese helper, que es donde la inversión puede colarse.
 */
export class MissingAssetFieldError extends WalletDomainError {
  constructor(
    readonly field: string,
    readonly kind: string,
  ) {
    super(`Asset of kind "${kind}" requires the field "${field}"`);
  }
}

/** Mismo orden invertido que `MissingAssetFieldError`, y por la misma razón. Caso E9. */
export class AssetFieldNotAllowedError extends WalletDomainError {
  constructor(
    readonly field: string,
    readonly kind: string,
  ) {
    super(`Asset of kind "${kind}" does not accept the field "${field}"`);
  }
}

export class UnknownAssetKindError extends WalletDomainError {
  constructor(readonly kind: string) {
    super(`"${kind}" is not a known asset kind`);
  }
}

export class WalletNotFoundError extends WalletDomainError {
  constructor(readonly ownerId: string) {
    super(`Wallet for owner ${ownerId} was not found`);
  }
}

/**
 * Lleva el ESTADO, no el id de la wallet. El id no le sirve de nada al cliente —los cinco
 * endpoints son «lo mío» y nunca lo ve—, mientras que el estado le dice si le toca activar
 * (`receive-only`) o esperar a que termine la activación en curso (`activating`).
 */
export class WalletNotActivatedError extends WalletDomainError {
  constructor(readonly status: WalletStatus) {
    super(`Wallet cannot send funds yet: its status is "${status}"`);
  }
}

/** Sin argumentos: el cliente solo tiene una wallet y ya sabe cuál. Nada variable que contar. */
export class WalletActivationInProgressError extends WalletDomainError {
  constructor() {
    super('Wallet already has an activation in progress');
  }
}

/** Sin argumentos, por lo mismo que `WalletActivationInProgressError`. */
export class WalletAlreadyActivatedError extends WalletDomainError {
  constructor() {
    super('Wallet is already activated');
  }
}

export class WalletOwnerGoneError extends WalletDomainError {
  constructor(readonly ownerId: string) {
    // El mensaje es interno: el filter publica el 403 canónico, nunca esta cadena. Mismo
    // contrato que `CustomerGoneError` de `orders`.
    super(`Owner ${ownerId} no longer exists or is inactive`);
  }
}

/**
 * El admin ya opera la master, así que darle una dirección derivada crearía una SEGUNDA EOA en el
 * sistema — justo la invariante de §3.1.1. Sin argumentos: el rol es la explicación entera.
 */
export class AdminUsesMasterAddressError extends WalletDomainError {
  constructor() {
    super('The admin operates the master address and has no gas pump wallet');
  }
}

export class AddressIndexAlreadyUsedError extends WalletDomainError {
  constructor(readonly index: number) {
    super(`Address index ${index} is already assigned to another wallet`);
  }
}

export class WalletAddressAlreadyUsedError extends WalletDomainError {
  constructor(readonly address: string) {
    super(`Address ${address} is already assigned to another wallet`);
  }
}

export class WalletOwnerMismatchError extends WalletDomainError {
  constructor(
    readonly walletOwnerAddress: string,
    readonly configuredMaster: string,
  ) {
    super(`Wallet was derived under master ${walletOwnerAddress}, not under ${configuredMaster}`);
  }
}

export class WalletAddressIsMasterError extends WalletDomainError {
  constructor(readonly address: string) {
    super(`Address ${address} is the master address and cannot be handed to a user`);
  }
}

export class WalletAssignmentLostError extends WalletDomainError {
  constructor(readonly ownerId: string) {
    super(`Wallet assignment for owner ${ownerId} vanished between the conflict and the re-read`);
  }
}

/**
 * Padre de los CUATRO errores del proveedor. Existe por dos motivos, y el primero es de compilación:
 * es donde `reason` y `providerStatus` se declaran UNA vez en lugar de cuatro. El segundo es el caso
 * de uso de la transferencia, que captura la familia entera para leer `error.reason` y pasárselo a
 * `markRejected`/`markUnknown` (spec §5.3); sin el padre enumeraría las clases y se quedaría
 * desactualizado al añadir una, en verde y sin que nada lo dijera.
 *
 * ⚠️ **Y ese futuro ya ocurrió, así que la advertencia deja de ser hipotética: la cuarta clase es
 * `WalletProviderRevertedError` (2026-09-02).** Lo que el padre salvó fue la lectura de
 * `error.reason`; lo que NO puede salvar es la elección de desenlace, porque una clase nueva no
 * puede saber si su fallo tocó la cadena. Por eso el `catch` del caso de uso enumera hoy las DOS
 * clases que significan «no pasó nada en la cadena» en vez de una — y por eso ese punto lleva su
 * propio caso.
 *
 * ⚠️ **El filtro NO debe tratarlas como familia, y meterlo aquí sería el peor consejo posible.**
 * `DomainExceptionFilter.catch()` gana con el PRIMER `instanceof` que coincide y `DomainErrorMapping`
 * acepta clases abstractas, así que una fila `[WalletProviderError, …]` compilaría y colapsaría en
 * silencio los cuatro status que el contrato publica por separado: 400 para `Rejected`, 409 para
 * `Reverted`, 502 para `Unreachable` y 503 para `Unavailable` (spec §3.5). El filtro las enumera de
 * una en una.
 *
 * Aquí viven los dos únicos campos que un error del proveedor puede transportar: el código
 * NUESTRO y el status. `providerStatus` es nullable porque los casos normalizados del §6.2 —un
 * `activated` ausente, un array de derivación con cardinalidad distinta de uno, un timeout— no
 * tienen status que citar.
 *
 * ⚠️ Los mensajes de los cuatro hijos son **FIJOS** y no interpolan nada. Es lo que impide que la
 * clave privada de la master, que viaja en el cuerpo de la transferencia, entre en un error:
 * `pino-std-serializers` recorre toda propiedad enumerable del error y la escribe. La propiedad
 * P2 lo fija, y de paso prohíbe escribir «is unreachable» en el 502 — ese literal contiene el
 * motivo `'unreachable'` de la lista.
 */
export abstract class WalletProviderError extends WalletDomainError {
  protected constructor(
    message: string,
    readonly reason: ProviderFailureReason,
    readonly providerStatus: number | null,
  ) {
    super(message);
  }
}

/**
 * El proveedor rechazó NUESTRO cuerpo con un 400, y solo puede pasar en la transferencia: es la
 * única de las tres llamadas que lleva entrada del cliente a la que culpar (spec §7.2) ⇒ 400.
 */
export class WalletProviderRejectedError extends WalletProviderError {
  constructor(reason: ProviderFailureReason, providerStatus: number | null) {
    super('The wallet provider rejected the transfer request', reason, providerStatus);
  }
}

/**
 * La cadena revirtió la operación ⇒ **409**. Es el 403 del proveedor cuyo cuerpo trae
 * `errorCode: "sc.operation.failed"`, y son dos afirmaciones distintas las que justifican los dos
 * cambios respecto de `WalletProviderUnavailableError`, que es donde caía antes:
 *
 * - **No es una caída de la integración.** El proveedor contestó, y contestó bien; lo que no se
 *   puede es ejecutar la operación con el estado actual de la wallet. Un 503 le dice al cliente
 *   «reintenta más tarde» y reintentará para siempre, porque el tiempo no cambia ese estado. El 409
 *   es el mismo status con el que este contexto publica los otros conflictos de estado
 *   —activación en curso, ya activada, el admin—, y el cliente SÍ puede actuar.
 * - **Se sabe que no se minó nada**, así que la fila del libro va a `rejected` y no a `unknown`.
 *   El razonamiento, escrito entero para que se pueda discutir: el proveedor responde un ERROR sin
 *   `txId`, y `execution reverted` es lo que devuelve un nodo cuando falla la simulación
 *   (`eth_call` / `eth_estimateGas`), o sea antes de firmar y difundir nada.
 *   ⚠️ **No comprobado en un explorador de bloques**: nadie ha verificado el nonce de la master tras
 *   una reversión. Si algún día se viera que el proveedor SÍ difunde y la transacción revierte en
 *   cadena —gastando gas y dejando hash—, el desenlace correcto volvería a ser `unknown`.
 *
 * ⚠️ **El nombre dice «la cadena revirtió», NUNCA «no hay saldo».** Ese `errorCode` cubre cualquier
 * reversión del contrato y el proveedor no lo desglosa: afirmar que siempre es falta de fondos sería
 * una afirmación que no se puede medir. Lo único cierto de todas ellas es que la operación revirtió.
 * La única reversión observada de verdad —2026-09-02, contra Sepolia, transferencia de 0.001 ETH
 * desde una gas pump address sin saldo— llegó con `cause: "Returned error: execution reverted:
 * Address: insufficient balance"`, y ese texto **no se lee, no se guarda y no viaja**: de todo el
 * cuerpo de un error solo se lee `errorCode` (ver `tatum-http.client.ts`).
 */
export class WalletProviderRevertedError extends WalletProviderError {
  constructor(reason: ProviderFailureReason, providerStatus: number | null) {
    super('The blockchain reverted the transfer', reason, providerStatus);
  }
}

/** Proveedor caído o contrato roto ⇒ 502. */
export class WalletProviderUnreachableError extends WalletProviderError {
  constructor(reason: ProviderFailureReason, providerStatus: number | null) {
    super(
      'The wallet provider could not be reached or broke its published contract',
      reason,
      providerStatus,
    );
  }
}

/**
 * Configuración NUESTRA rota (400 en derivar o activar, 401, el 403 que NO es una reversión de la
 * cadena, cualquier otro 4xx no documentado) ⇒ 503. Son dos clases y no una porque el filtro mapea
 * clase → excepción HTTP: una sola no puede rendir 502 y 503 a la vez.
 */
export class WalletProviderUnavailableError extends WalletProviderError {
  constructor(reason: ProviderFailureReason, providerStatus: number | null) {
    super('The wallet provider integration is unavailable', reason, providerStatus);
  }
}
