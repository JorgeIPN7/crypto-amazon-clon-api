/**
 * El perfil tal y como `auth` necesita verlo. Es un tipo PROPIO de este contexto, no el
 * `UserSummary` de la fachada de users: el adaptador (`infrastructure/users-user.directory.ts`)
 * traduce campo a campo, que es lo que convierte a ese adaptador en un anti-corruption layer
 * de verdad y no en un alias.
 */
export type DirectoryUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Resultado del alta de perfil. Es un RESULTADO y no una excepción a propósito: los errores
 * de `users` (`EmailAlreadyTakenError`, `InvalidEmailError`…) son suyos y auth no puede
 * importarlos —regla 3 del gate de boundaries—, así que el fallo viaja como dato y
 * `RegisterAccountUseCase` lo traduce a un error de ESTE dominio.
 *
 * `invalid-profile` lleva el mensaje del otro contexto porque es lo único que auth puede
 * saber de una regla ajena, y porque conservarlo mantiene intacto el 400 que hoy publica el
 * alta (`"sin-arroba" is not a valid email address`).
 */
export type CreateProfileResult =
  | { ok: true; user: DirectoryUser }
  | { ok: false; reason: 'email-taken' }
  | { ok: false; reason: 'invalid-profile'; message: string };

/**
 * La vista que `auth` tiene de `users`. `auth` define el puerto y no sabe qué módulo lo
 * implementa; hoy lo hace `UsersUserDirectory` sobre la fachada pública de users.
 *
 * `abstract class` —tipo y token en la misma referencia— por el mismo motivo que
 * `credential.repository.ts`.
 *
 * NO expone `passwordHash`: el perfil y la credencial son de dueños distintos desde este
 * ciclo, y este puerto es justamente la línea que lo hace cumplir.
 */
export abstract class UserDirectory {
  abstract findByEmail(email: string): Promise<DirectoryUser | null>;
  abstract createProfile(input: { email: string; name: string }): Promise<CreateProfileResult>;
  /** Compensación del registro: borra el perfil si la credencial no pudo escribirse. */
  abstract deleteProfile(id: string): Promise<void>;
}
