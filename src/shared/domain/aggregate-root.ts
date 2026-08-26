import { Entity } from './entity.base';
import type { UuidId } from './uuid-id.base';

/**
 * Base de los agregados que emiten eventos de dominio: recolecta y drena, encima de la
 * identidad que aporta `Entity`.
 *
 * Extiende `Entity` en vez de vivir al lado porque TypeScript da UNA sola ranura de
 * herencia: `Order` necesita identidad y eventos a la vez, y sin esto tendría que elegir.
 * De ahí el segundo parámetro de tipo — antes solo estaba `TEvent`.
 *
 * `TEvent` queda sin acotar porque el kernel no conoce ningún evento concreto: cada agregado
 * fija su propio tipo al extender (`extends AggregateRoot<OrderId, OrderPlaced>`), y es ahí
 * donde el compilador vuelve a ser estricto.
 *
 * `splice(0, length)` porque hace de una vez las dos mitades del drenaje: DEVUELVE un array
 * nuevo con los eventos y DEJA vacío el interno, sin que la referencia privada salga jamás
 * del agregado. Las alternativas no son incorrectas, solo peores: `return this.domainEvents`
 * entregaría al llamante la lista VIVA —que el siguiente `record()` mutaría bajo sus pies— y
 * `[...events]` + `length = 0` son dos pasos para exactamente el mismo resultado.
 */
export abstract class AggregateRoot<TId extends UuidId, TEvent> extends Entity<TId> {
  private readonly domainEvents: TEvent[] = [];

  protected record(event: TEvent): void {
    this.domainEvents.push(event);
  }

  pullEvents(): TEvent[] {
    return this.domainEvents.splice(0, this.domainEvents.length);
  }
}
