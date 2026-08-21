/**
 * Base de los value objects: encapsula lo único que de verdad se repetía —
 * el constructor, la igualdad estructural y la representación textual.
 * La VALIDACIÓN no se factoriza: es distinta en cada VO y es su razón de existir.
 *
 * `protected constructor` en vez de `private`: el hijo necesita `super(value)`.
 * Es un ensanchamiento real de la puerta de construcción —`private` la cerraba a todo lo que
 * no fuera la propia clase— asumido a conciencia. Lo que NO cambia es la puerta desde fuera
 * de la jerarquía: `protected` no es invocable ahí (TS2674, medido), así que un consumidor
 * sigue construyendo solo por las factorías estáticas de cada VO — `from()` en todos, y
 * además `generate()` en `UserId` y `OrderId`.
 *
 * La comparación es por `===` y no por `JSON.stringify`: todos nuestros VOs envuelven
 * un primitivo. Si alguno llegara a envolver un objeto, que sobreescriba `equals()` —
 * es preferible a pagar una serialización en cada comparación de todos los demás.
 *
 * `other` se tipa nullable a propósito: en el borde (un mapper, una respuesta HTTP) el
 * valor puede llegar ausente, y `equals` debe responder `false` sin reventar. Con la
 * firma no-nullable, TypeScript rechazaría el caso y el test tendría que falsearlo con
 * un cast — probando el cast, no el contrato.
 */
export abstract class ValueObject<T> {
  protected constructor(readonly value: T) {}

  equals(other: ValueObject<T> | null | undefined): boolean {
    if (other === null || other === undefined) {
      return false;
    }
    if (other.constructor !== this.constructor) {
      return false;
    }
    return this.value === other.value;
  }

  toString(): string {
    return String(this.value);
  }
}
