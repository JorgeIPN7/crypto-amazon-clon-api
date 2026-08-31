import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { WalletTransfer } from '../../domain/entities/wallet-transfer.entity';
import {
  WalletTransferRepository,
  type FindTransfersCriteria,
  type TransferPage,
} from '../../domain/ports/wallet-transfer.repository';

import { WalletTransferMapper } from './wallet-transfer.mapper';
import { WalletTransferOrmEntity } from './wallet-transfer.orm-entity';

/**
 * Adaptador de salida del libro. `WalletTransferRepository` entra como VALOR —es su propio token
 * de inyección— y los dos `type` que lo acompañan, en línea; por eso sus nombres tienen que estar
 * en la lista cerrada del selector de `eslint.config.mjs`, que falla en cerrado a propósito. Esa
 * lista la escribe entera la tarea que cablea `src/modules/wallets/wallets.module.ts`: aquí no se
 * toca.
 *
 * **El criterio llega en UN objeto, con el dueño dentro.** No es cosmética: `findByOwner(ownerId,
 * criteria)` con dos parámetros del mismo grupo semántico es la firma que produce el bug de
 * argumentos cruzados, y el puerto no puede distinguirlos. Con un solo objeto el compilador exige
 * los tres nombres.
 *
 * **`page`/`limit` entran y `skip`/`take` salen, y la conversión vive aquí.** `page` empieza en 1
 * —lo que manda `PaginationDto`—, así que la primera página salta cero filas. Poner la resta en el
 * caso de uso metería aritmética de paginación en `application/`, y ponerla en el controlador la
 * repetiría en cada endpoint que liste.
 *
 * **Sin traducción de errores del driver, y es una decisión, no un olvido.** La tabla no tiene un
 * solo índice único más allá de la clave primaria: un `23505` aquí solo puede significar que
 * `randomUUID()` repitió un `TransferId`, que no es una invariante de negocio que nombrar sino un
 * fallo del generador. Traducirlo inventaría un error de dominio para un suceso que nadie puede
 * provocar ni corregir. Compárese con `WalletTypeOrmRepository`, donde las cuatro restricciones sí
 * distinguen cuatro situaciones distintas.
 *
 * **`save()` sirve al alta Y a la actualización**, que es lo que hace posible la escritura por
 * delante: la fila se escribe en `submitting` antes de llamar al proveedor y la misma llamada la
 * cierra en `submitted`, `rejected` o `unknown`. `repository.save()` de TypeORM resuelve por
 * clave primaria, así que no hacen falta dos métodos en el puerto — y con dos, el caso de uso
 * tendría que acordarse de cuál usar en cada rama del `catch`.
 *
 * ⚠️ **Esta capa queda fuera del auditor de mutación** —`stryker.config.mjs` no muta
 * `infrastructure/`—, así que el único control de la aritmética y del orden es
 * `wallet-transfer.typeorm.repository.e2e-spec.ts`. Las dos se rompieron a propósito para
 * comprobar que alguien las caza; qué cae con cada mutante está escrito en el caso que le toca.
 */
@Injectable()
export class WalletTransferTypeOrmRepository implements WalletTransferRepository {
  constructor(
    @InjectRepository(WalletTransferOrmEntity)
    private readonly transfers: Repository<WalletTransferOrmEntity>,
  ) {}

  async save(transfer: WalletTransfer): Promise<void> {
    await this.transfers.save(WalletTransferMapper.toPersistence(transfer));
  }

  async findByOwner(criteria: FindTransfersCriteria): Promise<TransferPage> {
    const [rows, total] = await this.transfers.findAndCount({
      where: { ownerId: criteria.ownerId },
      skip: (criteria.page - 1) * criteria.limit,
      take: criteria.limit,
      // `id` como desempate y no solo `createdAt`: dos envíos del mismo milisegundo tienen orden
      // arbitrario entre consultas, y con paginación eso significa que una fila puede aparecer en
      // dos páginas o en ninguna. El índice compuesto sirve igual para el filtro y el orden
      // principal; el desempate solo ordena dentro de un empate exacto.
      //
      // ⚠️ Y cierra ESO y nada más. Con paginación por `OFFSET`, una fila sigue pudiendo repetirse
      // u omitirse si entra un envío nuevo entre la petición de la página 1 y la de la 2 — eso solo
      // lo evita un cursor. Es el mismo coste asumido que en `users`.
      order: { createdAt: 'DESC', id: 'DESC' },
    });

    return { items: rows.map((row) => WalletTransferMapper.toDomain(row)), total };
  }
}
