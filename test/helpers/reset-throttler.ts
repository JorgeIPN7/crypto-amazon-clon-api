import type { INestApplication } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';

/**
 * Vacía los contadores del rate limiter de una app bajo test.
 *
 * Hace falta desde que `POST /auth/register` tiene el MISMO límite propio que el login
 * (10/min): una suite E2E que da de alta más de diez cuentas contra la misma app agotaría el
 * cupo y empezaría a recibir 429 donde espera 201 — un rojo que no habla del código bajo
 * prueba sino del presupuesto de peticiones del test.
 *
 * La alternativa era repartir los tests entre varias apps hasta que ninguna pasara de diez
 * altas, y eso ata la ESTRUCTURA de la suite a un número de configuración: subir el límite a
 * 20 dejaría media suite con apps de más, y bajarlo a 5 la rompería sin tocar una sola
 * aserción. Vaciar el contador entre tests independiza una cosa de la otra.
 *
 * **No sirve para probar el límite en sí**: los `describe` que miden el 429 usan su propia
 * app y NO llaman a esta función — si lo hicieran, borrarían justo lo que están midiendo.
 *
 * `storage` es un getter público de `ThrottlerStorageService` que devuelve el `Map` real
 * (verificado contra @nestjs/throttler 6.5.0), así que esto no toca nada privado. El
 * `instanceof` cubre el día en que el storage se sustituya por Redis: entonces esta función
 * dejaría de vaciar en silencio, y el guard es preferible a un `as` que fingiría lo contrario.
 *
 * **Cancelar los temporizadores no es opcional, es la mitad del reset.** `timeoutIds` es un
 * Map SEPARADO de `_storage`: cada petición programa un `setTimeout` que al vencer hace
 * `const { totalHits } = this.storage.get(key)` para descontar su propio hit. Vaciar solo el
 * Map de contadores deja esos temporizadores huérfanos, y al dispararse hacen una de dos
 * cosas, ambas malas: si nadie recreó la clave revientan con
 * `TypeError: Cannot destructure property 'totalHits' of 'this.storage.get(...)' as it is
 * undefined` dentro del worker de Jest —atribuido al test que corriera en ese instante, no al
 * que hizo la petición—, y si alguien la recreó descuentan un hit de la ventana NUEVA.
 * Medido con `THROTTLER_TTL_MS=200` sobre `users.e2e-spec.ts`: 8 tests rojos con ese
 * TypeError antes de cancelar, 0 después. Con el TTL real de 60 s no se ve porque ninguna
 * suite dura tanto y `app.close()` acaba cancelándolos — es una bomba de relojería, no un
 * problema resuelto.
 *
 * `onApplicationShutdown()` es el ÚNICO miembro público que los cancela (`timeoutIds` y
 * `clearExpirationTimes` son `private` en el `.d.ts` de 6.5.0). Su cuerpo entero es
 * `this.timeoutIds.forEach((timeouts) => timeouts.forEach(clearTimeout))`: no cierra nada ni
 * deja el servicio inservible, así que llamarlo aquí es exacto y no un abuso del hook.
 */
export const resetThrottler = (app: INestApplication): void => {
  const storage = app.get<ThrottlerStorage>(ThrottlerStorage, { strict: false });
  if (!(storage instanceof ThrottlerStorageService)) {
    throw new Error(
      'resetThrottler solo sabe vaciar el storage en memoria de @nestjs/throttler; ' +
        'con un storage externo (Redis) hay que vaciarlo por su propia API.',
    );
  }
  storage.onApplicationShutdown();
  storage.storage.clear();
};
