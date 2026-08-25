import fc from 'fast-check';

import { Entity, type AuditTrail } from '../../domain/entity.base';
import { UuidId } from '../../domain/uuid-id.base';

const ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const OTHER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const CREATED_AT = new Date('2026-08-01T10:15:00.000Z');
const UPDATED_AT = new Date('2026-08-02T11:30:00.000Z');
const CREATED_BY = '3f1a9b2c-8d4e-4f6a-9b1c-2e5d7a0f3b48';

describe('Entity', () => {
  describe('propiedades', () => {
    it('debería exponer el id, createdAt y updatedAt recibidos', () => {
      // Arrange
      const id = SampleId.from(ID);

      // Act
      const entity = new SampleEntity(id, trail());

      // Assert
      expect(entity.id).toBe(id);
      expect(entity.createdAt).toEqual(CREATED_AT);
      expect(entity.updatedAt).toEqual(UPDATED_AT);
    });

    it('debería exponer la traza completa a través del getter audit', () => {
      // Arrange
      const entity = new SampleEntity(SampleId.from(ID), trail());

      // Act
      const audit = entity.audit;

      // Assert — `toEqual` es exacto, así que este caso es el que se pone rojo si la traza gana
      // o pierde un campo sin decidirlo. Al añadir el actor cambió aquí y en ningún otro sitio.
      expect(audit).toEqual({
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
        createdBy: CREATED_BY,
        updatedBy: CREATED_BY,
      });

      // Y la traza publicada está CONGELADA. No es cinturón sobre tirantes: el getter devuelve
      // la referencia interna, así que sin `Object.freeze` bastaba
      // `(entity.audit as { updatedAt: Date }).updatedAt = otra` para mover el sello saltándose
      // `touch()`. Medido antes de añadirlo: `updatedAt` se iba a 2099 y `updatedBy` a un valor
      // arbitrario, con todos los gates en verde. El `readonly` del tipo no lo impide — se borra
      // al compilar—, y `private` tampoco: es barrera de compilación, no de ejecución.
      expect(Object.isFrozen(audit)).toBe(true);
    });

    it('debería copiar la traza recibida en vez de guardar la referencia', () => {
      // Arrange — traza MUTABLE a propósito: es la que sigue teniendo en la mano quien construye
      // la entidad. Sin la copia, ese objeto es mando a distancia sobre el agregado.
      //
      // Las fechas son PROPIAS de este caso y no las constantes del archivo, precisamente porque
      // aquí se mutan: `trail()` las reutilizaría por referencia y el ataque contaminaría a los
      // demás `it`. Se descubrió al escribirlo — la primera versión movía `CREATED_AT` a 2100
      // para todo el spec.
      const bornAt = new Date('2026-08-01T10:15:00.000Z');
      const audit = trail({ createdAt: bornAt, updatedAt: new Date(bornAt) });
      const entity = new SampleEntity(SampleId.from(ID), audit);

      // Act — dos ataques distintos, y el segundo es el que se escapaba durante todo el ciclo:
      // REASIGNAR el campo lo para cualquier copia del objeto, pero MUTAR el `Date` en sitio
      // atraviesa el spread, que solo copia referencias. `Object.freeze` tampoco lo detiene: el
      // valor de un `Date` vive en un slot interno, no en una propiedad. Solo lo cierra copiar
      // la fecha, y eso es lo que hace `Entity.sealAudit`.
      audit.updatedAt = new Date('2030-01-01T00:00:00.000Z');
      audit.updatedBy = 'otro-actor';
      bornAt.setUTCFullYear(2100);

      // Assert
      expect(entity.createdAt.getUTCFullYear()).toBe(2026);
      expect(entity.updatedAt).toEqual(new Date('2026-08-01T10:15:00.000Z'));
      expect(entity.updatedBy).toBe(CREATED_BY);
      expect(entity.audit).not.toBe(audit);
    });
  });

  describe('la traza publicada tampoco se puede mover', () => {
    // El arreglo anterior (commit 9e18b32) copió los `Date` al construir y al tocar, y con eso
    // cortó el hilo con las instancias del LLAMANTE. Pero el getter seguía publicando la
    // instancia interna, así que quien la recibía podía moverla igual. Medido ejecutándolo:
    //
    //     antes               : 2020-01-01T00:00:00.000Z
    //     tras user.updatedAt : 2099-01-01T00:00:00.000Z   <<< MUTADO
    //     tras user.audit.*   : 2150-01-01T00:00:00.000Z   <<< MUTADO
    //
    // Es el mismo defecto un paso más allá: se cerró la ENTRADA y quedó abierta la SALIDA. Y el
    // JSDoc afirmaba que `Object.freeze` la cerraba, que era falso — `freeze` no protege un
    // `Date`, cuyo valor vive en un slot interno.
    it('debería no moverse aunque se mute la fecha devuelta por el getter directo', () => {
      // Arrange
      const entity = new SampleEntity(SampleId.from(ID), trail());

      // Act
      entity.updatedAt.setUTCFullYear(2099);

      // Assert
      expect(entity.updatedAt).toEqual(UPDATED_AT);
    });

    it('debería no moverse aunque se mute la fecha devuelta por el getter audit', () => {
      // Arrange
      const entity = new SampleEntity(SampleId.from(ID), trail());

      // Act
      entity.audit.updatedAt.setUTCFullYear(2150);

      // Assert
      // Caso aparte del anterior y no una aserción más: son DOS getters distintos, y copiar en
      // uno solo dejaría el otro abierto. Así fue exactamente como quedó el arreglo anterior.
      expect(entity.updatedAt).toEqual(UPDATED_AT);
    });

    it('debería no dejar mover createdAt, que ningún camino legítimo reescribe', () => {
      // Arrange
      const entity = new SampleEntity(SampleId.from(ID), trail());

      // Act
      entity.createdAt.setUTCFullYear(1999);
      entity.audit.createdAt.setUTCFullYear(1998);

      // Assert
      // `createdAt` es peor que `updatedAt`: no hay ningún método que lo reescriba, así que una
      // fecha de alta movida no se corrige nunca y la fila miente para siempre.
      expect(entity.createdAt).toEqual(CREATED_AT);
    });
  });

  describe('equals()', () => {
    it('debería considerar iguales dos instancias de la misma clase con el mismo id', () => {
      // Arrange — trazas distintas a propósito: la identidad NO depende del contenido.
      const one = new SampleEntity(SampleId.from(ID), trail({ updatedAt: CREATED_AT }));
      const another = new SampleEntity(
        SampleId.from(ID),
        trail({ createdAt: UPDATED_AT, createdBy: null, updatedBy: null }),
      );

      // Act
      const result = one.equals(another);

      // Assert
      expect(result).toBe(true);
    });

    it('debería considerar distintas dos instancias con ids distintos', () => {
      // Arrange
      const one = new SampleEntity(SampleId.from(ID), trail());
      const another = new SampleEntity(SampleId.from(OTHER_ID), trail());

      // Act
      const result = one.equals(another);

      // Assert
      expect(result).toBe(false);
    });

    it('debería considerar distintas dos entidades de clases distintas con el mismo id', () => {
      // Arrange
      const one = new SampleEntity(SampleId.from(ID), trail());
      const another = new OtherSampleEntity(SampleId.from(ID), trail());

      // Act
      const result = one.equals(another);

      // Assert
      expect(result).toBe(false);
    });

    it('debería devolver false ante null', () => {
      // Arrange
      const entity = new SampleEntity(SampleId.from(ID), trail());

      // Act
      const result = entity.equals(null);

      // Assert
      expect(result).toBe(false);
    });

    it('debería devolver false ante undefined', () => {
      // Arrange
      const entity = new SampleEntity(SampleId.from(ID), trail());

      // Act
      const result = entity.equals(undefined);

      // Assert
      expect(result).toBe(false);
    });

    it('debería considerar igual a una entidad consigo misma', () => {
      // Arrange
      const entity = new SampleEntity(SampleId.from(ID), trail());

      // Act
      const result = entity.equals(entity);

      // Assert
      expect(result).toBe(true);
    });
  });

  describe('touch()', () => {
    it('debería fijar updatedAt al instante que recibe touch', () => {
      // Arrange
      const entity = new SampleEntity(SampleId.from(ID), trail({ updatedAt: CREATED_AT }));
      const now = new Date('2026-09-09T09:09:09.000Z');

      // Act
      entity.mutate(now, null);

      // Assert
      expect(entity.updatedAt).toEqual(now);
    });

    // C14. El actor viaja hasta `updatedBy` sin transformarse ni perderse: es lo único que
    // distingue un `touch(now, by)` de verdad de uno que reciba el actor y lo tire.
    it('debería registrar el actor que recibe touch', () => {
      // Arrange
      const entity = new SampleEntity(SampleId.from(ID), trail({ updatedBy: null }));

      // Act
      entity.mutate(new Date('2026-09-09T09:09:09.000Z'), 'user-123');

      // Assert
      expect(entity.updatedBy).toBe('user-123');
    });

    it('debería dejar createdAt intacto tras un touch', () => {
      // Arrange
      const entity = new SampleEntity(SampleId.from(ID), trail({ updatedAt: CREATED_AT }));

      // Act
      entity.mutate(new Date('2026-09-09T09:09:09.000Z'), null);

      // Assert
      expect(entity.createdAt).toEqual(CREATED_AT);
    });

    it('debería reemplazar la traza en touch en lugar de mutarla', () => {
      // Arrange
      const entity = new SampleEntity(SampleId.from(ID), trail());
      const before = entity.audit;

      // Act
      entity.mutate(new Date('2026-09-09T09:09:09.000Z'), 'otro-actor');

      // Assert — la traza vieja sigue diciendo lo que decía: es la aserción que cae si `touch`
      // escribe `_audit.updatedAt` en sitio en vez de sustituir el objeto entero. Con el actor
      // dentro, la escritura en sitio se vería además en `before.updatedBy`.
      // ⚠️ Esta línea es TAUTOLÓGICA desde que `audit` devuelve una copia en cada llamada: dos
      // accesos consecutivos ya dan objetos distintos, tocado o no. Se conserva porque documenta
      // la intención de `touch` (sustituir, no escribir dentro), pero NO prueba nada: la que sí
      // cae si `touch` escribiera en sitio es la siguiente.
      expect(entity.audit).not.toBe(before);
      expect(before.updatedAt).toEqual(UPDATED_AT);
      expect(before.updatedBy).toBe(CREATED_BY);
      expect(entity.createdAt).toEqual(CREATED_AT);

      // La traza NUEVA también sale congelada, no solo la del constructor. Medido: sin esta
      // línea, quitar el `Object.freeze` de `touch` dejaba los 42 tests en verde — la protección
      // existía en el camino de entrada y se perdía en cuanto la entidad se tocaba una vez.
      expect(Object.isFrozen(entity.audit)).toBe(true);
    });

    // El kernel NO legisla sobre el valor del reloj: quien inyecta `now` decide, y `touch` lo
    // asigna sin rechazarlo ni ignorarlo. Es una decisión tomada expresamente en la fase de
    // contrato —se descartó tanto lanzar como ignorar en silencio— y hasta este caso vivía solo
    // en un comentario.
    //
    // P1 no sirve para fijarla aunque su arbitrario cubra 2000-2100: generaría fechas anteriores
    // por muestreo, no por contrato. Si alguien añadiera la validación, P1 se pondría rojo unas
    // veces sí y otras no — y un test intermitente se silencia por «flaky» en vez de arreglarse.
    it('debería aceptar un touch con una fecha anterior sin lanzar ni ignorarlo', () => {
      // Arrange
      const entity = new SampleEntity(SampleId.from(ID), trail());
      const earlierInstant = new Date('2020-01-01T00:00:00.000Z');

      // Act
      entity.mutate(earlierInstant, null);

      // Assert
      expect(entity.updatedAt).toEqual(earlierInstant);
    });
  });

  describe('touch() (property-based)', () => {
    it('debería reflejar exactamente el now inyectado', () => {
      fc.assert(
        fc.property(
          fc.date({
            min: new Date('2000-01-01T00:00:00.000Z'),
            max: new Date('2100-01-01T00:00:00.000Z'),
            noInvalidDate: true,
          }),
          (now) => {
            // Arrange
            const entity = new SampleEntity(SampleId.from(ID), trail({ updatedAt: CREATED_AT }));

            // Act
            entity.mutate(now, null);

            // Assert
            expect(entity.updatedAt).toEqual(now);
          },
        ),
      );
    });
  });
});

// Helpers
//
// `touch()` es `protected` —solo el propio agregado decide cuándo se toca—, así que el doble
// expone `mutate()` para poder ejercitarlo. Dos clases distintas con el MISMO tipo de id son
// necesarias para C4: es el caso que el kernel del repo de referencia falla, porque allí
// `equals` compara solo el id y da `true` entre agregados de tipos distintos.
//
// `SampleEntity` y `OtherSampleEntity` reciben la `AuditTrail` ENTERA. Hasta la fase anterior
// recibían `createdAt` y `updatedAt` sueltos, y el comentario que había aquí lo justificaba
// diciendo que ésa era «la forma que tienen los tres agregados reales». Dejó de serlo al añadir
// el actor: `User`, `Credential` y `Order` pasaron a recibir el objeto en su constructor privado
// para no crecer a nueve parámetros posicionales. Los dobles siguen a los agregados, que es lo
// que el comentario quería decir.
//
// Con la traza entrando de una pieza, el antiguo `AuditTrailEntity` sobra: existía solo porque
// C12 necesita mutar EL MISMO objeto que se pasó al constructor y `SampleEntity` lo armaba
// dentro. Ahora `SampleEntity` sirve para los dos usos.

/** Traza MUTABLE (sin `readonly`) para que C12 pueda intentar cambiarla desde fuera. */
type MutableAuditTrail = {
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
};

const trail = (overrides: Partial<MutableAuditTrail> = {}): MutableAuditTrail => ({
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  createdBy: CREATED_BY,
  updatedBy: CREATED_BY,
  ...overrides,
});

class SampleIdError extends Error {}

class SampleId extends UuidId {
  static from(value: string): SampleId {
    return new SampleId(UuidId.assertUuid(value, () => new SampleIdError()));
  }
}

class SampleEntity extends Entity<SampleId> {
  constructor(id: SampleId, audit: AuditTrail) {
    super(id, audit);
  }

  mutate(now: Date, by: string | null): void {
    this.touch(now, by);
  }

  /**
   * No lo llama ningún caso, y ahí está su valor: **no compila**. `_audit` es `private` y no
   * `protected`, así que ninguna subclase puede sustituir la traza entera saltándose `touch()`
   * —que es el agujero por el que se cuela un `updatedAt` puesto a mano—. Lo verifica
   * `pnpm typecheck`, no `pnpm test`: con `@swc/jest` la suite no comprueba tipos. Si algún día
   * `_audit` deja de ser privado, TypeScript marca el `@ts-expect-error` como directiva sin uso
   * y el gate se pone rojo solo.
   */
  attemptAuditReplacement(audit: AuditTrail): void {
    // @ts-expect-error `_audit` es privado en Entity: la traza solo se reemplaza vía touch().
    this._audit = audit;
  }
}

class OtherSampleEntity extends Entity<SampleId> {
  constructor(id: SampleId, audit: AuditTrail) {
    super(id, audit);
  }
}
