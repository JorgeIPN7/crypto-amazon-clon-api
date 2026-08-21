import type { PasswordHash } from '../value-objects/password-hash.vo';

/**
 * Puerto de salida (driven): hashear es I/O costoso (argon2), no lógica de dominio.
 * `abstract class` —tipo y token en la misma referencia— por el mismo motivo que
 * `credential.repository.ts`.
 *
 * Vivía en `users/domain/ports/`. Se mudó con la credencial: `users` ya no hashea nada.
 */
export abstract class PasswordHasher {
  abstract hash(plain: string): Promise<PasswordHash>;
  abstract verify(plain: string, hash: PasswordHash): Promise<boolean>;
}

/**
 * Hash argon2id REAL pregenerado con los ARGON2_PARAMS de config. El login verifica contra
 * él cuando el email no existe, cuando el usuario no tiene credencial o cuando está
 * inactivo: mismo costo de tiempo que una verificación real — sin oráculo de timing.
 * Es un string puro: dominio-legal, y el password que lo generó es irrelevante.
 *
 * «Mismo costo» es hoy una afirmación MEDIDA y no una convención: `argon2.verify()` saca el
 * costo del propio string PHC, así que subir `memoryCost` en `ARGON2_PARAMS` sin regenerar
 * este literal reabriría el oráculo en silencio —la propiedad anti-enumeración cuenta
 * llamadas a `verify`, no milisegundos—. Lo ata `__tests__/domain/ports/password-hasher.spec.ts`
 * (Tabla H): si cambias los parámetros, regenera el hash o ese spec se pone rojo.
 */
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$aZs5KW7uRGkBkUl8FhiIUQ$nSzY3OYpbfE/CFT/DYcZea+S7IMzp2CUDL5voSfmC5k';
