import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { createTestApp } from '@test/helpers/create-test-app';

import { OrderPlaced } from '../../../domain/events/order-placed.event';
import { Order } from '../../../domain/entities/order.entity';
import { OrderAmount } from '../../../domain/value-objects/order-amount.vo';
import { OrderConcept } from '../../../domain/value-objects/order-concept.vo';
import { OrderId } from '../../../domain/value-objects/order-id.vo';
import { OrderOrmEntity } from '../../../infrastructure/persistence/order.orm-entity';
import { OrderTypeOrmRepository } from '../../../infrastructure/persistence/order.typeorm.repository';

const CUSTOMER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';

/**
 * Contra PostgreSQL real: lo que se verifica es la TRANSACCIÓN — mockear el ORM aquí
 * eliminaría exactamente eso. El repositorio se construye con `new` y no resolviendo
 * `OrderRepository`: el binding no existe hasta la Task 5 y el sujeto es el adaptador,
 * no el wiring (divergencia deliberada respecto al spec E2E de users, documentada en la
 * cabecera del plan).
 */
describe('OrderTypeOrmRepository (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let repository: OrderTypeOrmRepository;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    dataSource = app.get(DataSource);
    repository = new OrderTypeOrmRepository(dataSource.getRepository(OrderOrmEntity), dataSource);
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE orders, orders_outbox');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('save()', () => {
    it('debería persistir la orden y su evento en la misma transacción', async () => {
      // Arrange
      const order = placeOrder();
      const events = order.pullEvents();

      // Act
      await repository.save(order, events);

      // Assert: filas crudas, no el mapper leyéndose a sí mismo.
      const orderRows = await dataSource.query<{ id: string; customer_id: string }[]>(
        'SELECT id, customer_id FROM orders',
      );
      expect(orderRows).toEqual([{ id: order.id.value, customer_id: CUSTOMER_ID }]);

      const outboxRows = await dataSource.query<
        { event_type: string; payload: Record<string, unknown>; processed_at: Date | null }[]
      >('SELECT event_type, payload, processed_at FROM orders_outbox');
      expect(outboxRows).toHaveLength(1);
      expect(outboxRows[0]?.event_type).toBe('OrderPlaced');
      expect(outboxRows[0]?.payload).toMatchObject({
        orderId: order.id.value,
        customerId: CUSTOMER_ID,
        amountCents: 149_900,
      });
      expect(outboxRows[0]?.processed_at).toBeNull();
    });

    /**
     * La sonda de atomicidad, diseñada con honestidad: el evento envenenado lleva un
     * `occurredAt` inválido, así que el INSERT de la orden SÍ se ejecuta y es la segunda
     * escritura (la columna `occurred_at` del outbox) la que revienta al serializar la
     * fecha. Sin transacción, la orden quedaría huérfana de evento — que es exactamente
     * el estado que el outbox promete imposible. Construir el evento a mano y no con
     * `Order.place()` es deliberado: el dominio nunca produce esa fecha; la sonda explota
     * que la clase del evento es plana y no valida.
     */
    it('debería no dejar la orden cuando la escritura del outbox falla', async () => {
      // Arrange
      const order = placeOrder();
      order.pullEvents();
      const poisoned = new OrderPlaced(order.id.value, CUSTOMER_ID, 149_900, new Date(NaN));

      // Act
      await expect(repository.save(order, [poisoned])).rejects.toThrow();

      // Assert: rollback total — ni orden ni outbox.
      const counts = await dataSource.query<{ orders: number; outbox: number }[]>(
        `SELECT
           (SELECT COUNT(*)::int FROM orders) AS orders,
           (SELECT COUNT(*)::int FROM orders_outbox) AS outbox`,
      );
      expect(counts[0]).toEqual({ orders: 0, outbox: 0 });
    });
  });

  describe('findById()', () => {
    it('debería reconstruir la orden guardada (round-trip)', async () => {
      // Arrange
      const order = placeOrder();
      await repository.save(order, order.pullEvents());

      // Act
      const found = await repository.findById(order.id);

      // Assert
      expect(found?.toSnapshot()).toEqual(order.toSnapshot());
    });

    it('debería devolver null cuando la orden no existe', async () => {
      // Act
      const found = await repository.findById(OrderId.generate());

      // Assert
      expect(found).toBeNull();
    });
  });
});

// Helpers

const placeOrder = (): Order =>
  Order.place({
    id: OrderId.generate(),
    customerId: CUSTOMER_ID,
    concept: OrderConcept.from('Suscripción anual plan Pro'),
    amount: OrderAmount.from(149_900),
    now: new Date('2026-08-06T09:30:00.000Z'),
  });
