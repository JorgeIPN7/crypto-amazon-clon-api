import type { UsersLookup } from '../../../users/users.module';
import { UsersCustomerDirectory } from '../../infrastructure/users-customer.directory';

const KNOWN_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';

describe('UsersCustomerDirectory', () => {
  describe('exists()', () => {
    it('debería devolver true cuando la fachada conoce al usuario', async () => {
      // Arrange
      const directory = new UsersCustomerDirectory(buildLookup([KNOWN_ID]));

      // Act
      const result = await directory.exists(KNOWN_ID);

      // Assert
      expect(result).toBe(true);
    });

    it('debería devolver false cuando la fachada no lo conoce', async () => {
      // Arrange
      const directory = new UsersCustomerDirectory(buildLookup([]));

      // Act
      const result = await directory.exists(KNOWN_ID);

      // Assert
      expect(result).toBe(false);
    });
  });
});

// Helpers

/**
 * Fake escrito a mano de la puerta de consulta. Tiene DOS métodos, no cuatro: desde el
 * backlog #13 `orders` inyecta `UsersLookup` y no la fachada entera, así que `createProfile`
 * y `deleteProfile` ya no existen en el tipo — el borrado físico dejó de estar al alcance de
 * este adaptador al COMPILAR, que es justo lo que el ticket pedía demostrar. Este fake es la
 * prueba: si `UsersCustomerDirectory` volviera a inyectar la superficie completa, el objeto
 * de abajo dejaría de compilar en vez de seguir en verde — comprobado anotándolo como
 * `UsersLookup & UsersProvisioning` y corriendo `tsc --noEmit`: `TS2322`, «Type '{ userExists;
 * findByEmail }' is not assignable».
 *
 * `findByEmail` —el otro método de la puerta, que `orders` no usa— va con `unreachable()` en
 * vez de con un valor plausible: si este adaptador empezara a llamarlo, el test falla
 * nombrando el método en vez de pasar sobre un doble complaciente.
 */
const buildLookup = (knownIds: readonly string[]): UsersLookup => ({
  userExists: (id: string) => Promise.resolve(knownIds.includes(id)),
  findByEmail: () => unreachable('findByEmail'),
});

const unreachable = (method: string): never => {
  throw new Error(`UsersCustomerDirectory no debería llamar a UsersLookup.${method}()`);
};
