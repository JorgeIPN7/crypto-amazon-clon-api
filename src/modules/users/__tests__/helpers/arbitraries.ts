import fc from 'fast-check';

/**
 * Arbitrarios del módulo para property-based testing.
 *
 * Todos están **construidos**, nunca filtrados. `fc.string().filter(isEmail)` descartaría
 * prácticamente todos los valores generados y fast-check acabaría abortando la propiedad
 * por exceso de descartes; además concentraría los casos en la forma más trivial.
 */

/** Emails que `Email.from()` acepta: `local@dominio.tld`, sin espacios ni arrobas extra. */
export const emailArb = fc
  .tuple(
    fc.stringMatching(/^[a-zA-Z0-9._+-]{1,24}$/),
    fc.stringMatching(/^[a-zA-Z0-9-]{1,24}$/),
    fc.constantFrom('com', 'mx', 'io', 'dev', 'com.mx'),
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

/** Nombres dentro del rango que la entidad admite, sin espacios en los extremos. */
export const userNameArb = fc
  .string({ minLength: 2, maxLength: 120 })
  .map((value) => value.trim())
  .filter((value) => value.length >= 2 && value.length <= 120);

/** Fechas acotadas a un rango realista: `fc.date()` genera hasta el año 275760. */
export const timestampArb = fc.date({
  min: new Date('2000-01-01T00:00:00.000Z'),
  max: new Date('2100-01-01T00:00:00.000Z'),
  noInvalidDate: true,
});
