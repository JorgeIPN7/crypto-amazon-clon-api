import { createHash, timingSafeEqual } from 'node:crypto';

import type { NextFunction, Request, RequestHandler, Response } from 'express';

export type AttemptLimiterOptions = {
  /** Ventana de vida de cada contador. */
  ttlMs: number;
  /** Tope duro de entradas simultáneas. */
  maxEntries: number;
};

/**
 * Contador de intentos fallidos por IP.
 *
 * `Map` local y no el `ThrottlerStorageService` de `@nestjs/throttler`: la documentación se monta
 * con `app.use()`, fuera del grafo de DI, así que habría que extraer la instancia con
 * `app.get(ThrottlerStorage, { strict: false })` y eso crearía una dependencia de arranque entre
 * la documentación y `ThrottlerModule` que hoy no existe — si alguien hiciera ese módulo
 * condicional, reventaría al arrancar. Además su API está pensada para el guard y ha cambiado
 * entre majors.
 *
 * El contador es por proceso. No es una regresión respecto a lo que ya hay: `app.module.ts`
 * configura `ThrottlerModule` sin `storage`, así que el throttler existente también lo es.
 */
export class AttemptLimiter {
  /** Techo del backoff. Sin él, un atacante persistente se auto-bloquearía para siempre. */
  readonly maxDelaySeconds = 30;

  private readonly entries = new Map<string, { failures: number; expiresAt: number }>();

  constructor(private readonly options: AttemptLimiterOptions) {}

  /** Anota un fallo. Solo lo llaman los 401: un acierto no debe consumir presupuesto. */
  record(key: string): void {
    this.evictExpired();

    // Tope duro antes de insertar una clave nueva: las llaves las controla quien ataca, así que
    // un mapa sin límite es a la vez fuga de memoria y vector de agotamiento. Se desaloja la
    // entrada más antigua, que en un `Map` es la primera del orden de inserción.
    if (!this.entries.has(key) && this.entries.size >= this.options.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }

    const current = this.entries.get(key);
    this.entries.set(key, {
      failures: (current?.failures ?? 0) + 1,
      expiresAt: Date.now() + this.options.ttlMs,
    });
  }

  failures(key: string): number {
    this.evictExpired();
    return this.entries.get(key)?.failures ?? 0;
  }

  size(): number {
    this.evictExpired();
    return this.entries.size;
  }

  /**
   * Segundos que anunciar en `Retry-After`. Backoff exponencial con techo, **nunca un bloqueo**.
   *
   * Los dos primeros fallos no penalizan: teclear mal una contraseña es normal y no debe costar
   * una espera. A partir de ahí crece 1, 2, 4… hasta el techo.
   */
  retryAfterSeconds(key: string): number {
    const failures = this.failures(key);
    if (failures <= 2) {
      return 0;
    }
    return Math.min(2 ** (failures - 3), this.maxDelaySeconds);
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }
}

export type DocsAuthOptions = {
  username: string;
  password: string;
  limiter?: AttemptLimiter;
};

/**
 * Digest de longitud fija.
 *
 * `timingSafeEqual` lanza si los búferes miden distinto, así que comparar las cadenas en crudo
 * filtraría la longitud de la contraseña por la vía del error. Hashear primero iguala el tamaño.
 */
const digestOf = (value: string): Buffer => createHash('sha256').update(value).digest();

const matches = (received: string, expected: string): boolean =>
  timingSafeEqual(digestOf(received), digestOf(expected));

/**
 * Basic Auth sobre la ruta de la documentación, con limitación de intentos fallidos.
 *
 * Basic Auth **abre una superficie de fuerza bruta que antes no existía**: sin credenciales no
 * había nada que adivinar. Y el `ThrottlerGuard` no la cubre, porque es un guard de Nest y esto
 * se monta con `app.use()`, fuera de ese pipeline.
 *
 * Se responde de inmediato con `Retry-After` en lugar de dormir la petición. Un `await delay()`
 * retendría la conexión varios segundos por cada intento fallido y, con concurrencia alta, el
 * propio limitador se convertiría en el agotamiento de sockets que pretende evitar. Para quien
 * respeta el protocolo el coste es el mismo; para quien no, el servidor no paga nada.
 */
export const createDocsAuth = ({
  username,
  password,
  limiter = new AttemptLimiter({ ttlMs: 15 * 60_000, maxEntries: 10_000 }),
}: DocsAuthOptions): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip ?? 'unknown';
    const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');

    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
      const separator = decoded.indexOf(':');

      if (
        separator > 0 &&
        matches(decoded.slice(0, separator), username) &&
        matches(decoded.slice(separator + 1), password)
      ) {
        // Un acierto no consume presupuesto: si contara, navegar por la documentación —que hace
        // varias peticiones por página— agotaría el contador del propio usuario legítimo.
        next();
        return;
      }
    }

    limiter.record(key);

    const retryAfter = limiter.retryAfterSeconds(key);
    if (retryAfter > 0) {
      res.setHeader('Retry-After', String(retryAfter));
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="API docs", charset="UTF-8"');
    res.status(401).send('Unauthorized');
  };
};
