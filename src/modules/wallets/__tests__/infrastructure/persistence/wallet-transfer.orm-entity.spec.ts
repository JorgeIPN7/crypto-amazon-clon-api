import { toSnakeCase } from '@database/snake-naming.strategy';
import { getMetadataArgsStorage } from 'typeorm';

import { WalletTransferOrmEntity } from '../../../infrastructure/persistence/wallet-transfer.orm-entity';

/**
 * Hermano de `wallet.orm-entity.spec.ts`, y ahí está explicado qué comprueba esta forma de test y
 * con qué E2E no se solapa.
 */
describe('WalletTransferOrmEntity', () => {
  describe('@Entity', () => {
    it('debería declarar el nombre de la tabla en plural, como las otras del esquema', () => {
      // Arrange
      const tables = getMetadataArgsStorage().tables;

      // Act
      const table = tables.find((candidate) => candidate.target === WalletTransferOrmEntity);

      // Assert
      // Sin el `name`, la estrategia derivaría el nombre de la CLASE. Medido con la función real.
      expect(toSnakeCase(WalletTransferOrmEntity.name)).toBe('wallet_transfer_orm_entity');
      expect(table?.name).toBe('wallet_transfers');
    });
  });

  describe('@Column', () => {
    it('debería no fijar name en ninguna columna, para que el snake_case lo ponga la estrategia', () => {
      // Arrange
      const columns = columnsOf(WalletTransferOrmEntity);

      // Act
      const withExplicitName = columns
        .filter((column) => column.options.name !== undefined)
        .map((column) => column.propertyName);

      // Assert
      expect(withExplicitName).toEqual([]);
    });

    it('debería producir las quince columnas exactas del libro al pasar por la estrategia de nombres', () => {
      // Arrange — la lista es la del contrato §8, comparada contra el nombre de columna REAL.
      const columns = columnsOf(WalletTransferOrmEntity);

      // Act
      const declared = columns.map((column) => toSnakeCase(column.propertyName)).sort();

      // Assert
      // Dos nombres se leen mal si no se sabe de dónde salen. `from_address` sale de la propiedad
      // `fromAddress` porque `from` es palabra reservada de SQL y una columna así obligaría a
      // citarla en cada consulta cruda. `reason_code` dice lo que guarda: un código de una lista
      // cerrada, jamás el `message` del proveedor.
      expect(declared).toEqual([
        'amount',
        'asset_kind',
        'created_at',
        'created_by',
        'from_address',
        'id',
        'owner_id',
        'reason_code',
        'recipient',
        'status',
        'token_address',
        'token_id',
        'tx_id',
        'updated_at',
        'updated_by',
      ]);
    });

    it('debería llamar fromAddress a la propiedad emisora, que es donde se decide el nombre de la columna', () => {
      // Arrange
      const columns = columnsOf(WalletTransferOrmEntity);

      // Act
      const propertyNames = columns.map((column) => column.propertyName);

      // Assert
      // El caso anterior pasaría igual con `@Column({ name: 'from_address' }) from`, que es lo que
      // la convención del repo prohíbe. Este lo cierra por el otro lado.
      expect(propertyNames).toContain('fromAddress');
      expect(propertyNames).not.toContain('from');
    });

    it('debería declarar todas las columnas como regulares, sin fechas automáticas del ORM', () => {
      // Arrange
      const columns = columnsOf(WalletTransferOrmEntity);

      // Act
      const automatic = columns
        .filter((column) => column.mode !== 'regular')
        .map((column) => `${column.propertyName}:${column.mode}`);

      // Assert
      expect(automatic).toEqual([]);
    });

    it('debería dejar nullables las tres columnas del activo excluyentes, las dos que se llenan después y los dos actores', () => {
      // Arrange
      const columns = columnsOf(WalletTransferOrmEntity);

      // Act
      const nullable = columns
        .filter((column) => column.options.nullable === true)
        .map((column) => column.propertyName)
        .sort();

      // Assert
      // `tokenAddress`, `amount` y `tokenId` son nulos en las clases de activo que los prohíben: el
      // nativo no lleva contrato, el NFT no lleva importe. `txId` y `reasonCode` nacen nulos porque
      // la fila se escribe ANTES de llamar al proveedor, que es lo que hace útil el libro: sin esa
      // nulabilidad no habría escritura por delante que valiera. Los dos actores, por `AuditTrail`.
      expect(nullable).toEqual([
        'amount',
        'createdBy',
        'reasonCode',
        'tokenAddress',
        'tokenId',
        'txId',
        'updatedBy',
      ]);
    });
  });

  describe('@Index', () => {
    it('debería declarar un único índice, por dueño y fecha, y NO único', () => {
      // Arrange
      const indices = getMetadataArgsStorage().indices.filter(
        (index) => index.target === WalletTransferOrmEntity,
      );

      // Act
      const declared = indices.map((index) => ({
        name: index.name,
        columns: index.columns,
        unique: index.unique,
      }));

      // Assert
      // Un dueño tiene MUCHAS transferencias: marcarlo único rompería el segundo envío de cualquier
      // usuario. Y el orden de las columnas es el del listado paginado —filtrar por dueño, ordenar
      // por fecha—, no al revés.
      expect(declared).toEqual([
        {
          name: 'idx_wallet_transfers_owner_id_created_at',
          columns: ['ownerId', 'createdAt'],
          unique: false,
        },
      ]);
    });
  });

  describe('@Check', () => {
    it('debería no declarar ningún CHECK, porque la exclusión del activo la garantiza el dominio', () => {
      // Arrange
      const checks = getMetadataArgsStorage().checks;

      // Act
      const declared = checks.filter((check) => check.target === WalletTransferOrmEntity);

      // Assert
      // Un `CHECK` de cuatro ramas aquí duplicaría en el esquema la partición que `TransferAsset`
      // ya hace imposible de incumplir, y `TransferAsset` es el único camino de escritura. El otro
      // candidato —`reason_code` contra la lista cerrada— sí haría falta, pero el contrato
      // congelado §8 declara para esta tabla solo la clave primaria y el índice compuesto: es
      // trabajo de la migración, y esa decisión está escrita en el JSDoc de la entidad para que
      // llegue a quien la escriba. Este caso es lo que impide que un `@Check` entre aquí sin pasar
      // por esa conversación.
      expect(declared).toEqual([]);
    });
  });
});

// Helpers

const columnsOf = (target: unknown) =>
  getMetadataArgsStorage().columns.filter((column) => column.target === target);
