import { OrderPlaced } from '../../../domain/events/order-placed.event';
import { Order } from '../../../domain/entities/order.entity';
import { OrderAmount } from '../../../domain/value-objects/order-amount.vo';
import { OrderConcept } from '../../../domain/value-objects/order-concept.vo';
import { OrderId } from '../../../domain/value-objects/order-id.vo';

const CUSTOMER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const NOW = new Date('2026-08-06T09:30:00.000Z');
/**
 * Actor DISTINTO de `CUSTOMER_ID` a propósito, aunque el caso de uso real pase hoy el mismo
 * valor a los dos: es lo único que demuestra que el agregado guarda los dos campos por separado
 * en lugar de derivar `createdBy` de `customerId`. Mismo argumento que las tres fechas distintas
 * del caso de `rehydrate` de más abajo.
 */
const ACTOR_ID = '5b7c2d4e-9a1f-4c3b-8e6d-0f2a4b6c8d1e';

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

    it('debería sellar placedAt, createdAt y updatedAt con el mismo instante al colocar la orden', () => {
      // Arrange
      const now = new Date('2026-08-01T10:15:00.000Z');

      // Act
      const order = Order.place({
        id: OrderId.generate(),
        customerId: '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012',
        concept: OrderConcept.from('Suscripción anual plan Pro'),
        amount: OrderAmount.from(149_900),
        now,
        createdBy: ACTOR_ID,
      });

      // Assert
      expect(order.placedAt).toBe(now);
      expect(order.createdAt).toBe(now);
      expect(order.updatedAt).toBe(now);
    });

    // `createdBy` es el ACTOR y `customerId` el DUEÑO. Hoy el caso de uso pasa el mismo valor a
    // los dos, pero el agregado no los deriva uno del otro: con `ACTOR_ID ≠ CUSTOMER_ID`, una
    // implementación que escribiera `createdBy: params.customerId` cae aquí.
    it('debería registrar el actor recibido y no derivarlo del cliente', () => {
      // Act
      const order = placeOrder(OrderId.generate());

      // Assert
      expect(order.createdBy).toBe(ACTOR_ID);
      expect(order.updatedBy).toBe(ACTOR_ID);
      expect(order.customerId).toBe(CUSTOMER_ID);
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
        createdAt: NOW,
        updatedAt: NOW,
        createdBy: null,
        updatedBy: null,
      });

      // Assert
      expect(order.pullEvents()).toEqual([]);
    });

    // Dos actores distintos aunque hoy la orden no tenga mutadores y el sistema no produzca esa
    // fila: es lo único que demuestra que `rehydrate` no los colapsa. Y `null` en `createdBy`
    // es el caso REAL de toda orden anterior a `AddAuditActorColumns`.
    it('debería conservar createdBy y updatedBy por separado al reconstituir', () => {
      // Act
      const order = Order.rehydrate({
        id: OrderId.generate(),
        customerId: CUSTOMER_ID,
        concept: OrderConcept.from('Suscripción anual plan Pro'),
        amount: OrderAmount.from(149_900),
        placedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
        createdBy: null,
        updatedBy: ACTOR_ID,
      });

      // Assert
      expect(order.createdBy).toBeNull();
      expect(order.updatedBy).toBe(ACTOR_ID);
    });

    it('debería conservar los tres instantes por separado al reconstituir', () => {
      // Arrange — tres fechas DISTINTAS aunque el sistema real nunca las produzca: es lo único
      // que demuestra que `rehydrate` no las colapsa. Con las tres iguales, una implementación
      // que ignorase dos parámetros pasaría igual.
      const placedAt = new Date('2026-08-01T10:15:00.000Z');
      const createdAt = new Date('2026-08-02T11:30:00.000Z');
      const updatedAt = new Date('2026-08-03T12:45:00.000Z');

      // Act
      const order = Order.rehydrate({
        id: OrderId.generate(),
        customerId: '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012',
        concept: OrderConcept.from('Suscripción anual plan Pro'),
        amount: OrderAmount.from(149_900),
        placedAt,
        createdAt,
        updatedAt,
        createdBy: null,
        updatedBy: null,
      });

      // Assert
      expect(order.placedAt).toBe(placedAt);
      expect(order.createdAt).toBe(createdAt);
      expect(order.updatedAt).toBe(updatedAt);
    });
  });

  describe('toSnapshot()', () => {
    it('debería exponer createdAt y updatedAt en el snapshot', () => {
      // Arrange
      const now = new Date('2026-08-01T10:15:00.000Z');
      const order = Order.place({
        id: OrderId.generate(),
        customerId: '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012',
        concept: OrderConcept.from('Suscripción anual plan Pro'),
        amount: OrderAmount.from(149_900),
        now,
        createdBy: ACTOR_ID,
      });

      // Act
      const snapshot = order.toSnapshot();

      // Assert
      expect(snapshot.createdAt).toBe(now);
      expect(snapshot.updatedAt).toBe(now);
      expect(snapshot.placedAt).toBe(now);
    });

    it('debería exponer createdBy y updatedBy en el snapshot', () => {
      // Arrange
      const order = placeOrder(OrderId.generate());

      // Act
      const snapshot = order.toSnapshot();

      // Assert
      expect(snapshot.createdBy).toBe(ACTOR_ID);
      expect(snapshot.updatedBy).toBe(ACTOR_ID);
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
    createdBy: ACTOR_ID,
  });
