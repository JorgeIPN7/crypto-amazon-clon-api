import type { OrderPlaced } from '../events/order-placed.event';
import type { Order } from '../entities/order.entity';
import type { OrderId } from '../value-objects/order-id.vo';

/**
 * Puerto de salida (driven). La firma de `save` lleva los eventos A PROPÓSITO: el outbox
 * es atómico con el agregado o no es outbox (spec §4) — un `save(order)` + `publish(events)`
 * separados no podrían prometer la transacción.
 *
 * `abstract class` —tipo y token en la misma referencia— por el mismo motivo que
 * `users/domain/ports/user.repository.ts`, donde vive el razonamiento completo.
 */
export abstract class OrderRepository {
  abstract save(order: Order, events: readonly OrderPlaced[]): Promise<void>;
  abstract findById(id: OrderId): Promise<Order | null>;
}
