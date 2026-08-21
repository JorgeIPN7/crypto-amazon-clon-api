import { Injectable } from '@nestjs/common';

import { UsersLookup } from '../../users/users.module';

import { CustomerDirectory } from '../domain/ports/customer.directory';

/**
 * Anti-corruption layer mínimo: implementa el puerto que `orders` definió inyectando la
 * puerta que `users` publica POR SU MODULE FILE — el único import cross-módulo legal
 * (regla 3 + enmienda G2). Si `users` cambia por dentro, este archivo es la única pieza
 * de orders que puede enterarse.
 *
 * Inyecta `UsersLookup` y NO la puerta de aprovisionamiento (backlog #13): `orders` solo
 * pregunta. Antes recibía las cuatro operaciones de una fachada única, `deleteProfile`
 * incluido —un DELETE físico sobre un esquema sin FOREIGN KEYs—; hoy ese método no está en
 * el tipo que inyecta, así que llamarlo no compila. Es el único control que ve la diferencia:
 * la matriz de boundaries razona por ruta y este import era legal en ambos mundos.
 *
 * `UsersLookup` es a la vez el tipo del contrato y el token: sin `@Inject`, la referencia
 * a la clase viaja en `design:paramtypes` y Nest la resuelve contra el provider que
 * `users.module.ts` exporta.
 */
@Injectable()
export class UsersCustomerDirectory implements CustomerDirectory {
  constructor(private readonly users: UsersLookup) {}

  exists(customerId: string): Promise<boolean> {
    return this.users.userExists(customerId);
  }
}
