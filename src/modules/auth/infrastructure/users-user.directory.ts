import { Injectable } from '@nestjs/common';

import { UsersLookup, UsersProvisioning, type UserSummary } from '../../users/users.module';

import {
  UserDirectory,
  type CreateProfileResult,
  type DirectoryUser,
} from '../domain/ports/user-directory';

/**
 * Anti-corruption layer: implementa el puerto que `auth` definió inyectando las puertas que
 * `users` publica POR SU MODULE FILE — el único import cross-módulo legal (regla 3 del gate
 * de boundaries + enmienda G2). Si `users` cambia por dentro, este archivo es la única pieza
 * de auth que puede enterarse.
 *
 * Inyecta las DOS puertas porque de verdad usa las dos (backlog #13): consulta con
 * `UsersLookup.findByEmail` para el login y aprovisiona con `UsersProvisioning` para el alta
 * y su compensación. Que aquí aparezcan dos parámetros y en `UsersCustomerDirectory` solo
 * uno es exactamente el punto de la segregación: el constructor declara el permiso que cada
 * consumidor necesita.
 *
 * Cada clase es a la vez el tipo del contrato y su token: sin `@Inject`, la referencia
 * viaja en `design:paramtypes` y Nest la resuelve contra el provider que `users.module.ts`
 * exporta.
 *
 * La traducción es CAMPO A CAMPO y no un `return` directo, aunque hoy `UserSummary` y
 * `DirectoryUser` sean estructuralmente idénticos: es lo único que impide que un campo nuevo
 * de la fachada de users aparezca en las respuestas de auth sin que nadie lo decida. Es la
 * misma razón por la que los DTO mapean campo a campo y nunca con spread.
 *
 * «Campo a campo» incluye los RECHAZOS, no solo el éxito — casos D7 y D8 de la Tabla D. El
 * `return result` de la rama de fallo era exactamente el agujero que esta regla existe para
 * tapar, y compilaba sin una queja.
 */
@Injectable()
export class UsersUserDirectory implements UserDirectory {
  constructor(
    private readonly lookup: UsersLookup,
    private readonly provisioning: UsersProvisioning,
  ) {}

  async findByEmail(email: string): Promise<DirectoryUser | null> {
    const user = await this.lookup.findByEmail(email);
    return user ? toDirectoryUser(user) : null;
  }

  async createProfile(input: { email: string; name: string }): Promise<CreateProfileResult> {
    const result = await this.provisioning.createProfile(input);
    if (result.ok) {
      return { ok: true, user: toDirectoryUser(result.user) };
    }
    // Los RECHAZOS se reconstruyen campo a campo igual que el éxito. `return result` compilaba
    // —las dos uniones son estructuralmente idénticas hoy— y era el único punto por el que la
    // promesa de la cabecera no se cumplía: un campo OPCIONAL nuevo en el rechazo de la
    // fachada cruzaría entero a auth sin que nada lo cazara. Uno REQUERIDO sí rompe (el fake
    // del spec dejaría de compilar); uno opcional no rompe nada y llega al cliente.
    return result.reason === 'email-taken'
      ? { ok: false, reason: 'email-taken' }
      : { ok: false, reason: 'invalid-profile', message: result.message };
  }

  deleteProfile(id: string): Promise<void> {
    return this.provisioning.deleteProfile(id);
  }
}

const toDirectoryUser = (user: UserSummary): DirectoryUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  active: user.active,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});
