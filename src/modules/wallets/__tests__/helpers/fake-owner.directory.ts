import type { OwnerDirectory } from '../../domain/ports/owner.directory';

/**
 * Directorio de mentira: conoce los ids con los que se construye y REGISTRA cada consulta.
 *
 * Escrito a mano y no `jest.mock`, igual que `users/__tests__/helpers/in-memory-user.repository.ts`
 * y por el mismo motivo: un doble configurado por expectativas prueba la configuración del doble,
 * no el caso de uso.
 *
 * **`existsCalls` no es adorno.** Es lo que deja afirmar las dos cosas que el puerto promete y que
 * ninguna aserción sobre el valor devuelto alcanza:
 *   - el ORDEN, «el directorio antes que el asignador» — sin él, un caso de uso que reserva índice
 *     y luego descubre que el dueño no existe deja un hueco en la secuencia por cada 403;
 *   - que en las DOS lecturas este puerto **no se consulta siquiera** (`existsCalls` vacío), que es
 *     lo que el JSDoc del puerto llama «un 403 cosmético costaría una consulta extra en los
 *     endpoints más llamados». Una aserción sobre el resultado no distingue «no preguntó» de
 *     «preguntó y le dijeron que sí».
 *
 * `knownIds` son los dueños que existen **y están activos**: el puerto tiene un solo booleano para
 * las dos condiciones, así que el fake tampoco las separa. Un dueño desactivado se modela **no
 * pasándolo** — es la única forma que el contrato permite, y es exactamente el fallo que el puerto
 * existe para tapar: un JWT firmado sobrevive a la desactivación de su dueño.
 */
export class FakeOwnerDirectory implements OwnerDirectory {
  readonly existsCalls: string[] = [];

  constructor(private readonly knownIds: readonly string[] = []) {}

  exists(ownerId: string): Promise<boolean> {
    this.existsCalls.push(ownerId);
    return Promise.resolve(this.knownIds.includes(ownerId));
  }
}
