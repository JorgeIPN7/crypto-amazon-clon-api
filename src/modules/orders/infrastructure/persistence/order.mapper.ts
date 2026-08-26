import { Order } from '../../domain/entities/order.entity';
import { OrderAmount } from '../../domain/value-objects/order-amount.vo';
import { OrderConcept } from '../../domain/value-objects/order-concept.vo';
import { OrderId } from '../../domain/value-objects/order-id.vo';

import { OrderOrmEntity } from './order.orm-entity';

/**
 * Única frontera entre la fila y el agregado. Al reconstituir usa `rehydrate`, no `place`:
 * los datos persistidos ya eran válidos al guardarse y reconstruir no re-emite eventos.
 *
 * Las tres marcas de tiempo viajan tal cual, sin fallback: `created_at` y `updated_at` nacen
 * `NOT NULL` en `CreateOrdersAndOutbox`, la misma migración que crea la tabla, así que no hay
 * filas con NULL que tolerar. `placed_at` no se deriva de ellas ni ellas de él — son tres datos
 * distintos que hoy coinciden, y el motivo está en `OrderOrmEntity`.
 *
 * Los dos actores SÍ pueden ser `null` y viajan tal cual: nacen nullables porque llegan a una
 * tabla ya creada, y las órdenes anteriores a `AddAuditActorColumns` no saben quién las escribió.
 */
export const OrderMapper = {
  toDomain(row: OrderOrmEntity): Order {
    return Order.rehydrate({
      id: OrderId.from(row.id),
      customerId: row.customerId,
      concept: OrderConcept.from(row.concept),
      amount: OrderAmount.from(row.amountCents),
      placedAt: row.placedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
    });
  },

  toPersistence(order: Order): OrderOrmEntity {
    const snapshot = order.toSnapshot();
    const row = new OrderOrmEntity();
    row.id = snapshot.id;
    row.customerId = snapshot.customerId;
    row.concept = snapshot.concept;
    row.amountCents = snapshot.amountCents;
    row.placedAt = snapshot.placedAt;
    row.createdAt = snapshot.createdAt;
    row.updatedAt = snapshot.updatedAt;
    row.createdBy = snapshot.createdBy;
    row.updatedBy = snapshot.updatedBy;
    return row;
  },
};
