import { Entity, type AuditTrail } from './entity.base';
import type { UuidId } from './uuid-id.base';

/**
 * Entidad que se borra marcándola, no quitándola de la tabla.
 *
 * **Es OPT-IN, y esa es la decisión.** La idea viene del `BaseEntity` de
 * `bridge-fital-pti-api`, donde `@DeleteDateColumn` y `is_active` están en la base y por tanto en
 * TODAS las tablas. Aquí no: es una clase aparte que una entidad ELIGE extender, porque poner
 * `deleted_at` en las tres tablas del repo habría metido una columna que nadie consulta en
 * `orders` y `auth_credentials`, y habría duplicado el concepto en `users`, que ya tiene `active`.
 *
 * **`deleted_at` y `active` no son lo mismo, y conviene no confundirlos** — es la trampa obvia:
 *   - `active` es un estado de NEGOCIO. Un usuario inactivo existe, ocupa su email, aparece en
 *     el listado y puede reactivarse; es lo que hace `DELETE /users/:id`, que a pesar del verbo
 *     es una desactivación lógica.
 *   - `deleted_at` es un estado de CICLO DE VIDA. Una fila borrada no existe para el dominio:
 *     no se lista, no se encuentra, no ocupa su email. Solo está ahí para poder deshacerlo.
 *
 * **Qué problema resuelve aquí, en concreto.** `UsersProvisioning.deleteProfile` es un `DELETE`
 * FÍSICO, y es la compensación de un alta cuya credencial no pudo escribirse. Si se dispara por
 * error —o por el defecto de backlog #16, que hoy tiene DOS borrados capaces de enmascarar el
 * error original— el perfil se pierde para siempre, sobre un esquema con CERO foreign keys donde
 * nada avisa de que había filas apuntando a él. Con la marca, es recuperable.
 *
 * **La copia del `Date` en el getter es la ÚNICA defensa aquí**, y no una simetría decorativa.
 * En `AuditTrail` hay además un `Object.freeze` sobre el objeto contenedor; `deletedAt` es un
 * campo suelto, así que no hay nada que congelar. Y congelar tampoco bastaría: medido en el
 * kernel, `Object.freeze` no protege un `Date` porque su valor vive en un slot interno.
 *
 * Los dos mutadores son idempotentes con el corte ANTES del `touch`, igual que los de `User`:
 * un segundo borrado no reescribe el actor, así que la traza sigue nombrando a quien lo borró.
 */
export abstract class SoftDeletableEntity<TId extends UuidId> extends Entity<TId> {
  private _deletedAt: Date | null;

  protected constructor(id: TId, audit: AuditTrail, deletedAt: Date | null) {
    super(id, audit);
    this._deletedAt = SoftDeletableEntity.copy(deletedAt);
  }

  private static copy(value: Date | null): Date | null {
    return value === null ? null : new Date(value);
  }

  /** Copia en cada llamada: sin ella, quien la recibe puede mover el sello (ver cabecera). */
  get deletedAt(): Date | null {
    return SoftDeletableEntity.copy(this._deletedAt);
  }

  get isDeleted(): boolean {
    return this._deletedAt !== null;
  }

  /** Borrar es modificar: avanza también `updatedAt`/`updatedBy`, que dicen QUIÉN lo borró. */
  protected markDeleted(now: Date, by: string | null): void {
    if (this._deletedAt !== null) {
      return;
    }
    this._deletedAt = new Date(now);
    this.touch(now, by);
  }

  protected restore(now: Date, by: string | null): void {
    if (this._deletedAt === null) {
      return;
    }
    this._deletedAt = null;
    this.touch(now, by);
  }
}
