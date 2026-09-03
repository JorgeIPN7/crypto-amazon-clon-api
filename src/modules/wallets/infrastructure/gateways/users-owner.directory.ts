import { Injectable } from '@nestjs/common';

import { UsersLookup } from '../../../users/users.module';

import { OwnerDirectory } from '../../domain/ports/owner.directory';

/**
 * Anti-corruption layer: implementa el puerto que `wallets` definió inyectando la puerta que
 * `users` publica POR SU MODULE FILE — el único import cross-módulo legal (regla 3 del gate +
 * enmienda G1/G2). Si `users` cambia por dentro, este archivo es la única pieza de `wallets`
 * que puede enterarse.
 *
 * Inyecta `UsersLookup` y NO `UsersProvisioning`: `wallets` solo pregunta si el dueño sigue
 * vivo. Que aquí haya un parámetro y en `UsersUserDirectory` de `auth` haya dos es exactamente
 * el punto de la segregación por intención — el constructor declara el permiso que cada
 * consumidor necesita, y lo comprueba el COMPILADOR. La medición de que ese control existe de
 * verdad vive en el fake del spec de este archivo, que deja de compilar si se le pide la
 * superficie completa.
 *
 * `UsersLookup` es a la vez el tipo del contrato y el token: sin `@Inject`, la referencia a la
 * clase viaja en `design:paramtypes` y Nest la resuelve contra el provider que `users.module.ts`
 * exporta. Por eso se importa como VALOR: un `import type` la borraría del emit y Nest fallaría
 * EN RUNTIME con `lint:check` y `typecheck` en verde. Ese descuido no depende de la vista: lo
 * caza el primer selector de `no-restricted-syntax` en `eslint.config.mjs`, cuyo `source` casa
 * `\.module$`.
 *
 * **Por qué existe siquiera.** Un JWT firmado sobrevive a la desactivación de su dueño, y el
 * esquema no tiene ni una sola clave foránea: sin esta comprobación, un usuario desactivado
 * seguiría activando direcciones y moviendo fondos hasta que su token expirara. Los tres casos
 * de uso que cuestan dinero o crean estado la consultan; las dos lecturas NO, y eso es
 * deliberado (§5) — el token ya probó el `sub` y son los endpoints más llamados.
 *
 * La traducción es campo a campo. Hoy es un booleano y no hay campo que copiar, pero el nombre
 * del método cambia —`userExists` fuera, `exists` dentro— y esa frontera es la que impide que un
 * cambio en la puerta de `users` se cuele en el dominio de `wallets` sin que nadie lo decida.
 *
 * **Vive en `infrastructure/gateways/`** y no suelto en `infrastructure/`: cada adaptador cuelga
 * de una subcarpeta que dice CON QUÉ habla, y `gateways/` es el sitio del que habla con OTRO
 * CONTEXTO o con un sistema externo — que es lo que distingue a un anti-corruption layer de un
 * repositorio.
 */
@Injectable()
export class UsersOwnerDirectory implements OwnerDirectory {
  constructor(private readonly users: UsersLookup) {}

  exists(ownerId: string): Promise<boolean> {
    return this.users.userExists(ownerId);
  }
}
