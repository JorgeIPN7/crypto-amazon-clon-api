import type { AuditTrail } from '@shared/domain/entity.base';
import { SoftDeletableEntity } from '@shared/domain/soft-deletable-entity.base';

import type { Email } from '../value-objects/email.vo';
import { InvalidUserNameError } from '../errors/user.errors';
import type { UserId } from '../value-objects/user-id.vo';
import type { UserRole } from '../user-role';

const NAME_MIN_LENGTH = 2;
const NAME_MAX_LENGTH = 120;

export type UserSnapshot = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: Date | null;
};

/**
 * Raíz del agregado. Sin decoradores, sin ORM y sin dependencias de framework: sus
 * invariantes se garantizan en el constructor y en los métodos, no en un validador externo.
 * El adaptador de persistencia lo traduce desde y hacia la fila de la tabla.
 *
 * `id` y la traza de auditoría (`createdAt`, `updatedAt`, `createdBy`, `updatedBy`) los pone
 * `Entity`, junto con `equals()` y `touch()`. Las dos fechas estaban escritas a mano aquí y en
 * los otros dos agregados; los dos actores son capacidad NUEVA y no existían en ninguno.
 *
 * **Los cinco mutadores reciben `by` y ninguno lo puede omitir.** `touch(now, by)` lo exige, así
 * que un mutador que se olvidara del actor no compila. `by` es `string | null` —el id del actor
 * o `null` para el sistema— y NO un `UserId`: aquí sí podría serlo (este es el contexto dueño
 * del identificador), pero el campo lo declara `AuditTrail` en `shared/`, que no puede importar
 * de `modules/`. Un tipo distinto por agregado sería peor que uno común: rompería el round-trip
 * con la fila, que es una columna `varchar` para las tres tablas.
 *
 * **Sin `passwordHash` desde el ciclo 4.** El usuario es un PERFIL: identidad, nombre, rol y
 * vigencia. La credencial es el agregado `Credential` del bounded context `auth`, con su
 * propia tabla. El corte no es estético — mientras el hash vivía aquí, cualquier consulta de
 * perfil arrastraba el secreto y cualquier `toSnapshot()` podía filtrarlo.
 */
export class User extends SoftDeletableEntity<UserId> {
  /**
   * Recibe la `AuditTrail` entera y no las marcas sueltas. Con cuatro campos, la alternativa
   * eran nueve parámetros posicionales seguidos de `Date, Date, string|null, string|null` — la
   * clase exacta de bug que `CLAUDE.md` evita en los casos de uso con entradas nombradas.
   */
  private constructor(
    id: UserId,
    private _email: Email,
    private _name: string,
    private _role: UserRole,
    private _active: boolean,
    audit: AuditTrail,
    deletedAt: Date | null,
  ) {
    super(id, audit, deletedAt);
  }

  /**
   * `updatedBy` nace igual a `createdBy`, por la misma simetría que hace que `updatedAt` nazca
   * igual a `createdAt`: quien creó la fila es, hasta el primer `touch()`, el último que la
   * escribió. Ponerlo a `null` diría que nadie la ha tocado nunca, y sería falso.
   */
  static create(params: {
    id: UserId;
    email: Email;
    name: string;
    now: Date;
    createdBy: string | null;
  }): User {
    const name = User.assertName(params.name);
    return new User(
      params.id,
      params.email,
      name,
      'user',
      true,
      {
        createdAt: params.now,
        updatedAt: params.now,
        createdBy: params.createdBy,
        updatedBy: params.createdBy,
      },
      null,
    );
  }

  /** Reconstituye el agregado desde persistencia sin volver a aplicar reglas de creación. */
  static rehydrate(params: {
    id: UserId;
    email: Email;
    name: string;
    role: UserRole;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
    createdBy: string | null;
    updatedBy: string | null;
    deletedAt: Date | null;
  }): User {
    return new User(
      params.id,
      params.email,
      params.name,
      params.role,
      params.active,
      {
        createdAt: params.createdAt,
        updatedAt: params.updatedAt,
        createdBy: params.createdBy,
        updatedBy: params.updatedBy,
      },
      params.deletedAt,
    );
  }

  get email(): Email {
    return this._email;
  }

  get name(): string {
    return this._name;
  }

  get role(): UserRole {
    return this._role;
  }

  get active(): boolean {
    return this._active;
  }

  rename(name: string, now: Date, by: string | null): void {
    this._name = User.assertName(name);
    this.touch(now, by);
  }

  changeEmail(email: Email, now: Date, by: string | null): void {
    if (this._email.equals(email)) {
      return;
    }
    this._email = email;
    this.touch(now, by);
  }

  deactivate(now: Date, by: string | null): void {
    if (!this._active) {
      return;
    }
    this._active = false;
    this.touch(now, by);
  }

  activate(now: Date, by: string | null): void {
    if (this._active) {
      return;
    }
    this._active = true;
    this.touch(now, by);
  }

  /**
   * Único camino de dominio hacia admin. Idempotente: repetirlo no toca `updatedAt` — ni, desde
   * esta fase, `updatedBy`. El corte en seco es anterior al `touch`, así que una promoción
   * repetida tampoco reescribe el actor: la traza sigue nombrando a quien la promovió de verdad.
   * Lo mismo vale para los otros tres mutadores idempotentes.
   */
  promoteToAdmin(now: Date, by: string | null): void {
    if (this._role === 'admin') {
      return;
    }
    this._role = 'admin';
    this.touch(now, by);
  }

  /**
   * Borrado LÓGICO del perfil, y no confundir con `deactivate()`: un usuario inactivo sigue
   * existiendo —ocupa su email, se lista, se reactiva—, mientras que uno borrado no existe para
   * el dominio. El criterio completo está en `SoftDeletableEntity`.
   *
   * Su único llamante es `UsersProvisioning.deleteProfile`, la compensación del alta cuya
   * credencial no pudo escribirse. Hasta el 2026-08-25 esa compensación hacía un DELETE físico
   * sobre un esquema sin una sola foreign key: disparada por error, el perfil se perdía y nada
   * avisaba de las filas que apuntaban a él.
   */
  softDelete(now: Date, by: string | null): void {
    this.markDeleted(now, by);
  }

  // NO hay `restoreProfile()`. Se escribió y se quitó el mismo día: no tenía un solo llamante, y
  // el auditor de mutación lo delató con sus dos únicos mutantes sin cobertura de todo el ciclo.
  // La capacidad existe y está probada en `SoftDeletableEntity.restore()`; exponerla aquí es una
  // línea el día que exista un caso de uso que restaure, y hoy no lo hay. Mismo criterio con el
  // que `delete()` salió de `UserRepository`: un método público invita a llamarlo.

  toSnapshot(): UserSnapshot {
    return {
      id: this.id.value,
      email: this._email.value,
      name: this._name,
      role: this._role,
      active: this._active,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      createdBy: this.createdBy,
      updatedBy: this.updatedBy,
      deletedAt: this.deletedAt,
    };
  }

  private static assertName(name: string): string {
    const trimmed = name.trim();
    if (trimmed.length < NAME_MIN_LENGTH || trimmed.length > NAME_MAX_LENGTH) {
      throw new InvalidUserNameError(name);
    }
    return trimmed;
  }
}
