import type { Email } from '../../domain/value-objects/email.vo';
import type {
  FindUsersCriteria,
  UserPage,
  UserRepository,
} from '../../domain/ports/user.repository';
import type { User } from '../../domain/entities/user.entity';
import type { UserId } from '../../domain/value-objects/user-id.vo';

/**
 * Fake escrito a mano del puerto, no un mock generado. Se comporta como un repositorio
 * real (guarda, sobrescribe por id, filtra) para que el test valide el caso de uso y no
 * la configuración de un doble.
 */
export class InMemoryUserRepository implements UserRepository {
  private readonly store = new Map<string, User>();

  constructor(seed: User[] = []) {
    seed.forEach((user) => this.store.set(user.id.value, user));
  }

  findById(id: UserId): Promise<User | null> {
    return Promise.resolve(this.store.get(id.value) ?? null);
  }

  findByEmail(email: Email): Promise<User | null> {
    const found = [...this.store.values()].find((user) => user.email.equals(email));
    return Promise.resolve(found ?? null);
  }

  findMany(criteria: FindUsersCriteria): Promise<UserPage> {
    const all = [...this.store.values()];
    const items = all.slice(criteria.skip, criteria.skip + criteria.take);
    return Promise.resolve({ items, total: all.length });
  }

  save(user: User): Promise<void> {
    this.store.set(user.id.value, user);
    return Promise.resolve();
  }

  delete(id: UserId): Promise<void> {
    this.store.delete(id.value);
    return Promise.resolve();
  }

  /** Solo para aserciones del test, no forma parte del puerto. */
  size(): number {
    return this.store.size;
  }
}
