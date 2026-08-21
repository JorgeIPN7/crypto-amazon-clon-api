import { Email } from '../../domain/value-objects/email.vo';
import { User } from '../../domain/entities/user.entity';
import { UserId } from '../../domain/value-objects/user-id.vo';

/**
 * Factory único del agregado para los tests del módulo. Vive aquí, junto al
 * `in-memory-user.repository.ts`, y no en `test/helpers/`, para que mover el módulo se
 * lleve sus tests enteros — que es la razón de que `__tests__/` esté dentro del módulo.
 *
 * Antes esta función estaba copiada casi literalmente en cinco specs distintos, así que
 * cambiar el constructor de `User` obligaba a tocar cinco archivos.
 */
const DEFAULT_NOW = new Date('2026-07-27T10:00:00.000Z');

type BuildUserOverrides = {
  email?: string;
  name?: string;
  now?: Date;
};

export const buildUser = ({
  email = 'usuario@example.com',
  name = 'Usuario de Prueba',
  now = DEFAULT_NOW,
}: BuildUserOverrides = {}): User =>
  User.create({
    id: UserId.generate(),
    email: Email.from(email),
    name,
    now,
  });

/** Atajo para el caso más frecuente: lo único que distingue a un usuario de otro. */
export const buildUserWithEmail = (email: string): User => buildUser({ email });

/** Usuario ya desactivado, para los casos que dependen del estado y no de la transición. */
export const buildInactiveUser = (email: string): User => {
  const user = buildUser({ email });
  user.deactivate(DEFAULT_NOW);
  return user;
};
