import type { AddressIndex } from '../value-objects/address-index.vo';

/**
 * Reserva del índice de derivación. **Puerto propio y no un método más del repositorio**, y el
 * motivo no es estético: detrás hay OTRO almacén —una secuencia de PostgreSQL, no la tabla
 * `wallets`— con otro modo de fallo. Metido en el repositorio, todo fake que no reserva índices
 * tendría que implementarlo igualmente (§4).
 *
 * `abstract class` —tipo y token en la misma referencia— por el mismo motivo que
 * `wallet.repository.ts`.
 *
 * La secuencia, y no `max(index)+1`, por dos razones y la segunda es la decisiva (§5.1): `max()`
 * mira la tabla y **recicla el índice de una fila borrada** —dos usuarios sobre la misma
 * dirección—, y obligaría al orden «leer el máximo → derivar en el proveedor → insertar», donde
 * cada colisión tira los créditos de una llamada ya hecha. Con la secuencia el índice es nuestro
 * antes de gastar nada.
 *
 * Los huecos son gratis: derivar no escribe en la cadena ni consume gas —«This API does not make
 * any changes on the blockchain itself… therefore, no gas fee is applied», en la `description` de
 * `POST /v3/gas-pump` de `docs/tatum/gas-pump/openapi.json`—, así que un hueco es una dirección que
 * nadie posee y a la que nadie va a mandar nada. Por eso `next()` no tiene contrapartida para
 * devolver un índice: consumir una secuencia es irreversible por diseño y no hay compensación que
 * escribir (§5.2).
 */
export abstract class AddressIndexAllocator {
  abstract next(): Promise<AddressIndex>;
}
