import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import type { OrderPlaced } from '../../domain/events/order-placed.event';
import type { Order } from '../../domain/entities/order.entity';
import type { OrderId } from '../../domain/value-objects/order-id.vo';
import { OrderRepository } from '../../domain/ports/order.repository';

import { OrderMapper } from './order.mapper';
import { OrderOrmEntity } from './order.orm-entity';
import { OutboxMessageOrmEntity } from './outbox-message.orm-entity';

/**
 * Adaptador de salida. `save` escribe la orden Y sus filas de outbox dentro de
 * `dataSource.transaction` (`db-use-transactions`): si cualquiera de las dos escrituras
 * falla, ninguna queda — eso es lo que convierte la tabla en un outbox y no en un log
 * optimista. El E2E lo verifica con una fila envenenada, no por fe.
 */
@Injectable()
export class OrderTypeOrmRepository implements OrderRepository {
  constructor(
    @InjectRepository(OrderOrmEntity)
    private readonly orders: Repository<OrderOrmEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async save(order: Order, events: readonly OrderPlaced[]): Promise<void> {
    const orderRow = OrderMapper.toPersistence(order);
    const outboxRows = events.map((event) => {
      const row = new OutboxMessageOrmEntity();
      row.id = randomUUID();
      // `keepClassNames: true` en `.swcrc` garantiza el nombre real de la clase (README
      // documenta que Nest ya depende de ello); con un solo tipo de evento no hay registro.
      row.eventType = event.constructor.name;
      // El payload del evento es serializable tal cual (spec §3): JSON.stringify convierte
      // el Date a ISO-8601 dentro del jsonb.
      row.payload = {
        orderId: event.orderId,
        customerId: event.customerId,
        amountCents: event.amountCents,
        occurredAt: event.occurredAt,
      };
      row.occurredAt = event.occurredAt;
      row.processedAt = null;
      return row;
    });

    await this.dataSource.transaction(async (manager) => {
      await manager.save(orderRow);
      await manager.save(outboxRows);
    });
  }

  async findById(id: OrderId): Promise<Order | null> {
    const row = await this.orders.findOne({ where: { id: id.value } });
    return row ? OrderMapper.toDomain(row) : null;
  }
}
