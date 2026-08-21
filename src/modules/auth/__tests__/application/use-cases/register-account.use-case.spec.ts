import { test as fcTest, fc } from '@fast-check/jest';

import { RegisterAccountUseCase } from '../../../application/use-cases/register-account.use-case';
import {
  EmailAlreadyRegisteredError,
  InvalidProfileError,
} from '../../../domain/errors/auth.errors';
import { FakePasswordHasher, fakeHashOf } from '../../helpers/fake-password-hasher';
import { FakeUserDirectory } from '../../helpers/fake-user.directory';
import { InMemoryCredentialRepository } from '../../helpers/in-memory-credential.repository';

/**
 * Casos acordados — Tabla R (`RegisterAccountUseCase`, ciclo 4 del refactor de arquitectura).
 *
 * La tabla la definió la IA por autorización expresa del usuario para este ciclo, 1:1 con los
 * `it` de abajo.
 *
 * | #   | Caso                                              | Esperado                                                        |
 * | --- | ------------------------------------------------- | --------------------------------------------------------------- |
 * | R1  | Email libre y password válido                     | Devuelve el perfil creado (id, email, name, role, active…)       |
 * | R2  | Email libre y password válido                     | Guarda UNA credencial ligada al id que devolvió el directorio    |
 * | R3  | Email libre y password válido                     | La credencial guarda el hash del hasher, no el password en claro |
 * | R4  | Email libre y password válido                     | NO compensa: `deleteProfile` no se llama                         |
 * | R5  | El directorio responde `email-taken`              | `EmailAlreadyRegisteredError` y ninguna credencial guardada      |
 * | R6  | El directorio responde `invalid-profile`          | `InvalidProfileError` con el mensaje del directorio              |
 * | R7  | El hasher falla                                   | Propaga el error SIN llegar a crear perfil (nada que compensar)  |
 * | R8  | El repositorio de credenciales falla al guardar   | Compensa (borra el perfil) y propaga el error original           |
 * | R9  | El repositorio falla                              | No queda credencial guardada ni perfil huérfano                  |
 * | R10 | La credencial se escribió y aun así el save falló | La compensación borra TAMBIÉN la credencial (backlog #14)        |
 * | R11 | Email libre vs email tomado                       | `hash()` se llama UNA vez en los dos caminos (backlog #15)       |
 * | R12 | (P) Cualquier password válido                     | Ningún campo de la credencial contiene el password en claro      |
 *
 * **Tres cambios sobre la tabla del ciclo 4**, todos de esta tanda (backlog #14 y #15):
 *
 * - **R7 cambió de expectativa y su `it` de texto.** El hash pasó a calcularse ANTES de crear
 *   el perfil, así que un fallo del hasher ya no puede dejar un perfil detrás: no hay nada que
 *   compensar. El caso viejo —«compensa borrando el perfil cuando el hasher falla»— dejó de
 *   ser alcanzable, no de importar; lo que se afirma ahora es la consecuencia buena de la
 *   reordenación.
 * - **R10 y R11 son nuevos.**
 * - **R12 es la antigua R10**, sin tocar: solo se renumeró para que la fila de propiedad siga
 *   cerrando la tabla.
 */
describe('RegisterAccountUseCase', () => {
  it('debería devolver el perfil creado con el email y el nombre del alta', async () => {
    // Arrange
    const { useCase } = build();

    // Act
    const user = await useCase.execute({
      email: 'maria@example.com',
      name: 'María González',
      password: 'Password-Segura-1',
    });

    // Assert
    expect(user.email).toBe('maria@example.com');
    expect(user.name).toBe('María González');
    expect(user.active).toBe(true);
  });

  it('debería guardar una credencial ligada al id del perfil creado', async () => {
    // Arrange
    const { useCase, credentials } = build();

    // Act
    const user = await useCase.execute({
      email: 'maria@example.com',
      name: 'María González',
      password: 'Password-Segura-1',
    });

    // Assert
    expect(credentials.size()).toBe(1);
    const credential = await credentials.findByUserId(user.id);
    expect(credential?.userId).toBe(user.id);
  });

  it('debería guardar el hash que produce el hasher y nunca el password en claro', async () => {
    // Arrange
    const { useCase, credentials, hasher } = build();

    // Act
    const user = await useCase.execute({
      email: 'maria@example.com',
      name: 'María González',
      password: 'Password-Segura-1',
    });

    // Assert
    expect(hasher.hashCalls).toEqual(['Password-Segura-1']);
    const credential = await credentials.findByUserId(user.id);
    expect(credential?.passwordHash.value).toBe(fakeHashOf('Password-Segura-1'));
  });

  it('debería no compensar cuando el alta termina bien', async () => {
    // Arrange
    const { useCase, directory } = build();

    // Act
    await useCase.execute({
      email: 'maria@example.com',
      name: 'María González',
      password: 'Password-Segura-1',
    });

    // Assert
    expect(directory.deletedProfileIds).toEqual([]);
    expect(directory.size()).toBe(1);
  });

  it('debería lanzar EmailAlreadyRegisteredError cuando el directorio rechaza el email', async () => {
    // Arrange
    const { useCase, directory, credentials } = build();
    directory.createProfileOutcome = { ok: false, reason: 'email-taken' };

    // Act + Assert
    await expect(
      useCase.execute({
        email: 'tomado@example.com',
        name: 'Otro Usuario',
        password: 'Password-Segura-1',
      }),
    ).rejects.toThrow(EmailAlreadyRegisteredError);
    expect(credentials.size()).toBe(0);
  });

  it('debería lanzar InvalidProfileError conservando el mensaje del directorio', async () => {
    // Arrange
    const { useCase, directory, credentials } = build();
    directory.createProfileOutcome = {
      ok: false,
      reason: 'invalid-profile',
      message: '"sin-arroba" is not a valid email address',
    };

    // Act
    const error = await useCase
      .execute({ email: 'sin-arroba', name: 'Nombre', password: 'Password-Segura-1' })
      .then(() => null)
      .catch((e: unknown) => e as Error);

    // Assert
    expect(error).toBeInstanceOf(InvalidProfileError);
    expect(error?.message).toBe('"sin-arroba" is not a valid email address');
    expect(credentials.size()).toBe(0);
  });

  // R7. Con el hash delante del alta (backlog #15), un hasher caído ya no deja un perfil a
  // medias: el caso pasó de «compensa» a «no hay nada que compensar», que es estrictamente
  // mejor. Se afirman las dos mitades —ni perfil creado ni borrado— porque «cero perfiles» a
  // secas también sería cierto si se hubiera creado y borrado.
  it('debería no llegar a crear el perfil cuando el hasher falla', async () => {
    // Arrange
    const { useCase, directory, hasher } = build();
    hasher.failNextHashWith = new Error('argon2 no disponible');

    // Act
    const error = await useCase
      .execute({ email: 'maria@example.com', name: 'María', password: 'Password-Segura-1' })
      .then(() => null)
      .catch((e: unknown) => e as Error);

    // Assert
    expect(error?.message).toBe('argon2 no disponible');
    expect(directory.createProfileCalls).toEqual([]);
    expect(directory.deletedProfileIds).toEqual([]);
    expect(directory.size()).toBe(0);
  });

  it('debería compensar borrando el perfil cuando la credencial no puede guardarse', async () => {
    // Arrange
    const { useCase, directory, credentials } = build();
    credentials.failNextSaveWith = new Error('fallo al escribir la credencial');

    // Act
    const error = await useCase
      .execute({ email: 'maria@example.com', name: 'María', password: 'Password-Segura-1' })
      .then(() => null)
      .catch((e: unknown) => e as Error);

    // Assert
    expect(error?.message).toBe('fallo al escribir la credencial');
    expect(directory.deletedProfileIds).toHaveLength(1);
  });

  it('debería no dejar credencial ni perfil huérfano tras la compensación', async () => {
    // Arrange
    const { useCase, directory, credentials } = build();
    credentials.failNextSaveWith = new Error('fallo al escribir la credencial');

    // Act
    await useCase
      .execute({ email: 'maria@example.com', name: 'María', password: 'Password-Segura-1' })
      .catch(() => undefined);

    // Assert
    expect(credentials.size()).toBe(0);
    expect(directory.size()).toBe(0);
  });

  /**
   * R10 — el camino del backlog #14, y el único que no es alcanzable en E2E sin trucos: hace
   * falta que la fila quede COMMITEADA y que aun así la llamada rechace, y desde PostgreSQL
   * eso no se puede provocar (un `RAISE` en un trigger `BEFORE`/`AFTER INSERT`, o en un
   * `CONSTRAINT TRIGGER` diferido, aborta la transacción y se lleva la fila por delante; solo
   * un commit fuera de banda tipo `dblink` lo lograría). Con el fake sí, porque el fake puede
   * separar «escribió» de «respondió», que es justo lo que hace un timeout de red.
   *
   * Se pone rojo sin el arreglo: sin el `deleteByUserId` de la compensación, `size()` es 1.
   */
  it('debería borrar la credencial que sí se escribió antes de que el save fallara', async () => {
    // Arrange
    const { useCase, directory, credentials } = build();
    credentials.failNextSaveAfterWritingWith = new Error('conexión perdida tras el COMMIT');

    // Act
    const error = await useCase
      .execute({ email: 'huerfana@example.com', name: 'María', password: 'Password-Segura-1' })
      .then(() => null)
      .catch((e: unknown) => e as Error);

    // Assert
    expect(error?.message).toBe('conexión perdida tras el COMMIT');
    expect(credentials.size()).toBe(0);
    expect(credentials.deletedUserIds).toEqual(directory.deletedProfileIds);
    expect(directory.size()).toBe(0);
  });

  /**
   * R11 — el arreglo del backlog #15, fijado por la ESTRUCTURA y no por el reloj. Medir
   * milisegundos en un test sería inestable en CI, así que se afirma la causa del coste igual
   * que hace L9 en `login.use-case.spec.ts` con `verify()`: `hash()` se llama exactamente una
   * vez en los dos caminos. Antes de este cambio el camino «email tomado» lo llamaba CERO
   * veces, y eso —no el 409— es lo que delataba la cuenta: 7.52 ms de mediana frente a
   * 91.47 ms, distribuciones disjuntas (medición completa en la cabecera del caso de uso).
   *
   * El 409 se mantiene a propósito: es un compromiso de producto aceptado, y esta fila fija
   * que lo que se cerró es la fuga de tiempo.
   */
  it('debería hashear una sola vez tanto si el email está libre como si está tomado', async () => {
    // Arrange
    const free = build();
    const taken = build();
    taken.directory.createProfileOutcome = { ok: false, reason: 'email-taken' };

    // Act
    await free.useCase.execute({
      email: 'libre@example.com',
      name: 'Usuario Libre',
      password: 'Password-Segura-1',
    });
    await taken.useCase
      .execute({
        email: 'tomado@example.com',
        name: 'Usuario Tomado',
        password: 'Password-Segura-1',
      })
      .catch(() => undefined);

    // Assert
    expect(free.hasher.hashCalls).toEqual(['Password-Segura-1']);
    expect(taken.hasher.hashCalls).toEqual(['Password-Segura-1']);
  });

  describe('opacidad del hash (property-based)', () => {
    fcTest.prop([passwordArb()])(
      'debería no almacenar el password en claro en ningún campo de la credencial',
      async (password) => {
        // Arrange
        const { useCase, credentials } = build();

        // Act
        const user = await useCase.execute({
          email: 'propiedad@example.com',
          name: 'Usuario Propiedad',
          password,
        });

        // Assert
        const snapshot = (await credentials.findByUserId(user.id))?.toSnapshot() ?? {};
        for (const value of Object.values(snapshot)) {
          expect(String(value)).not.toContain(password);
        }
      },
    );
  });
});

// Helpers

const build = () => {
  const directory = new FakeUserDirectory();
  const credentials = new InMemoryCredentialRepository();
  const hasher = new FakePasswordHasher();
  return {
    directory,
    credentials,
    hasher,
    useCase: new RegisterAccountUseCase(directory, credentials, hasher),
  };
};

/**
 * Arbitrario CONSTRUIDO (nunca filtrado) de passwords dentro de los límites del DTO. La
 * longitud mínima de 12 evita el falso positivo de una cadena tan corta que aparezca por azar
 * dentro del base64 del hash falso.
 */
function passwordArb() {
  return fc.stringMatching(/^[A-Za-z0-9!@#$%^&*-]{12,64}$/);
}
