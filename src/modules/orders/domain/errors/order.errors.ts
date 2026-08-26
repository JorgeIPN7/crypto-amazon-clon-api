import { DomainError } from '@shared/domain/domain-error.base';

/**
 * Errores de dominio de orders: de negocio, no de transporte. Traducirlos a HTTP es tarea
 * de `infrastructure/http/orders-domain-exception.filter.ts` — mismo contrato que
 * `user.errors.ts`. El cuerpo compartido está en `DomainError`.
 */
export abstract class OrderDomainError extends DomainError {}

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
