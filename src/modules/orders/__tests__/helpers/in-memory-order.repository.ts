import type { OrderPlaced } from '../../domain/events/order-placed.event';
import type { Order } from '../../domain/entities/order.entity';
import type { OrderId } from '../../domain/value-objects/order-id.vo';
import type { OrderRepository } from '../../domain/ports/order.repository';

/**
 * Fake escrito a mano del puerto, no un mock generado. Registra cada llamada a `save` con
 * sus eventos para que la suite pueda afirmar el contrato «una sola llamada, eventos
 * dentro» (Tabla E, casos E1 y E3).
 */
export class InMemoryOrderRepository implements OrderRepository {
  readonly saveCalls: { order: Order; events: readonly OrderPlaced[] }[] = [];

  private readonly store = new Map<string, Order>();

  save(order: Order, events: readonly OrderPlaced[]): Promise<void> {
    this.saveCalls.push({ order, events });
    this.store.set(order.id.value, order);
    return Promise.resolve();
  }

  findById(id: OrderId): Promise<Order | null> {
    return Promise.resolve(this.store.get(id.value) ?? null);
  }
}
