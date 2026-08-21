import { ValueObject } from '@shared/domain/value-object.base';

import { InvalidOrderConceptError } from '../errors/order.errors';

const CONCEPT_MAX_LENGTH = 140;

/** Concepto de la orden: 1-140 caracteres tras recortar espacios. */
export class OrderConcept extends ValueObject<string> {
  static from(value: string): OrderConcept {
    const trimmed = value.trim();
    if (trimmed.length < 1 || trimmed.length > CONCEPT_MAX_LENGTH) {
      throw new InvalidOrderConceptError(value);
    }
    return new OrderConcept(trimmed);
  }
}
