import type { Credential } from '../../domain/entities/credential.entity';
import type { CredentialRepository } from '../../domain/ports/credential.repository';

/**
 * Fake escrito a mano del puerto, no un mock generado. Se comporta como un repositorio real
 * (guarda, sobrescribe por `userId`, busca) para que el test valide el caso de uso y no la
 * configuración de un doble.
 */
export class InMemoryCredentialRepository implements CredentialRepository {
  private readonly store = new Map<string, Credential>();
  /** Cuando se fija, `save()` rechaza con este error: el disparador del caso de compensación. */
  failNextSaveWith?: Error;
  /**
   * El otro modo de fallo del `save`, y el que motivó el backlog #14: la escritura SÍ se
   * confirma en el motor y aun así la llamada rechaza —un timeout de red, un pod que muere
   * entre el COMMIT y la respuesta—. La diferencia con `failNextSaveWith` no es cosmética:
   * ahí no queda fila y aquí sí, que es exactamente la credencial huérfana que la
   * compensación tiene que barrer.
   */
  failNextSaveAfterWritingWith?: Error;
  /** Solo para aserciones del test: a qué usuarios se les borró la credencial. */
  readonly deletedUserIds: string[] = [];

  constructor(seed: Credential[] = []) {
    seed.forEach((credential) => this.store.set(credential.userId, credential));
  }

  findByUserId(userId: string): Promise<Credential | null> {
    return Promise.resolve(this.store.get(userId) ?? null);
  }

  save(credential: Credential): Promise<void> {
    if (this.failNextSaveWith) {
      return Promise.reject(this.failNextSaveWith);
    }
    this.store.set(credential.userId, credential);
    if (this.failNextSaveAfterWritingWith) {
      return Promise.reject(this.failNextSaveAfterWritingWith);
    }
    return Promise.resolve();
  }

  deleteByUserId(userId: string): Promise<void> {
    this.deletedUserIds.push(userId);
    this.store.delete(userId);
    return Promise.resolve();
  }

  /** Solo para aserciones del test, no forma parte del puerto. */
  size(): number {
    return this.store.size;
  }
}
