/**
 * Unión y no enum: convención del repo (`type`, nunca `interface`; uniones sobre enums), la
 * misma forma que `USER_ROLES` en `users`.
 *
 * **Vive suelto en `domain/` y NO en `domain/value-objects/`**: no extiende `ValueObject`, no
 * tiene factoría y no encapsula ninguna invariante — es un vocabulario cerrado que se compara
 * con `===`. En `value-objects/` solo entra lo que extiende `ValueObject`.
 *
 * El orden ES la máquina de estados y es **monótona**: `receive-only` → `activating` → `active`,
 * y nunca retrocede. Una wallet en `receive-only` puede recibir fondos pero no enviarlos, que es
 * exactamente lo que `WalletNotActivatedError` cuenta cuando lleva este valor.
 *
 * ⚠️ **Reordenar esta lista NO es cosmético**, al revés que en `transfer-status.ts`, donde el
 * orden no significa nada. Aquí el índice ES el rango de capacidad, y la propiedad P1 de
 * `wallet.entity.spec.ts` lo usa como tal: convierte cada estado en su índice y exige que la
 * serie sea no decreciente.
 *
 * **Medición REHECHA el 2026-08-30, ahora que `entities/wallet.entity.ts` existe.** La anterior
 * decía «cae exactamente uno, el A1 de `wallet-status.spec.ts`» y describía un árbol en el que
 * nada más ataba este orden a un comportamiento. Ya no es cierto: invirtiendo la lista a
 * `['active', 'activating', 'receive-only']` y corriendo la suite entera del módulo caen **dos**
 * casos: el A1 de `wallet-status.spec.ts` y la propiedad P1 de `wallet.entity.spec.ts`. El orden
 * ya está atado a un comportamiento, que era justo lo que faltaba.
 *
 * (Se nombran los casos y no el total de la suite: ese número lo invalida cualquier archivo de
 * test que se añada al módulo, aunque no toque nada de esto.)
 *
 * ⚠️ **Y las dos mitades de esa medición NO son igual de fiables, que es lo que hay que saber
 * antes de apoyarse en ella.** A1 cae siempre: compara la lista literal. P1 es una propiedad de
 * `fast-check` SIN semilla fija, así que su fiabilidad depende del reordenado concreto:
 *
 * | Reordenado                                    | Casos que caen | ¿Determinista?                                     |
 * | --------------------------------------------- | -------------- | -------------------------------------------------- |
 * | `['active','activating','receive-only']`      | A1 y P1        | **Sí**, y es demostrable — ver el párrafo de abajo |
 * | `['receive-only','active','activating']`      | A1 y P1        | **No**: P1 depende del muestreo                    |
 *
 * Con la lista invertida, `receive-only` pasa a valer 2 y los dos únicos primeros pasos posibles
 * bajan el rango (`request` → `activating` = 1, `confirm` → `active` = 0), así que P1 muere en la
 * PRIMERA muestra que genere, sea cual sea la semilla — repetido cinco veces, `2 failed, 158
 * passed` las cinco. Con la permuta de los dos últimos, en cambio, `receive-only` vale 0 y
 * ningún primer paso baja: P1 solo muere si el muestreo produce un `request` seguido de un
 * `confirm`, cosa que en 100 ejecuciones pasa casi siempre pero no por construcción —repetido
 * tres veces, `2 failed` las tres, y aun así no es una garantía—.
 *
 * Quien para un reordenado de forma FIABLE sigue siendo A1. P1 es lo que ata el orden a un
 * comportamiento, no un segundo cerrojo determinista.
 */
export const WALLET_STATUSES = ['receive-only', 'activating', 'active'] as const;
export type WalletStatus = (typeof WALLET_STATUSES)[number];
