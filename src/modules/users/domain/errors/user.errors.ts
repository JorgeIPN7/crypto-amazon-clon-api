import { DomainError } from '@shared/domain/domain-error.base';

/**
 * Errores de dominio: son de negocio, no de transporte. No heredan de `HttpException`
 * ni conocen códigos HTTP — traducirlos a una respuesta es tarea del adaptador HTTP.
 *
 * El cuerpo (constructor + `new.target.name`) vive en `DomainError`, en el kernel: estaba
 * duplicado carácter por carácter en los tres contextos. Lo que este marcador aporta es la
 * IDENTIDAD del contexto, que es lo que `@Catch(UserDomainError)` discrimina.
 */
export abstract class UserDomainError extends DomainError {}

export class InvalidEmailError extends UserDomainError {
  constructor(readonly value: string) {
    super(`"${value}" is not a valid email address`);
  }
}

export class InvalidUserIdError extends UserDomainError {
  constructor(readonly value: string) {
    super(`"${value}" is not a valid user id`);
  }
}

export class InvalidUserNameError extends UserDomainError {
  constructor(readonly value: string) {
    super(`"${value}" is not a valid user name`);
  }
}

export class UserNotFoundError extends UserDomainError {
  constructor(readonly userId: string) {
    super(`User ${userId} was not found`);
  }
}

export class EmailAlreadyTakenError extends UserDomainError {
  constructor(readonly email: string) {
    super(`Email ${email} is already registered`);
  }
}

// `InvalidPasswordHashError` e `InvalidCredentialsError` se mudaron a
// `modules/auth/domain/errors/auth.errors.ts` en el ciclo 4, con el hash. `users` ya no sabe
// qué es una contraseña, así que tampoco puede tener los errores que hablan de ella.
