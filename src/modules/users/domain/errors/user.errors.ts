/**
 * Errores de dominio: son de negocio, no de transporte. No heredan de `HttpException`
 * ni conocen códigos HTTP — traducirlos a una respuesta es tarea del adaptador HTTP.
 */
export abstract class UserDomainError extends Error {
  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

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
