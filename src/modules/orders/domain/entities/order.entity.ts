import { AggregateRoot } from '@shared/domain/aggregate-root';
import type { AuditTrail } from '@shared/domain/entity.base';

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
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
};

/**
 * Raíz del agregado. El agregado RECOLECTA sus eventos y `pullEvents()` los drena; quien publica
 * es la aplicación (patrón del skill clean-ddd-hexagonal). La recolección, el drenaje y ahora
 * también la identidad y las marcas de tiempo los pone `AggregateRoot`, que extiende `Entity`;
 * este agregado solo decide QUÉ emite y cuándo.
 *
 * `placedAt` NO es `createdAt` aunque hoy valgan siempre lo mismo: es el hecho de negocio que
 * viaja en `OrderPlaced` y en el contrato publicado, mientras que `createdAt`/`updatedAt` son las
 * marcas de fila comunes a todo agregado. Coinciden porque la orden es inmutable — no tiene un
 * solo mutador. El día que lo tenga, `updatedAt` se moverá y `placedAt` no.
 *
 * `customerId` es un string y no un VO propio: llega del `sub` de un token ya verificado y el
 * directorio de clientes lo re-valida ANTES de construir la orden (Tabla E, caso E5). Es el
 * mismo criterio, escrito antes que él, por el que `createdBy`/`updatedBy` de la traza son
 * `string | null`.
 *
 * ⚠️ **`createdBy` y `customerId` valen HOY siempre lo mismo, y aun así son dos campos.** La
 * distinción es la que ya existe entre `placedAt` y `createdAt`: `customerId` es el DUEÑO de
 * negocio de la orden, `createdBy` es quien ejecutó la escritura. Coinciden porque el único
 * camino que existe es `POST /orders` con `@Auth()`, donde el cliente se coloca su propia orden
 * y el controller saca ambos del mismo `sub`. El día que haya un alta por parte de un
 * administrador en nombre de un cliente, se separan — y quien decide el valor es el caso de uso,
 * no este agregado, que se limita a recibirlo.
 */
export class Order extends AggregateRoot<OrderId, OrderPlaced> {
  private constructor(
    id: OrderId,
    readonly customerId: string,
    readonly concept: OrderConcept,
    readonly amount: OrderAmount,
    readonly placedAt: Date,
    audit: AuditTrail,
  ) {
    super(id, audit);
  }

  static place(params: {
    id: OrderId;
    customerId: string;
    concept: OrderConcept;
    amount: OrderAmount;
    now: Date;
    createdBy: string | null;
  }): Order {
    // Un solo `now` para los tres instantes: colocar la orden ES crearla. Y un solo actor para
    // los dos campos de la traza, por la misma razón que en `User.create`.
    const order = new Order(
      params.id,
      params.customerId,
      params.concept,
      params.amount,
      params.now,
      {
        createdAt: params.now,
        updatedAt: params.now,
        createdBy: params.createdBy,
        updatedBy: params.createdBy,
      },
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
    createdAt: Date;
    updatedAt: Date;
    createdBy: string | null;
    updatedBy: string | null;
  }): Order {
    return new Order(params.id, params.customerId, params.concept, params.amount, params.placedAt, {
      createdAt: params.createdAt,
      updatedAt: params.updatedAt,
      createdBy: params.createdBy,
      updatedBy: params.updatedBy,
    });
  }

  toSnapshot(): OrderSnapshot {
    return {
      id: this.id.value,
      customerId: this.customerId,
      concept: this.concept.value,
      amountCents: this.amount.value,
      placedAt: this.placedAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      createdBy: this.createdBy,
      updatedBy: this.updatedBy,
    };
  }
}
