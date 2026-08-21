/**
 * Errores de dominio de orders: de negocio, no de transporte. Traducirlos a HTTP es tarea
 * de `infrastructure/http/orders-domain-exception.filter.ts` — mismo contrato que
 * `user.errors.ts`.
 */
export abstract class OrderDomainError extends Error {
  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidOrderIdError extends OrderDomainError {
  constructor(readonly value: string) {
    super(`"${value}" is not a valid order id`);
  }
}

export class InvalidOrderConceptError extends OrderDomainError {
  constructor(readonly value: string) {
    super(`"${value}" is not a valid order concept`);
  }
}

export class InvalidOrderAmountError extends OrderDomainError {
  constructor(readonly value: number) {
    super(`${value} is not a valid order amount in cents`);
  }
}

export class CustomerGoneError extends OrderDomainError {
  constructor(readonly customerId: string) {
    // El mensaje es interno: el filter publica el 403 canónico, nunca esta cadena.
    super(`Customer ${customerId} no longer exists or is inactive`);
  }
}
