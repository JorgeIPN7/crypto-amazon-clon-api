import { Credential } from '../../../domain/entities/credential.entity';
import { InvalidPasswordHashError } from '../../../domain/errors/auth.errors';
import { PasswordHash } from '../../../domain/value-objects/password-hash.vo';
import { CredentialMapper } from '../../../infrastructure/persistence/credential.mapper';
import { CredentialOrmEntity } from '../../../infrastructure/persistence/credential.orm-entity';

const CREATED_AT = new Date('2026-08-01T08:00:00.000Z');
const UPDATED_AT = new Date('2026-08-07T10:00:00.000Z');
const USER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const HASH_VALUE = '$argon2id$fake$mapper';
const ACTOR_ID = '5b7c2d4e-9a1f-4c3b-8e6d-0f2a4b6c8d1e';

describe('CredentialMapper', () => {
  describe('toPersistence()', () => {
    it('debería volcar el agregado a columnas primitivas', () => {
      // Arrange
      const credential = buildCredential();

      // Act
      const row = CredentialMapper.toPersistence(credential);

      // Assert
      expect(row).toBeInstanceOf(CredentialOrmEntity);
      expect(row.id).toBe(credential.id.value);
      expect(row.userId).toBe(USER_ID);
      expect(row.passwordHash).toBe(HASH_VALUE);
      expect(row.createdAt).toEqual(CREATED_AT);
    });

    // Nombra las dos columnas, que el round-trip de más abajo no hace: solo diría que dos
    // snapshots difieren. `createdBy: null` es el caso REAL del alta pública.
    it('debería escribir createdBy y updatedBy en la fila', () => {
      // Arrange
      const credential = buildCredential();

      // Act
      const row = CredentialMapper.toPersistence(credential);

      // Assert
      expect(row.createdBy).toBeNull();
      expect(row.updatedBy).toBeNull();
    });
  });

  describe('toDomain()', () => {
    it('debería reconstruir el agregado desde la fila conservando su id', () => {
      // Arrange
      const row = buildRow();

      // Act
      const credential = CredentialMapper.toDomain(row);

      // Assert
      expect(credential.id.value).toBe(row.id);
      expect(credential.userId).toBe(row.userId);
      expect(credential.passwordHash.value).toBe(row.passwordHash);
      expect(credential.updatedAt).toEqual(UPDATED_AT);
    });

    // Los dos actores llegan de la fila y NO se colapsan: valores distintos a propósito, porque
    // con el mismo un mapper que leyera `row.createdBy` dos veces pasaría igual.
    it('debería reconstruir los dos actores por separado desde la fila', () => {
      // Arrange
      const row = buildRow({ createdBy: null, updatedBy: ACTOR_ID });

      // Act
      const credential = CredentialMapper.toDomain(row);

      // Assert
      expect(credential.createdBy).toBeNull();
      expect(credential.updatedBy).toBe(ACTOR_ID);
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
    createdBy: null,
  });

const buildRow = (overrides: Partial<CredentialOrmEntity> = {}): CredentialOrmEntity => {
  const row = new CredentialOrmEntity();
  row.id = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  row.userId = USER_ID;
  row.passwordHash = '$argon2id$fake$row';
  row.createdAt = CREATED_AT;
  row.updatedAt = UPDATED_AT;
  row.createdBy = null;
  row.updatedBy = null;
  return Object.assign(row, overrides);
};
