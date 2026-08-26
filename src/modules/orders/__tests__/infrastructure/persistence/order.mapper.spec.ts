import { test as fcTest, fc } from '@fast-check/jest';

import { Order } from '../../../domain/entities/order.entity';
import { OrderAmount } from '../../../domain/value-objects/order-amount.vo';
import { OrderConcept } from '../../../domain/value-objects/order-concept.vo';
import { OrderId } from '../../../domain/value-objects/order-id.vo';
import { OrderMapper } from '../../../infrastructure/persistence/order.mapper';
import { OrderOrmEntity } from '../../../infrastructure/persistence/order.orm-entity';
import { orderAmountCentsArb, orderConceptArb, timestampArb } from '../../helpers/arbitraries';

const CUSTOMER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const PLACED_AT = new Date('2026-08-06T09:30:00.000Z');
// Distintos de `PLACED_AT` a propósito: si coincidieran, un mapper que confundiera las tres
// columnas —o que derivase las dos marcas de fila de `placed_at`— pasaría igual.
const CREATED_AT = new Date('2026-08-06T09:30:00.500Z');
const UPDATED_AT = new Date('2026-08-07T18:45:00.000Z');
// Distintos entre sí y distintos de `CUSTOMER_ID`: con valores repetidos, un mapper que
// confundiera las columnas de actor —o que las derivase de `customer_id`— pasaría igual.
const CREATED_BY = '3f1a9b2c-8d4e-4f6a-9b1c-2e5d7a0f3b48';
const UPDATED_BY = '5b7c2d4e-9a1f-4c3b-8e6d-0f2a4b6c8d1e';

describe('OrderMapper', () => {
  describe('toPersistence()', () => {
    it('debería volcar el agregado a columnas primitivas', () => {
      // Arrange
      const order = buildOrder();

      // Act
      const row = OrderMapper.toPersistence(order);

      // Assert
      expect(row).toBeInstanceOf(OrderOrmEntity);
      expect(row.id).toBe(order.id.value);
      expect(row.customerId).toBe(CUSTOMER_ID);
      expect(row.concept).toBe('Suscripción anual plan Pro');
      expect(row.amountCents).toBe(149_900);
      expect(row.placedAt).toEqual(PLACED_AT);
    });

    it('debería escribir created_at y updated_at, no dejarlos sin poner', () => {
      // Arrange — las dos columnas son NOT NULL en la tabla, así que un `toPersistence` que
      // las olvidara reventaría el INSERT contra PostgreSQL. Este caso lo caza sin bajar a la
      // base, y lo hace de forma DIRECTA: dice qué falta y dónde.
      //
      // No es lo único que lo sujeta —medido: borrando las dos asignaciones caen DOS tests, este
      // y el round-trip property-based de más abajo—, pero el round-trip solo informa de que dos
      // snapshots difieren. Este nombra el campo.
      const order = buildOrder();

      // Act
      const row = OrderMapper.toPersistence(order);

      // Assert
      expect(row.createdAt).toEqual(CREATED_AT);
      expect(row.updatedAt).toEqual(UPDATED_AT);
    });

    // Mismo argumento que el caso de arriba, con una diferencia: estas dos columnas SÍ son
    // nullables, así que un `toPersistence` que las olvidara NO reventaría el INSERT contra
    // PostgreSQL — escribiría NULL en silencio. Aquí el unitario no es un atajo del E2E: es el
    // único sitio donde el olvido se ve.
    it('debería escribir created_by y updated_by en la fila', () => {
      // Arrange
      const order = buildOrder();

      // Act
      const row = OrderMapper.toPersistence(order);

      // Assert
      expect(row.createdBy).toBe(CREATED_BY);
      expect(row.updatedBy).toBe(UPDATED_BY);
    });
  });

  describe('toDomain()', () => {
    it('debería reconstruir el agregado desde la fila sin emitir eventos', () => {
      // Arrange
      const row = buildRow();

      // Act
      const order = OrderMapper.toDomain(row);

      // Assert: rehydrate, no place — reconstruir no re-publica.
      expect(order.toSnapshot()).toEqual({
        id: row.id,
        customerId: row.customerId,
        concept: row.concept,
        amountCents: row.amountCents,
        placedAt: row.placedAt,
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
        createdBy: CREATED_BY,
        updatedBy: UPDATED_BY,
      });
      expect(order.pullEvents()).toEqual([]);
    });

    // Toda orden anterior a `AddAuditActorColumns` lee NULL en las dos columnas: el mapper las
    // pasa tal cual, sin coalescer a una cadena que inventaría un actor.
    it('debería reconstruir una fila cuyos actores son null', () => {
      // Arrange
      const row = buildRow();
      row.createdBy = null;
      row.updatedBy = null;

      // Act
      const order = OrderMapper.toDomain(row);

      // Assert
      expect(order.createdBy).toBeNull();
      expect(order.updatedBy).toBeNull();
    });
  });

  describe('toDomain() ∘ toPersistence() (property-based)', () => {
    fcTest.prop([
      fc.record({
        concept: orderConceptArb,
        amountCents: orderAmountCentsArb,
        placedAt: timestampArb,
        createdAt: timestampArb,
        updatedAt: timestampArb,
        // Arbitrario CONSTRUIDO, no filtrado: los dos únicos valores que la columna puede
        // tener son «un id» y «NULL», y ambos tienen que sobrevivir la ida y vuelta.
        createdBy: fc.constantFrom<string | null>(CREATED_BY, null),
        updatedBy: fc.constantFrom<string | null>(UPDATED_BY, null),
      }),
    ])(
      'debería preservar el snapshot para cualquier orden del dominio',
      ({ concept, amountCents, placedAt, createdAt, updatedAt, createdBy, updatedBy }) => {
        // Arrange
        const original = Order.rehydrate({
          id: OrderId.generate(),
          customerId: CUSTOMER_ID,
          concept: OrderConcept.from(concept),
          amount: OrderAmount.from(amountCents),
          placedAt,
          createdAt,
          updatedAt,
          createdBy,
          updatedBy,
        });

        // Act
        const restored = OrderMapper.toDomain(OrderMapper.toPersistence(original));

        // Assert
        expect(restored.toSnapshot()).toEqual(original.toSnapshot());
      },
    );
  });
});

// Helpers

const buildOrder = (): Order =>
  Order.rehydrate({
    id: OrderId.generate(),
    customerId: CUSTOMER_ID,
    concept: OrderConcept.from('Suscripción anual plan Pro'),
    amount: OrderAmount.from(149_900),
    placedAt: PLACED_AT,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    createdBy: CREATED_BY,
    updatedBy: UPDATED_BY,
  });

const buildRow = (): OrderOrmEntity => {
  const row = new OrderOrmEntity();
  row.id = OrderId.generate().value;
  row.customerId = CUSTOMER_ID;
  row.concept = 'Fila persistida';
  row.amountCents = 5_000;
  row.placedAt = PLACED_AT;
  row.createdAt = CREATED_AT;
  row.updatedAt = UPDATED_AT;
  row.createdBy = CREATED_BY;
  row.updatedBy = UPDATED_BY;
  return row;
};
