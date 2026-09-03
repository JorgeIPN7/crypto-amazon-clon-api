/**
 * El rol que posee la master. Los cuatro casos de uso que reciben `ownerRole` lo comparan contra
 * este literal para responder `AdminUsesMasterAddressError`.
 *
 * **Vive suelto en `domain/` y no en `value-objects/`**, mismo criterio que `wallet-status.ts`,
 * `transfer-status.ts` y `users/domain/user-role.ts`: no extiende `ValueObject`, no valida nada y
 * se compara con `===`.
 *
 * ⚠️ **Es un literal propio y NO `USER_ROLES` de `users`, y eso no es duplicación por descuido.**
 * La regla 2 del gate de fronteras prohíbe a un módulo importar el `domain/` de otro, y `common`
 * publica el rol como `string` por ese mismo motivo. Copiarlo aquí es el precio de la frontera.
 *
 * ⚠️ **La invariante que sostiene**: la única EOA del sistema es la del admin, y todos los usuarios
 * reciben direcciones DERIVADAS. El admin no tiene gas pump —no tiene índice—, así que ninguna de
 * las cuatro operaciones existe para él. Sin esta comprobación, `POST /wallets` le derivaría una
 * dirección y el fondo de gas de la plataforma pasaría a ser «su» wallet.
 *
 * Estaba copiado en los cuatro casos de uso, cada uno con su JSDoc y dos de ellos con un inventario
 * de archivos hermanos que caducaba en cuanto apareciese un quinto consumidor. Una sola escritura
 * quita las cuatro copias y los dos inventarios.
 */
export const ADMIN_ROLE = 'admin';
