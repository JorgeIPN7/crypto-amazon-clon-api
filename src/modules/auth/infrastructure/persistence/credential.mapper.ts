import { Credential } from '../../domain/entities/credential.entity';
import { PasswordHash } from '../../domain/value-objects/password-hash.vo';

import { CredentialOrmEntity } from './credential.orm-entity';

/**
 * Única frontera entre la fila de `auth_credentials` y el agregado. Al reconstituir se usa
 * `rehydrate`, no `create`: los datos ya persistidos no vuelven a pasar por las reglas de
 * creación —`create` acuñaría un id nuevo— porque eran válidos cuando se guardaron.
 *
 * `PasswordHash.from()` sí se aplica en la vuelta: es la red que impide que una fila
 * manipulada a mano (un password en claro escrito por SQL directo) entre al dominio como si
 * fuera un hash.
 */
export const CredentialMapper = {
  toDomain(row: CredentialOrmEntity): Credential {
    return Credential.rehydrate({
      id: row.id,
      userId: row.userId,
      passwordHash: PasswordHash.from(row.passwordHash),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  },

  toPersistence(credential: Credential): CredentialOrmEntity {
    const snapshot = credential.toSnapshot();
    const row = new CredentialOrmEntity();
    row.id = snapshot.id;
    row.userId = snapshot.userId;
    row.passwordHash = snapshot.passwordHash;
    row.createdAt = snapshot.createdAt;
    row.updatedAt = snapshot.updatedAt;
    return row;
  },
};
