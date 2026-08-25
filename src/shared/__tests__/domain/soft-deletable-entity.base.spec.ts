import type { AuditTrail } from '../../domain/entity.base';
import { SoftDeletableEntity } from '../../domain/soft-deletable-entity.base';
import { UuidId } from '../../domain/uuid-id.base';

const ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');
const UPDATED_AT = new Date('2026-02-02T00:00:00.000Z');
const DELETED_AT = new Date('2026-03-03T00:00:00.000Z');
const LATER = new Date('2026-04-04T00:00:00.000Z');
const CREATED_BY = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';

class SampleId extends UuidId {
  static from(value: string): SampleId {
    return new SampleId(UuidId.assertUuid(value, () => new Error('id inválido')));
  }
}

const trail = (): AuditTrail => ({
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  createdBy: CREATED_BY,
  updatedBy: CREATED_BY,
});

/** Doble de prueba: expone los dos métodos `protected` para poder ejercitarlos. */
class SampleEntity extends SoftDeletableEntity<SampleId> {
  constructor(id: SampleId, audit: AuditTrail, deletedAt: Date | null = null) {
    super(id, audit, deletedAt);
  }
  remove(now: Date, by: string | null): void {
    this.markDeleted(now, by);
  }
  bringBack(now: Date, by: string | null): void {
    this.restore(now, by);
  }
}

describe('SoftDeletableEntity', () => {
  describe('estado inicial', () => {
    it('debería nacer sin marca de borrado', () => {
      // Arrange & Act
      const entity = new SampleEntity(SampleId.from(ID), trail());

      // Assert
      expect(entity.deletedAt).toBeNull();
      expect(entity.isDeleted).toBe(false);
    });

    it('debería reconstituirse conservando la marca de borrado que recibe', () => {
      // Arrange & Act
      const entity = new SampleEntity(SampleId.from(ID), trail(), DELETED_AT);

      // Assert
      // Es el caso del mapper: una fila ya borrada vuelve del ORM borrada, sin que nadie llame a
      // `markDeleted` otra vez — que además movería la fecha original.
      expect(entity.deletedAt).toEqual(DELETED_AT);
      expect(entity.isDeleted).toBe(true);
    });
  });

  describe('markDeleted()', () => {
    it('debería sellar la fecha de borrado con el instante recibido', () => {
      // Arrange
      const entity = new SampleEntity(SampleId.from(ID), trail());

      // Act
      entity.remove(DELETED_AT, ACTOR);

      // Assert
      expect(entity.deletedAt).toEqual(DELETED_AT);
      expect(entity.isDeleted).toBe(true);
    });

    it('debería avanzar también la traza de auditoría, porque borrar es modificar', () => {
      // Arrange
      const entity = new SampleEntity(SampleId.from(ID), trail());

      // Act
      entity.remove(DELETED_AT, ACTOR);

      // Assert
      // Sin esto, una fila borrada diría que su última modificación fue anterior al borrado. El
      // `updatedBy` importa más todavía: es quien lo borró, que es la pregunta que se hace
      // cuando algo desaparece.
      expect(entity.updatedAt).toEqual(DELETED_AT);
      expect(entity.updatedBy).toBe(ACTOR);
    });

    it('debería ser idempotente: repetirlo no mueve la fecha del primer borrado', () => {
      // Arrange
      const entity = new SampleEntity(SampleId.from(ID), trail());
      entity.remove(DELETED_AT, ACTOR);

      // Act
      entity.remove(LATER, 'otro-actor');

      // Assert
      // Mismo criterio que los mutadores idempotentes de `User`: el corte es ANTES del `touch`,
      // así que un segundo borrado tampoco reescribe el actor. La traza sigue nombrando a quien
      // lo borró de verdad.
      expect(entity.deletedAt).toEqual(DELETED_AT);
      expect(entity.updatedAt).toEqual(DELETED_AT);
      expect(entity.updatedBy).toBe(ACTOR);
    });
  });

  describe('restore()', () => {
    it('debería limpiar la marca de borrado', () => {
      // Arrange
      const entity = new SampleEntity(SampleId.from(ID), trail(), DELETED_AT);

      // Act
      entity.bringBack(LATER, ACTOR);

      // Assert
      expect(entity.deletedAt).toBeNull();
      expect(entity.isDeleted).toBe(false);
    });

    it('debería registrar en la traza quién restauró y cuándo', () => {
      // Arrange
      const entity = new SampleEntity(SampleId.from(ID), trail(), DELETED_AT);

      // Act
      entity.bringBack(LATER, ACTOR);

      // Assert
      expect(entity.updatedAt).toEqual(LATER);
      expect(entity.updatedBy).toBe(ACTOR);
    });

    it('debería no tocar nada al restaurar una entidad que no estaba borrada', () => {
      // Arrange
      const entity = new SampleEntity(SampleId.from(ID), trail());

      // Act
      entity.bringBack(LATER, ACTOR);

      // Assert
      // Simétrico a la idempotencia del borrado: sin el corte, restaurar algo vivo reescribiría
      // `updatedBy` con quien no cambió nada.
      expect(entity.updatedAt).toEqual(UPDATED_AT);
      expect(entity.updatedBy).toBe(CREATED_BY);
    });
  });

  describe('la marca de borrado tampoco se puede mover desde fuera', () => {
    it('debería no moverse aunque se mute la fecha que devuelve el getter', () => {
      // Arrange
      const entity = new SampleEntity(SampleId.from(ID), trail(), DELETED_AT);

      // Act
      entity.deletedAt?.setUTCFullYear(2099);

      // Assert
      // Misma garantía que las fechas de `AuditTrail`, y por el mismo motivo medido:
      // `Object.freeze` no protege un `Date`. Aquí no hay objeto que congelar —es un campo
      // suelto—, así que la copia en el getter es la ÚNICA defensa.
      expect(entity.deletedAt).toEqual(DELETED_AT);
    });

    it('debería no quedar ligada a la instancia que recibió el constructor', () => {
      // Arrange
      const mutable = new Date(DELETED_AT);
      const entity = new SampleEntity(SampleId.from(ID), trail(), mutable);

      // Act
      mutable.setUTCFullYear(2099);

      // Assert
      expect(entity.deletedAt).toEqual(DELETED_AT);
    });
  });
});
