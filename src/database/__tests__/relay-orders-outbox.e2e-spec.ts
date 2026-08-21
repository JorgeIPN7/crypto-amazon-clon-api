import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { createTestApp } from '@test/helpers/create-test-app';

import { relayOrdersOutbox } from '../outbox/relay-orders-outbox';

/**
 * Contra PostgreSQL real y con SQL crudo en las aserciones: el relay habla SQL directo
 * (no pasa por el ORM), así que el test se queda en el mismo registro — exactamente el
 * razonamiento de seed-admin.e2e-spec.ts.
 */
describe('relayOrdersOutbox (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE orders_outbox');
    // La publicación ES el log: silenciarlo mantiene limpia la salida de Jest y permite
    // afirmarlo. `restoreMocks: true` del config lo repone tras cada test.
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterAll(async () => {
    await app.close();
  });

  it('debería publicar las filas pendientes y marcarlas procesadas', async () => {
    // Arrange
    await insertOutboxRow('OrderPlaced', { orderId: randomUUID(), amountCents: 100 });
    await insertOutboxRow('OrderPlaced', { orderId: randomUUID(), amountCents: 200 });

    // Act
    const relayed = await relayOrdersOutbox(dataSource);

    // Assert
    expect(relayed).toBe(2);
    expect(console.log).toHaveBeenCalledTimes(2);
    const pending = await dataSource.query<{ count: number }[]>(
      'SELECT COUNT(*)::int AS count FROM orders_outbox WHERE processed_at IS NULL',
    );
    expect(pending[0]?.count).toBe(0);
  });

  it('debería ser idempotente: la segunda corrida no re-publica nada', async () => {
    // Arrange
    await insertOutboxRow('OrderPlaced', { orderId: randomUUID(), amountCents: 100 });
    await relayOrdersOutbox(dataSource);

    // Act
    const relayed = await relayOrdersOutbox(dataSource);

    // Assert
    expect(relayed).toBe(0);
  });

  it('debería devolver 0 con el outbox vacío', async () => {
    // Act
    const relayed = await relayOrdersOutbox(dataSource);

    // Assert
    expect(relayed).toBe(0);
    expect(console.log).not.toHaveBeenCalled();
  });

  /**
   * El `ORDER BY occurred_at ASC` es parte del contrato que declara el docstring del relay
   * —un consumidor recibe los eventos en el orden en que ocurrieron, no en el que se
   * insertaron—, así que las dos filas se insertan con el `occurred_at` INVERTIDO respecto
   * al orden de inserción: sin el ORDER BY (o con DESC) el orden publicado sería el otro.
   */
  it('debería publicar en orden de occurred_at, no de inserción', async () => {
    // Arrange: se inserta primero la MÁS RECIENTE.
    await insertOutboxRow(
      'OrderPlaced',
      { orderId: randomUUID(), concept: 'segunda' },
      new Date('2026-08-06T10:00:00.000Z'),
    );
    await insertOutboxRow(
      'OrderPlaced',
      { orderId: randomUUID(), concept: 'primera' },
      new Date('2026-08-06T09:00:00.000Z'),
    );

    // Act
    await relayOrdersOutbox(dataSource);

    // Assert: la publicación ES el log, así que el orden de las llamadas es el orden real.
    const published = (console.log as jest.Mock).mock.calls.map(([line]) => String(line));
    expect(published).toHaveLength(2);
    expect(published[0]).toContain('primera');
    expect(published[1]).toContain('segunda');
  });

  // Helpers

  async function insertOutboxRow(
    eventType: string,
    payload: Record<string, unknown>,
    occurredAt: Date = new Date(),
  ): Promise<void> {
    await dataSource.query(
      `INSERT INTO orders_outbox (id, event_type, payload, occurred_at, processed_at)
       VALUES ($1, $2, $3, $4, NULL)`,
      [randomUUID(), eventType, JSON.stringify(payload), occurredAt],
    );
  }
});
