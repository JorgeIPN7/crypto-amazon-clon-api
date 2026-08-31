import { toSnakeCase } from '@database/snake-naming.strategy';
import { getMetadataArgsStorage } from 'typeorm';

import { WalletOrmEntity } from '../../../infrastructure/persistence/wallet.orm-entity';

/**
 * Se lee la metadata que los decoradores registran, no una base de datos: `getMetadataArgsStorage()`
 * es síncrono y no abre ninguna conexión, así que esto es un spec unitario y no un E2E.
 *
 * **Qué comprueba y qué no.** Aquí se comprueba la DECLARACIÓN; que el esquema resultante en
 * PostgreSQL sea el correcto lo comprueban `src/database/__tests__/schema-conventions.e2e-spec.ts`
 * y `src/database/__tests__/migrations.e2e-spec.ts`. No se solapan, y está medido leyendo sus
 * casos: los cuatro del primero hablan de mayúsculas, de guiones, de nombres de tabla y de las
 * columnas de traza — ninguno mira cómo se llama un índice, si una columna nació de un
 * `@CreateDateColumn`, ni si el snake_case lo puso la estrategia o un `name:` escrito a mano.
 *
 * ⚠️ El nombre de cada índice es contrato con `wallet.typeorm.repository.ts`, que discrimina los
 * tres `23505` por `driverError.constraint`.
 */
describe('WalletOrmEntity', () => {
  describe('@Entity', () => {
    it('debería declarar el nombre de la tabla, que la estrategia de nombres no puede adivinar', () => {
      // Arrange
      const tables = getMetadataArgsStorage().tables;

      // Act
      const table = tables.find((candidate) => candidate.target === WalletOrmEntity);

      // Assert
      // Sin el `name`, la estrategia derivaría el nombre de la CLASE. Medido con la función real:
      // `toSnakeCase('WalletOrmEntity')` es `wallet_orm_entity` — no puede saber que `OrmEntity` es
      // decoración nuestra.
      expect(toSnakeCase(WalletOrmEntity.name)).toBe('wallet_orm_entity');
      expect(table?.name).toBe('wallets');
    });
  });

  describe('@Column', () => {
    it('debería no fijar name en ninguna columna, para que el snake_case lo ponga la estrategia', () => {
      // Arrange
      const columns = columnsOf(WalletOrmEntity);

      // Act
      const withExplicitName = columns
        .filter((column) => column.options.name !== undefined)
        .map((column) => column.propertyName);

      // Assert
      // Un `name:` explícito GANA y no se convierte: es la escotilla para una columna heredada, y
      // por eso no basta con que el nombre resultante sea el correcto. Aquí no hay ninguna heredada.
      expect(withExplicitName).toEqual([]);
    });

    it('debería producir las once columnas exactas de la tabla al pasar por la estrategia de nombres', () => {
      // Arrange — la lista es la del contrato §8, y se compara contra el nombre de columna REAL,
      // no contra el de la propiedad: es lo único que ata esta clase al esquema.
      const columns = columnsOf(WalletOrmEntity);

      // Act
      const declared = columns.map((column) => toSnakeCase(column.propertyName)).sort();

      // Assert
      // `user_id` sale de una propiedad llamada `userId`, no `ownerId`: como aquí no hay `name:`
      // que renombre nada, el nombre de la PROPIEDAD es el único sitio donde se decide el de la
      // columna. El agregado sigue llamando `ownerId` al dueño y `wallet.mapper.ts` cruza los dos
      // vocabularios.
      expect(declared).toEqual([
        'activation_tx_id',
        'address',
        'address_index',
        'created_at',
        'created_by',
        'id',
        'owner_address',
        'status',
        'updated_at',
        'updated_by',
        'user_id',
      ]);
    });

    it('debería llamar userId a la propiedad del dueño, que es donde se decide el nombre de la columna', () => {
      // Arrange
      const columns = columnsOf(WalletOrmEntity);

      // Act
      const propertyNames = columns.map((column) => column.propertyName);

      // Assert
      // El caso anterior pasaría igual con `@Column({ name: 'user_id' }) ownerId`, que es
      // exactamente lo que la convención del repo prohíbe. Este lo cierra por el otro lado.
      expect(propertyNames).toContain('userId');
      expect(propertyNames).not.toContain('ownerId');
    });

    it('debería declarar todas las columnas como regulares, sin fechas automáticas del ORM', () => {
      // Arrange
      const columns = columnsOf(WalletOrmEntity);

      // Act
      const automatic = columns
        .filter((column) => column.mode !== 'regular')
        .map((column) => `${column.propertyName}:${column.mode}`);

      // Assert
      // `@CreateDateColumn`/`@UpdateDateColumn` meterían un segundo reloj en el sistema: el instante
      // lo pone el dominio con el `now` que le inyecta el caso de uso. El modo de fallo concreto
      // —`updated_at` movido por TypeORM y `updated_by` con el actor anterior— está medido en
      // `user.orm-entity.ts`.
      expect(automatic).toEqual([]);
    });

    it('debería dejar nullables exactamente las tres columnas que el dominio tipa como nulas', () => {
      // Arrange
      const columns = columnsOf(WalletOrmEntity);

      // Act
      const nullable = columns
        .filter((column) => column.options.nullable === true)
        .map((column) => column.propertyName)
        .sort();

      // Assert
      // `activationTxId` es `TransactionHash | null` en `Wallet`; los dos actores son
      // `string | null` en `AuditTrail`. Una columna NOT NULL de más rompe el INSERT del alta; una
      // de menos deja pasar un hueco que el dominio no admite.
      expect(nullable).toEqual(['activationTxId', 'createdBy', 'updatedBy']);
    });
  });

  describe('@Index', () => {
    it('debería declarar los tres índices únicos con el nombre que la traducción del 23505 compara', () => {
      // Arrange
      const indices = getMetadataArgsStorage().indices.filter(
        (index) => index.target === WalletOrmEntity,
      );

      // Act
      const declared = indices
        .map((index) => ({ name: index.name, columns: index.columns, unique: index.unique }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));

      // Assert
      // El nombre no es cosmético: `wallet.typeorm.repository.ts` decide QUÉ hace con cada `23505`
      // mirando `driverError.constraint`, que vale exactamente estas cadenas. Renombrar un índice
      // aquí sin tocar el adaptador convierte el desenlace `'owner-conflict'` y los dos 500 con
      // nombre en un 500 anónimo. `columns` lleva el nombre de la PROPIEDAD porque es lo que el
      // decorador registra; la estrategia lo traduce después.
      expect(declared).toEqual([
        { name: 'idx_wallets_address', columns: ['address'], unique: true },
        { name: 'idx_wallets_address_index', columns: ['addressIndex'], unique: true },
        { name: 'idx_wallets_user_id', columns: ['userId'], unique: true },
      ]);
    });
  });

  describe('@Check', () => {
    it('debería declarar el CHECK que impide entregar la master como dirección de un usuario', () => {
      // Arrange
      const checks = getMetadataArgsStorage().checks.filter(
        (check) => check.target === WalletOrmEntity,
      );

      // Act
      const declared = checks.map((check) => ({ name: check.name, expression: check.expression }));

      // Assert
      // `Wallet.assign()` ya rechaza esa dirección, pero solo ve las escrituras que pasan por el
      // agregado. Este control vive en el motor y es el único que ve además un seed, una consola u
      // otra migración. La expresión nombra las COLUMNAS (`owner_address`), no las propiedades: es
      // SQL que va tal cual a PostgreSQL y la estrategia de nombres no lo toca.
      expect(declared).toEqual([
        {
          name: 'ck_wallets_address_not_master',
          expression: '"address" <> "owner_address"',
        },
      ]);
    });
  });
});

// Helpers

const columnsOf = (target: unknown) =>
  getMetadataArgsStorage().columns.filter((column) => column.target === target);
