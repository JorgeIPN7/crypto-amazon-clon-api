import fc from 'fast-check';

/**
 * Arbitrarios del módulo, construidos y no filtrados de `fc.string()` a ciegas — mismo
 * patrón (map + filtro ligero de baja tasa de descarte) que `userNameArb` en el módulo
 * `users`, que es el precedente del repo para cadenas con trim.
 */

/** Conceptos que `OrderConcept.from()` acepta: 1-140 caracteres tras recortar espacios. */
export const orderConceptArb = fc
  .string({ minLength: 1, maxLength: 140 })
  .map((value) => value.trim())
  .filter((value) => value.length >= 1 && value.length <= 140);

/** Exactamente el dominio de la fila P2 de la Tabla D. */
export const orderAmountCentsArb = fc.integer({ min: 1, max: 10_000_000 });

/** Fechas acotadas a un rango realista, como `timestampArb` de users. */
export const timestampArb = fc.date({
  min: new Date('2000-01-01T00:00:00.000Z'),
  max: new Date('2100-01-01T00:00:00.000Z'),
  noInvalidDate: true,
});
