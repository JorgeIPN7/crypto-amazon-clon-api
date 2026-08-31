import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { DataSource, QueryFailedError } from 'typeorm';

import { createTestApp } from '@test/helpers/create-test-app';

import { Wallet } from '../../../domain/entities/wallet.entity';
import {
  AddressIndexAlreadyUsedError,
  WalletAddressAlreadyUsedError,
  WalletAddressIsMasterError,
  WalletDomainError,
} from '../../../domain/errors/wallet.errors';
import { AddressIndex } from '../../../domain/value-objects/address-index.vo';
import { EthereumAddress } from '../../../domain/value-objects/ethereum-address.vo';
import { TransactionHash } from '../../../domain/value-objects/transaction-hash.vo';
import { WalletId } from '../../../domain/value-objects/wallet-id.vo';
import { WalletOrmEntity } from '../../../infrastructure/persistence/wallet.orm-entity';
import { WalletTypeOrmRepository } from '../../../infrastructure/persistence/wallet.typeorm.repository';

const MASTER = '0x1111111111111111111111111111111111111111';
const OWNER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const RIVAL_OWNER_ID = '2c8f5a11-3d4e-4b6a-9f7c-1e0d5b8a3c24';
const ADDRESS = '0xa0b1c2d3e4f5061728394a5b6c7d8e9f00112233';
const RIVAL_ADDRESS = '0xa9887766554433221100ffeeddccbbaa99887766';
const TX_ID = '0x' + 'ab'.repeat(32);
const ACTOR = '5b7c2d4e-9a1f-4c3b-8e6d-0f2a4b6c8d1e';

/**
 * Contra PostgreSQL real, nunca con `jest.mock('typeorm')`: lo que hay que verificar es
 * exactamente el comportamiento del motor —los tres índices únicos, el `CHECK`, y el nombre de la
 * restricción que llega en `driverError.constraint`—, y un doble lo sustituiría por lo que uno
 * cree que hace.
 *
 * El repositorio se construye con `new` y no resolviendo `WalletRepository` del contenedor, y eso
 * seguirá siendo lo correcto cuando `src/modules/wallets/wallets.module.ts` lo registre: el sujeto
 * de este spec es el adaptador, no el wiring. La frase se escribe así —y no como «el binding
 * todavía no existe»— para que no quede INVERTIDA el día que el módulo aterrice. Que el motivo no
 * es la falta de módulo se comprueba en el precedente: `orders.module.ts` existe desde hace
 * ciclos y `order.typeorm.repository.e2e-spec.ts` sigue construyendo su repositorio con
 * `new OrderTypeOrmRepository(...)` en el `beforeAll`.
 *
 * ⚠️ **Esta capa no la audita la mutación** (`stryker.config.mjs` no muta `infrastructure/`), así
 * que el único control de estos casos son ellos mismos. Por eso cada uno de los cuatro de
 * traducción se midió rompiendo a propósito la rama que le toca; el resultado está en el JSDoc de
 * cada caso, con el nombre del que muere y no con un total de suite.
 */
describe('WalletTypeOrmRepository (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let repository: WalletTypeOrmRepository;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    dataSource = app.get(DataSource);
    repository = new WalletTypeOrmRepository(dataSource.getRepository(WalletOrmEntity));
  });

  beforeEach(async () => {
    // ⚠️ SIN `RESTART IDENTITY`. Con él, `wallets_address_index_seq` se reiniciaría —es propiedad
    // de `wallets.address_index` por el `OWNED BY`— y volvería a repartir índices ya entregados,
    // que es el desastre que §5.1 describe: dos usuarios sobre la misma dirección. Estos casos no
    // se romperían por ello (las filas se van con el TRUNCATE), y por eso conviene decirlo aquí:
    // lo que se evita es dejar escrito en el repo el gesto exacto que nunca debe ejecutarse.
    await dataSource.query('TRUNCATE TABLE wallets, wallet_transfers');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('save()', () => {
    it('debería persistir la wallet en sus columnas crudas y devolver el desenlace saved', async () => {
      // Arrange
      const wallet = buildWallet();

      // Act
      const outcome = await repository.save(wallet);

      // Assert: SQL crudo y no `find()` — es lo único que demuestra que las columnas existen en
      // PostgreSQL con el nombre snake_case que la ORM entity declara, `user_id` incluido.
      expect(outcome).toBe('saved');
      const rows = await dataSource.query<
        {
          user_id: string;
          owner_address: string;
          address_index: number;
          address: string;
          status: string;
          created_by: string | null;
        }[]
      >(
        `SELECT user_id, owner_address, address_index, address, status, created_by
           FROM wallets WHERE id = $1`,
        [wallet.id.value],
      );
      expect(rows[0]).toEqual({
        user_id: OWNER_ID,
        owner_address: MASTER,
        address_index: 0,
        address: ADDRESS,
        status: 'receive-only',
        created_by: ACTOR,
      });
    });

    it('debería sobrescribir la wallet existente cuando avanza su estado de activación', async () => {
      // Arrange
      const wallet = buildWallet();
      await repository.save(wallet);
      wallet.markActivationRequested(
        TransactionHash.from(TX_ID),
        new Date('2026-08-27T12:00:00.000Z'),
        ACTOR,
      );

      // Act
      const outcome = await repository.save(wallet);

      // Assert
      expect(outcome).toBe('saved');
      const rows = await dataSource.query<{ status: string; activation_tx_id: string | null }[]>(
        'SELECT status, activation_tx_id FROM wallets WHERE id = $1',
        [wallet.id.value],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ status: 'activating', activation_tx_id: TX_ID });
    });
  });

  describe('findByOwnerId()', () => {
    it('debería reconstruir la wallet guardada (ida y vuelta)', async () => {
      // Arrange
      const wallet = buildWallet();
      await repository.save(wallet);

      // Act
      const found = await repository.findByOwnerId(OWNER_ID);

      // Assert
      // La consulta filtra por la columna `user_id` con el `ownerId` del dominio: si el `where`
      // del adaptador nombrara una propiedad que la ORM entity no tiene, TypeORM devolvería
      // TODAS las filas en vez de fallar, y este caso pasaría igual con una sola fila. Por eso el
      // caso siguiente pide una wallet que no existe.
      expect(found?.toSnapshot()).toMatchObject({
        id: wallet.id.value,
        ownerId: OWNER_ID,
        ownerAddress: MASTER,
        addressIndex: 0,
        address: ADDRESS,
        status: 'receive-only',
      });
    });

    it('debería devolver null cuando el dueño todavía no tiene wallet', async () => {
      // Arrange
      await repository.save(buildWallet());

      // Act
      const found = await repository.findByOwnerId(RIVAL_OWNER_ID);

      // Assert
      // Con una fila de OTRO dueño ya guardada: es lo que distingue «filtra de verdad» de
      // «devuelve lo primero que encuentra».
      expect(found).toBeNull();
    });
  });

  describe('traducción de los errores del driver', () => {
    it('debería devolver el desenlace owner-conflict cuando el dueño ya tiene wallet', async () => {
      // Arrange: la fila rival se inserta primero, así que el segundo `save` choca de verdad
      // contra `idx_wallets_user_id`. Es la carrera normal entre dos altas del mismo usuario.
      await repository.save(buildWallet());
      const loser = buildWallet({
        id: WalletId.generate(),
        addressIndex: 1,
        address: RIVAL_ADDRESS,
      });

      // Act
      const outcome = await repository.save(loser);

      // Assert
      // Desenlace, NO excepción: si esto lanzara, el alta idempotente respondería un error
      // precisamente en la carrera que existe para absorber, y quien perdió por milisegundos
      // vería un 4xx donde el contrato promete 200 con su dirección.
      // Medido borrando la rama de `idx_wallets_user_id` del adaptador: caen DOS casos, este y
      // «debería dejar una sola fila tras la carrera perdida por el dueño», los dos porque el
      // `QueryFailedError` sale crudo del `save`. Son los únicos dos.
      expect(outcome).toBe('owner-conflict');
    });

    it('debería traducir el choque de address_index a AddressIndexAlreadyUsedError', async () => {
      // Arrange
      await repository.save(buildWallet());
      const collision = buildWallet({
        id: WalletId.generate(),
        ownerId: RIVAL_OWNER_ID,
        address: RIVAL_ADDRESS,
      });

      // Act + Assert
      // Significa que la secuencia repitió un índice: dos usuarios sobre la MISMA dirección. Es
      // un 500 ruidoso a propósito — el `ErrorReporter` solo ve 5xx.
      // Medido borrando su rama del adaptador: cae SOLO este caso, con
      // `Expected constructor: AddressIndexAlreadyUsedError · Received constructor:
      // QueryFailedError`.
      await expect(repository.save(collision)).rejects.toBeInstanceOf(AddressIndexAlreadyUsedError);
    });

    it('debería traducir el choque de address a WalletAddressAlreadyUsedError', async () => {
      // Arrange
      await repository.save(buildWallet());
      const collision = buildWallet({
        id: WalletId.generate(),
        ownerId: RIVAL_OWNER_ID,
        addressIndex: 1,
      });

      // Act + Assert
      // Sin esta traducción el `23505` saldría como un 500 anónimo, perdiendo justo el
      // diagnóstico por el que ese tercer índice existe: el proveedor devolvió la misma dirección
      // para dos índices distintos.
      // Medido borrando su rama del adaptador: cae SOLO este caso, con
      // `Expected constructor: WalletAddressAlreadyUsedError · Received constructor:
      // QueryFailedError`.
      await expect(repository.save(collision)).rejects.toBeInstanceOf(
        WalletAddressAlreadyUsedError,
      );
    });

    it('debería traducir la violación del CHECK a WalletAddressIsMasterError', async () => {
      // Arrange: se construye con `rehydrate` porque `Wallet.assign()` rechaza esta wallet en el
      // dominio y jamás llegaría al INSERT. Eso es lo que hace el caso honesto: reproduce la única
      // forma real de llegar al `CHECK` —una fila que no pasó por el agregado— y comprueba que el
      // motor la para y que el adaptador le pone nombre.
      const impostor = Wallet.rehydrate({
        id: WalletId.generate(),
        ownerId: RIVAL_OWNER_ID,
        ownerAddress: EthereumAddress.from(MASTER),
        addressIndex: AddressIndex.from(9),
        address: EthereumAddress.from(MASTER),
        status: 'receive-only',
        activationTxId: null,
        createdAt: new Date('2026-08-27T09:00:00.000Z'),
        updatedAt: new Date('2026-08-27T09:00:00.000Z'),
        createdBy: ACTOR,
        updatedBy: ACTOR,
      });

      // Act + Assert
      // Medido borrando el `if` entero del `CHECK` en el adaptador: cae SOLO este caso, con
      // `Expected constructor: WalletAddressIsMasterError · Received constructor:
      // QueryFailedError`. Es además el único de los cuatro que llega con `23514` y no con
      // `23505`, que es por lo que un `catch` que solo mirara `23505` lo dejaría escapar: medido
      // aparte cambiando `PG_CHECK_VIOLATION` a `'23505'` en el adaptador, que también deja rojo
      // SOLO este caso.
      await expect(repository.save(impostor)).rejects.toBeInstanceOf(WalletAddressIsMasterError);
    });

    it('debería propagar sin traducir los errores que no son de unicidad ni del CHECK', async () => {
      // Arrange: `user_id` es `uuid` en la tabla y `string` en el dominio, así que un dueño con
      // forma inválida llega al motor y sale como 22P02, no como 23505.
      const malformed = buildWallet({ ownerId: 'no-soy-un-uuid' });

      // Act
      const error = await repository.save(malformed).catch((caught: unknown) => caught);

      // Assert
      // Solo las cuatro restricciones nombradas se tratan: cualquier otro fallo del motor tiene
      // que seguir subiendo tal cual, o se estarían disfrazando errores de infraestructura de
      // errores de invariante — y peor, un `catch` demasiado ancho los devolvería como
      // `'owner-conflict'`, que el caso de uso interpreta como «alguien se me adelantó».
      // Medido sustituyendo el `throw error` final del adaptador por un `return 'owner-conflict'`:
      // cae SOLO este caso, con `Expected constructor: QueryFailedError · Received value:
      // "owner-conflict"`.
      expect(error).toBeInstanceOf(QueryFailedError);
      expect(error).not.toBeInstanceOf(WalletDomainError);
    });

    it('debería dejar una sola fila tras la carrera perdida por el dueño', async () => {
      // Arrange
      await repository.save(buildWallet());

      // Act
      await repository.save(
        buildWallet({ id: WalletId.generate(), addressIndex: 1, address: RIVAL_ADDRESS }),
      );

      // Assert
      // El desenlace `'owner-conflict'` no puede esconder una escritura parcial: la fila rival no
      // entró, y el caso de uso va a releer la del ganador.
      const rows = await dataSource.query<{ count: number }[]>(
        'SELECT COUNT(*)::int AS count FROM wallets',
      );
      expect(rows[0]?.count).toBe(1);
    });
  });
});

// Helpers

type WalletOverrides = {
  id?: WalletId;
  ownerId?: string;
  addressIndex?: number;
  address?: string;
};

const buildWallet = (overrides: WalletOverrides = {}): Wallet =>
  Wallet.assign({
    id: overrides.id ?? WalletId.generate(),
    ownerId: overrides.ownerId ?? OWNER_ID,
    ownerAddress: EthereumAddress.from(MASTER),
    addressIndex: AddressIndex.from(overrides.addressIndex ?? 0),
    address: EthereumAddress.from(overrides.address ?? ADDRESS),
    now: new Date('2026-08-27T09:00:00.000Z'),
    createdBy: ACTOR,
  });
