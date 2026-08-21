import { Argon2PasswordHasher } from '../../../infrastructure/security/argon2-password-hasher';

/**
 * Argon2 real, no un doble: es precisamente el algoritmo lo que hay que verificar
 * (prefijo `$argon2id$`, que el mismo plano produce hashes distintos por el salt, y
 * que `verify` solo acepta el plano correcto). Una sola iteración de test, no de
 * costo — `ARGON2_PARAMS` no cambia entre entornos.
 */
describe('Argon2PasswordHasher', () => {
  describe('hash()', () => {
    it('debería producir un hash con el prefijo argon2id', async () => {
      // Arrange
      const hasher = new Argon2PasswordHasher();

      // Act
      const hash = await hasher.hash('Password-Segura-1');

      // Assert
      expect(hash.value.startsWith('$argon2id$')).toBe(true);
    });

    it('debería producir hashes distintos para el mismo password', async () => {
      // Arrange
      const hasher = new Argon2PasswordHasher();

      // Act
      const first = await hasher.hash('Password-Segura-1');
      const second = await hasher.hash('Password-Segura-1');

      // Assert: el salt aleatorio de argon2 hace que dos hashes del mismo plano difieran.
      expect(first.value).not.toBe(second.value);
    });
  });

  describe('verify()', () => {
    it('debería aceptar el password correcto', async () => {
      // Arrange
      const hasher = new Argon2PasswordHasher();
      const hash = await hasher.hash('Password-Segura-1');

      // Act
      const result = await hasher.verify('Password-Segura-1', hash);

      // Assert
      expect(result).toBe(true);
    });

    it('debería rechazar un password incorrecto', async () => {
      // Arrange
      const hasher = new Argon2PasswordHasher();
      const hash = await hasher.hash('Password-Segura-1');

      // Act
      const result = await hasher.verify('otro-password', hash);

      // Assert
      expect(result).toBe(false);
    });
  });
});
