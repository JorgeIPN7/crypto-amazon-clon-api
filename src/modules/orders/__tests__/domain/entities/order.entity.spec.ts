import { OrderPlaced } from '../../../domain/events/order-placed.event';
import { Order } from '../../../domain/entities/order.entity';
import { OrderAmount } from '../../../domain/value-objects/order-amount.vo';
import { OrderConcept } from '../../../domain/value-objects/order-concept.vo';
import { OrderId } from '../../../domain/value-objects/order-id.vo';

const CUSTOMER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const NOW = new Date('2026-08-06T09:30:00.000Z');

describe('Order', () => {
  describe('place()', () => {
    it('debería emitir OrderPlaced al colocar una orden', () => {
      // Arrange
      const id = OrderId.generate();

      // Act
      const order = placeOrder(id);
      const events = order.pullEvents();

      // Assert: el payload lleva los datos primitivos que irán tal cual al outbox.
      expect(events).toEqual([new OrderPlaced(id.value, CUSTOMER_ID, 149_900, NOW)]);
    });

    it('debería drenar los eventos al hacer pull', () => {
      // Arrange
      const order = placeOrder(OrderId.generate());
      order.pullEvents();

      // Act
      const second = order.pullEvents();

      // Assert
      expect(second).toEqual([]);
    });
  });

  describe('rehydrate()', () => {
    it('debería reconstruir sin emitir eventos', () => {
      // Act
      const order = Order.rehydrate({
        id: OrderId.generate(),
        customerId: CUSTOMER_ID,
        concept: OrderConcept.from('Suscripción anual plan Pro'),
        amount: OrderAmount.from(149_900),
        placedAt: NOW,
      });

      // Assert
      expect(order.pullEvents()).toEqual([]);
    });
  });
});

// Helpers

const placeOrder = (id: OrderId): Order =>
  Order.place({
    id,
    customerId: CUSTOMER_ID,
    concept: OrderConcept.from('Suscripción anual plan Pro'),
    amount: OrderAmount.from(149_900),
    now: NOW,
  });
