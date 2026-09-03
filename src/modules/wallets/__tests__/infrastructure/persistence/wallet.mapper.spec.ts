import { test as fcTest } from '@fast-check/jest';
import fc from 'fast-check';
import { getMetadataArgsStorage } from 'typeorm';

import { AddressIndex } from '../../../domain/value-objects/address-index.vo';
import { EthereumAddress } from '../../../domain/value-objects/ethereum-address.vo';
import { TransactionHash } from '../../../domain/value-objects/transaction-hash.vo';
import { Wallet } from '../../../domain/entities/wallet.entity';
import { WalletId } from '../../../domain/value-objects/wallet-id.vo';
import { WalletMapper } from '../../../infrastructure/persistence/wallet.mapper';
import { WalletOrmEntity } from '../../../infrastructure/persistence/wallet.orm-entity';
import { addressIndexArb, ethereumAddressArb, transactionHashArb } from '../../helpers/arbitraries';
import type { WalletStatus } from '../../../domain/wallet-status';

const OWNER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const MASTER_ADDRESS = '0x1111111111111111111111111111111111111111';
const DERIVED_ADDRESS = '0xa0b1c2d3e4f5061728394a5b6c7d8e9f00112233';
const ACTIVATION_TX = `0x${'ab'.repeat(32)}`;
const ADDRESS_INDEX = 7;

// Distintas entre sí a propósito: con la misma marca en las dos, un mapper que confundiera
// `created_at` con `updated_at` pasaría igual.
const CREATED_AT = new Date('2026-08-27T09:00:00.000Z');
const UPDATED_AT = new Date('2026-08-27T11:30:00.500Z');

// Distintos entre sí y distintos de `OWNER_ID`: con valores repetidos, un mapper que derivase los
// actores del dueño —o que cruzase los dos entre ellos— pasaría igual.
const CREATED_BY = '3f1a9b2c-8d4e-4f6a-9b1c-2e5d7a0f3b48';
const UPDATED_BY = '5b7c2d4e-9a1f-4c3b-8e6d-0f2a4b6c8d1e';

/**
 * Estado y transacción de activación viajan JUNTOS y no como dos arbitrarios sueltos: una wallet
 * `receive-only` con hash de activación es una de las dos combinaciones que el dominio nunca
 * produce —lo dice el JSDoc de `Wallet.rehydrate`, que las enumera—, y generarla probaría el mapper
 * contra filas que no existen.
 */
type Lifecycle = { status: WalletStatus; activationTxId: string | null };

/**
 * ⚠️ Las ramas ANOTAN el tipo de retorno del `map` en vez de llevar un `as WalletStatus` dentro, y
 * la forma no es indiferente: medido, las dos herramientas se contradicen sobre la misma línea. Sin
 * nada, `tsc` infiere `status: string` y el `fc.oneof` no encaja en `Arbitrary<Lifecycle>`
 * (`TS2322`); con el `as`, `@typescript-eslint/no-unnecessary-type-assertion` lo marca como
 * innecesario y `lint:check` se pone rojo. La anotación de retorno es la forma que las dos aceptan.
 */
const lifecycleArb: fc.Arbitrary<Lifecycle> = fc.oneof(
  fc.constant<Lifecycle>({ status: 'receive-only', activationTxId: null }),
  transactionHashArb.map((activationTxId): Lifecycle => ({ status: 'activating', activationTxId })),
  transactionHashArb.map((activationTxId): Lifecycle => ({ status: 'active', activationTxId })),
);

const timestampArb = fc.date({
  min: new Date('2000-01-01T00:00:00.000Z'),
  max: new Date('2100-01-01T00:00:00.000Z'),
  noInvalidDate: true,
});

/**
 * Los dos actores se generan por SEPARADO y de un conjunto de tres —dos ids distintos y `null`—, no
 * de una sola muestra compartida: con un único valor para los dos, cruzarlos sería invisible en
 * toda ejecución. Los tres son los únicos valores que la columna puede tener.
 */
const actorArb = fc.constantFrom<string | null>(CREATED_BY, UPDATED_BY, null);

/**
 * ⚠️ Este arbitrario y los tres de arriba viven ENCIMA del `describe` y no en el bloque de helpers
 * del final, al revés que los constructores puntuales. No es estilo: `fcTest.prop([walletArb])` se
 * evalúa mientras Jest registra el `describe`, o sea antes de que se inicialice cualquier `const`
 * posterior. Medido con una sonda que hace exactamente eso —un `fcTest.prop([laterArb])` con
 * `const laterArb = fc.integer()` debajo—: `Test suite failed to run · ReferenceError: Cannot
 * access 'laterArb' before initialization`, y no cae un caso sino la suite entera. Los
 * constructores de abajo sí pueden quedarse allí porque solo se LLAMAN dentro de un `it`, que corre
 * después.
 *
 * Las direcciones y el índice salen de `__tests__/helpers/arbitraries.ts`, no de generadores
 * propios: son los mismos que ya describen lo que `EthereumAddress` y `AddressIndex` aceptan, y
 * duplicarlos aquí haría que endurecer un value object dejara esta propiedad probando el contrato
 * viejo.
 */
const walletArb: fc.Arbitrary<Wallet> = fc
  .tuple(
    ethereumAddressArb,
    ethereumAddressArb,
    addressIndexArb,
    lifecycleArb,
    timestampArb,
    timestampArb,
    actorArb,
    actorArb,
  )
  .map(
    ([
      ownerAddress,
      address,
      addressIndex,
      lifecycle,
      createdAt,
      updatedAt,
      createdBy,
      updatedBy,
    ]) =>
      Wallet.rehydrate({
        id: WalletId.generate(),
        ownerId: OWNER_ID,
        ownerAddress: EthereumAddress.from(ownerAddress),
        addressIndex: AddressIndex.from(addressIndex),
        address: EthereumAddress.from(address),
        status: lifecycle.status,
        activationTxId:
          lifecycle.activationTxId === null ? null : TransactionHash.from(lifecycle.activationTxId),
        createdAt,
        updatedAt,
        createdBy,
        updatedBy,
      }),
  );

/**
 * ⚠️ **Los constructores locales de este archivo usan `Wallet.rehydrate` y no `buildWallet`** de
 * `__tests__/helpers/wallet.factory.ts`, que es la factoría del módulo. No es un olvido de la
 * convención «nunca copiar un builder en varios specs»: aquella alcanza los estados EJECUTANDO las
 * transiciones del agregado, así que `createdBy` y `updatedBy` salen siempre iguales y las dos
 * marcas de tiempo las ponen tres instantes fijos. Este archivo necesita exactamente lo contrario
 * —cuatro valores distintos entre sí—, porque cruzar dos campos del mismo tipo es el defecto que un
 * mapper escrito a ojo produce y el único que aquí hace falta poder distinguir.
 */
describe('WalletMapper', () => {
  describe('toPersistence()', () => {
    it('debería volcar el agregado a columnas primitivas, con el dueño en la columna user_id', () => {
      // Arrange
      const wallet = buildWallet();

      // Act
      const row = WalletMapper.toPersistence(wallet);

      // Assert
      // `row.userId` y no `row.ownerId`: la tabla guarda el dueño en `user_id`, y el mapper es el
      // único sitio del módulo donde los dos vocabularios se tocan. `ownerAddress` y `address` son
      // dos direcciones del mismo tipo y la misma longitud: cruzarlas no rompería ningún tipo, y
      // son distintas aquí para que este caso las separe.
      expect(row).toBeInstanceOf(WalletOrmEntity);
      expect(row.id).toBe(wallet.id.value);
      expect(row.userId).toBe(OWNER_ID);
      expect(row.ownerAddress).toBe(MASTER_ADDRESS);
      expect(row.addressIndex).toBe(ADDRESS_INDEX);
      expect(row.address).toBe(DERIVED_ADDRESS);
      expect(row.status).toBe('activating');
      expect(row.activationTxId).toBe(ACTIVATION_TX);
    });

    it('debería escribir las dos marcas de tiempo y los dos actores de la traza', () => {
      // Arrange — las cuatro salen de `Entity`, no del estado de negocio, y son justo las que un
      // mapper escrito a ojo se deja: las dos primeras son NOT NULL y reventarían el INSERT, pero
      // las dos de actor son nullables y se escribirían NULL en silencio. Los cuatro valores son
      // distintos entre sí, así que este caso caza también cruzarlos.
      const wallet = buildWallet();

      // Act
      const row = WalletMapper.toPersistence(wallet);

      // Assert
      expect(row.createdAt).toEqual(CREATED_AT);
      expect(row.updatedAt).toEqual(UPDATED_AT);
      expect(row.createdBy).toBe(CREATED_BY);
      expect(row.updatedBy).toBe(UPDATED_BY);
    });

    it('debería escribir null en activation_tx_id cuando la wallet todavía no tiene transacción', () => {
      // Arrange
      const wallet = buildWallet({ status: 'receive-only', activationTxId: null });

      // Act
      const row = WalletMapper.toPersistence(wallet);

      // Assert
      // Es el estado con el que nace TODA wallet, así que un `?.value` mal escrito aquí rompería el
      // alta entera y no un caso de borde. `toBeNull` y no `toBeFalsy`: `undefined` significaría
      // para TypeORM «no toques esta columna» y dejaría el hash anterior en la fila.
      expect(row.activationTxId).toBeNull();
    });

    it('debería asignar TODAS las columnas declaradas, sin dejar ninguna en undefined', () => {
      // Arrange — este caso no mira valores, mira COBERTURA: es lo único que se pondría rojo si
      // mañana la ORM entity gana una columna y nadie añade su línea al mapper. Sin él, esa columna
      // quedaría en `undefined`, que TypeORM traduce a «no toques esta columna» y no a NULL, así
      // que el defecto no daría error de INSERT ni de tipos — se vería en producción como una
      // columna que nunca cambia. No es tautológico: medido con una sonda dentro de Jest,
      // `Object.keys(new WalletOrmEntity())` devuelve `[]` —`useDefineForClassFields: false` en
      // `.swcrc` hace que un campo declarado sin inicializador no se emita—, así que toda clave que
      // tenga la fila la puso el mapper.
      const row = WalletMapper.toPersistence(buildWallet());

      // Act
      const unwritten = declaredPropertiesOf(WalletOrmEntity).filter(
        (property) => (row as unknown as Record<string, unknown>)[property] === undefined,
      );

      // Assert
      expect(unwritten).toEqual([]);
    });
  });

  describe('toDomain()', () => {
    it('debería reconstruir el agregado desde la fila sin volver a comprobar la invariante del alta', () => {
      // Arrange
      const row = buildRow();

      // Act
      const wallet = WalletMapper.toDomain(row);

      // Assert
      // `rehydrate`, no `assign`: los datos persistidos ya eran válidos al guardarse, y `assign`
      // volvería a ejercer la comprobación «la dirección no es la master», que en una fila que ya
      // existe no es una invariante que reimponer sino una corrupción que hay que poder LEER para
      // diagnosticarla. Se compara el snapshot ENTERO —los once campos— y no campo a campo: es lo
      // que hace que un campo del dominio no pueda quedarse sin leer en silencio.
      expect(wallet.toSnapshot()).toEqual({
        id: row.id,
        ownerId: OWNER_ID,
        ownerAddress: MASTER_ADDRESS,
        addressIndex: ADDRESS_INDEX,
        address: DERIVED_ADDRESS,
        status: 'activating',
        activationTxId: ACTIVATION_TX,
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
        createdBy: CREATED_BY,
        updatedBy: UPDATED_BY,
      });
    });

    it('debería reconstruir una fila cuyo activation_tx_id y cuyos actores son null', () => {
      // Arrange
      const row = buildRow();
      row.status = 'receive-only';
      row.activationTxId = null;
      row.createdBy = null;
      row.updatedBy = null;

      // Act
      const wallet = WalletMapper.toDomain(row);

      // Assert
      // Los tres viajan tal cual, sin coalescer: `null` en un actor significa «no se sabe quién» y
      // es un valor legítimo del dominio, no un hueco que rellenar.
      expect(wallet.activationTxId).toBeNull();
      expect(wallet.createdBy).toBeNull();
      expect(wallet.updatedBy).toBeNull();
    });
  });

  describe('toDomain() ∘ toPersistence()', () => {
    fcTest.prop([walletArb])(
      'debería preservar los once campos para cualquier wallet del dominio',
      (original) => {
        // Arrange — la wallet la construye el arbitrario.

        // Act
        const restored = WalletMapper.toDomain(WalletMapper.toPersistence(original));

        // Assert
        // Es lo único que ata las once asignaciones de ida con las once de vuelta a la vez. ⚠️ No
        // es lo que caza los cruces entre campos del mismo tipo de forma FIABLE: esta propiedad no
        // lleva semilla fija, así que un cruce entre `createdBy` y `updatedBy` solo muere en las
        // muestras donde los dos difieren. De eso se encargan, deterministas, los dos primeros
        // casos de `toPersistence()`. Lo que esta propiedad añade es la ida y vuelta COMPLETA sobre
        // valores que ningún caso puntual escribe a mano.
        expect(restored.toSnapshot()).toEqual(original.toSnapshot());
      },
    );
  });
});

// Helpers

const buildWallet = (
  overrides: { status?: WalletStatus; activationTxId?: string | null } = {},
): Wallet =>
  Wallet.rehydrate({
    id: WalletId.generate(),
    ownerId: OWNER_ID,
    ownerAddress: EthereumAddress.from(MASTER_ADDRESS),
    addressIndex: AddressIndex.from(ADDRESS_INDEX),
    address: EthereumAddress.from(DERIVED_ADDRESS),
    status: overrides.status ?? 'activating',
    activationTxId:
      overrides.activationTxId === undefined
        ? TransactionHash.from(ACTIVATION_TX)
        : overrides.activationTxId === null
          ? null
          : TransactionHash.from(overrides.activationTxId),
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    createdBy: CREATED_BY,
    updatedBy: UPDATED_BY,
  });

const buildRow = (): WalletOrmEntity => {
  const row = new WalletOrmEntity();
  row.id = WalletId.generate().value;
  row.userId = OWNER_ID;
  row.ownerAddress = MASTER_ADDRESS;
  row.addressIndex = ADDRESS_INDEX;
  row.address = DERIVED_ADDRESS;
  row.status = 'activating';
  row.activationTxId = ACTIVATION_TX;
  row.createdAt = CREATED_AT;
  row.updatedAt = UPDATED_AT;
  row.createdBy = CREATED_BY;
  row.updatedBy = UPDATED_BY;
  return row;
};

/** Las propiedades que los decoradores de la ORM entity declararon, leídas de su propia metadata. */
const declaredPropertiesOf = (target: unknown): string[] =>
  getMetadataArgsStorage()
    .columns.filter((column) => column.target === target)
    .map((column) => column.propertyName);
