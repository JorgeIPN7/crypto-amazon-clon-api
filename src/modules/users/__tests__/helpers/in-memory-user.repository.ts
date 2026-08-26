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
 *
 * **Las tres consultas ocultan las filas borradas**, igual que `UserTypeOrmRepository` con su
 * `deletedAt: IsNull()`. No es adorno: si el fake las devolviera, un caso de uso que dependiera
 * de no verlas pasaría aquí y fallaría contra PostgreSQL, que es la clase de divergencia por la
 * que un fake escrito a mano deja de valer para nada.
 *
 * `delete()` se retiró con el puerto: el borrado ya no lo hace el repositorio, lo decide el
 * agregado con `softDelete()` y se persiste con `save()`.
 */
export class InMemoryUserRepository implements UserRepository {
  private readonly store = new Map<string, User>();

  constructor(seed: User[] = []) {
    seed.forEach((user) => this.store.set(user.id.value, user));
  }

  private get alive(): User[] {
    return [...this.store.values()].filter((user) => !user.isDeleted);
  }

  findById(id: UserId): Promise<User | null> {
    const found = this.store.get(id.value);
    return Promise.resolve(found && !found.isDeleted ? found : null);
  }

  findByEmail(email: Email): Promise<User | null> {
    const found = this.alive.find((user) => user.email.equals(email));
    return Promise.resolve(found ?? null);
  }

  findMany(criteria: FindUsersCriteria): Promise<UserPage> {
    const all = this.alive;
    const items = all.slice(criteria.skip, criteria.skip + criteria.take);
    return Promise.resolve({ items, total: all.length });
  }

  save(user: User): Promise<void> {
    this.store.set(user.id.value, user);
    return Promise.resolve();
  }

  /**
   * Solo para aserciones del test, no forma parte del puerto. Cuenta las filas VIVAS: es lo que
   * los tests quieren saber, y coincide con lo que un `SELECT` del adaptador real vería.
   */
  size(): number {
    return this.alive.length;
  }

  /** Filas totales, borradas incluidas. Para distinguir «se marcó» de «desapareció». */
  rowCount(): number {
    return this.store.size;
  }
}
