import type { UsersLookup } from '../../../../users/users.module';
import { UsersOwnerDirectory } from '../../../infrastructure/gateways/users-owner.directory';

const KNOWN_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';

describe('UsersOwnerDirectory', () => {
  describe('exists()', () => {
    it('debería devolver true cuando la puerta de users conoce al dueño', async () => {
      // Arrange
      const directory = new UsersOwnerDirectory(buildLookup([KNOWN_ID]));

      // Act
      const result = await directory.exists(KNOWN_ID);

      // Assert
      expect(result).toBe(true);
    });

    it('debería devolver false cuando la puerta de users no lo conoce', async () => {
      // Arrange
      const directory = new UsersOwnerDirectory(buildLookup([]));

      // Act
      const result = await directory.exists(KNOWN_ID);

      // Assert
      expect(result).toBe(false);
    });
  });
});

// Helpers

/**
 * Fake escrito a mano de la puerta de CONSULTA. Tiene dos métodos, no cuatro: `wallets` inyecta
 * `UsersLookup` y no `UsersProvisioning`, así que `createProfile` y `deleteProfile` no existen
 * en el tipo — un borrado de perfil desde `wallets` no compilaría, que es lo que la segregación
 * por intención compra y lo que la matriz de fronteras, que razona por ruta, no puede ver.
 * Medido anotando este mismo objeto como `UsersLookup & UsersProvisioning` y corriendo
 * `npx tsc --noEmit`: `TS2322`, «Type '{ userExists…; findByEmail…; }' is not assignable to type
 * 'UsersLookup & UsersProvisioning'. … is missing the following properties from type
 * 'UsersProvisioning': createProfile, deleteProfile».
 *
 * `findByEmail` —el otro método de la puerta, que `wallets` no usa— va con `unreachable()` en
 * vez de con un valor plausible: si este adaptador empezara a llamarlo, el test falla nombrando
 * el método en lugar de pasar sobre un doble complaciente.
 *
 * `import type` AQUÍ es lo correcto y no contradice la regla del module file: este archivo no
 * tiene decoradores, así que `consistent-type-imports` lo exige. La asimetría con el adaptador
 * —que la importa como VALOR— es real, y el discriminador es «¿hay un decorador en el archivo?».
 */
const buildLookup = (knownIds: readonly string[]): UsersLookup => ({
  userExists: (id: string) => Promise.resolve(knownIds.includes(id)),
  findByEmail: () => unreachable('findByEmail'),
});

const unreachable = (method: string): never => {
  throw new Error(`UsersOwnerDirectory no debería llamar a UsersLookup.${method}()`);
};
