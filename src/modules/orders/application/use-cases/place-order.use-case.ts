import { Injectable } from '@nestjs/common';

import { CustomerGoneError } from '../../domain/errors/order.errors';
import { Order } from '../../domain/entities/order.entity';
import { OrderAmount } from '../../domain/value-objects/order-amount.vo';
import { OrderConcept } from '../../domain/value-objects/order-concept.vo';
import { OrderId } from '../../domain/value-objects/order-id.vo';
import { CustomerDirectory } from '../../domain/ports/customer.directory';
import { OrderRepository } from '../../domain/ports/order.repository';

export type PlaceOrderInput = {
  customerId: string;
  concept: string;
  amountCents: number;
};

/**
 * Caso de uso único del contexto. El directorio se consulta ANTES de construir nada: un
 * token firmado puede sobrevivir a su usuario (desactivado tras emitirse), y también cubre
 * el `sub` malformado — la fachada de users devuelve `false` sin lanzar (Tabla F, F4).
 * Los eventos se drenan y viajan al repositorio EN LA MISMA llamada: la atomicidad con el
 * outbox es del puerto, no de este caso de uso.
 */
@Injectable()
export class PlaceOrderUseCase {
  constructor(
    private readonly customers: CustomerDirectory,
    private readonly orders: OrderRepository,
  ) {}

  async execute(input: PlaceOrderInput): Promise<Order> {
    const exists = await this.customers.exists(input.customerId);
    if (!exists) {
      throw new CustomerGoneError(input.customerId);
    }

    const order = Order.place({
      id: OrderId.generate(),
      customerId: input.customerId,
      concept: OrderConcept.from(input.concept),
      amount: OrderAmount.from(input.amountCents),
      now: new Date(),
    });

    await this.orders.save(order, order.pullEvents());
    return order;
  }
}
