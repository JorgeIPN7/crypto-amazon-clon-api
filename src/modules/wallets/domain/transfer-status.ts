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
 * - **`rejected` significa que NO PASÓ NADA EN LA CADENA**, y ese —no un status concreto— es el
 *   criterio. Hoy lo cumplen dos respuestas del proveedor: su 400 de validación del cuerpo, donde
 *   nadie llegó a ejecutar nada, y su 403 con `errorCode: "sc.operation.failed"`, que es una
 *   reversión en simulación (`execution reverted`), o sea que tampoco se minó nada.
 *   ⚠️ **Hasta el 2026-09-02 esta línea decía «`rejected` es solo el 400 de validación», y era una
 *   descripción del único caso conocido colada como definición.** Con ella, la reversión —que es
 *   justo el caso en el que SÍ se sabe— acababa en `unknown`, que afirma «pudo minarse o no». Un
 *
 *   ⚠️ **Un 401, o un 403 de permisos, siguen yendo a `unknown`, y el motivo NO es que «no pasó
 *   nada»** — decir eso contradiría el criterio que se acaba de fijar. Es que **no lo sabemos**:
 *   de esas respuestas no tenemos ninguna evidencia sobre la cadena, mientras que del 403 con
 *   `sc.operation.failed` sí la tenemos, porque el propio proveedor dice `execution reverted`.
 *   La diferencia entre los dos 403 no es la culpa, es la EVIDENCIA.
 *
 *   Y es la decisión conservadora a propósito: ante la duda, `unknown`. Lo caro es lo contrario
 *   —afirmar que no se movió nada cuando pudo moverse—, no quedarse corto.
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
