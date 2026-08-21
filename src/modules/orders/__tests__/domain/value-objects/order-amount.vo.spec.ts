import { test as fcTest } from '@fast-check/jest';

import { InvalidOrderAmountError } from '../../../domain/errors/order.errors';
import { OrderAmount } from '../../../domain/value-objects/order-amount.vo';
import { orderAmountCentsArb } from '../../helpers/arbitraries';

describe('OrderAmount', () => {
  describe('from()', () => {
    it('debería rechazar un importe no entero', () => {
      // Act + Assert
      expect(() => OrderAmount.from(10.5)).toThrow(InvalidOrderAmountError);
    });

    it('debería rechazar un importe de cero o negativo', () => {
      // Act + Assert
      expect(() => OrderAmount.from(0)).toThrow(InvalidOrderAmountError);
      expect(() => OrderAmount.from(-1)).toThrow(InvalidOrderAmountError);
    });

    it('debería rechazar un importe mayor al tope', () => {
      // Act + Assert
      expect(() => OrderAmount.from(10_000_001)).toThrow(InvalidOrderAmountError);
    });
  });

  describe('from() (property-based)', () => {
    fcTest.prop([orderAmountCentsArb])(
      'debería aceptar cualquier importe entero del rango (propiedad)',
      (cents) => {
        // Act
        const amount = OrderAmount.from(cents);

        // Assert
        expect(amount.value).toBe(cents);
      },
    );
  });
});
