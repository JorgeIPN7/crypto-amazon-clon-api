import { Email } from '../../domain/value-objects/email.vo';
import { User } from '../../domain/entities/user.entity';
import { UserId } from '../../domain/value-objects/user-id.vo';
import type { UserRole } from '../../domain/value-objects/user-role';

import { UserOrmEntity } from './user.orm-entity';

/**
 * Única frontera entre la fila de la tabla y el agregado. Al reconstituir se usa
 * `rehydrate`, no `create`: los datos ya persistidos no vuelven a pasar por las reglas
 * de creación, porque eran válidos cuando se guardaron.
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
    return row;
  },
};
