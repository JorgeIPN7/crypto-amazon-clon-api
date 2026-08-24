import { Entity, type AuditTrail } from '@shared/domain/entity.base';

import { CredentialId } from '../value-objects/credential-id.vo';
import type { PasswordHash } from '../value-objects/password-hash.vo';

export type CredentialSnapshot = {
  id: string;
  userId: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
};

/**
 * Raíz del agregado de `auth`: la credencial de acceso de una cuenta. Sin decoradores, sin
 * ORM y sin framework — el adaptador de persistencia la traduce desde y hacia la fila de
 * `auth_credentials`.
 *
 * `id` es un `CredentialId` desde este ciclo (antes, un `string` crudo): lo exige `Entity`,
 * que necesita un id comparable. `userId` en cambio SIGUE siendo `string` a propósito: el
 * identificador del usuario pertenece a `users`, y copiar aquí su `UserId` duplicaría una
 * invariante ajena que este contexto no puede mantener sincronizada. Mismo criterio que
 * `Order.customerId` en `orders` — y el mismo, exactamente, que hace que `createdBy` y
 * `updatedBy` de la traza sean `string | null` y no un VO de identidad.
 *
 * La única invariante real del agregado la lleva `PasswordHash` (forma PHC de argon2id), y
 * por eso vive en el VO y no aquí: lo que hay que impedir es persistir un password en claro,
 * no que la credencial cambie de estado — hoy no tiene transiciones (no hay caso de uso de
 * cambio de contraseña). Cuando lo haya, `changePassword(hash, now, by)` es su sitio, y ahí es
 * donde entrará el `touch(now, by)` que `Entity` ya le da hecho.
 *
 * Consecuencia directa: este agregado no tiene ningún mutador que propague actor, así que hoy
 * su `updatedBy` solo puede valer lo que valga `createdBy`. La traza está completa; su mitad
 * «updated» no se mueve hasta que exista la primera transición.
 */
export class Credential extends Entity<CredentialId> {
  private constructor(
    id: CredentialId,
    readonly userId: string,
    readonly passwordHash: PasswordHash,
    audit: AuditTrail,
  ) {
    super(id, audit);
  }

  /**
   * Alta de la credencial. El id lo acuña el propio agregado.
   *
   * `updatedBy` nace igual a `createdBy`, misma simetría que en `User.create`: quien la escribió
   * es el último que la escribió mientras no haya un `touch()`.
   */
  static create(params: {
    userId: string;
    passwordHash: PasswordHash;
    now: Date;
    createdBy: string | null;
  }): Credential {
    return new Credential(CredentialId.generate(), params.userId, params.passwordHash, {
      createdAt: params.now,
      updatedAt: params.now,
      createdBy: params.createdBy,
      updatedBy: params.createdBy,
    });
  }

  /** Reconstituye el agregado desde persistencia sin volver a aplicar reglas de creación. */
  static rehydrate(params: {
    id: CredentialId;
    userId: string;
    passwordHash: PasswordHash;
    createdAt: Date;
    updatedAt: Date;
    createdBy: string | null;
    updatedBy: string | null;
  }): Credential {
    return new Credential(params.id, params.userId, params.passwordHash, {
      createdAt: params.createdAt,
      updatedAt: params.updatedAt,
      createdBy: params.createdBy,
      updatedBy: params.updatedBy,
    });
  }

  toSnapshot(): CredentialSnapshot {
    return {
      id: this.id.value,
      userId: this.userId,
      passwordHash: this.passwordHash.value,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      createdBy: this.createdBy,
      updatedBy: this.updatedBy,
    };
  }
}
