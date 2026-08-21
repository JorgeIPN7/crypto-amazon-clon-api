import { Credential } from '../../../domain/entities/credential.entity';
import { InvalidPasswordHashError } from '../../../domain/errors/auth.errors';
import { PasswordHash } from '../../../domain/value-objects/password-hash.vo';
import { CredentialMapper } from '../../../infrastructure/persistence/credential.mapper';
import { CredentialOrmEntity } from '../../../infrastructure/persistence/credential.orm-entity';

const CREATED_AT = new Date('2026-08-01T08:00:00.000Z');
const UPDATED_AT = new Date('2026-08-07T10:00:00.000Z');
const USER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const HASH_VALUE = '$argon2id$fake$mapper';

describe('CredentialMapper', () => {
  describe('toPersistence()', () => {
    it('debería volcar el agregado a columnas primitivas', () => {
      // Arrange
      const credential = buildCredential();

      // Act
      const row = CredentialMapper.toPersistence(credential);

      // Assert
      expect(row).toBeInstanceOf(CredentialOrmEntity);
      expect(row.id).toBe(credential.id);
      expect(row.userId).toBe(USER_ID);
      expect(row.passwordHash).toBe(HASH_VALUE);
      expect(row.createdAt).toEqual(CREATED_AT);
    });
  });

  describe('toDomain()', () => {
    it('debería reconstruir el agregado desde la fila conservando su id', () => {
      // Arrange
      const row = buildRow();

      // Act
      const credential = CredentialMapper.toDomain(row);

      // Assert
      expect(credential.id).toBe(row.id);
      expect(credential.userId).toBe(row.userId);
      expect(credential.passwordHash.value).toBe(row.passwordHash);
      expect(credential.updatedAt).toEqual(UPDATED_AT);
    });

    // La red contra una fila manipulada a mano: un password en claro escrito por SQL directo
    // no puede entrar al dominio disfrazado de hash.
    it('debería rechazar una fila cuyo hash no tiene forma de argon2id', () => {
      // Arrange
      const row = buildRow({ passwordHash: 'hunter2-en-claro' });

      // Act + Assert
      expect(() => CredentialMapper.toDomain(row)).toThrow(InvalidPasswordHashError);
    });
  });

  describe('toDomain() ∘ toPersistence()', () => {
    it('debería preservar el snapshot en el round-trip', () => {
      // Arrange
      const original = buildCredential();

      // Act
      const restored = CredentialMapper.toDomain(CredentialMapper.toPersistence(original));

      // Assert
      expect(restored.toSnapshot()).toEqual(original.toSnapshot());
    });
  });
});

// Helpers

const buildCredential = (): Credential =>
  Credential.create({
    userId: USER_ID,
    passwordHash: PasswordHash.from(HASH_VALUE),
    now: CREATED_AT,
  });

const buildRow = (overrides: Partial<CredentialOrmEntity> = {}): CredentialOrmEntity => {
  const row = new CredentialOrmEntity();
  row.id = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  row.userId = USER_ID;
  row.passwordHash = '$argon2id$fake$row';
  row.createdAt = CREATED_AT;
  row.updatedAt = UPDATED_AT;
  return Object.assign(row, overrides);
};
