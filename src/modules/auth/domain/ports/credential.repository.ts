import type { Credential } from '../entities/credential.entity';

/**
 * Puerto de salida (driven) del agregado propio de `auth`. Vive en el dominio porque es el
 * dominio quien decide qué necesita de la persistencia; `infrastructure/persistence/` provee
 * la implementación.
 *
 * `abstract class` y no `type` + `Symbol`: la clase sobrevive a la compilación, así que la
 * MISMA referencia es el tipo del contrato y el token de inyección. El razonamiento completo
 * vive en `users/domain/ports/user.repository.ts`.
 *
 * Tres operaciones, todas con un caso de uso detrás: el login busca por `userId` (la clave de
 * acceso, y por eso la tabla lleva índice único ahí), el registro guarda, y la compensación
 * del registro borra.
 */
export abstract class CredentialRepository {
  abstract findByUserId(userId: string): Promise<Credential | null>;
  abstract save(credential: Credential): Promise<void>;
  /**
   * Compensación del registro (backlog #14). Por `userId` y no por `id` porque en el momento
   * de compensar el caso de uso tiene el id del PERFIL, no el de la credencial —que acuñó
   * `Credential.create()` en la llamada que acaba de fallar y cuyo valor puede no haber vuelto
   * nunca—. Idempotente: borrar lo que no existe no es un error, que es el caso normal (la
   * escritura falló de verdad y no hay fila).
   */
  abstract deleteByUserId(userId: string): Promise<void>;
}
