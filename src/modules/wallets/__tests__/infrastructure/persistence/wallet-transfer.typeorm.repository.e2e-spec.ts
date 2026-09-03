import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { createTestApp } from '@test/helpers/create-test-app';

import { WalletTransfer } from '../../../domain/entities/wallet-transfer.entity';
import { TransferAsset } from '../../../domain/transfer-asset';
import { EthereumAddress } from '../../../domain/value-objects/ethereum-address.vo';
import { TokenAmount } from '../../../domain/value-objects/token-amount.vo';
import { TokenId } from '../../../domain/value-objects/token-id.vo';
import { TransactionHash } from '../../../domain/value-objects/transaction-hash.vo';
import { TransferId } from '../../../domain/value-objects/transfer-id.vo';
import { WalletTransferOrmEntity } from '../../../infrastructure/persistence/wallet-transfer.orm-entity';
import { WalletTransferTypeOrmRepository } from '../../../infrastructure/persistence/wallet-transfer.typeorm.repository';

const OWNER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const OTHER_OWNER_ID = '2c8f5a11-3d4e-4b6a-9f7c-1e0d5b8a3c24';
const FROM = '0xa0b1c2d3e4f5061728394a5b6c7d8e9f00112233';
const RECIPIENT = '0xb1c2d3e4f5061728394a5b6c7d8e9f0011223344';
const CONTRACT = '0xc2d3e4f5061728394a5b6c7d8e9f001122334455';
const TX_ID = '0x' + 'cd'.repeat(32);
const ACTOR = OWNER_ID;

/**
 * Los dos ids del caso del empate exacto, fijos y no generados: PostgreSQL ordena `uuid` por
 * bytes, así que sobre estas dos constantes en minúsculas el orden es el del texto y `HIGH` va
 * antes que `LOW` bajo `id DESC`. Con `TransferId.generate()` el caso sería una moneda al aire.
 */
const LOW_ID = '11111111-1111-4111-8111-111111111111';
const HIGH_ID = '99999999-9999-4999-8999-999999999999';

/**
 * Contra PostgreSQL real, como el resto de repositorios del repo: lo que se verifica es la
 * aritmética de la paginación tal y como la ejecuta el motor y el orden que devuelve, y un doble
 * lo sustituiría por el orden que uno cree.
 *
 * El repositorio se construye con `new` y no resolviendo `WalletTransferRepository` del
 * contenedor, por lo mismo —y con la misma cautela sobre cómo escribirlo— que explica el JSDoc de
 * `wallet.typeorm.repository.e2e-spec.ts`: el sujeto es el adaptador, no el wiring.
 */
describe('WalletTransferTypeOrmRepository (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let repository: WalletTransferTypeOrmRepository;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    dataSource = app.get(DataSource);
    repository = new WalletTransferTypeOrmRepository(
      dataSource.getRepository(WalletTransferOrmEntity),
    );
  });

  beforeEach(async () => {
    // Sin `RESTART IDENTITY`, por lo mismo que en el E2E de `WalletTypeOrmRepository`: reiniciar
    // `wallets_address_index_seq` reparte otra vez índices ya entregados.
    await dataSource.query('TRUNCATE TABLE wallets, wallet_transfers');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('save()', () => {
    it('debería persistir la transferencia con las columnas del activo que le tocan', async () => {
      // Arrange
      const transfer = buildTransfer({
        asset: TransferAsset.multiToken({
          token: EthereumAddress.from(CONTRACT),
          amount: TokenAmount.from('3'),
          tokenId: TokenId.from('0'),
        }),
      });

      // Act
      await repository.save(transfer);

      // Assert: columnas crudas — es lo único que demuestra que el despliegue del activo llega a
      // PostgreSQL con los nombres snake_case de la ORM entity, `from_address` incluido.
      const rows = await dataSource.query<
        {
          from_address: string;
          recipient: string;
          asset_kind: string;
          token_address: string | null;
          amount: string | null;
          token_id: string | null;
          status: string;
          tx_id: string | null;
          reason_code: string | null;
        }[]
      >(
        `SELECT from_address, recipient, asset_kind, token_address, amount, token_id,
                status, tx_id, reason_code
           FROM wallet_transfers WHERE id = $1`,
        [transfer.id.value],
      );
      expect(rows[0]).toEqual({
        from_address: FROM,
        recipient: RECIPIENT,
        asset_kind: 'multi-token',
        token_address: CONTRACT,
        amount: '3',
        token_id: '0',
        status: 'submitting',
        tx_id: null,
        reason_code: null,
      });
    });

    it('debería sobrescribir la fila al pasar de submitting a submitted', async () => {
      // Arrange — es la escritura por delante completa: la fila existe ANTES de llamar al
      // proveedor y se actualiza con su respuesta. Si `save` insertara en vez de actualizar,
      // cada envío dejaría dos filas y el libro contaría el doble.
      const transfer = buildTransfer({});
      await repository.save(transfer);
      transfer.markSubmitted(
        TransactionHash.from(TX_ID),
        new Date('2026-08-27T09:00:02.000Z'),
        ACTOR,
      );

      // Act
      await repository.save(transfer);

      // Assert
      const rows = await dataSource.query<{ status: string; tx_id: string | null }[]>(
        'SELECT status, tx_id FROM wallet_transfers WHERE owner_id = $1',
        [OWNER_ID],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ status: 'submitted', tx_id: TX_ID });
    });
  });

  describe('findByOwner()', () => {
    it('debería devolver la página pedida junto al total sin paginar', async () => {
      // Arrange
      await repository.save(buildTransfer({ at: '2026-08-27T09:00:00.000Z' }));
      await repository.save(buildTransfer({ at: '2026-08-27T10:00:00.000Z' }));
      await repository.save(buildTransfer({ at: '2026-08-27T11:00:00.000Z' }));

      // Act
      const page = await repository.findByOwner({ ownerId: OWNER_ID, page: 2, limit: 2 });

      // Assert
      // Dos cosas a la vez, y las dos son fallos vistos en producción en otros sitios. La
      // aritmética: `page` empieza en 1, así que la segunda página de 2 salta 2 filas — un
      // adaptador que pasara `skip: criteria.page` devolvería DOS elementos y este caso lo caza.
      // Y el `total`: si el filtro por dueño se aplicara solo a la página, la paginación
      // anunciaría una siguiente que no existe. Son dos consultas dentro de `findAndCount`.
      // ⚠️ **El mutante que hay que citar aquí es `page * limit`, no `page` a secas**, y la
      // diferencia se midió en vez de suponerse: con `skip: criteria.page` este caso sigue
      // VERDE, porque para `page: 2, limit: 2` las dos expresiones valen 2 —el mutante es
      // equivalente justo en esta entrada— y quienes caen son otros tres. Con el desplazamiento
      // clásico `skip: criteria.page * criteria.limit` sí cae, con
      // `Expected length: 1 · Received length: 0`.
      expect(page.items).toHaveLength(1);
      expect(page.total).toBe(3);
    });

    it('debería devolver primero la transferencia más reciente', async () => {
      // Arrange
      const older = buildTransfer({ at: '2026-08-27T09:00:00.000Z' });
      const newer = buildTransfer({ at: '2026-08-27T11:00:00.000Z' });
      await repository.save(older);
      await repository.save(newer);

      // Act
      const page = await repository.findByOwner({ ownerId: OWNER_ID, page: 1, limit: 10 });

      // Assert
      // Un libro que empieza por lo más viejo obliga a paginar hasta el final para ver el envío
      // que se acaba de hacer, que es el único que a alguien le interesa mirar.
      expect(page.items.map((item) => item.id.value)).toEqual([newer.id.value, older.id.value]);
    });

    it('debería pedir al motor un orden TOTAL, desempatando por id', async () => {
      // Arrange
      // El SQL emitido y no el resultado, y es el único de los dos casos del empate que sirve de
      // guardián. Se captura por el `logQuery` del logger de TypeORM, al que el query runner
      // llama SIEMPRE —quien decide si imprime o no es el logger, mirando `options.logging`—, así
      // que no hace falta encender el log ni mockear el ORM.
      const logQuery = jest.spyOn(dataSource.logger, 'logQuery');

      // Act
      await repository.findByOwner({ ownerId: OWNER_ID, page: 1, limit: 5 });

      // Assert
      // ⚠️ **Este caso existe porque el siguiente NO caza el defecto.** Medido quitando
      // `id: 'DESC'` del `order` del adaptador y corriendo esta suite TRES veces: sin este caso,
      // las 7 salían verdes las tres veces. El orden entre filas empatadas no lo promete
      // PostgreSQL en ningún sentido, así que un caso que solo mire el resultado no puede
      // distinguir «ordenado» de «me ha tocado el orden bueno». Con este caso, ese mismo mutante
      // cae aquí y solo aquí.
      const paged = logQuery.mock.calls.map(([sql]) => sql).filter((sql) => sql.includes('LIMIT'));
      expect(paged).toHaveLength(1);
      expect(paged[0]).toContain('ORDER BY "WalletTransferOrmEntity"."created_at" DESC');
      expect(paged[0]).toContain('"WalletTransferOrmEntity"."id" DESC');
    });

    it('debería devolver la primera y la segunda página sin solaparlas cuando dos comparten el instante exacto', async () => {
      // Arrange: mismo `created_at` al milisegundo, y las marcas las pone el DOMINIO con el `now`
      // que le inyecta el caso de uso, así que empatar es posible de verdad y no una rareza de
      // laboratorio. Los dos ids son fijos para que «primero el alto» sea una afirmación y no un
      // sorteo.
      const tie = '2026-08-27T09:00:00.000Z';
      await repository.save(buildTransfer({ at: tie, id: TransferId.from(LOW_ID) }));
      await repository.save(buildTransfer({ at: tie, id: TransferId.from(HIGH_ID) }));

      // Act
      const first = await repository.findByOwner({ ownerId: OWNER_ID, page: 1, limit: 1 });
      const second = await repository.findByOwner({ ownerId: OWNER_ID, page: 2, limit: 1 });

      // Assert
      // ⚠️ **Este caso NO guarda el desempate, y decirlo importa más que tenerlo:** medido
      // quitando `id: 'DESC'` del adaptador, sigue VERDE las tres veces que se corrió. Quien caza
      // ese mutante es el caso anterior, que mira el SQL. Lo que este sí fija es la DIRECCIÓN del
      // desempate —con `id: 'ASC'` las dos páginas salen cambiadas y cae— y que el orden pedido
      // llega de verdad a las filas devueltas, no solo a la cadena SQL.
      expect(first.items.map((item) => item.id.value)).toEqual([HIGH_ID]);
      expect(second.items.map((item) => item.id.value)).toEqual([LOW_ID]);
    });

    it('debería excluir las transferencias de otro dueño, del listado y del total', async () => {
      // Arrange
      await repository.save(buildTransfer({}));
      await repository.save(buildTransfer({ ownerId: OTHER_OWNER_ID }));

      // Act
      const page = await repository.findByOwner({ ownerId: OWNER_ID, page: 1, limit: 10 });

      // Assert
      // Los cinco endpoints son «lo mío»: una fuga aquí publicaría el historial financiero de
      // otro usuario.
      expect(page.total).toBe(1);
      expect(page.items[0]?.toSnapshot().ownerId).toBe(OWNER_ID);
    });

    it('debería devolver una página vacía y total cero cuando el dueño no tiene transferencias', async () => {
      // Arrange
      await repository.save(buildTransfer({}));

      // Act
      const page = await repository.findByOwner({ ownerId: OTHER_OWNER_ID, page: 1, limit: 10 });

      // Assert
      // Es la respuesta del rol admin, que no puede enviar por Gas Pump: página vacía, no 404.
      expect(page).toEqual({ items: [], total: 0 });
    });
  });
});

// Helpers

const buildTransfer = (overrides: {
  id?: TransferId;
  ownerId?: string;
  asset?: TransferAsset;
  at?: string;
}): WalletTransfer => {
  const now = new Date(overrides.at ?? '2026-08-27T09:00:00.000Z');
  return WalletTransfer.start({
    id: overrides.id ?? TransferId.generate(),
    ownerId: overrides.ownerId ?? OWNER_ID,
    from: EthereumAddress.from(FROM),
    recipient: EthereumAddress.from(RECIPIENT),
    asset: overrides.asset ?? TransferAsset.native({ amount: TokenAmount.from('1') }),
    now,
    createdBy: overrides.ownerId ?? ACTOR,
  });
};
