import { test as fcTest } from '@fast-check/jest';
import fc from 'fast-check';
import { getMetadataArgsStorage } from 'typeorm';

import { EthereumAddress } from '../../../domain/value-objects/ethereum-address.vo';
import { TokenAmount } from '../../../domain/value-objects/token-amount.vo';
import { TokenId } from '../../../domain/value-objects/token-id.vo';
import { TransactionHash } from '../../../domain/value-objects/transaction-hash.vo';
import { TransferAsset } from '../../../domain/transfer-asset';
import { TransferId } from '../../../domain/value-objects/transfer-id.vo';
import { WalletTransfer } from '../../../domain/entities/wallet-transfer.entity';
import { WalletTransferMapper } from '../../../infrastructure/persistence/wallet-transfer.mapper';
import { WalletTransferOrmEntity } from '../../../infrastructure/persistence/wallet-transfer.orm-entity';
import {
  providerFailureReasonArb,
  transactionHashArb,
  transferAssetArb,
} from '../../helpers/arbitraries';
import type { ProviderFailureReason } from '../../../domain/errors/wallet.errors';
import type { TransferStatus } from '../../../domain/transfer-status';

const OWNER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const FROM_ADDRESS = '0xa0b1c2d3e4f5061728394a5b6c7d8e9f00112233';
const RECIPIENT_ADDRESS = '0xb1c2d3e4f5061728394a5b6c7d8e9f0011223344';

/**
 * ⚠️ **Se llama `CONTRACT` y no `TOKEN` por gitleaks**, que es un gate de CI: su regla
 * `generic-api-key` cruza una palabra clave —`TOKEN` está en esa lista— con la entropía del literal
 * que sigue, y una dirección Ethereum PÚBLICA da de sobra. El mismo renombrado, con la corrida de
 * `gitleaks detect` que lo mide, está documentado en
 * `__tests__/infrastructure/gateways/tatum-asset.mapper.spec.ts`.
 */
const CONTRACT = '0xc2d3e4f5061728394a5b6c7d8e9f001122334455';

const SUBMITTED_TX = `0x${'cd'.repeat(32)}`;

// Distintas entre sí: con la misma marca, un mapper que cruzara `created_at` con `updated_at`
// pasaría igual.
const CREATED_AT = new Date('2026-08-27T09:00:00.000Z');
const UPDATED_AT = new Date('2026-08-27T09:00:02.250Z');

// Y distintos entre sí, por lo mismo, y distintos de `OWNER_ID`.
const CREATED_BY = '3f1a9b2c-8d4e-4f6a-9b1c-2e5d7a0f3b48';
const UPDATED_BY = '5b7c2d4e-9a1f-4c3b-8e6d-0f2a4b6c8d1e';

const DEFAULT_AMOUNT = '1500000000000000000';

type Outcome = {
  status: TransferStatus;
  txId: string | null;
  reasonCode: ProviderFailureReason | null;
};

/**
 * Estado, hash y motivo viajan JUNTOS por el mismo motivo que las cuatro columnas del activo:
 * `submitted` sin hash o `rejected` sin motivo son filas que el agregado no escribe, y generarlas
 * probaría el mapper contra un libro que no existe. Los motivos salen de `PROVIDER_FAILURE_REASONS`
 * vía el arbitrario compartido, nunca de una copia escrita a mano: con una copia, añadir un motivo
 * dejaría esta propiedad sin cubrirlo, en verde y en silencio.
 *
 * ⚠️ Las ramas ANOTAN el tipo de retorno del `map` en vez de llevar un `as TransferStatus` dentro,
 * por lo mismo que en `wallet.mapper.spec.ts`: sin nada `tsc` infiere `status: string` y da
 * `TS2322`, y con el `as` lo marca `@typescript-eslint/no-unnecessary-type-assertion`. La anotación
 * es la única forma que las dos herramientas aceptan.
 */
const outcomeArb: fc.Arbitrary<Outcome> = fc.oneof(
  fc.constant<Outcome>({ status: 'submitting', txId: null, reasonCode: null }),
  transactionHashArb.map((txId): Outcome => ({ status: 'submitted', txId, reasonCode: null })),
  providerFailureReasonArb.map((reasonCode): Outcome => ({
    status: 'rejected',
    txId: null,
    reasonCode,
  })),
  providerFailureReasonArb.map((reasonCode): Outcome => ({
    status: 'unknown',
    txId: null,
    reasonCode,
  })),
);

const timestampArb = fc.date({
  min: new Date('2000-01-01T00:00:00.000Z'),
  max: new Date('2100-01-01T00:00:00.000Z'),
  noInvalidDate: true,
});

/** Los dos actores, generados por separado: con una sola muestra compartida, cruzarlos no se vería. */
const actorArb = fc.constantFrom<string | null>(CREATED_BY, UPDATED_BY, null);

/**
 * ⚠️ Vive ENCIMA del `describe`, igual que en `wallet.mapper.spec.ts` y por lo mismo:
 * `fcTest.prop([transferArb])` se evalúa al registrar el `describe`, antes de que se inicialice
 * cualquier `const` posterior.
 *
 * El activo sale de `transferAssetArb` (`__tests__/helpers/arbitraries.ts`), que produce las cuatro
 * clases con sus value objects ya construidos. Generar las cuatro columnas por separado fabricaría
 * filas imposibles —un NFT con importe— y el caso moriría por una fila que la tabla nunca puede
 * contener, no por un defecto del mapper.
 */
const transferArb: fc.Arbitrary<WalletTransfer> = fc
  .tuple(transferAssetArb, outcomeArb, timestampArb, timestampArb, actorArb, actorArb)
  .map(([sample, outcome, createdAt, updatedAt, createdBy, updatedBy]) =>
    WalletTransfer.rehydrate({
      id: TransferId.generate(),
      ownerId: OWNER_ID,
      from: EthereumAddress.from(FROM_ADDRESS),
      recipient: EthereumAddress.from(RECIPIENT_ADDRESS),
      asset: sample.asset,
      status: outcome.status,
      txId: outcome.txId === null ? null : TransactionHash.from(outcome.txId),
      reasonCode: outcome.reasonCode,
      createdAt,
      updatedAt,
      createdBy,
      updatedBy,
    }),
  );

/**
 * ⚠️ **Los constructores locales usan `WalletTransfer.rehydrate` y no `buildTransfer`** de
 * `__tests__/helpers/wallet-transfer.factory.ts`, por el mismo motivo que en `wallet.mapper.spec.ts`:
 * la factoría del módulo alcanza los estados EJECUTANDO los mutadores, así que `createdBy` y
 * `updatedBy` salen siempre iguales, y aquí hacen falta distintos para poder ver si el mapper los
 * cruza.
 */
describe('WalletTransferMapper', () => {
  describe('toPersistence()', () => {
    it('debería escribir contrato e importe del activo fungible, dejando token_id nulo', () => {
      // Arrange
      const transfer = buildTransfer(
        TransferAsset.fungible({
          token: EthereumAddress.from(CONTRACT),
          amount: TokenAmount.from(DEFAULT_AMOUNT),
        }),
      );

      // Act
      const row = WalletTransferMapper.toPersistence(transfer);

      // Assert
      expect(row).toBeInstanceOf(WalletTransferOrmEntity);
      expect(row.assetKind).toBe('fungible');
      expect(row.tokenAddress).toBe(CONTRACT);
      expect(row.amount).toBe(DEFAULT_AMOUNT);
      expect(row.tokenId).toBeNull();
    });

    it('debería escribir contrato e identificador del NFT, dejando amount nulo', () => {
      // Arrange
      const transfer = buildTransfer(
        TransferAsset.nft({
          token: EthereumAddress.from(CONTRACT),
          tokenId: TokenId.from('42'),
        }),
      );

      // Act
      const row = WalletTransferMapper.toPersistence(transfer);

      // Assert
      expect(row.assetKind).toBe('nft');
      expect(row.tokenAddress).toBe(CONTRACT);
      expect(row.amount).toBeNull();
      expect(row.tokenId).toBe('42');
    });

    it('debería escribir las tres columnas del activo multi-token, con el token cero intacto', () => {
      // Arrange
      const transfer = buildTransfer(
        TransferAsset.multiToken({
          token: EthereumAddress.from(CONTRACT),
          amount: TokenAmount.from('3'),
          tokenId: TokenId.from('0'),
        }),
      );

      // Act
      const row = WalletTransferMapper.toPersistence(transfer);

      // Assert
      // El literal lleva GUION: `'multi-token'` es el vocabulario del dominio, del DTO y de la
      // columna. `multiToken` en camelCase existe solo como clave del matcher de `TransferAsset`,
      // que es un identificador de TypeScript y no un valor.
      //
      // `tokenId` es `'0'` a propósito: el token 0 existe y es la asimetría deliberada con
      // `TokenAmount`, que sí rechaza el cero. ⚠️ **Y aquí NO se cuela el fallo que parece.** El
      // riesgo obvio sería un `tokenId || null` en el mapper convirtiendo el cero en NULL; medido
      // en Node, `'0' || null` devuelve `'0'`, porque una cadena no vacía es truthy — solo el
      // NÚMERO cero es falso. Confirmado además rompiendo el mapper a propósito de las dos formas,
      // `row.tokenId = snapshot.tokenId || null` al escribir y `row.tokenId || undefined` al
      // releer: los dos son mutantes EQUIVALENTES, no cae ningún caso de esta carpeta y no debería
      // caer ninguno. Lo que este caso sí ancla de forma determinista es la ida del cero por
      // `TokenId.from('0')`, que la propiedad de más abajo solo cubre cuando el muestreo lo saca.
      expect(row.assetKind).toBe('multi-token');
      expect(row.tokenAddress).toBe(CONTRACT);
      expect(row.amount).toBe('3');
      expect(row.tokenId).toBe('0');
    });

    it('debería escribir solo el importe del activo nativo, sin contrato ni token_id', () => {
      // Arrange
      const transfer = buildTransfer(TransferAsset.native({ amount: TokenAmount.from('0.5') }));

      // Act
      const row = WalletTransferMapper.toPersistence(transfer);

      // Assert
      expect(row.assetKind).toBe('native');
      expect(row.tokenAddress).toBeNull();
      expect(row.amount).toBe('0.5');
      expect(row.tokenId).toBeNull();
    });

    it('debería escribir la dirección emisora en from_address y la destinataria en recipient', () => {
      // Arrange — las dos son direcciones de 42 caracteres y del mismo tipo: cruzarlas no rompe
      // ningún tipo ni ninguna longitud, y deja el libro diciendo que el usuario se mandó el dinero
      // a sí mismo. Este caso es lo único que las distingue de forma determinista.
      const transfer = buildTransfer(TransferAsset.native({ amount: TokenAmount.from('1') }));

      // Act
      const row = WalletTransferMapper.toPersistence(transfer);

      // Assert
      expect(row.fromAddress).toBe(FROM_ADDRESS);
      expect(row.recipient).toBe(RECIPIENT_ADDRESS);
    });

    it('debería escribir el desenlace en status, tx_id y reason_code sin cruzarlos', () => {
      // Arrange
      const transfer = buildTransfer(TransferAsset.native({ amount: TokenAmount.from('1') }), {
        status: 'rejected',
        txId: null,
        reasonCode: 'body-rejected',
      });

      // Act
      const row = WalletTransferMapper.toPersistence(transfer);

      // Assert
      // `'body-rejected'` sale de `PROVIDER_FAILURE_REASONS`, la única lista de motivos del módulo:
      // el libro y la pasarela hablan del mismo suceso visto desde dos sitios.
      expect(row.status).toBe('rejected');
      expect(row.txId).toBeNull();
      expect(row.reasonCode).toBe('body-rejected');
    });

    it('debería escribir las dos marcas de tiempo y los dos actores de la traza', () => {
      // Arrange — los cuatro valores son distintos entre sí, así que este caso caza también
      // cruzarlos. Los dos actores son nullables: un mapper que se los dejara escribiría NULL en
      // silencio, sin romper ningún INSERT.
      const transfer = buildTransfer(TransferAsset.native({ amount: TokenAmount.from('1') }));

      // Act
      const row = WalletTransferMapper.toPersistence(transfer);

      // Assert
      expect(row.createdAt).toEqual(CREATED_AT);
      expect(row.updatedAt).toEqual(UPDATED_AT);
      expect(row.createdBy).toBe(CREATED_BY);
      expect(row.updatedBy).toBe(UPDATED_BY);
    });

    it('debería asignar TODAS las columnas declaradas, sin dejar ninguna en undefined', () => {
      // Arrange — mira COBERTURA, no valores: es lo único que se pondría rojo si la ORM entity gana
      // una columna y nadie añade su línea al mapper. `undefined` no es NULL para TypeORM, es «no
      // toques esta columna», así que ese defecto no rompería ningún INSERT. Se usa el activo
      // multi-token porque es el único que llena las tres columnas del activo a la vez.
      const row = WalletTransferMapper.toPersistence(
        buildTransfer(
          TransferAsset.multiToken({
            token: EthereumAddress.from(CONTRACT),
            amount: TokenAmount.from('3'),
            tokenId: TokenId.from('7'),
          }),
        ),
      );

      // Act
      const unwritten = declaredPropertiesOf(WalletTransferOrmEntity).filter(
        (property) => (row as unknown as Record<string, unknown>)[property] === undefined,
      );

      // Assert
      expect(unwritten).toEqual([]);
    });
  });

  describe('toDomain()', () => {
    it('debería reconstruir la transferencia desde las quince columnas', () => {
      // Arrange
      const row = buildRow();

      // Act
      const transfer = WalletTransferMapper.toDomain(row);

      // Assert
      // El snapshot ENTERO, no campo a campo: es lo que hace que un campo del dominio no pueda
      // quedarse sin leer en silencio.
      expect(transfer.toSnapshot()).toEqual({
        id: row.id,
        ownerId: OWNER_ID,
        from: FROM_ADDRESS,
        recipient: RECIPIENT_ADDRESS,
        assetKind: 'fungible',
        tokenAddress: CONTRACT,
        amount: DEFAULT_AMOUNT,
        tokenId: null,
        status: 'submitted',
        txId: SUBMITTED_TX,
        reasonCode: null,
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
        createdBy: CREATED_BY,
        updatedBy: UPDATED_BY,
      });
    });

    it('debería reconstruir una fila nativa, cuyas columnas de contrato y de token_id son nulas', () => {
      // Arrange
      const row = buildRow();
      row.assetKind = 'native';
      row.tokenAddress = null;
      row.tokenId = null;
      row.amount = '0.5';

      // Act
      const transfer = WalletTransferMapper.toDomain(row);

      // Assert
      // ⚠️ Este es el caso del `?? undefined` del mapper. `TransferAsset.fromParts` distingue
      // «campo ausente» con `!== undefined`, no con una comprobación de nulidad, así que pasarle el
      // `null` de la columna cuenta como PRESENTE y sale por `AssetFieldNotAllowedError`. Sin ese
      // `??`, NINGUNA transferencia nativa podría releerse — y el activo nativo es el camino más
      // común del módulo, no un caso de borde.
      const snapshot = transfer.toSnapshot();
      expect(snapshot.assetKind).toBe('native');
      expect(snapshot.tokenAddress).toBeNull();
      expect(snapshot.amount).toBe('0.5');
      expect(snapshot.tokenId).toBeNull();
    });

    it('debería reconstruir una fila en submitting, sin txId y sin código de motivo', () => {
      // Arrange
      const row = buildRow();
      row.status = 'submitting';
      row.txId = null;
      row.reasonCode = null;

      // Act
      const transfer = WalletTransferMapper.toDomain(row);

      // Assert
      // Es el estado con el que TODA transferencia nace, por la escritura por delante: si el mapper
      // no supiera releerlo, el libro no podría reconstruir precisamente las filas que justifican
      // su existencia.
      const snapshot = transfer.toSnapshot();
      expect(snapshot.status).toBe('submitting');
      expect(snapshot.txId).toBeNull();
      expect(snapshot.reasonCode).toBeNull();
    });

    it('debería reconstruir una fila rechazada, con su código de motivo y sin txId', () => {
      // Arrange
      const row = buildRow();
      row.status = 'rejected';
      row.txId = null;
      row.reasonCode = 'body-rejected';

      // Act
      const transfer = WalletTransferMapper.toDomain(row);

      // Assert
      const snapshot = transfer.toSnapshot();
      expect(snapshot.status).toBe('rejected');
      expect(snapshot.txId).toBeNull();
      expect(snapshot.reasonCode).toBe('body-rejected');
    });
  });

  describe('toDomain() ∘ toPersistence()', () => {
    fcTest.prop([transferArb])(
      'debería preservar los quince campos para cualquier transferencia del dominio',
      (original) => {
        // Arrange — la transferencia la construye el arbitrario.

        // Act
        const restored = WalletTransferMapper.toDomain(
          WalletTransferMapper.toPersistence(original),
        );

        // Assert
        // Es lo único que ata los cuatro literales de `assetKind` que salen del snapshot con los
        // cuatro que `TransferAsset.fromParts` acepta al releer: cambiar uno sin el otro pone esta
        // propiedad en rojo, porque `fromParts` lanzaría `UnknownAssetKindError`. ⚠️ Igual que en
        // `wallet.mapper.spec.ts`, no es lo que caza los cruces entre campos del mismo tipo de
        // forma fiable —no lleva semilla fija—: de eso se encargan los casos puntuales de
        // `toPersistence()`.
        expect(restored.toSnapshot()).toEqual(original.toSnapshot());
      },
    );
  });
});

// Helpers

const buildTransfer = (
  asset: TransferAsset,
  outcome: Outcome = { status: 'submitted', txId: SUBMITTED_TX, reasonCode: null },
): WalletTransfer =>
  WalletTransfer.rehydrate({
    id: TransferId.generate(),
    ownerId: OWNER_ID,
    from: EthereumAddress.from(FROM_ADDRESS),
    recipient: EthereumAddress.from(RECIPIENT_ADDRESS),
    asset,
    status: outcome.status,
    txId: outcome.txId === null ? null : TransactionHash.from(outcome.txId),
    reasonCode: outcome.reasonCode,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    createdBy: CREATED_BY,
    updatedBy: UPDATED_BY,
  });

/** Una fila fungible y liquidada: la forma con la que empiezan los casos de `toDomain()`. */
const buildRow = (): WalletTransferOrmEntity => {
  const row = new WalletTransferOrmEntity();
  row.id = TransferId.generate().value;
  row.ownerId = OWNER_ID;
  row.fromAddress = FROM_ADDRESS;
  row.recipient = RECIPIENT_ADDRESS;
  row.assetKind = 'fungible';
  row.tokenAddress = CONTRACT;
  row.amount = DEFAULT_AMOUNT;
  row.tokenId = null;
  row.status = 'submitted';
  row.txId = SUBMITTED_TX;
  row.reasonCode = null;
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
