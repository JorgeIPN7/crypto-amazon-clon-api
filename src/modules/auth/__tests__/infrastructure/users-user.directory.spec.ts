import type {
  CreateProfileResult,
  UserSummary,
  UsersLookup,
  UsersProvisioning,
} from '../../../users/users.module';
import { UsersUserDirectory } from '../../infrastructure/users-user.directory';

const KNOWN_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const CREATED_AT = new Date('2026-08-07T10:00:00.000Z');
const UPDATED_AT = new Date('2026-08-07T11:00:00.000Z');

/**
 * Casos acordados — Tabla D (`UsersUserDirectory`, ciclo 4). Definidos por la IA con la
 * autorización expresa del usuario, 1:1 con los `it` de abajo.
 *
 * | #   | Caso                                                | Esperado                                             |
 * | --- | --------------------------------------------------- | ---------------------------------------------------- |
 * | D1  | `findByEmail` con un email que la fachada conoce    | Devuelve el `DirectoryUser` traducido campo a campo  |
 * | D2  | `findByEmail` con un email que la fachada no conoce | `null`                                               |
 * | D3  | `createProfile` con alta correcta                   | `{ ok: true }` con el usuario traducido              |
 * | D4  | `createProfile` rechazado por email duplicado       | Propaga `{ ok: false, reason: 'email-taken' }`       |
 * | D5  | `createProfile` rechazado por perfil inválido       | Propaga el `message` sin tocarlo                     |
 * | D6  | `deleteProfile`                                     | Delega en la fachada con el MISMO id                 |
 * | D7  | La fachada devuelve un campo extra                  | El campo NO cruza: la traducción es campo a campo    |
 * | D8  | La fachada añade un campo extra al RECHAZO          | Tampoco cruza: los rechazos también se reconstruyen  |
 *
 * D8 se añadió en la revisión adversarial del ciclo 4: la rama de fallo hacía `return result`
 * y era el único punto donde la promesa de traducción campo a campo no se cumplía. Un campo
 * opcional nuevo en el rechazo de `users` habría llegado a auth sin romper nada.
 *
 * «La fachada» de la tabla son DOS clases desde el backlog #13 —`UsersLookup` y
 * `UsersProvisioning`—, y este adaptador inyecta las dos. Los casos no cambian: siguen
 * describiendo el mismo comportamiento observable, solo que el doble que los alimenta son
 * ahora dos objetos con dos tipos.
 */
describe('UsersUserDirectory', () => {
  describe('findByEmail()', () => {
    it('debería traducir el resumen de la fachada a DirectoryUser', async () => {
      // Arrange
      const directory = new UsersUserDirectory(...buildGates({ user: buildSummary() }));

      // Act
      const result = await directory.findByEmail('maria@example.com');

      // Assert
      expect(result).toEqual({
        id: KNOWN_ID,
        email: 'maria@example.com',
        name: 'María González',
        role: 'user',
        active: true,
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
      });
    });

    it('debería devolver null cuando la fachada no conoce el email', async () => {
      // Arrange
      const directory = new UsersUserDirectory(...buildGates({ user: null }));

      // Act
      const result = await directory.findByEmail('nadie@example.com');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('createProfile()', () => {
    it('debería propagar el alta correcta con el usuario traducido', async () => {
      // Arrange
      const directory = new UsersUserDirectory(
        ...buildGates({ createResult: { ok: true, user: buildSummary() } }),
      );

      // Act
      const result = await directory.createProfile({
        email: 'maria@example.com',
        name: 'María González',
      });

      // Assert
      expect(result).toEqual({
        ok: true,
        user: expect.objectContaining({ id: KNOWN_ID, email: 'maria@example.com' }),
      });
    });

    it('debería propagar el rechazo por email duplicado tal cual', async () => {
      // Arrange
      const directory = new UsersUserDirectory(
        ...buildGates({ createResult: { ok: false, reason: 'email-taken' } }),
      );

      // Act
      const result = await directory.createProfile({ email: 'x@example.com', name: 'Nombre' });

      // Assert
      expect(result).toEqual({ ok: false, reason: 'email-taken' });
    });

    it('debería propagar el rechazo por perfil inválido conservando el mensaje', async () => {
      // Arrange
      const directory = new UsersUserDirectory(
        ...buildGates({
          createResult: {
            ok: false,
            reason: 'invalid-profile',
            message: '"sin-arroba" is not a valid email address',
          },
        }),
      );

      // Act
      const result = await directory.createProfile({ email: 'sin-arroba', name: 'Nombre' });

      // Assert
      expect(result).toEqual({
        ok: false,
        reason: 'invalid-profile',
        message: '"sin-arroba" is not a valid email address',
      });
    });
  });

  describe('deleteProfile()', () => {
    it('debería delegar en la fachada con el mismo id', async () => {
      // Arrange
      const deleted: string[] = [];
      const directory = new UsersUserDirectory(...buildGates({ deleted }));

      // Act
      await directory.deleteProfile(KNOWN_ID);

      // Assert
      expect(deleted).toEqual([KNOWN_ID]);
    });
  });

  /**
   * La razón de que el ACL mapee campo a campo en vez de devolver el objeto de la fachada:
   * si `users` añade un campo a `UserSummary` —un teléfono, una preferencia— no aparece en
   * las respuestas de `auth` hasta que alguien lo decida aquí.
   */
  it('debería no dejar pasar un campo que la fachada añada por su cuenta', async () => {
    // Arrange
    const withExtra = { ...buildSummary(), phone: '+52 55 0000 0000' } as UserSummary;
    const directory = new UsersUserDirectory(...buildGates({ user: withExtra }));

    // Act
    const result = await directory.findByEmail('maria@example.com');

    // Assert
    expect(result).not.toHaveProperty('phone');
  });

  /**
   * El mismo blindaje, en la rama que se lo saltaba. El campo extra es OPCIONAL a propósito:
   * uno requerido rompería el fake al compilar y nunca llegaría aquí — el que se cuela es el
   * que TypeScript deja pasar.
   */
  it('debería no dejar pasar un campo que la fachada añada al rechazo', async () => {
    // Arrange
    const withExtra = {
      ok: false,
      reason: 'email-taken',
      retryAfterSeconds: 30,
    } as CreateProfileResult;
    const directory = new UsersUserDirectory(...buildGates({ createResult: withExtra }));

    // Act
    const result = await directory.createProfile({ email: 'x@example.com', name: 'Nombre' });

    // Assert
    expect(result).toEqual({ ok: false, reason: 'email-taken' });
    expect(result).not.toHaveProperty('retryAfterSeconds');
  });
});

// Helpers

const buildSummary = (): UserSummary => ({
  id: KNOWN_ID,
  email: 'maria@example.com',
  name: 'María González',
  role: 'user',
  active: true,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
});

type GateOptions = {
  user?: UserSummary | null;
  createResult?: CreateProfileResult;
  deleted?: string[];
};

/**
 * Fakes escritos a mano de las DOS puertas que este adaptador inyecta desde el backlog #13.
 * Se construyen juntos porque las opciones del test describen un solo escenario, pero son
 * dos objetos con dos tipos: el de consulta no puede borrar nada ni aunque el test quisiera.
 */
const buildGates = ({
  user = null,
  createResult,
  deleted = [],
}: GateOptions): [UsersLookup, UsersProvisioning] => [
  {
    userExists: () => Promise.resolve(user !== null),
    findByEmail: () => Promise.resolve(user),
  },
  {
    createProfile: () =>
      Promise.resolve(createResult ?? { ok: false, reason: 'email-taken' as const }),
    deleteProfile: (id: string) => {
      deleted.push(id);
      return Promise.resolve();
    },
  },
];
