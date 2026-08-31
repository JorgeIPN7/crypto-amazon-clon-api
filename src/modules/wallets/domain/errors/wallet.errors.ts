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
 */
export const PROVIDER_FAILURE_REASONS = [
  'body-rejected', // 400 del proveedor en la TRANSFERENCIA (culpa del cliente)
  'misconfigured', // 400 del proveedor al derivar o activar (culpa nuestra)
  'unauthorized', // 401
  'forbidden', // 403
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
 * Padre de los tres errores del proveedor. Existe por dos motivos, y el primero es de compilación:
 * es donde `reason` y `providerStatus` se declaran UNA vez en lugar de tres. El segundo es el caso
 * de uso de la transferencia, que captura la familia entera para leer `error.reason` y pasárselo a
 * `markRejected`/`markUnknown` (spec §5.3); sin el padre enumeraría las tres clases y se quedaría
 * desactualizado al añadir la cuarta, en verde y sin que nada lo dijera.
 *
 * ⚠️ **El filtro NO debe tratarlas como familia, y meterlo aquí sería el peor consejo posible.**
 * `DomainExceptionFilter.catch()` gana con el PRIMER `instanceof` que coincide y `DomainErrorMapping`
 * acepta clases abstractas, así que una fila `[WalletProviderError, …]` compilaría y colapsaría en
 * silencio los tres status que el contrato publica por separado: 400 para `Rejected`, 502 para
 * `Unreachable` y 503 para `Unavailable` (spec §3.5). El filtro las enumera de una en una.
 *
 * Aquí viven los dos únicos campos que un error del proveedor puede transportar: el código
 * NUESTRO y el status. `providerStatus` es nullable porque los casos normalizados del §6.2 —un
 * `activated` ausente, un array de derivación con cardinalidad distinta de uno, un timeout— no
 * tienen status que citar.
 *
 * ⚠️ Los mensajes de los tres hijos son **FIJOS** y no interpolan nada. Es lo que impide que la
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
 * Configuración NUESTRA rota (400 en derivar o activar, 401, 403, cualquier otro 4xx no
 * documentado) ⇒ 503. Son dos clases y no una porque el filtro mapea clase → excepción HTTP: una
 * sola no puede rendir 502 y 503 a la vez.
 */
export class WalletProviderUnavailableError extends WalletProviderError {
  constructor(reason: ProviderFailureReason, providerStatus: number | null) {
    super('The wallet provider integration is unavailable', reason, providerStatus);
  }
}
