import { AggregateRoot } from '../../domain/aggregate-root';

describe('AggregateRoot', () => {
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

class RecordingAggregate extends AggregateRoot<string> {
  emit(event: string): void {
    this.record(event);
  }
}
