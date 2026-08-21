import { test as fcTest, fc } from '@fast-check/jest';

import { Order } from '../../../domain/entities/order.entity';
import { OrderAmount } from '../../../domain/value-objects/order-amount.vo';
import { OrderConcept } from '../../../domain/value-objects/order-concept.vo';
import { OrderId } from '../../../domain/value-objects/order-id.vo';
import { OrderMapper } from '../../../infrastructure/persistence/order.mapper';
import { OrderOrmEntity } from '../../../infrastructure/persistence/order.orm-entity';
import { orderAmountCentsArb, orderConceptArb, timestampArb } from '../../helpers/arbitraries';

const CUSTOMER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const PLACED_AT = new Date('2026-08-06T09:30:00.000Z');

describe('OrderMapper', () => {
  describe('toPersistence()', () => {
    it('debería volcar el agregado a columnas primitivas', () => {
      // Arrange
      const order = buildOrder();

      // Act
      const row = OrderMapper.toPersistence(order);

      // Assert
      expect(row).toBeInstanceOf(OrderOrmEntity);
      expect(row.id).toBe(order.id.value);
      expect(row.customerId).toBe(CUSTOMER_ID);
      expect(row.concept).toBe('Suscripción anual plan Pro');
      expect(row.amountCents).toBe(149_900);
      expect(row.placedAt).toEqual(PLACED_AT);
    });
  });

  describe('toDomain()', () => {
    it('debería reconstruir el agregado desde la fila sin emitir eventos', () => {
      // Arrange
      const row = buildRow();

      // Act
      const order = OrderMapper.toDomain(row);

      // Assert: rehydrate, no place — reconstruir no re-publica.
      expect(order.toSnapshot()).toEqual({
        id: row.id,
        customerId: row.customerId,
        concept: row.concept,
        amountCents: row.amountCents,
        placedAt: row.placedAt,
      });
      expect(order.pullEvents()).toEqual([]);
    });
  });

  describe('toDomain() ∘ toPersistence() (property-based)', () => {
    fcTest.prop([
      fc.record({
        concept: orderConceptArb,
        amountCents: orderAmountCentsArb,
        placedAt: timestampArb,
      }),
    ])(
      'debería preservar el snapshot para cualquier orden del dominio',
      ({ concept, amountCents, placedAt }) => {
        // Arrange
        const original = Order.rehydrate({
          id: OrderId.generate(),
          customerId: CUSTOMER_ID,
          concept: OrderConcept.from(concept),
          amount: OrderAmount.from(amountCents),
          placedAt,
        });

        // Act
        const restored = OrderMapper.toDomain(OrderMapper.toPersistence(original));

        // Assert
        expect(restored.toSnapshot()).toEqual(original.toSnapshot());
      },
    );
  });
});

// Helpers

const buildOrder = (): Order =>
  Order.rehydrate({
    id: OrderId.generate(),
    customerId: CUSTOMER_ID,
    concept: OrderConcept.from('Suscripción anual plan Pro'),
    amount: OrderAmount.from(149_900),
    placedAt: PLACED_AT,
  });

const buildRow = (): OrderOrmEntity => {
  const row = new OrderOrmEntity();
  row.id = OrderId.generate().value;
  row.customerId = CUSTOMER_ID;
  row.concept = 'Fila persistida';
  row.amountCents = 5_000;
  row.placedAt = PLACED_AT;
  return row;
};
