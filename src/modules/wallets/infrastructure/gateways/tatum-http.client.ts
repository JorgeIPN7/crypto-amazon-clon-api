import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { WalletsConfig } from '@config/wallets.config';

import {
  WalletProviderError,
  WalletProviderRejectedError,
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
 * A quién culpa un 400 del proveedor. NO tiene default a propósito, igual que `retryable`: el
 * mismo status significa cosas distintas según el endpoint (§7.2) —en el alta de la wallet y en
 * la activación el cuerpo lo construimos NOSOTROS enteros, así que su 400 es configuración rota
 * nuestra y sale 503; solo la transferencia lleva entrada del cliente a la que culpar— y un
 * default habría hecho que la operación nueva heredara una decisión en silencio.
 */
export type BadRequestBlame = 'client-input' | 'our-configuration';

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
  badRequestBlame: BadRequestBlame;
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
 * La sonda no está en el árbol: es una comprobación de cableado, no un caso de la Tabla T23. El
 * arranque real llegará con `src/modules/wallets/wallets.module.ts`, que todavía no existe
 * (medido: `ls src/modules/wallets/*.module.ts` no devuelve nada).
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
   * Un 401 o un 403 no mejoran repitiéndolos: la clave está muerta o el permiso no está, y
   * reintentar solo duplica el gasto de créditos. Lo fija el caso E5.
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
      throw translateStatus(response.status, request.badRequestBlame);
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
 * en el tipo que de aquí solo salen las tres clases del proveedor, y de paso lo que hace que
 * `reason` y `providerStatus` estén garantizados en quien lo reciba.
 *
 * ⚠️ Límite reconocido y no cerrado en este ciclo: el 403 de Tatum es literalmente «logical
 * error or invalid permissions», así que una precondición de negocio suya sale publicada como
 * caída de la integración; y su 400 no distingue «dirección destino inválida» de «la master no
 * tiene fondos», así que algún 503 saldrá como 400. Afinarlo exige clasificar el cuerpo (§9).
 */
const translateStatus = (status: number, blame: BadRequestBlame): WalletProviderError => {
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
