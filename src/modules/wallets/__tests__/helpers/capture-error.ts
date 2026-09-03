/**
 * Devuelve el error que `fn` lanzó, para poder afirmar sobre su clase Y sobre su mensaje exacto.
 *
 * **El fallo que evita:** `toThrow(Clase)` NO mira el mensaje y `toThrow('texto')` lo compara por
 * SUBCADENA. Con cualquiera de las dos, un mutante que cambie el literal del mensaje sobrevive —
 * y esa es una de las dos familias de supervivientes que este repo ya tiene medidas. Capturando el
 * error, el `message` se compara con `toBe` y el mutante muere.
 *
 * Vive en `__tests__/helpers/` y no copiado en cada spec porque `CLAUDE.md` lo pide así («nunca
 * copies un builder en varios specs»; los helpers de módulo van en `<module>/__tests__/helpers/`)
 * y porque los seis value objects del contexto necesitan exactamente esto: la segunda copia ya
 * estaba escrita cuando se extrajo.
 */
export const captureError = (fn: () => unknown): Error => {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error('Se esperaba que la función lanzara un error y no lo hizo');
};
