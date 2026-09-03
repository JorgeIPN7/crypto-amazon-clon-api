import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import type { Wallet } from '../../domain/entities/wallet.entity';
import {
  AddressIndexAlreadyUsedError,
  WalletAddressAlreadyUsedError,
  WalletAddressIsMasterError,
} from '../../domain/errors/wallet.errors';
import { WalletRepository, type WalletSaveOutcome } from '../../domain/ports/wallet.repository';

import { WalletMapper } from './wallet.mapper';
import { WalletOrmEntity } from './wallet.orm-entity';

/** https://www.postgresql.org/docs/current/errcodes-appendix.html */
const PG_UNIQUE_VIOLATION = '23505';
const PG_CHECK_VIOLATION = '23514';

/**
 * Los nombres tienen que coincidir EXACTAMENTE con los de `wallet.orm-entity.ts` y los de la
 * migración `CreateWallets`. No hay tipo que lo garantice: lo garantizan los cuatro casos de
 * traducción del E2E, que chocan contra el motor de verdad y se ponen rojos si uno se renombra
 * en un sitio y no en los otros dos.
 */
const USER_ID_INDEX = 'idx_wallets_user_id';
const ADDRESS_INDEX_INDEX = 'idx_wallets_address_index';
const ADDRESS_INDEX = 'idx_wallets_address';
const ADDRESS_NOT_MASTER_CHECK = 'ck_wallets_address_not_master';

type PostgresDriverError = { code?: string; constraint?: string };

const driverErrorOf = (error: unknown): PostgresDriverError | null =>
  error instanceof QueryFailedError ? (error.driverError as PostgresDriverError) : null;

/**
 * Adaptador de salida. Es la única clase del módulo que conoce el `Repository` del ORM; todo lo
 * que sale de aquí ya es dominio.
 *
 * `implements WalletRepository`, NUNCA `extends`: la conformidad la garantiza el `implements` y
 * solo él — `ClassProvider.provide` está tipado como `any`, así que el `useClass` del module no
 * comprueba nada. Y el puerto se importa como VALOR aunque solo aparezca en el `implements`: es
 * su propio token de inyección, y un `import type` lo borraría del emit.
 *
 * ## Un desenlace y tres excepciones: por qué el `23505` de `user_id` NO lanza
 *
 * La tabla tiene tres índices únicos y un `CHECK`, y esas cuatro restricciones significan cosas
 * radicalmente distintas. La de `user_id` es que otra petición del MISMO usuario ganó la carrera:
 * es el curso normal de un alta idempotente, no un fallo, y por eso `save()` devuelve
 * `'owner-conflict'` y el caso de uso relee. Convertirlo en excepción obligaría al caso de uso a
 * hacer control de flujo con un `catch`, y a cualquiera que añadiera un `catch` más ancho a
 * tragarse las otras tres.
 *
 * Las otras tres SÍ lanzan porque son invariantes rotas que tienen que hacer ruido:
 * `address_index` dice que la secuencia repitió un índice —dos usuarios sobre la misma
 * dirección—, `address` que el proveedor devolvió la misma dirección para índices distintos, y el
 * `CHECK` que alguien escribió la master como dirección de un usuario. Traducir por código y no
 * por restricción colapsaría las tres primeras en el mismo suceso, y la más benigna se comería a
 * las dos graves: un usuario recibiría 200 con la wallet de otro justo cuando la secuencia acaba
 * de repetir un índice.
 *
 * ⚠️ **Y mirar solo `23505` dejaría escapar la cuarta.** La violación del `CHECK` llega con
 * `23514`, que es un código distinto: por eso el `if` del `CHECK` es suyo propio y no una rama más
 * dentro del de unicidad. Medido en el E2E — el caso «debería traducir la violación del CHECK a
 * WalletAddressIsMasterError» es el único de los cuatro que no pasa por `PG_UNIQUE_VIOLATION`.
 *
 * ⚠️ **`WalletAlreadyAssignedError` no existe, y no debe crearse.** No hay ningún camino por el
 * que un choque de dueño llegue a HTTP —`AssignWalletUseCase` lo absorbe releyendo—, así que una
 * clase de error para él sería dominio inalcanzable, y mapearla en el filtro publicaría un 409 que
 * `POST /wallets` no declara.
 *
 * ## Qué NO se toca, y por qué eso también es una decisión
 *
 * Un `23505` sobre una restricción desconocida —o cualquier otro código del motor— se re-lanza tal
 * cual. Sale como un 500 anónimo, que es exactamente lo que es: un fallo de infraestructura que
 * nadie previó. Inventarle un error de dominio lo disfrazaría de invariante de negocio y lo
 * escondería de quien tiene que arreglarlo; devolverlo como `'owner-conflict'` sería peor todavía,
 * porque el caso de uso releería una wallet que no existe.
 *
 * El `where` de la lectura nombra `userId`, la propiedad de la ORM entity, y recibe el `ownerId`
 * del dominio: la columna es `user_id` y el mapper es quien cruza los dos vocabularios.
 *
 * ⚠️ **Esta capa queda fuera del auditor de mutación** —`stryker.config.mjs` no muta
 * `infrastructure/`—, así que el único control de estas cuatro ramas es
 * `wallet.typeorm.repository.e2e-spec.ts`. Cada una se rompió a propósito para comprobar que
 * alguien la caza; qué cae con cada mutante está escrito en el caso correspondiente.
 */
@Injectable()
export class WalletTypeOrmRepository implements WalletRepository {
  constructor(
    @InjectRepository(WalletOrmEntity)
    private readonly wallets: Repository<WalletOrmEntity>,
  ) {}

  async findByOwnerId(ownerId: string): Promise<Wallet | null> {
    const row = await this.wallets.findOne({ where: { userId: ownerId } });
    return row ? WalletMapper.toDomain(row) : null;
  }

  async save(wallet: Wallet): Promise<WalletSaveOutcome> {
    try {
      await this.wallets.save(WalletMapper.toPersistence(wallet));
      return 'saved';
    } catch (error) {
      const driverError = driverErrorOf(error);
      const snapshot = wallet.toSnapshot();

      if (driverError?.code === PG_UNIQUE_VIOLATION) {
        if (driverError.constraint === USER_ID_INDEX) {
          return 'owner-conflict';
        }
        if (driverError.constraint === ADDRESS_INDEX_INDEX) {
          throw new AddressIndexAlreadyUsedError(snapshot.addressIndex);
        }
        if (driverError.constraint === ADDRESS_INDEX) {
          throw new WalletAddressAlreadyUsedError(snapshot.address);
        }
      }

      if (
        driverError?.code === PG_CHECK_VIOLATION &&
        driverError.constraint === ADDRESS_NOT_MASTER_CHECK
      ) {
        throw new WalletAddressIsMasterError(snapshot.address);
      }

      throw error;
    }
  }
}
