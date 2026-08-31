/**
 * Los cuatro estados del libro de transferencias. Unión suelta en `domain/`, mismo criterio que
 * `wallet-status.ts` y que `users/domain/user-role.ts`: no extiende `ValueObject`, no valida nada
 * y se compara con `===`.
 *
 * ⚠️ **A diferencia de `WALLET_STATUSES`, este orden NO significa nada.** Allí la secuencia es la
 * máquina de estados monótona y hay una propiedad que usa el índice como rango; aquí `submitting`
 * es el único estado inicial y los otros tres son terminales y excluyentes entre sí. Una
 * propiedad que afirmara monotonía sobre esta lista estaría afirmando algo falso.
 *
 * Qué distingue a los tres terminales, porque confundirlos hace que la fila MIENTA:
 *
 * - **`rejected` es solo el 400 de validación del cuerpo**, y significa que **no pasó nada en la
 *   cadena**. Un 401 o un 403 del proveedor no son un rechazo del envío —nadie rechazó nada, la
 *   petición ni siquiera llegó a procesarse como transferencia— y van a `unknown`.
 * - **`unknown` es la respuesta honesta a un timeout, una red caída o un 5xx: pudo minarse o no.**
 *   No se inventa un `rejected`, que afirmaría que no pasó nada, ni un `submitted` sin `txId`.
 *   Y a diferencia de `activation-failed` —que no existe por inalcanzable— este estado se alcanza
 *   cada vez que expira el timeout, así que el dominio lo modela.
 * - **`submitting` es la escritura POR DELANTE de la llamada**, y aquí significa solo «fila
 *   escrita, aún sin respuesta». La regla de que una fila que sobrevive en `submitting` a su
 *   petición se lee como `unknown` es del CONSUMIDOR, no de esta entidad.
 */
export const TRANSFER_STATUSES = ['submitting', 'submitted', 'rejected', 'unknown'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];
