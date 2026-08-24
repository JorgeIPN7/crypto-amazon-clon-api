import { Credential } from '../../../domain/entities/credential.entity';
import { CredentialId } from '../../../domain/value-objects/credential-id.vo';
import { PasswordHash } from '../../../domain/value-objects/password-hash.vo';

const NOW = new Date('2026-08-07T10:00:00.000Z');
const LATER = new Date('2026-08-07T11:00:00.000Z');
const USER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
/** Actor de la traza. El alta real usa `null`; aquí hace falta un valor para distinguirlo. */
const ACTOR_ID = '5b7c2d4e-9a1f-4c3b-8e6d-0f2a4b6c8d1e';
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
      const credential = buildCredential();

      // Assert
      expect(credential.createdAt).toEqual(NOW);
      expect(credential.updatedAt).toEqual(NOW);
    });

    // Simetría con las marcas de tiempo, y el mismo motivo: quien la escribió es el último que
    // la escribió. El alta real pasa `null` —`POST /auth/register` es `@Public()`— pero el
    // agregado no lo impone: recibe el actor que le den.
    it('debería nacer con createdBy y updatedBy iguales al actor recibido', () => {
      // Act
      const credential = buildCredential({ createdBy: ACTOR_ID });

      // Assert
      expect(credential.createdBy).toBe(ACTOR_ID);
      expect(credential.updatedBy).toBe(ACTOR_ID);
    });

    it('debería aceptar null como actor: es el sistema, no un hueco', () => {
      // Act
      const credential = buildCredential();

      // Assert
      expect(credential.createdBy).toBeNull();
      expect(credential.updatedBy).toBeNull();
    });

    it('debería quedar ligada al usuario y al hash recibidos', () => {
      // Act
      const credential = buildCredential();

      // Assert
      expect(credential.userId).toBe(USER_ID);
      expect(credential.passwordHash).toBe(HASH);
    });

    // El id lo acuña el propio agregado, no lo recibe. Si dejara de hacerlo, dos credenciales
    // compartirían PK y la segunda pisaría a la primera al guardarse.
    //
    // La comparación es sobre `.value` y no sobre el objeto a propósito: desde que el id es un
    // `CredentialId`, `expect(first.id).not.toBe(second.id)` se cumpliría SIEMPRE —dos
    // instancias distintas nunca son la misma referencia— y este test quedaría verde aunque
    // `generate()` devolviera dos veces el mismo UUID.
    it('debería acuñar un identificador propio y distinto en cada alta', () => {
      // Act
      const first = buildCredential();
      const second = buildCredential();

      // Assert
      expect(first.id).toBeInstanceOf(CredentialId);
      expect(first.id.value).not.toBe(second.id.value);
    });
  });

  describe('rehydrate()', () => {
    it('debería reconstruir el agregado conservando su id y sus marcas de tiempo', () => {
      // Arrange
      const params = {
        id: CredentialId.from('7c9e6679-7425-40de-944b-e07fc1f90ae7'),
        userId: USER_ID,
        passwordHash: HASH,
        createdAt: NOW,
        updatedAt: LATER,
        createdBy: null,
        updatedBy: null,
      };

      // Act
      const credential = Credential.rehydrate(params);

      // Assert
      expect(credential.id.value).toBe(params.id.value);
      expect(credential.createdAt).toEqual(NOW);
      expect(credential.updatedAt).toEqual(LATER);
    });

    // Dos actores DISTINTOS, aunque el sistema todavía no pueda producir esa fila: es lo único
    // que demuestra que `rehydrate` no los colapsa. Con los dos iguales, una implementación que
    // ignorase el segundo parámetro pasaría igual — mismo argumento que el caso de las tres
    // fechas en `order.entity.spec.ts`.
    it('debería conservar createdBy y updatedBy por separado al reconstituir', () => {
      // Act
      const credential = Credential.rehydrate({
        id: CredentialId.from('7c9e6679-7425-40de-944b-e07fc1f90ae7'),
        userId: USER_ID,
        passwordHash: HASH,
        createdAt: NOW,
        updatedAt: LATER,
        createdBy: null,
        updatedBy: ACTOR_ID,
      });

      // Assert
      expect(credential.createdBy).toBeNull();
      expect(credential.updatedBy).toBe(ACTOR_ID);
    });
  });

  describe('toSnapshot()', () => {
    it('debería exponer valores primitivos en lugar de value objects', () => {
      // Arrange
      const credential = buildCredential({ createdBy: ACTOR_ID });

      // Act
      const snapshot = credential.toSnapshot();

      // Assert
      expect(snapshot).toEqual({
        id: credential.id.value,
        userId: USER_ID,
        passwordHash: HASH.value,
        createdAt: NOW,
        updatedAt: NOW,
        createdBy: ACTOR_ID,
        updatedBy: ACTOR_ID,
      });
    });

    it('debería sobrevivir al round-trip snapshot→rehydrate', () => {
      // Arrange
      const original = buildCredential({ createdBy: ACTOR_ID });

      // Act
      const revived = Credential.rehydrate({
        ...original.toSnapshot(),
        id: CredentialId.from(original.toSnapshot().id),
        passwordHash: PasswordHash.from(original.toSnapshot().passwordHash),
      });

      // Assert
      expect(revived.toSnapshot()).toEqual(original.toSnapshot());
    });
  });
});

// Helpers

const buildCredential = ({ createdBy = null }: { createdBy?: string | null } = {}): Credential =>
  Credential.create({ userId: USER_ID, passwordHash: HASH, now: NOW, createdBy });
