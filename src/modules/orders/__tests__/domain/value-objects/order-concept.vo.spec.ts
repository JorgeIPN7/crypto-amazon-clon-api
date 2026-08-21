import { test as fcTest } from '@fast-check/jest';

import { InvalidOrderConceptError } from '../../../domain/errors/order.errors';
import { OrderConcept } from '../../../domain/value-objects/order-concept.vo';
import { orderConceptArb } from '../../helpers/arbitraries';

describe('OrderConcept', () => {
  describe('from()', () => {
    it('debería rechazar un concepto vacío tras trim', () => {
      // Act + Assert
      expect(() => OrderConcept.from('   ')).toThrow(InvalidOrderConceptError);
    });

    it('debería rechazar un concepto de más de 140 caracteres', () => {
      // Arrange
      const tooLong = 'a'.repeat(141);

      // Act + Assert
      expect(() => OrderConcept.from(tooLong)).toThrow(InvalidOrderConceptError);
    });
  });

  describe('from() (property-based)', () => {
    fcTest.prop([orderConceptArb])(
      'debería aceptar cualquier concepto válido (propiedad)',
      (raw) => {
        // Act
        const concept = OrderConcept.from(raw);

        // Assert: nunca lanza, el value queda recortado y re-parsearlo es estable.
        expect(concept.value).toBe(raw.trim());
        expect(OrderConcept.from(concept.value).value).toBe(concept.value);
      },
    );
  });
});
