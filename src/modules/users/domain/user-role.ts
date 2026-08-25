/**
 * Union y no enum: convención del repo (`type`, nunca `interface`; uniones sobre enums).
 *
 * **Vive suelto en `domain/` y NO en `domain/value-objects/`**, donde estuvo hasta el
 * 2026-08-25. No es un value object: no extiende `ValueObject`, no tiene factoría, no valida
 * nada y no encapsula ninguna invariante — es un vocabulario cerrado que se compara con `===`.
 * Tenerlo en esa carpeta hacía que `value-objects/` significara «cosas del dominio que no son
 * entidades», que no significa nada.
 *
 * El criterio, que vale para los tres contextos: en `value-objects/` solo entra lo que extiende
 * `ValueObject`. Un enum de dominio, una constante o un tipo auxiliar van sueltos en `domain/`.
 * Hoy este es el único caso del repo, así que tampoco se le crea carpeta propia para uno.
 */
export const USER_ROLES = ['admin', 'user'] as const;
export type UserRole = (typeof USER_ROLES)[number];
