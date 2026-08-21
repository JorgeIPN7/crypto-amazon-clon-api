import { Credential } from '../../../domain/entities/credential.entity';
import { PasswordHash } from '../../../domain/value-objects/password-hash.vo';

const NOW = new Date('2026-08-07T10:00:00.000Z');
const LATER = new Date('2026-08-07T11:00:00.000Z');
const USER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const HASH = PasswordHash.from(
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$aBcDeFgHiJkLmNoPqRsTuVwXyZ012345678901234567',
);

/**
 * El agregado no tiene transiciones (no hay caso de uso de cambio de contraseña), así que no
 * lleva tabla de casos: su contrato es identidad, factorías y snapshot. La invariante real
 * del contexto —«esto es un hash, no un password»— vive en `PasswordHash` y se prueba allí.
 */
describe('Credential', () => {
  describe('create()', () => {
    it('debería nacer con las marcas de tiempo iguales', () => {
      // Act
      const credential = Credential.create({ userId: USER_ID, passwordHash: HASH, now: NOW });

      // Assert
      expect(credential.createdAt).toEqual(NOW);
      expect(credential.updatedAt).toEqual(NOW);
    });

    it('debería quedar ligada al usuario y al hash recibidos', () => {
      // Act
      const credential = Credential.create({ userId: USER_ID, passwordHash: HASH, now: NOW });

      // Assert
      expect(credential.userId).toBe(USER_ID);
      expect(credential.passwordHash).toBe(HASH);
    });

    // No hay VO de identidad: el id lo acuña el propio agregado. Si dejara de hacerlo, dos
    // credenciales compartirían PK y la segunda pisaría a la primera al guardarse.
    it('debería acuñar un identificador propio y distinto en cada alta', () => {
      // Act
      const first = Credential.create({ userId: USER_ID, passwordHash: HASH, now: NOW });
      const second = Credential.create({ userId: USER_ID, passwordHash: HASH, now: NOW });

      // Assert
      expect(first.id).toEqual(expect.any(String));
      expect(first.id).not.toBe(second.id);
    });
  });

  describe('rehydrate()', () => {
    it('debería reconstruir el agregado conservando su id y sus marcas de tiempo', () => {
      // Arrange
      const params = {
        id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        userId: USER_ID,
        passwordHash: HASH,
        createdAt: NOW,
        updatedAt: LATER,
      };

      // Act
      const credential = Credential.rehydrate(params);

      // Assert
      expect(credential.id).toBe(params.id);
      expect(credential.createdAt).toEqual(NOW);
      expect(credential.updatedAt).toEqual(LATER);
    });
  });

  describe('toSnapshot()', () => {
    it('debería exponer valores primitivos en lugar de value objects', () => {
      // Arrange
      const credential = Credential.create({ userId: USER_ID, passwordHash: HASH, now: NOW });

      // Act
      const snapshot = credential.toSnapshot();

      // Assert
      expect(snapshot).toEqual({
        id: credential.id,
        userId: USER_ID,
        passwordHash: HASH.value,
        createdAt: NOW,
        updatedAt: NOW,
      });
    });

    it('debería sobrevivir al round-trip snapshot→rehydrate', () => {
      // Arrange
      const original = Credential.create({ userId: USER_ID, passwordHash: HASH, now: NOW });

      // Act
      const revived = Credential.rehydrate({
        ...original.toSnapshot(),
        passwordHash: PasswordHash.from(original.toSnapshot().passwordHash),
      });

      // Assert
      expect(revived.toSnapshot()).toEqual(original.toSnapshot());
    });
  });
});
