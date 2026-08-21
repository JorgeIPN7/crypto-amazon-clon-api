import { AggregateRoot } from '@shared/domain/aggregate-root';

import { OrderPlaced } from '../events/order-placed.event';
import type { OrderAmount } from '../value-objects/order-amount.vo';
import type { OrderConcept } from '../value-objects/order-concept.vo';
import type { OrderId } from '../value-objects/order-id.vo';

export type OrderSnapshot = {
  id: string;
  customerId: string;
  concept: string;
  amountCents: number;
  placedAt: Date;
};

/**
 * Raíz del agregado. El agregado RECOLECTA sus eventos y `pullEvents()` los drena; quien
 * publica es la aplicación (patrón del skill clean-ddd-hexagonal). La recolección y el
 * drenaje ya no se escriben aquí: los pone `AggregateRoot`, y este agregado solo decide
 * QUÉ emite y cuándo. `customerId` es un string y no un VO propio: llega del `sub` de un
 * token ya verificado y el directorio de clientes lo re-valida ANTES de construir la orden
 * (Tabla E, caso E5).
 */
export class Order extends AggregateRoot<OrderPlaced> {
  private constructor(
    readonly id: OrderId,
    readonly customerId: string,
    readonly concept: OrderConcept,
    readonly amount: OrderAmount,
    readonly placedAt: Date,
  ) {
    super();
  }

  static place(params: {
    id: OrderId;
    customerId: string;
    concept: OrderConcept;
    amount: OrderAmount;
    now: Date;
  }): Order {
    const order = new Order(
      params.id,
      params.customerId,
      params.concept,
      params.amount,
      params.now,
    );
    order.record(
      new OrderPlaced(params.id.value, params.customerId, params.amount.value, params.now),
    );
    return order;
  }

  /** Reconstituye desde persistencia sin re-emitir eventos: ya se publicaron en su día. */
  static rehydrate(params: {
    id: OrderId;
    customerId: string;
    concept: OrderConcept;
    amount: OrderAmount;
    placedAt: Date;
  }): Order {
    return new Order(params.id, params.customerId, params.concept, params.amount, params.placedAt);
  }

  toSnapshot(): OrderSnapshot {
    return {
      id: this.id.value,
      customerId: this.customerId,
      concept: this.concept.value,
      amountCents: this.amount.value,
      placedAt: this.placedAt,
    };
  }
}
