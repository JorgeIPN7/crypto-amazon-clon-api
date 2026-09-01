import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

/**
 * Puerto FIJO, no efímero. El adaptador lee su URL de la configuración, que `test/setup-env.ts`
 * fija antes de que arranque el `AppModule`: un puerto efímero solo se conoce DESPUÉS de arrancar
 * el servidor, y para entonces la configuración ya está congelada (`cache: true` en
 * `ConfigModule.forRoot`).
 *
 * 14567 queda fuera del rango efímero de las dos plataformas donde corre esta suite, así que el
 * sistema no puede dárselo a otro proceso mientras la suite corre:
 *
 *  · Windows 49152-65535 — medido en esta máquina con `netsh int ipv4 show dynamicport tcp`
 *    (inicio 49152, 16384 puertos).
 *  · Linux 32768-60999 — el default documentado de `/proc/sys/net/ipv4/ip_local_port_range`.
 *    NO medido aquí: no hay Linux a mano en este entorno.
 *
 * ⚠️ El literal de la URL está DUPLICADO en `test/setup-env.ts`. Importarlo de aquí se puede, pero
 * metería `node:http` y esta clase en el arranque de TODAS las suites, y ese archivo es hoy el
 * único del árbol de tests que no importa NADA — se eligió duplicar y vigilar la copia. Lo que
 * impide que las dos diverjan es el caso «debería apuntar la URL del proveedor al puerto exacto
 * del stub» de `src/__tests__/test-env-defaults.spec.ts`, que compara las dos constantes;
 * comprobado que mide, cambiando el puerto de `setup-env.ts` a 14568 cae ese caso y solo ese.
 */
export const TATUM_STUB_PORT = 14567;
export const TATUM_STUB_HOST = '127.0.0.1';
export const TATUM_STUB_BASE_URL = `http://${TATUM_STUB_HOST}:${TATUM_STUB_PORT}`;

/** Lo que queda en el registro en lugar del secreto. No es un valor válido de clave. */
export const MASKED_SECRET = '[[stub-masked]]';

/**
 * Lo que responde una ruta sin respuesta programada.
 *
 * ⚠️ **418 NO cambia el status que el adaptador acaba publicando, y escribir lo contrario sería
 * justo el comentario caro: el que hace que alguien deduzca mal en el siguiente rojo.** Medido con
 * una sonda temporal que pasa ocho statuses por `TatumHttpClient.request()` con el `fetch`
 * doblado, y `retryable` en sus dos valores:
 *
 *     404 -> WalletProviderUnavailableError  undocumented-4xx  providerStatus=404   1 intento
 *     418 -> WalletProviderUnavailableError  undocumented-4xx  providerStatus=418   1 intento
 *     500 -> WalletProviderUnreachableError  upstream-error    providerStatus=500   2 intentos
 *
 * O sea que 418 y 404 salen los dos como 503 con el MISMO mensaje fijo y son indistinguibles por
 * HTTP: `translateStatus` manda todo 4xx que no sea 400/401/403 al mismo sitio, así que ningún
 * status del rango distingue por sí solo un fallo del stub de uno del proveedor. Quien distingue
 * de verdad es la capa 2 —`unstubbed`, que NOMBRA la ruta— y la capa 3 —los casos felices afirman
 * sobre el contenido literal que solo el stub produce—.
 *
 * Lo que 418 sí aporta, y es lo único que se le atribuye:
 *
 *  1. **No puede venir del proveedor.** Sus SIETE operaciones declaran exactamente
 *     `200, 400, 401, 403, 500` — medido recorriendo `paths` de
 *     `docs/tatum/gas-pump/openapi.json`. Un `providerStatus: 418` en un error solo puede haberlo
 *     escrito este archivo.
 *  2. **No se reintenta.** Un 5xx sale como `WalletProviderUnreachableError`, que es exactamente
 *     lo que el cliente reintenta cuando `retryable: true`: la sonda cuenta 2 intentos con 500 y 1
 *     con 418. Con un 5xx, una sola ruta sin programar dejaría DOS entradas en `unstubbed` y la
 *     lista dejaría de leerse como «una llamada, una ruta».
 */
export const UNSTUBBED_STATUS = 418;

/**
 * Cualquier propiedad cuyo nombre huela a clave privada se enmascara AL GUARDAR.
 *
 * Un solo término basta, y está medido: recorriendo los 32 esquemas de
 * `docs/tatum/gas-pump/openapi.json` y filtrando los nombres de propiedad que casan
 * `/private|mnemonic|secret|passphrase|password|signature|key/i` salen exactamente DOS,
 * `fromPrivateKey` y `signatureId`. El segundo no es un secreto —es el id de una clave guardada en
 * el KMS del proveedor— y además pertenece a los esquemas KMS, que el veto de `WALLETS_NETWORK`
 * deja fuera de este ciclo (ver `src/config/wallets.config.ts`). Ampliar el patrón «por si acaso»
 * sería inventar cobertura para campos que ningún cuerpo de este ciclo lleva.
 */
const SECRET_KEY_PATTERN = /privatekey/i;

export type StubbedResponse = {
  readonly status: number;
  readonly body?: unknown;
  /** No responder jamás. Es la única forma de provocar el timeout del adaptador. */
  readonly hang?: boolean;
};

export type RecordedCall = {
  readonly method: string;
  readonly path: string;
  readonly body: Record<string, unknown> | null;
  /** Presencia, nunca el valor: el mensaje de 401 del proveedor interpola la clave de API. */
  readonly apiKeyPresent: boolean;
};

/**
 * Stub HTTP del proveedor custodial para los E2E de `wallets`.
 *
 * **Por qué un servidor local y no un interceptor ni un adaptador falso**: es la única de las tres
 * opciones que ejercita el adaptador de verdad. Un adaptador falso por configuración dejaría el
 * guardián de contrato en verde mientras el archivo más propenso a defectos del módulo —el que
 * traduce statuses, normaliza el `txId` sin `0x` y discrimina el timeout por `err.name` y no por
 * `instanceof`— no se ejecuta en ninguna prueba: reproduciría, una capa más abajo, el punto ciego
 * que ese guardián existe para cerrar. Con un servidor real se ejercitan `fetch` de verdad, los
 * status de verdad, `AbortSignal.timeout` de verdad y `ECONNREFUSED` de verdad. Y no añade una
 * dependencia, que es la política visible del repo.
 *
 * ⚠️ **Este es el ÚNICO doble del árbol que ve la clave privada de la master**, porque el cuerpo de
 * `POST /v3/blockchain/sc/custodial/transfer` la lleva en `fromPrivateKey`. De ahí que el
 * enmascarado ocurra al GUARDAR y no al leer: ver `handle()`.
 */
export class TatumStubServer {
  private readonly server: Server;
  private readonly queues = new Map<string, StubbedResponse[]>();
  private readonly sockets = new Set<Socket>();
  private readonly held = new Set<ServerResponse>();
  private readonly recorded: RecordedCall[] = [];
  private readonly missed: string[] = [];

  private constructor() {
    this.server = createServer((request, response) => {
      // `.catch()` y no `void`: `void` no atiende el rechazo, así que un fallo dentro de
      // `handle()` —un `writeHead` sobre una conexión ya destruida, un cuerpo programado que
      // `JSON.stringify` no puede serializar— saldría como unhandled rejection y Jest se lo
      // atribuiría al test que estuviera corriendo en ese instante, no a este archivo. Es una
      // guarda, no una medición: no he provocado ese camino en ningún caso.
      this.handle(request, response).catch(() => response.destroy());
    });
    // Sin este registro, `stop()` se queda colgado esperando a las conexiones que un `hang`
    // dejó abiertas, y Jest muere con «A worker process has failed to exit gracefully».
    this.server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
  }

  static start(): Promise<TatumStubServer> {
    const stub = new TatumStubServer();
    return new Promise((resolve, reject) => {
      stub.server.once('error', reject);
      stub.server.listen(TATUM_STUB_PORT, TATUM_STUB_HOST, () => resolve(stub));
    });
  }

  /**
   * Programa una respuesta. Se consumen en orden FIFO por ruta.
   *
   * `path` puede terminar en `/*` para casar por prefijo, que es lo que necesita
   * `GET /v3/gas-pump/activated/{chain}/{owner}/{index}`: el índice lo decide la secuencia de
   * PostgreSQL y el guion del test no puede saberlo de antemano.
   */
  stub(method: string, path: string, response: StubbedResponse): void {
    const key = `${method.toUpperCase()} ${path}`;
    this.queues.set(key, [...(this.queues.get(key) ?? []), response]);
  }

  get calls(): readonly RecordedCall[] {
    return this.recorded;
  }

  /** Rutas golpeadas sin respuesta programada. Cada escenario afirma que queda vacía. */
  get unstubbed(): readonly string[] {
    return this.missed;
  }

  /**
   * La QUINTA capa, simétrica de `unstubbed`: respuestas que el guion programó y la app nunca pidió.
   *
   * Las cuatro capas que documenta la cabecera cubren «la app llamó a una ruta que nadie programó».
   * Esta cubre lo contrario, que es igual de traicionero: un caso que programa un desenlace que el
   * código ha dejado de consultar sigue pasando en verde, porque `reset()` descarta la cola en
   * silencio y nada lo dice.
   *
   * ⚠️ **Se expone pero NO se afirma en los `afterEach`, y el motivo está medido**: hacerlo pone
   * rojos casi todos los casos de `wallets.e2e-spec.ts`. La razón es legítima y no un descuido de
   * los tests — los casos que responden 401, 403 o 409 cortan ANTES de llamar al proveedor, así que
   * la respuesta que su montaje compartido programó se queda sin consumir por diseño.
   *
   * O sea que la quinta capa no cuesta «una línea»: exigiría que cada caso programe exactamente lo
   * que va a consumir, y eso es un cambio en el contrato de todos ellos. Queda el getter, que sirve
   * para depurar un caso concreto, y queda dicho por qué no es una aserción global.
   *
   * Hoy tampoco hay agujero real: cada omisión de ese tipo tumba otro caso — quitar la
   * reconciliación pone rojo el 409 de «el proveedor ya la da por activada».
   */
  get pending(): readonly string[] {
    return [...this.queues.entries()]
      .filter(([, queue]) => queue.length > 0)
      .map(([key, queue]) => key + ' (' + queue.length + ' sin consumir)');
  }

  reset(): void {
    this.releaseHeld();
    this.queues.clear();
    this.recorded.length = 0;
    this.missed.length = 0;
  }

  async stop(): Promise<void> {
    this.releaseHeld();
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private releaseHeld(): void {
    for (const response of this.held) {
      response.destroy();
    }
    this.held.clear();
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = (request.method ?? 'GET').toUpperCase();
    const path = (request.url ?? '/').split('?')[0] ?? '/';
    const raw = await readBody(request);

    // El enmascarado va AQUÍ, antes del push, y no en el getter: si el registro llegara a guardar
    // el secreto, cualquier `console.log`, snapshot o volcado de un test rojo lo escribiría en la
    // salida de CI. Enmascarar al leer deja el agujero abierto en memoria, que es donde lo lee un
    // depurador o un `--verbose`.
    this.recorded.push({
      method,
      path,
      body: maskSecrets(raw),
      apiKeyPresent: typeof request.headers['x-api-key'] === 'string',
    });

    const stubbed = this.take(method, path);
    if (!stubbed) {
      this.missed.push(`${method} ${path}`);
      response.writeHead(UNSTUBBED_STATUS, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ stub: 'unprogrammed', method, path }));
      return;
    }

    if (stubbed.hang) {
      this.held.add(response);
      return;
    }

    response.writeHead(stubbed.status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(stubbed.body ?? null));
  }

  private take(method: string, path: string): StubbedResponse | undefined {
    const exact = this.queues.get(`${method} ${path}`);
    if (exact && exact.length > 0) {
      return exact.shift();
    }
    for (const [key, queue] of this.queues) {
      const separator = key.indexOf(' ');
      const keyMethod = key.slice(0, separator);
      const keyPath = key.slice(separator + 1);
      if (queue.length === 0 || keyMethod !== method || !keyPath.endsWith('/*')) {
        continue;
      }
      if (path.startsWith(keyPath.slice(0, -1))) {
        return queue.shift();
      }
    }
    return undefined;
  }
}

// Helpers

const readBody = (request: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    // Un stream sin listener de `error` emite una excepción no capturada y se lleva por delante
    // el worker de Jest. Aquí se resuelve con lo que no llegó a leerse —cadena vacía, que
    // `maskSecrets` convierte en `null`— porque un cuerpo a medias NO se guarda: es exactamente
    // el caso en el que no se puede garantizar que el enmascarado haya visto la clave entera.
    // Guarda, no medición: no he provocado un corte a mitad de cuerpo en ningún caso.
    request.on('error', () => resolve(''));
  });

/**
 * ⚠️ Recorre el cuerpo ENTERO, no solo el primer nivel. Los cuatro cuerpos que este ciclo envía
 * son planos, así que un enmascarado superficial bastaría hoy; el problema es que el comentario
 * que lo acompaña —«enmascara la clave privada»— dejaría de ser cierto en cuanto alguien anidara
 * un objeto, y sería cierto a medias sin que nada se pusiera rojo. La aserción que lo fija compara
 * contra el registro ENTERO serializado, no contra `calls[0].body.fromPrivateKey`.
 *
 * Un cuerpo que no es un objeto JSON —vacío, no-JSON, o un array en la raíz— se guarda como
 * `null` y NUNCA en crudo: si no se puede recorrer, tampoco se puede garantizar que no lleve el
 * secreto dentro. Es lo mismo que hace `tatum-http.client.ts` al descartar entero el error de
 * `json()` en vez de interpolarlo.
 */
const maskSecrets = (raw: string): Record<string, unknown> | null => {
  if (raw.length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  return maskObject(parsed as Record<string, unknown>);
};

const maskObject = (source: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(source).map(([key, value]) =>
      SECRET_KEY_PATTERN.test(key) ? [key, MASKED_SECRET] : [key, maskValue(value)],
    ),
  );

const maskValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(maskValue);
  }
  if (value !== null && typeof value === 'object') {
    return maskObject(value as Record<string, unknown>);
  }
  return value;
};
