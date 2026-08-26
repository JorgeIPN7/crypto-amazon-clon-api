import { Email } from '../../domain/value-objects/email.vo';
import { User } from '../../domain/entities/user.entity';
import { UserId } from '../../domain/value-objects/user-id.vo';
import type { UserRole } from '../../domain/user-role';

import { UserOrmEntity } from './user.orm-entity';

/**
 * Única frontera entre la fila de la tabla y el agregado. Al reconstituir se usa
 * `rehydrate`, no `create`: los datos ya persistidos no vuelven a pasar por las reglas
 * de creación, porque eran válidos cuando se guardaron.
 *
 * Los dos actores de la traza viajan TAL CUAL, `null` incluido y sin coalescer a nada: el `null`
 * de la columna significa «lo escribió el sistema» y es un valor legítimo del dominio, no un
 * hueco que rellenar. Las filas anteriores a `AddAuditActorColumns` también leen `null`, que es
 * la respuesta correcta: no se sabe quién las escribió.
 */
export const UserMapper = {
  toDomain(row: UserOrmEntity): User {
    return User.rehydrate({
      id: UserId.from(row.id),
      email: Email.from(row.email),
      name: row.name,
      // Se confía en la columna en esta frontera: solo el propio mapper y el seed del
      // primer admin la escriben. Un valor ajeno no eleva privilegios — falla cerrado,
      // porque no coincidiría con ningún `roles.includes()` del guard.
      role: row.role as UserRole,
      active: row.active,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
      deletedAt: row.deletedAt,
    });
  },

  toPersistence(user: User): UserOrmEntity {
    const snapshot = user.toSnapshot();
    const row = new UserOrmEntity();
    row.id = snapshot.id;
    row.email = snapshot.email;
    row.name = snapshot.name;
    row.role = snapshot.role;
    row.active = snapshot.active;
    row.createdAt = snapshot.createdAt;
    row.updatedAt = snapshot.updatedAt;
    row.createdBy = snapshot.createdBy;
    row.updatedBy = snapshot.updatedBy;
    row.deletedAt = snapshot.deletedAt;
    return row;
  },
};
