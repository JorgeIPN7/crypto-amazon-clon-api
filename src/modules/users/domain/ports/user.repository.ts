import type { Email } from '../value-objects/email.vo';
import type { User } from '../entities/user.entity';
import type { UserId } from '../value-objects/user-id.vo';

export type UserPage = {
  items: User[];
  total: number;
};

export type FindUsersCriteria = {
  skip: number;
  take: number;
};

/**
 * Puerto de salida (driven). Vive en el dominio porque es el dominio quien decide qué
 * necesita de la persistencia; `infrastructure/persistence/` provee la implementación.
 *
 * Es una `abstract class` y no un `type` + `Symbol`: una clase SOBREVIVE a la compilación,
 * así que la referencia a `UserRepository` sirve a la vez de tipo y de token de inyección
 * (Nest acepta `Abstract<T>` como `InjectionToken`, y SWC la emite en `design:paramtypes`).
 * Un token aparte deja de hacer falta, y con él el `@Inject` de cada consumidor.
 *
 * Forma obligatoria del puerto: SOLO miembros `abstract` públicos — sin campos, sin
 * `protected`/`private`, sin constructor. Son DOS prohibiciones con causas distintas, y
 * confundirlas lleva a defender la regla con un motivo que no aguanta (medido con tsc 6.0.3,
 * `--noEmit --strict`):
 *
 *   - Un CAMPO —público, `protected` o `private`— o una parameter property SÍ rompe el fake
 *     por objeto literal: `TS2741: Property 'x' is missing in type '{ … }' but required in
 *     type 'Port'`. Hay un fake real así en
 *     `orders/__tests__/infrastructure/users-customer.directory.spec.ts`.
 *   - Un `protected constructor()` VACÍO no rompe nada: el objeto literal sigue asignando sin
 *     un solo error. Se prohíbe por otra razón — los adaptadores hacen `implements` y jamás
 *     `extends`, así que el puerto no entra en su cadena de prototipos y ese constructor NO
 *     SE EJECUTA nunca (`adapter instanceof Port === false`). Es código muerto que promete
 *     una inicialización que nadie corre, y es la puerta por la que entran las parameter
 *     properties, que son las que sí rompen.
 *
 * `UserPage` y `FindUsersCriteria` se quedan como `type`: son datos que acompañan al
 * puerto, no algo inyectable.
 */
export abstract class UserRepository {
  abstract findById(id: UserId): Promise<User | null>;
  abstract findByEmail(email: Email): Promise<User | null>;
  abstract findMany(criteria: FindUsersCriteria): Promise<UserPage>;
  abstract save(user: User): Promise<void>;
  abstract delete(id: UserId): Promise<void>;
}
