import { InvalidOrderIdError } from '../../../domain/errors/order.errors';
import { OrderId } from '../../../domain/value-objects/order-id.vo';

describe('OrderId', () => {
  describe('from()', () => {
    it('debería rechazar un id que no sea uuid v4', () => {
      // Act + Assert
      expect(() => OrderId.from('nope')).toThrow(InvalidOrderIdError);
    });
  });
});
