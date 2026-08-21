import { randomUUID } from 'node:crypto';

import type {
  CreateProfileResult,
  DirectoryUser,
  UserDirectory,
} from '../../domain/ports/user-directory';

const DEFAULT_NOW = new Date('2026-08-07T10:00:00.000Z');

export type BuildDirectoryUserOverrides = Partial<DirectoryUser>;

export const buildDirectoryUser = (overrides: BuildDirectoryUserOverrides = {}): DirectoryUser => ({
  id: randomUUID(),
  email: 'usuario@example.com',
  name: 'Usuario de Prueba',
  role: 'user',
  active: true,
  createdAt: DEFAULT_NOW,
  updatedAt: DEFAULT_NOW,
  ...overrides,
});

/**
 * Fake escrito a mano del puerto que `auth` define sobre `users`. NO normaliza el email a
 * propósito: la normalización es responsabilidad del OTRO contexto (lo hace `Email.from`
 * dentro de la fachada), y un fake que la imitara escondería justo el contrato que interesa
 * fijar — que auth pasa la cadena tal cual llegó.
 */
export class FakeUserDirectory implements UserDirectory {
  readonly findByEmailCalls: string[] = [];
  readonly deletedProfileIds: string[] = [];
  readonly createProfileCalls: { email: string; name: string }[] = [];
  /** Fuerza el resultado del alta; por defecto crea un perfil nuevo. */
  createProfileOutcome?: CreateProfileResult;

  constructor(private readonly users: DirectoryUser[] = []) {}

  findByEmail(email: string): Promise<DirectoryUser | null> {
    this.findByEmailCalls.push(email);
    return Promise.resolve(this.users.find((user) => user.email === email) ?? null);
  }

  createProfile(input: { email: string; name: string }): Promise<CreateProfileResult> {
    this.createProfileCalls.push(input);
    if (this.createProfileOutcome) {
      return Promise.resolve(this.createProfileOutcome);
    }
    const user = buildDirectoryUser({ email: input.email, name: input.name });
    this.users.push(user);
    return Promise.resolve({ ok: true, user });
  }

  deleteProfile(id: string): Promise<void> {
    this.deletedProfileIds.push(id);
    const index = this.users.findIndex((user) => user.id === id);
    if (index >= 0) {
      this.users.splice(index, 1);
    }
    return Promise.resolve();
  }

  /** Solo para aserciones del test, no forma parte del puerto. */
  size(): number {
    return this.users.length;
  }
}
