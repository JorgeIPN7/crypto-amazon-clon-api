import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { WalletsConfig } from '@config/wallets.config';

import {
  WalletProviderError,
  WalletProviderRejectedError,
  WalletProviderRevertedError,
  WalletProviderUnavailableError,
  WalletProviderUnreachableError,
  type ProviderFailureReason,
} from '../../domain/errors/wallet.errors';

/**
 * La rendija de `fetch` que este cliente usa, y nada más. Se inyecta por constructor para que
 * el test pueda darle un doble sin `jest.mock`, y para que este archivo no dependa de un global
 * que en un test no se puede sustituir sin tocar `globalThis`.
 */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * A quién se culpa cuando el proveedor rechaza la llamada. NO tiene default a propósito, igual que
 * `retryable`: el mismo status significa cosas distintas según el endpoint (§7.2) —en el alta de la
 * wallet y en la activación el cuerpo lo construimos NOSOTROS enteros, así que su rechazo es
 * configuración rota nuestra y sale 503; solo la transferencia lleva entrada del cliente y activos
 * del cliente a los que culpar— y un default habría hecho que la operación nueva heredara una
 * decisión en silencio.
 *
 * ⚠️ **Se llamaba `BadRequestBlame` y gobernaba solo el 400; desde el 2026-09-02 gobierna también
 * el 403 de reversión, y por eso el nombre perdió el `BadRequest`.** El motivo de que sea el mismo
 * campo y no uno nuevo: la pregunta es la misma, «¿puede el cliente hacer algo con esto?». Una
 * reversión de la cadena en la transferencia la causa el estado de SU wallet y él puede actuar
 * ⇒ 409; una reversión activando la causaría el saldo de NUESTRA master ⇒ 503, y con 409 se
 * escondería del `ErrorReporter`, que solo ve 5xx, además de culpar al cliente de nuestro gas.
 */
export type ProviderFaultBlame = 'client-input' | 'our-configuration';

/**
 * `retryable` es OBLIGATORIO, no opcional con default. Las tres operaciones cuestan lo mismo en
 * créditos —`credits: 2` en las cabeceras de `docs/tatum/gas-pump/01`, `02` y `05`, leídas, no
 * recordadas—, así que lo que las separa es lo que hacen en la cadena:
 *
 *  · Derivar no la toca: «does not make any changes on the blockchain itself, just generates
 *    addresses… therefore, no gas fee is applied» (doc 01, cita literal). Reintentar solo gasta
 *    dos créditos más.
 *  · Activar sí: «activating a gas pump address costs some amount of gas on a blockchain»
 *    (doc 02, cita literal), y quién paga ese gas lo decide `activationPayer` —ETH de la master
 *    o la cuota de créditos—, documentado en `src/config/wallets.config.ts`.
 *  · Transferir mueve el dinero, y un reintento lo mueve dos veces.
 *
 * Un campo con default habría dejado que una operación nueva heredara la política de otra sin que
 * nadie lo decidiera.
 *
 * ⚠️ El argumento del primero es «no cuesta gas», NO «es determinista». Medido sobre los siete
 * documentos de `docs/tatum/gas-pump/` con
 * `grep -riE "determinis|idempot|same address"`: **cero coincidencias**. El proveedor no promete
 * en ningún sitio que derivar `(owner, índice)` devuelva siempre la misma dirección, y por eso la
 * fuente de verdad es la fila guardada y no una rederivación. Reintentar es seguro porque no
 * cuesta gas, no porque el resultado sea el mismo.
 */
export type TatumRequest = {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  retryable: boolean;
  blame: ProviderFaultBlame;
};

const ATTEMPTS_WHEN_RETRYABLE = 2;

/** El `fetch` de verdad, envuelto en la firma estrecha que este archivo declara. */
const globalFetch: FetchLike = (input, init) => fetch(input, init);

/**
 * Transporte contra Tatum: cabeceras, timeout, reintentos y traducción de errores. No conoce
 * el dominio de wallets ni la clave privada de la master: recibe un cuerpo ya construido, lo
 * serializa y lo entrega a `fetch`. Ese string es local, no se guarda, no se loguea y no se
 * adjunta a ningún error — que es la mitad transporte de la invariante de §7.1.
 *
 * ⚠️ **El fallo que evita, y está medido.** `pino-std-serializers` recorre el error con
 * `for (const key in err)` y escribe TODA propiedad enumerable; el filtro global publica
 * `exception.message` tal cual fuera de producción; y `Error.cause` arrastra el mensaje y el
 * stack de la causa. Guardar aquí el cuerpo, la petición o el error original como `cause`
 * bastaría para que la `fromPrivateKey` de la transferencia acabara en los logs. Medido con una
 * sonda temporal que ejecuta ese mismo bucle sobre el error de los CINCO caminos de fallo —4xx,
 * 5xx, cuerpo no-JSON, red y timeout— con una clave privada de 64 hex y una API key falsas en el
 * cuerpo y en la configuración: las claves enumerables son siempre exactamente
 * `["name", "reason", "providerStatus"]`, `cause` es `undefined`, y ni el volcado ni el `stack`
 * contienen la clave privada, la API key ni el host (`false` en las quince comprobaciones).
 *
 * ⚠️ **Desde el 2026-09-02 este archivo LEE el cuerpo de una respuesta de error, que es la
 * superficie que el párrafo de arriba mantiene cerrada por el otro lado.** Lo hace en un solo sitio
 * —`isChainRevert`— y con una firma que devuelve `boolean`, así que del cuerpo del proveedor no sale
 * ni una cadena hacia el resto del proceso. El escenario «la transferencia responde 403 con el
 * mensaje del 401 dentro» de `tatum-secret-surface.spec.ts` mide ese camino en las cuatro
 * superficies, línea real de pino incluida.
 *
 * Devuelve `unknown` y no un genérico `<T>`: un `<T>` sería un cast sin comprobar, y este
 * cliente no puede validar la forma de la respuesta de cada operación. Normalizarla es trabajo
 * del gateway (§6.2), y forzarlo a estrechar es lo que impide que un `{}` del proveedor entre
 * al dominio disfrazado de respuesta buena.
 *
 * Es `@Injectable` y lee su configuración del `ConfigService` porque `wallets.module.ts` lo
 * registra como provider de clase a secas: no está detrás de un puerto, así que no hay `provide`
 * ni `useFactory` que le pasara un objeto de opciones.
 *
 * ⚠️ `@Optional()` en el segundo parámetro NO es adorno: `emitDecoratorMetadata` escribe
 * `Function` como paramtype de `fetchImpl`, y sin él Nest busca un provider con ese token al
 * arrancar. **Medido** con una sonda temporal de `@nestjs/testing` que compila un módulo con
 * `[TatumHttpClient, ConfigService]` y nada más: con `@Optional()`, `compile()` sale bien y
 * `request()` acaba en `globalFetch` —falla por red contra un puerto cerrado, `unreachable`—;
 * quitándolo, `compile()` lanza, literalmente:
 *
 *     Nest can't resolve dependencies of the TatumHttpClient (ConfigService, ?). Please make
 *     sure that the argument at index [1] is available in the current module.
 *
 * La sonda no está en el árbol: es una comprobación de cableado, no un caso de la Tabla T23. Quien
 * la ejerce de verdad desde el 2026-08-31 es `src/modules/wallets/wallets.module.ts`, que declara
 * esta clase en `providers`, y el bloque «grafo de inyección» de
 * `src/modules/wallets/__tests__/wallets.module.e2e-spec.ts`, que compila el `AppModule` real y
 * resuelve cada token del contexto.
 */
@Injectable()
export class TatumHttpClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(configService: ConfigService, @Optional() fetchImpl?: FetchLike) {
    const config = configService.getOrThrow<WalletsConfig>('wallets');
    this.apiUrl = config.apiUrl;
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs;
    this.fetchImpl = fetchImpl ?? globalFetch;
  }

  /**
   * El bucle recorre los intentos MENOS UNO y el último va fuera: así el fallo del intento
   * final se propaga solo, sin guardar el error en una variable ni cerrar con un `throw
   * lastError ?? …` cuya rama derecha sería inalcanzable. Con `retryable: false` el cuerpo del
   * bucle no se ejecuta ni una vez.
   *
   * Solo se reintenta `WalletProviderUnreachableError` —5xx, red, timeout, cuerpo ilegible—.
   * Un 401 o un 403 no mejoran repitiéndolos: la clave está muerta, el permiso no está o la cadena
   * revirtió, y reintentar solo duplica el gasto de créditos. Lo fija el caso E5.
   *
   * ⚠️ **El timeout es el motivo por el que el reintento lo decide QUIEN LLAMA y no este bucle.**
   * Un timeout no significa «no se ejecutó»: significa que no sabemos si se ejecutó, y el
   * `WalletProviderUnreachableError` que sale de él es indistinguible del de un DNS que no
   * resolvió, donde sí sabemos que no. Con `retryable: true` esa ambigüedad es barata —derivar no
   * toca la cadena— y con `retryable: false` es la diferencia entre transferir una vez y
   * transferir dos. Por eso `retryable` no tiene default: quien añada una operación tiene que
   * mirar esta línea. El estado desconocido que queda del lado no reintentable es lo que el
   * dominio nombra `WalletTransfer.markUnknown`.
   */
  async request(request: TatumRequest): Promise<unknown> {
    const attempts = request.retryable ? ATTEMPTS_WHEN_RETRYABLE : 1;
    for (let attempt = 1; attempt < attempts; attempt += 1) {
      try {
        return await this.attempt(request);
      } catch (error) {
        if (!(error instanceof WalletProviderUnreachableError)) {
          throw error;
        }
      }
    }
    return this.attempt(request);
  }

  private async attempt(request: TatumRequest): Promise<unknown> {
    const response = await this.call(request);
    if (!response.ok) {
      throw await translateError(response, request.blame);
    }
    return parseJson(response);
  }

  /**
   * `AbortSignal.timeout` y no un `setTimeout` con `AbortController`: es nativo desde Node 17
   * y su temporizador va `unref`, así que no mantiene vivo el bucle de eventos cuando la
   * respuesta llega antes (medido con `node -e`: un script cuyo único pendiente es un
   * `AbortSignal.timeout(5)` termina ANTES de que el `abort` se dispare).
   *
   * ⚠️ El error que atrapa este `catch` NUNCA se adjunta como `cause`, y el fallo que eso evita
   * está medido. `pino-std-serializers` concatena mensajes y stacks de las causas, y la `cause`
   * de un `fetch` fallido lleva el destino dentro. Contra un dominio inexistente, el `fetch` real
   * de Node 24.19.0 rechaza con `TypeError: fetch failed` cuya `cause` es un `Error` con:
   *
   *     message: "getaddrinfo ENOTFOUND no-existe.invalid"
   *     propias enumerables: errno, code, syscall, hostname ("no-existe.invalid")
   *
   * Es decir, el host aparece TRES veces —mensaje, stack y `hostname`—, y cada una de ellas la
   * copiaría el serializador. Encadenarla sería publicar a qué proveedor llamamos y desde dónde;
   * el nuestro es un mensaje fijo y lo único que viaja es el código de motivo (§7.1).
   */
  private async call(request: TatumRequest): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.apiUrl}${request.path}`, {
        method: request.method,
        headers: this.buildHeaders(request),
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new WalletProviderUnreachableError(transportReason(error), null);
    }
  }

  private buildHeaders(request: TatumRequest): Record<string, string> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-api-key': this.apiKey,
    };
    if (request.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    return headers;
  }
}

/**
 * ⚠️ Se discrimina por `err.name` y NUNCA por `instanceof`, y no es estilo.
 *
 * `AbortSignal.timeout` rechaza con un `DOMException` cuyo `name` es **`TimeoutError`**, no
 * `AbortError` —ese es el de un `AbortController.abort()`—, así que un `instanceof
 * DOMException` no distingue los dos casos que aquí importan. Medido contra un `fetch` REAL a un
 * servidor que acepta la conexión y no contesta: `name === 'TimeoutError'`,
 * `constructor.name === 'DOMException'`; y con `new AbortController().abort()`,
 * `name === 'AbortError'`.
 *
 * Y el `instanceof` tampoco es fiable a secas: medido bajo `jest-environment-node`
 * (jest 30.4.1, Node 24.19.0), ese mismo `DOMException` da **`instanceof Error === false`**
 * porque el `Error` del realm del test no es el del host, mientras que ejecutado fuera de jest
 * da `true`. Una implementación apoyada en `instanceof` se comportaría distinto en la suite y en
 * producción.
 */
const errorName = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string'
    ? error.name
    : '';

const transportReason = (error: unknown): ProviderFailureReason =>
  errorName(error) === 'TimeoutError' ? 'timeout' : 'unreachable';

/**
 * El ÚNICO `errorCode` del proveedor que este módulo reconoce. Significa «la cadena rechazó la
 * operación», no «no hay saldo»: cubre cualquier reversión del contrato y el proveedor no la
 * desglosa. Lo cierto de todas ellas —y lo único que se afirma— es que la operación revirtió en la
 * simulación y **no se minó nada**, que es literalmente la definición de `rejected` en
 * `domain/transfer-status.ts`.
 *
 * ⚠️ **No está en el contrato publicado del proveedor, y eso hay que decirlo en vez de suponerlo.**
 * Medido sobre `docs/tatum/gas-pump/openapi.json`: la cadena `sc.operation.failed` no aparece
 * (`grep` sobre el archivo: cero), y el esquema de su `Error403` declara solo `message` y
 * `statusCode` — ni siquiera tiene `errorCode`. O sea que este literal sale de una respuesta REAL
 * (2026-09-02, Sepolia, transferencia desde una gas pump address sin saldo) y no de su documento, y
 * el proveedor puede cambiarlo sin avisar. Esa es exactamente la razón de que el camino por defecto
 * siga siendo el 503: si el literal deja de casar, se vuelve al comportamiento anterior, que es
 * ruidoso pero no miente sobre la cadena.
 */
const CHAIN_REVERTED_ERROR_CODE = 'sc.operation.failed';

/**
 * La única puerta por la que el cuerpo de un error del proveedor entra en este proceso.
 *
 * ⚠️ **Devuelve un BOOLEANO y no el `errorCode`, y eso es una decisión de tipo, no de estilo.** El
 * cuerpo del error es justo donde vive la fuga que todo el módulo evita: el `message` del 401
 * interpola la clave de API (`"Unable to find valid subscription for '${apiKey}'"`, medido en
 * `docs/tatum/gas-pump/openapi.json`, `components.responses.Error401 → …oneOf[1].properties.message
 * .example`). Con esta firma, **ninguna cadena del proveedor puede alcanzar un error, una fila ni un
 * log**, porque no sale de esta función: lo impide el tipo, igual que el union de
 * `ProviderFailureReason` impide guardar el `message` en el libro. Devolviendo `string | null` la
 * garantía pasaría a ser disciplina de quien llama.
 *
 * `message` y `cause` no se leen **ni siquiera para clasificar**: emparejar contra el texto de
 * `cause` —donde viaja el `execution reverted: Address: insufficient balance` de la respuesta real—
 * sería frágil Y peligroso a la vez.
 *
 * El `catch` cubre el cuerpo que no es JSON: un error sin `errorCode` legible no es una reversión,
 * es un 403 corriente. Nunca lanza — que este camino tumbara la clasificación convertiría un fallo
 * del proveedor en un fallo nuestro.
 */
const isChainRevert = async (response: Response): Promise<boolean> => {
  try {
    const body: unknown = await response.json();
    return (
      typeof body === 'object' &&
      body !== null &&
      'errorCode' in body &&
      body.errorCode === CHAIN_REVERTED_ERROR_CODE
    );
  } catch {
    return false;
  }
};

/**
 * Clasifica la respuesta de error entera: primero la única fila que mira el CUERPO, después la tabla
 * por status.
 *
 * ⚠️ **Los DOS cortes previos a leer el cuerpo son deliberados, y cada uno evita un fallo distinto.**
 *
 * 1. **Solo el 403.** Un `errorCode` en el 400 no cambiaría nada hoy —su `validation.failed` no
 *    distingue las dos culpas, ver `translateStatus`— y leerlo «por simetría» ampliaría a todos los
 *    statuses la superficie por la que el texto del proveedor entra en el proceso. Lo fija un caso:
 *    un 400 que trae `sc.operation.failed` sigue saliendo como `body-rejected`.
 * 2. **Solo cuando la culpa es del cliente**, o sea solo en la transferencia. Derivar no toca la
 *    cadena, pero activar SÍ y lo paga la master: una reversión ahí sería nuestra —el saldo de
 *    NUESTRA EOA, backlog #14— y publicarla como 409 culparía al cliente de nuestro gas y la
 *    escondería del `ErrorReporter`, que solo ve 5xx. Con `our-configuration` se queda en el 503 de
 *    siempre, que es ruidoso pero no miente. Lo fija otro caso.
 *
 * ⚠️ Y el 403 que NO trae ese código —o que no trae `errorCode` en absoluto, que es la forma que su
 * `openapi.json` publica— sigue saliendo 503 también en la transferencia: un fallo de permisos de
 * NUESTRA clave es cosa nuestra.
 */
const translateError = async (
  response: Response,
  blame: ProviderFaultBlame,
): Promise<WalletProviderError> =>
  response.status === 403 && blame === 'client-input' && (await isChainRevert(response))
    ? new WalletProviderRevertedError('chain-reverted', response.status)
    : translateStatus(response.status, blame);

/**
 * La tabla de §7.2, en el orden en que hay que leerla. Lo único que sale como 400 nuestro es el
 * 400 de la transferencia: publicar como 400 el de la derivación o el de la activación
 * escondería del `ErrorReporter` —que solo ve 5xx— una configuración rota NUESTRA, y de paso
 * culparía al cliente.
 *
 * El 401 del proveedor no puede salir como 401 nuestro: el nuestro tiene un significado
 * publicado y estrecho («Token ausente, inválido o expirado») y devolverlo haría que el cliente
 * borrara su sesión, se reautenticara y volviera a fallar por algo que es enteramente nuestro.
 *
 * El retorno se declara `WalletProviderError` —el padre abstracto— y no `Error`: es lo que fija
 * en el tipo que de aquí solo salen las clases del proveedor, y de paso lo que hace que
 * `reason` y `providerStatus` estén garantizados en quien lo reciba.
 *
 * ⚠️ **Esta función clasifica SOLO por status y no ve el cuerpo, a propósito: quien lo mira es
 * `translateError`, y solo en el 403.** La mitad del límite que aquí decía «reconocido y no
 * cerrado» ya está cerrada —el 403 que trae `errorCode: "sc.operation.failed"` sale ahora como 409
 * y no como 503—; la otra mitad sigue abierta y es del 400: su `errorCode` es `validation.failed`
 * tanto para un destinatario inválido —culpa del cliente— como, según `docs/backlog.md` #10, para
 * una master sin fondos —culpa nuestra—, así que ese código no discrimina nada y algún 503 sigue
 * saliendo como 400. **No medido por este ciclo**: la única reversión observada contra Sepolia llegó
 * como 403, no como 400.
 */
const translateStatus = (status: number, blame: ProviderFaultBlame): WalletProviderError => {
  if (status === 400) {
    return blame === 'client-input'
      ? new WalletProviderRejectedError('body-rejected', status)
      : new WalletProviderUnavailableError('misconfigured', status);
  }
  if (status === 401) {
    return new WalletProviderUnavailableError('unauthorized', status);
  }
  if (status === 403) {
    return new WalletProviderUnavailableError('forbidden', status);
  }
  if (status >= 500) {
    return new WalletProviderUnreachableError('upstream-error', status);
  }
  // Medido sobre `docs/tatum/gas-pump/openapi.json`: las SIETE operaciones declaran exactamente
  // `200, 400, 401, 403, 500`. Un 404, un 429, un 402 o un 409 no forman parte de su contrato
  // publicado, así que no se les inventa una fila propia: son `undocumented-4xx` y 503.
  return new WalletProviderUnavailableError('undocumented-4xx', status);
};

/**
 * El error de `json()` se descarta ENTERO, sin `cause` y sin interpolarlo: su mensaje lleva un
 * fragmento del cuerpo recibido (`Unexpected token '<' …`), y este código no puede saber qué hay
 * en ese cuerpo. Lo que queda es el código de motivo y el status, que es lo que §7.1 permite.
 */
const parseJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    throw new WalletProviderUnreachableError('malformed-response', response.status);
  }
};
