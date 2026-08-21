/**
 * La vista que `orders` tiene de `users`: un directorio de clientes. `orders` define el
 * puerto y no sabe qué módulo lo implementa (spec §4). `exists` devuelve `true` solo si el
 * cliente existe Y está activo — el JWT solo prueba firma, no vigencia del usuario.
 *
 * `abstract class` —tipo y token en la misma referencia— por el mismo motivo que
 * `users/domain/ports/user.repository.ts`, donde vive el razonamiento completo.
 */
export abstract class CustomerDirectory {
  abstract exists(customerId: string): Promise<boolean>;
}
