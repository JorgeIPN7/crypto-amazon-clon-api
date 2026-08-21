import { test as fcTest, fc } from '@fast-check/jest';

import { LoginUseCase } from '../../../application/use-cases/login.use-case';
import { Credential } from '../../../domain/entities/credential.entity';
import { InvalidCredentialsError } from '../../../domain/errors/auth.errors';
import { DUMMY_PASSWORD_HASH } from '../../../domain/ports/password-hasher';
import type { DirectoryUser } from '../../../domain/ports/user-directory';
import { PasswordHash } from '../../../domain/value-objects/password-hash.vo';
import { FakePasswordHasher, fakeHashOf } from '../../helpers/fake-password-hasher';
import { FakeTokenSigner } from '../../helpers/fake-token-signer';
import { FakeUserDirectory, buildDirectoryUser } from '../../helpers/fake-user.directory';
import { InMemoryCredentialRepository } from '../../helpers/in-memory-credential.repository';

/**
 * Casos acordados — Tabla L (`LoginUseCase`, ciclo 4 del refactor de arquitectura).
 *
 * La tabla la definió la IA por autorización expresa del usuario para este ciclo («implementa
 * la opción recomendada sin consultarme»), 1:1 con los `it` de abajo.
 *
 * | #   | Caso                                                        | Esperado                                                     |
 * | --- | ----------------------------------------------------------- | ------------------------------------------------------------ |
 * | L1  | Credenciales válidas                                        | Devuelve accessToken, expiresInSeconds y el usuario           |
 * | L2  | Email inexistente                                           | `InvalidCredentialsError`                                     |
 * | L3  | Usuario existente SIN credencial                            | `InvalidCredentialsError` (caso nuevo: dos tablas, dos dueños)|
 * | L4  | Password incorrecto                                         | `InvalidCredentialsError`                                     |
 * | L5  | Usuario inactivo                                            | `InvalidCredentialsError`                                     |
 * | L6  | Email inexistente                                           | Verifica contra `DUMMY_PASSWORD_HASH`                         |
 * | L7  | Usuario con rol admin                                       | Firma el token con ese rol                                    |
 * | L8  | Email con espacios y mayúsculas                             | Lo pasa TAL CUAL al directorio (normalizar es de `users`)     |
 * | L9  | (P) Los CUATRO caminos de fallo                             | Error indistinguible (tipo, nombre, mensaje) y UN solo verify |
 *
 * L9 es el requisito de seguridad medido del ciclo: si se pierde, el ciclo falla.
 *
 * **El endpoint de al lado NO es indistinguible, y es una decisión escrita** (backlog #15,
 * cerrado el 2026-08-08). `POST /auth/register` responde 409 cuando el email ya tiene cuenta:
 * se ACEPTA como compromiso de producto —sin él, quien ya está registrado no sabe por qué no
 * puede darse de alta— y así lo dice el `description` de `registerAccount` en
 * `auth.controller.ts`, que apunta a esta fila igual que esta fila apunta a él. Lo que sí se
 * cerró es la fuga de TIEMPO, que era indefendible porque delataba la cuenta aunque el
 * cliente ignorase el código de estado: `RegisterAccountUseCase` hashea antes de comprobar la
 * unicidad, y su fila R11 fija —por estructura, no por reloj— que los dos caminos llaman a
 * `hash()` exactamente una vez, que es el mismo patrón que L9 usa aquí con `verify()`.
 * Quien toque uno de los dos endpoints debería leer el otro antes.
 */
describe('LoginUseCase', () => {
  it('debería devolver token, expiración y usuario con credenciales válidas', async () => {
    // Arrange
    const { useCase, user } = buildWithAccount('maria@example.com', 'Password-Segura-1');

    // Act
    const result = await useCase.execute({
      email: 'maria@example.com',
      password: 'Password-Segura-1',
    });

    // Assert
    expect(result.accessToken).toBe(`fake.jwt.${user.id}`);
    expect(result.expiresInSeconds).toBe(3600);
    expect(result.user.id).toBe(user.id);
  });

  it('debería lanzar InvalidCredentialsError si el email no existe', async () => {
    // Arrange
    const { useCase } = build();

    // Act + Assert
    await expect(
      useCase.execute({ email: 'nadie@example.com', password: 'lo-que-sea-123' }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  // Caso NUEVO del ciclo 4: perfil y credencial son de dueños distintos, así que un perfil
  // sin credencial es un estado alcanzable (una compensación que no llegó a completarse).
  it('debería lanzar InvalidCredentialsError si el usuario no tiene credencial', async () => {
    // Arrange
    const user = buildDirectoryUser({ email: 'sin.credencial@example.com' });
    const { useCase } = build({ users: [user] });

    // Act + Assert
    await expect(
      useCase.execute({ email: 'sin.credencial@example.com', password: 'lo-que-sea-123' }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it('debería lanzar InvalidCredentialsError si el password no coincide', async () => {
    // Arrange
    const { useCase } = buildWithAccount('maria@example.com', 'Password-Correcta-1');

    // Act + Assert
    await expect(
      useCase.execute({ email: 'maria@example.com', password: 'password-mala-9' }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it('debería lanzar InvalidCredentialsError si el usuario está inactivo', async () => {
    // Arrange
    const { useCase } = buildWithAccount('baja@example.com', 'Password-Correcta-1', {
      active: false,
    });

    // Act + Assert
    await expect(
      useCase.execute({ email: 'baja@example.com', password: 'Password-Correcta-1' }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it('debería verificar contra el hash dummy cuando el email no existe', async () => {
    // Arrange
    const { useCase, hasher } = build();

    // Act
    await useCase
      .execute({ email: 'nadie@example.com', password: 'x-y-z-123456' })
      .catch(() => undefined);

    // Assert
    expect(hasher.verifyCalls).toHaveLength(1);
    expect(hasher.verifyCalls[0]?.hash.value).toBe(DUMMY_PASSWORD_HASH);
  });

  it('debería firmar con el rol del usuario', async () => {
    // Arrange
    const { useCase, signer, user } = buildWithAccount('root@example.com', 'Password-Correcta-1', {
      role: 'admin',
    });

    // Act
    await useCase.execute({ email: 'root@example.com', password: 'Password-Correcta-1' });

    // Assert
    expect(signer.signCalls).toEqual([{ sub: user.id, email: 'root@example.com', role: 'admin' }]);
  });

  /**
   * El `it` original decía «debería normalizar el email antes de buscar». Cambió de texto
   * porque la responsabilidad cambió de dueño: desde el ciclo 4 la normalización la hace
   * `users` con el MISMO `Email.from` del alta, y auth solo transporta la cadena. Dejar el
   * texto anterior habría afirmado sobre este SUT algo que ya no hace.
   */
  it('debería delegar la normalización del email pasándolo tal cual al directorio', async () => {
    // Arrange
    const { useCase, directory } = build();

    // Act
    await useCase
      .execute({ email: '  ADMIN@X.COM ', password: 'Password-Correcta-1' })
      .catch(() => undefined);

    // Assert
    expect(directory.findByEmailCalls).toEqual(['  ADMIN@X.COM ']);
  });

  describe('indistinguibilidad (property-based)', () => {
    fcTest.prop([
      fc.constantFrom<'no-user' | 'no-credential' | 'bad-password' | 'inactive'>(
        'no-user',
        'no-credential',
        'bad-password',
        'inactive',
      ),
    ])(
      'debería fallar de forma indistinguible y con un solo verify en los cuatro caminos',
      async (scenario) => {
        // Arrange
        const { useCase, hasher } = buildScenario(scenario);

        // Act
        const error = await useCase
          .execute({ email: 'existe@example.com', password: 'password-mala-9' })
          .then(() => null)
          .catch((e: unknown) => e as Error);

        // Assert
        expect(error).toBeInstanceOf(InvalidCredentialsError);
        expect(error?.name).toBe('InvalidCredentialsError');
        expect(error?.message).toBe('Invalid credentials');
        // Un solo `verify` en TODOS los caminos: es lo que iguala el costo de tiempo y
        // cierra el oráculo. Con dos (o cero) el atacante distingue los casos por latencia.
        expect(hasher.verifyCalls).toHaveLength(1);
      },
    );
  });
});

// Helpers

const build = ({ users = [], credentials = [] }: BuildOptions = {}) => {
  const directory = new FakeUserDirectory(users);
  const repository = new InMemoryCredentialRepository(credentials);
  const hasher = new FakePasswordHasher();
  const signer = new FakeTokenSigner();
  return {
    directory,
    repository,
    hasher,
    signer,
    useCase: new LoginUseCase(directory, repository, hasher, signer),
  };
};

type BuildOptions = { users?: DirectoryUser[]; credentials?: Credential[] };

/** Cuenta completa: perfil en el directorio + credencial con el hash de ese password. */
const buildWithAccount = (
  email: string,
  password: string,
  overrides: Partial<DirectoryUser> = {},
) => {
  const user = buildDirectoryUser({ email, ...overrides });
  const credential = buildCredentialFor(user.id, password);
  return { ...build({ users: [user], credentials: [credential] }), user };
};

const buildCredentialFor = (userId: string, password: string): Credential =>
  Credential.create({
    userId,
    passwordHash: PasswordHash.from(fakeHashOf(password)),
    now: new Date('2026-08-07T10:00:00.000Z'),
  });

/** Los cuatro caminos de fallo, todos con el MISMO email y el MISMO password de entrada. */
const buildScenario = (scenario: 'no-user' | 'no-credential' | 'bad-password' | 'inactive') => {
  const email = 'existe@example.com';
  if (scenario === 'no-user') {
    return build();
  }
  if (scenario === 'no-credential') {
    return build({ users: [buildDirectoryUser({ email })] });
  }
  if (scenario === 'bad-password') {
    return buildWithAccount(email, 'Password-Correcta-1');
  }
  return buildWithAccount(email, 'password-mala-9', { active: false });
};
