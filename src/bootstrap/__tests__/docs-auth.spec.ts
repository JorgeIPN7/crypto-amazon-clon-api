import type { Request } from 'express';

import { AttemptLimiter, createDocsAuth } from '../docs-auth';

// Al scope del archivo, no dentro de un solo `describe`: `AttemptLimiter` mide con `Date.now()` y
// el test del TTL avanza el reloj. Con los timers reales, `advanceTimersByTime` no mueve nada y
// el test pasaría por el motivo equivocado.
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('AttemptLimiter', () => {
  it('debería expirar las entradas pasado el TTL', () => {
    // Arrange
    const limiter = new AttemptLimiter({ ttlMs: 1_000, maxEntries: 10 });
    limiter.record('1.2.3.4');

    // Act
    const before = limiter.failures('1.2.3.4');
    jest.advanceTimersByTime(1_500);
    const after = limiter.failures('1.2.3.4');

    // Assert
    expect(before).toBe(1);
    expect(after).toBe(0);
  });

  it('debería desalojar la entrada más antigua al alcanzar el tope', () => {
    // Arrange
    const limiter = new AttemptLimiter({ ttlMs: 60_000, maxEntries: 2 });

    // Act
    limiter.record('a');
    limiter.record('b');
    limiter.record('c');

    // Assert
    // Las llaves las controla quien ataca: sin tope, el mapa es a la vez una fuga de memoria y
    // un vector de agotamiento.
    expect(limiter.size()).toBe(2);
    expect(limiter.failures('a')).toBe(0);
    expect(limiter.failures('c')).toBe(1);
  });

  it('debería no penalizar los dos primeros fallos', () => {
    // Arrange
    const limiter = new AttemptLimiter({ ttlMs: 60_000, maxEntries: 10 });

    // Act
    limiter.record('1.2.3.4');
    const afterFirst = limiter.retryAfterSeconds('1.2.3.4');
    limiter.record('1.2.3.4');
    const afterSecond = limiter.retryAfterSeconds('1.2.3.4');

    // Assert
    // Teclear mal una contraseña es normal y no debe costar una espera.
    expect(afterFirst).toBe(0);
    expect(afterSecond).toBe(0);
  });

  it('debería crecer el retardo con cada fallo, hasta un techo', () => {
    // Arrange
    const limiter = new AttemptLimiter({ ttlMs: 60_000, maxEntries: 10 });

    // Act
    const delays = Array.from({ length: 12 }, () => {
      limiter.record('1.2.3.4');
      return limiter.retryAfterSeconds('1.2.3.4');
    });

    // Assert
    // Backoff, no bloqueo: un lockout permanente convertiría al limitador en la denegación de
    // servicio que pretende evitar.
    expect(delays[3] ?? 0).toBeLessThan(delays[6] ?? 0);
    expect(delays.at(-1)).toBe(limiter.maxDelaySeconds);
  });
});

describe('createDocsAuth', () => {
  it('debería responder 401 sin credenciales', () => {
    // Arrange
    const middleware = createDocsAuth({ username: 'u', password: 'p' });
    const res = fakeResponse();

    // Act
    middleware(requestWith(), res.res, res.next);

    // Assert
    expect(res.status).toBe(401);
    expect(res.headers['WWW-Authenticate']).toContain('Basic');
    expect(res.nextCalled).toBe(false);
  });

  it('debería dejar pasar con las credenciales correctas', () => {
    // Arrange
    const middleware = createDocsAuth({ username: 'u', password: 'p' });
    const res = fakeResponse();

    // Act
    middleware(requestWith(basicHeader('u', 'p')), res.res, res.next);

    // Assert
    expect(res.nextCalled).toBe(true);
    expect(res.status).toBeUndefined();
  });

  it.each([
    ['usuario incorrecto', 'otro', 'p'],
    ['contraseña incorrecta', 'u', 'otra'],
    ['contraseña vacía', 'u', ''],
  ])('debería rechazar con %s', (_caso, user, pass) => {
    // Arrange
    const middleware = createDocsAuth({ username: 'u', password: 'p' });
    const res = fakeResponse();

    // Act
    middleware(requestWith(basicHeader(user, pass)), res.res, res.next);

    // Assert
    expect(res.status).toBe(401);
    expect(res.nextCalled).toBe(false);
  });

  it('debería no consumir presupuesto en una petición exitosa', () => {
    // Arrange
    const limiter = new AttemptLimiter({ ttlMs: 60_000, maxEntries: 10 });
    const middleware = createDocsAuth({ username: 'u', password: 'p', limiter });

    // Act
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = fakeResponse();
      middleware(requestWith(basicHeader('u', 'p')), res.res, res.next);
    }

    // Assert
    // Si un acierto consumiera presupuesto, navegar por la documentación —que hace varias
    // peticiones por página— agotaría el contador del propio usuario legítimo.
    expect(limiter.failures('1.2.3.4')).toBe(0);
  });

  it('debería anunciar Retry-After creciente tras varios fallos, sin retener la conexión', () => {
    // Arrange
    const limiter = new AttemptLimiter({ ttlMs: 60_000, maxEntries: 10 });
    const middleware = createDocsAuth({ username: 'u', password: 'p', limiter });

    // Act
    let last = fakeResponse();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      last = fakeResponse();
      middleware(requestWith(), last.res, last.next);
    }

    // Assert
    // El middleware es síncrono a propósito: un `await delay()` retendría la conexión varios
    // segundos por intento y, con concurrencia alta, el limitador se volvería el agotamiento de
    // sockets que pretende evitar.
    expect(Number(last.headers['Retry-After'])).toBeGreaterThan(0);
    expect(last.status).toBe(401);
  });

  it('debería contar por IP y no penalizar a un cliente por los fallos de otro', () => {
    // Arrange
    const limiter = new AttemptLimiter({ ttlMs: 60_000, maxEntries: 10 });
    const middleware = createDocsAuth({ username: 'u', password: 'p', limiter });

    // Act
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = fakeResponse();
      middleware(requestWith(undefined, '9.9.9.9'), res.res, res.next);
    }

    // Assert
    // Con un `TRUST_PROXY` mal configurado detrás de un balanceador esto deja de cumplirse:
    // `req.ip` sería la IP del proxy y todos compartirían contador. `setupOpenApi` avisa al
    // arrancar cuando detecta esa combinación.
    expect(limiter.failures('9.9.9.9')).toBe(5);
    expect(limiter.failures('1.2.3.4')).toBe(0);
  });
});

// Helpers

const basicHeader = (user: string, pass: string): string =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

const requestWith = (authorization?: string, ip = '1.2.3.4'): Request =>
  ({ headers: authorization === undefined ? {} : { authorization }, ip }) as unknown as Request;

/** Captura lo único que estas pruebas observan del `res`: estado, cabeceras y si cedió el paso. */
const fakeResponse = () => {
  const state = {
    headers: {} as Record<string, string>,
    status: undefined as number | undefined,
    nextCalled: false,
    res: {} as never,
    next: () => undefined as void,
  };

  state.res = {
    setHeader: (key: string, value: string) => {
      state.headers[key] = value;
    },
    status: (code: number) => {
      state.status = code;
      return state.res;
    },
    send: () => state.res,
  } as never;
  state.next = () => {
    state.nextCalled = true;
  };

  return state;
};
