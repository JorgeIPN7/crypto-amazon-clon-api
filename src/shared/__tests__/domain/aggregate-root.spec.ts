import { AggregateRoot } from '../../domain/aggregate-root';
import { UuidId } from '../../domain/uuid-id.base';

describe('AggregateRoot', () => {
  describe('identidad', () => {
    it('debería exponer la identidad heredada de Entity', () => {
      // Arrange
      const id = SampleId.from('9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012');
      const createdAt = new Date('2026-08-01T10:15:00.000Z');

      // Act
      const aggregate = new RecordingAggregate(id, createdAt);

      // Assert
      expect(aggregate.id).toBe(id);
      expect(aggregate.createdAt).toEqual(createdAt);
      expect(aggregate.updatedAt).toEqual(createdAt);
    });
  });

  describe('pullEvents()', () => {
    it('debería devolver una lista vacía cuando el agregado no ha recolectado nada', () => {
      // Arrange
      const aggregate = new RecordingAggregate();
      // Act
      const events = aggregate.pullEvents();
      // Assert
      expect(events).toEqual([]);
    });

    it('debería devolver los eventos recolectados en el orden en que se registraron', () => {
      // Arrange
      const aggregate = new RecordingAggregate();
      aggregate.emit('first');
      aggregate.emit('second');
      // Act
      const events = aggregate.pullEvents();
      // Assert
      expect(events).toEqual(['first', 'second']);
    });

    it('debería drenar la colección: el segundo drenaje devuelve vacío', () => {
      // Arrange
      const aggregate = new RecordingAggregate();
      aggregate.emit('only');
      aggregate.pullEvents();
      // Act
      const events = aggregate.pullEvents();
      // Assert
      expect(events).toEqual([]);
    });

    it('debería volver a recolectar después de un drenaje', () => {
      // Arrange
      const aggregate = new RecordingAggregate();
      aggregate.emit('first');
      aggregate.pullEvents();
      aggregate.emit('second');
      // Act
      const events = aggregate.pullEvents();
      // Assert
      expect(events).toEqual(['second']);
    });
  });
});

// Helpers
//
// `record()` es `protected` a propósito —solo el propio agregado decide qué emite—, así que
// el doble expone un `emit()` público que lo delega. Los eventos son strings y no clases de
// evento reales: la base es genérica en `TEvent` y no toca su contenido.
//
// Desde que `AggregateRoot` extiende `Entity`, el doble necesita además un id y sus marcas
// de tiempo. El id por defecto evita repetirlo en los cuatro casos de `pullEvents()`, que
// solo hablan de eventos y no de identidad.

const DEFAULT_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const DEFAULT_NOW = new Date('2026-08-01T10:15:00.000Z');

class SampleIdError extends Error {}

class SampleId extends UuidId {
  static from(value: string): SampleId {
    return new SampleId(UuidId.assertUuid(value, () => new SampleIdError()));
  }
}

class RecordingAggregate extends AggregateRoot<SampleId, string> {
  constructor(id: SampleId = SampleId.from(DEFAULT_ID), now: Date = DEFAULT_NOW) {
    super(id, { createdAt: now, updatedAt: now, createdBy: null, updatedBy: null });
  }

  emit(event: string): void {
    this.record(event);
  }
}
