import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AddressIndexAllocator } from '../../domain/ports/address-index.allocator';
import { AddressIndex } from '../../domain/value-objects/address-index.vo';

/**
 * Nombre sin cualificar el schema, como todas las migraciones del repo: así hereda el
 * `search_path` de la conexión, que sale de `DB_SCHEMA`. Fijar `public` aquí haría que con
 * `DB_SCHEMA=app` el asignador buscara una secuencia que no existe.
 */
const SEQUENCE = 'wallets_address_index_seq';

/**
 * Reserva el siguiente índice de dirección. Puerto propio y NO un método más del repositorio, y el
 * motivo es que es OTRO ALMACÉN: una secuencia, no la tabla. Tiene otro modo de fallo (agotarse,
 * no chocar), otra semántica (irreversible: consumir un valor no se deshace) y otro fake. Metido
 * en el repositorio obligaría a todo doble que no reserva índices a implementarlo igualmente.
 *
 * ## Por qué una secuencia y no `max(address_index) + 1`
 *
 * Dos razones, y la segunda es la decisiva (§5.1): `max()` mira la tabla, así que reciclaría el
 * índice de una fila borrada —dos usuarios sobre la misma dirección—; y obligaría al orden «leer
 * el máximo → derivar en el proveedor → insertar», de modo que cada colisión tiraría los créditos
 * de una llamada ya hecha. Con la secuencia el índice es nuestro antes de gastar nada.
 *
 * Los huecos son gratis: derivar no escribe en la cadena ni consume gas, así que un índice
 * reservado y no usado es una dirección que nadie posee y a la que nadie va a mandar nada. Por eso
 * un fallo del proveedor tras reservar no necesita compensación — lo que queda huérfano es un
 * número, no una fila (§5.2).
 *
 * ## El `Number()` no es cosmética
 *
 * `nextval` devuelve `bigint` y el driver de PostgreSQL entrega los `int8` como STRING, para no
 * perder precisión con valores mayores que `Number.MAX_SAFE_INTEGER`. Aquí no puede haberlos —la
 * secuencia es `AS integer`— pero el driver no lo sabe. Sin esta conversión, el índice llegaría al
 * proveedor como texto y sus campos de rango, que son enteros, lo rechazarían con un 400 que §7.2
 * clasifica como configuración rota nuestra y publica como 503.
 *
 * ⚠️ **Ese 400 es el fallo que se EVITA, no el que se observaría hoy si alguien quitara el
 * `Number()`.** Medido quitándolo y corriendo `sequence-address-index.allocator.e2e-spec.ts`: los
 * TRES casos caen antes de llegar a la red, con
 * `InvalidAddressIndexError: <n> is not a valid address index` — porque
 * `Number.isInteger('6')` es `false` y el value object corta primero. Dicho de otro modo: quien
 * ataja la cadena es `AddressIndex`, y este `Number()` es lo que hace que el camino feliz exista.
 * Que el driver entrega un string se comprueba EJECUTÁNDOLO en ese mismo spec, no afirmándolo
 * aquí.
 *
 * La fila ausente no necesita clase de error propia: `Number(undefined)` es `NaN` y
 * `AddressIndex.from` ya lo rechaza con nombre (`InvalidAddressIndexError`, 500). Inventar una
 * segunda clase para un caso que `nextval` no puede producir sería dominio inalcanzable.
 *
 * ⚠️ **Esta capa queda fuera del auditor de mutación** —`stryker.config.mjs` no muta
 * `infrastructure/`—, así que el único control de esta conversión es ese spec.
 */
@Injectable()
export class SequenceAddressIndexAllocator implements AddressIndexAllocator {
  constructor(private readonly dataSource: DataSource) {}

  async next(): Promise<AddressIndex> {
    const rows = await this.dataSource.query<{ nextval: string }[]>(
      `SELECT nextval('${SEQUENCE}') AS nextval`,
    );
    return AddressIndex.from(Number(rows[0]?.nextval));
  }
}
