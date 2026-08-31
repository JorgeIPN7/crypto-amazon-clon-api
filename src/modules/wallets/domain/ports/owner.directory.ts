/**
 * La vista que `wallets` tiene de `users`: un directorio de dueños. `wallets` define el puerto y no
 * sabe qué módulo lo implementa; el adaptador (`infrastructure/gateways/users-owner.directory.ts`,
 * §6.2) inyecta `UsersLookup`, que es la única superficie cross-módulo legal.
 *
 * `abstract class` —tipo y token en la misma referencia— por el mismo motivo que
 * `wallet.repository.ts`.
 *
 * Idéntico en espíritu a `CustomerDirectory` de `orders`, y por el mismo fallo: **un JWT firmado
 * sobrevive a la desactivación de su dueño** y el esquema no tiene ni una clave foránea —medido:
 * `grep -rn "FOREIGN KEY\|REFERENCES" src/database/migrations/` no devuelve nada—, así que nada más
 * impediría que una cuenta desactivada siguiera pidiendo direcciones y moviendo fondos hasta que
 * expire su token.
 *
 * `exists` devuelve `true` solo si el dueño existe Y está activo. Lo consultan los TRES casos de
 * uso que cuestan dinero o crean estado, y **no las dos lecturas** (§5): ahí el token ya probó el
 * `sub`, y un 403 cosmético costaría una consulta extra en los endpoints más llamados —la gente
 * consulta repetidamente esperando la activación—.
 */
export abstract class OwnerDirectory {
  abstract exists(ownerId: string): Promise<boolean>;
}
