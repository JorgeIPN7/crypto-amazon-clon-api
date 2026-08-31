import { test as fcTest } from '@fast-check/jest';

import { EthereumAddress } from '../../../domain/value-objects/ethereum-address.vo';
import { TokenAmount } from '../../../domain/value-objects/token-amount.vo';
import { TokenId } from '../../../domain/value-objects/token-id.vo';
import { TransactionHash } from '../../../domain/value-objects/transaction-hash.vo';
import { TransferAsset, type TransferAssetKind } from '../../../domain/transfer-asset';
import { TransferId } from '../../../domain/value-objects/transfer-id.vo';
import {
  WalletTransfer,
  type WalletTransferSnapshot,
} from '../../../domain/entities/wallet-transfer.entity';
import { providerFailureReasonArb, transferAssetArb } from '../../helpers/arbitraries';
import type { ProviderFailureReason } from '../../../domain/errors/wallet.errors';
import type { TransferStatus } from '../../../domain/transfer-status';

/**
 * ⚠️ **Aquí abajo solo hay cadenas CRUDAS: ni un value object a nivel de módulo.** Es el idioma de
 * `transfer-asset.spec.ts` y no el de `wallet.entity.spec.ts`, y la diferencia está medida en
 * `docs/backlog.md` #17: aquel construye SIETE value objects de CUATRO clases fuera de todo
 * `describe`, y un mutante que haga que un `from()` rechace un valor VÁLIDO revienta el archivo
 * al importarlo —`Test suite failed to run`, `Tests: 0 total`—, así que Stryker no puede decir
 * qué caso lo mató y lo bucketea como «error» en vez de como «muerto». Son 14 mutantes del
 * módulo, y caen en TRES de esas cuatro clases (5 / 5 / 4).
 *
 * ⚠️ La cuarta, `WalletId`, se construye ahí igual y aporta CERO errores — y el matiz importa,
 * porque sin él la regla se leería como «construir un VO a nivel de módulo ⇒ errores», que es
 * falso. Ninguno de sus tres mutantes está en una validación capaz de rechazar un UUID legítimo:
 * viven en la línea del `throw`. Lo que produce el error no es construir el VO, es que exista un
 * mutante que haga fallar esa construcción.
 *
 * `transfer-asset.spec.ts` aporta 61 mutantes y cero errores.
 *
 * El precio es construir los VO dentro de los helpers del final, y por eso las aserciones comparan
 * contra la cadena cruda: las de aquí abajo ya están en la forma canónica que devuelve cada
 * `from()` —las dos direcciones en minúsculas, el importe y el id de token sin ceros a la
 * izquierda—, así que `EthereumAddress.from(FROM).value === FROM`.
 */
const TRANSFER_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const OWNER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
/**
 * Actor DISTINTO del dueño a propósito, aunque el caso de uso de la transferencia acabe pasando el
 * mismo `sub` a los dos: es lo único que demuestra que el agregado guarda ambos campos por separado
 * en lugar de derivar `createdBy` de `ownerId`. Mismo argumento, y mismos dos literales, que
 * `wallet.entity.spec.ts` y `order.entity.spec.ts`.
 */
const ACTOR_ID = '5b7c2d4e-9a1f-4c3b-8e6d-0f2a4b6c8d1e';
const OTHER_ACTOR_ID = '3f1a9b2c-8d4e-4f6a-9b1c-2e5d7a0f3b48';

const FROM = '0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3';
const RECIPIENT = '0x627306090abab3a6e1400e9345bc60c78a8bef57';
/**
 * La dirección del contrato del token — lo que el dominio llama `tokenAddress`.
 *
 * ⚠️ **Se llama `CONTRACT` y no `TOKEN` por gitleaks**, mismo motivo ya medido en
 * `transfer-asset.spec.ts`: su regla `generic-api-key` combina una palabra clave —`token` está en
 * esa lista— con la entropía del literal que sigue, y marca direcciones Ethereum PÚBLICAS como
 * fuga. El precedente limpio del módulo es `CONTRACT` / `LOWERCASE` / `CHECKSUMMED`.
 */
const CONTRACT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const AMOUNT = '1000000000000000000';
const TOKEN_ID = '42';

const TX_HASH = '0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060';
const OTHER_TX_HASH = '0x88df016429689c079f3b2f6ad39fa052532c56795b733da78a91ebe6a713944b';

const NOW = new Date('2026-08-27T09:00:00.000Z');
const LATER = new Date('2026-08-27T10:30:00.000Z');
const MUCH_LATER = new Date('2026-08-27T12:45:00.000Z');

describe('WalletTransfer', () => {
  describe('start()', () => {
    it('debería nacer en submitting, sin txId ni motivo y con las dos marcas selladas en el mismo instante', () => {
      // Arrange + Act — la fila se escribe ANTES de llamar al proveedor. Con la escritura
      // posterior, un timeout no dejaría rastro, que es justo el caso para el que el libro
      // existe (§3.2).
      const transfer = buildStartedTransfer();

      // Assert — `toEqual` y no `toBe` sobre las fechas: los getters de `Entity` devuelven copias
      // (`get createdAt() { return new Date(this._audit.createdAt) }`), así que la instancia que
      // sale nunca es la que entró.
      expect(settlementOf(transfer)).toEqual({
        status: 'submitting',
        txId: null,
        reasonCode: null,
      });
      expect(transfer.createdAt).toEqual(NOW);
      expect(transfer.updatedAt).toEqual(NOW);
    });

    it('debería registrar el actor recibido en createdBy y updatedBy sin derivarlo del dueño', () => {
      // Arrange
      const transfer = buildStartedTransfer();

      // Act
      const actors = { createdBy: transfer.createdBy, updatedBy: transfer.updatedBy };

      // Assert — con ACTOR_ID ≠ OWNER_ID, una implementación que escribiera `params.ownerId` en la
      // traza cae aquí.
      expect(actors).toEqual({ createdBy: ACTOR_ID, updatedBy: ACTOR_ID });
      expect(transfer.ownerId).toBe(OWNER_ID);
    });
  });

  describe('markSubmitted()', () => {
    it('debería pasar a submitted guardando el txId y moviendo la traza', () => {
      // Arrange
      const transfer = buildStartedTransfer();

      // Act — instante y actor DISTINTOS de los del alta: con los mismos, el `touch()` no
      // cambiaría nada observable y el caso pasaría con la llamada borrada.
      transfer.markSubmitted(TransactionHash.from(TX_HASH), LATER, OTHER_ACTOR_ID);

      // Assert
      expect(settlementOf(transfer)).toEqual({
        status: 'submitted',
        txId: TX_HASH,
        reasonCode: null,
      });
      expect(transfer.updatedAt).toEqual(LATER);
      expect(transfer.updatedBy).toBe(OTHER_ACTOR_ID);
    });

    it('debería conservar rejected y su motivo cuando se marca envío sobre una fila ya liquidada', () => {
      // Arrange
      const transfer = buildRejectedTransfer();
      const before = { updatedAt: transfer.updatedAt, updatedBy: transfer.updatedBy };

      // Act
      transfer.markSubmitted(TransactionHash.from(TX_HASH), MUCH_LATER, OTHER_ACTOR_ID);

      // Assert — el `txId` sigue nulo: una fila `rejected` afirma que NO pasó nada en la cadena, y
      // guardarle un hash la haría mentir en las dos direcciones a la vez.
      expect(settlementOf(transfer)).toEqual({
        status: 'rejected',
        txId: null,
        reasonCode: 'body-rejected',
      });
      expect(transfer.updatedAt).toEqual(before.updatedAt);
      expect(transfer.updatedBy).toBe(before.updatedBy);
    });
  });

  describe('markRejected()', () => {
    it('debería pasar a rejected con el motivo recibido y sin txId', () => {
      // Arrange: `rejected` es SOLO el 400 de validación del cuerpo —`'body-rejected'`—, es decir
      // que no pasó nada en la cadena y no hay hash que guardar (§3.2).
      const transfer = buildStartedTransfer();

      // Act
      transfer.markRejected('body-rejected', LATER, ACTOR_ID);

      // Assert
      expect(settlementOf(transfer)).toEqual({
        status: 'rejected',
        txId: null,
        reasonCode: 'body-rejected',
      });
    });

    it('debería conservar submitted y su txId cuando se marca rechazo sobre una fila ya liquidada', () => {
      // Arrange: el fallo que este caso cierra es alcanzable — §3.2 manda reintentar UNA vez el
      // guardado posterior a la llamada («se reintenta una vez»), así que existe un `catch`
      // alrededor de una entidad ya marcada. Sin la regla «gana la primera liquidación», el libro
      // afirmaría un rechazo sobre una transacción cuyo hash tenemos.
      const transfer = buildSubmittedTransfer();
      const before = { updatedAt: transfer.updatedAt, updatedBy: transfer.updatedBy };

      // Act
      transfer.markRejected('body-rejected', MUCH_LATER, OTHER_ACTOR_ID);

      // Assert
      expect(settlementOf(transfer)).toEqual({
        status: 'submitted',
        txId: TX_HASH,
        reasonCode: null,
      });
      expect(transfer.updatedAt).toEqual(before.updatedAt);
      expect(transfer.updatedBy).toBe(before.updatedBy);
    });
  });

  describe('markUnknown()', () => {
    it('debería pasar a unknown con el motivo recibido y sin txId', () => {
      // Arrange: `unknown` es la respuesta honesta a un timeout — pudo minarse o no. No se inventa
      // un `rejected`, que afirmaría algo falso, ni un `submitted` sin `txId` (§3.2).
      const transfer = buildStartedTransfer();

      // Act
      transfer.markUnknown('timeout', LATER, ACTOR_ID);

      // Assert
      expect(settlementOf(transfer)).toEqual({
        status: 'unknown',
        txId: null,
        reasonCode: 'timeout',
      });
    });

    it('debería conservar submitted y su txId cuando se marca unknown sobre una fila ya liquidada', () => {
      // Arrange: la variante peor del caso anterior — el libro diría «no sé si se movió el dinero»
      // sobre una transacción cuyo hash ya tenemos guardado.
      const transfer = buildSubmittedTransfer();
      const before = { updatedAt: transfer.updatedAt, updatedBy: transfer.updatedBy };

      // Act
      transfer.markUnknown('unreachable', MUCH_LATER, OTHER_ACTOR_ID);

      // Assert
      expect(settlementOf(transfer)).toEqual({
        status: 'submitted',
        txId: TX_HASH,
        reasonCode: null,
      });
      expect(transfer.updatedAt).toEqual(before.updatedAt);
      expect(transfer.updatedBy).toBe(before.updatedBy);
    });
  });

  describe('rehydrate()', () => {
    it('debería reconstituir el estado, el txId y el motivo guardados', () => {
      // Arrange
      const transfer = rehydrateTransfer({
        status: 'unknown',
        txId: null,
        reasonCode: 'upstream-error',
      });

      // Act
      const state = settlementOf(transfer);

      // Assert
      expect(state).toEqual({
        status: 'unknown',
        txId: null,
        reasonCode: 'upstream-error',
      });
    });

    it('debería conservar por separado las dos marcas y los dos actores al reconstituir', () => {
      // Arrange — dos fechas y dos actores DISTINTOS: es lo único que demuestra que `rehydrate` no
      // los colapsa. Con los cuatro iguales, una implementación que ignorase dos parámetros pasaría
      // igual.
      const transfer = rehydrateTransfer({
        status: 'submitted',
        txId: OTHER_TX_HASH,
        reasonCode: null,
        createdAt: NOW,
        updatedAt: MUCH_LATER,
        createdBy: null,
        updatedBy: ACTOR_ID,
      });

      // Act
      const trail = {
        createdAt: transfer.createdAt,
        updatedAt: transfer.updatedAt,
        createdBy: transfer.createdBy,
        updatedBy: transfer.updatedBy,
      };

      // Assert
      expect(trail).toEqual({
        createdAt: NOW,
        updatedAt: MUCH_LATER,
        createdBy: null,
        updatedBy: ACTOR_ID,
      });
    });
  });

  describe('toSnapshot()', () => {
    it('debería aplanar el activo nativo en el snapshot dejando nulos tokenAddress y tokenId', () => {
      // Arrange: la rama nativa es la única sin contrato, y la que caza un aplanado que escribiera
      // la dirección del token «por si acaso».
      const transfer = buildStartedTransfer(nativeAsset());

      // Act
      const snapshot = transfer.toSnapshot();

      // Assert — el objeto COMPLETO: un campo de menos deja al mapper sin dato y al DTO sin
      // publicar, y comparar campo a campo dejaría vivo ese mutante.
      expect(snapshot).toEqual({
        id: TRANSFER_ID,
        ownerId: OWNER_ID,
        from: FROM,
        recipient: RECIPIENT,
        assetKind: 'native',
        tokenAddress: null,
        amount: AMOUNT,
        tokenId: null,
        status: 'submitting',
        txId: null,
        reasonCode: null,
        createdAt: NOW,
        updatedAt: NOW,
        createdBy: ACTOR_ID,
        updatedBy: ACTOR_ID,
      });
    });

    it('debería aplanar el activo multi-token y publicar el motivo en el snapshot', () => {
      // Arrange: `'multi-token'` CON GUION es el literal del dominio y el de la columna
      // `asset_kind`; la clave del matcher es `multiToken` porque es un identificador de
      // TypeScript. Son dos cosas distintas y este caso fija la que sale publicada.
      const transfer = buildStartedTransfer(multiTokenAsset());
      transfer.markRejected('body-rejected', LATER, OTHER_ACTOR_ID);

      // Act
      const snapshot = transfer.toSnapshot();

      // Assert
      expect(snapshot).toEqual({
        id: TRANSFER_ID,
        ownerId: OWNER_ID,
        from: FROM,
        recipient: RECIPIENT,
        assetKind: 'multi-token',
        tokenAddress: CONTRACT,
        amount: AMOUNT,
        tokenId: TOKEN_ID,
        status: 'rejected',
        txId: null,
        reasonCode: 'body-rejected',
        createdAt: NOW,
        updatedAt: LATER,
        createdBy: ACTOR_ID,
        updatedBy: OTHER_ACTOR_ID,
      });
    });
  });

  describe('aplanado de las clases intermedias', () => {
    // ⚠️ **Estos dos casos existen por el AUDITOR, no por el dominio**, y el motivo merece estar
    // escrito porque no es evidente: la propiedad de más abajo ya cubre las cuatro clases y —
    // medido— mata el mutante `fungible: () => undefined` cuando se ejecuta directamente con
    // Jest. Pero Stryker la da por SUPERVIVIENTE.
    //
    // La causa está medida y es del andamiaje, no del test: `stryker.config.mjs` usa
    // `coverageAnalysis: perTest`, que empareja tests por NOMBRE, y `@fast-check/jest` mete la
    // semilla dentro del nombre — la salida del auditor lo enseña literalmente:
    // `~ … en sus cuatro columnas (with seed=399077411) … (covered 16)`, cubriendo 16 mutantes y
    // matando CERO. En la corrida del mutante, fast-check elige otra semilla, el nombre cambia,
    // Stryker no encuentra el test y no lo ejecuta.
    //
    // Consecuencia, y va al backlog porque alcanza a todo el repo: **una propiedad no aporta
    // poder de muerte al gate de mutación.** Lo que ata estas dos ramas para el auditor son
    // estos dos casos deterministas; la propiedad se queda porque explora valores que ellos no.
    it('debería aplanar el activo fungible dejando nulo el id de token', () => {
      // Arrange
      const transfer = buildStartedTransfer(fungibleAsset());

      // Act
      const snapshot = transfer.toSnapshot();

      // Assert — el objeto de columnas COMPLETO, no campo a campo: es lo único que caza que una
      // rama escriba de más en una columna que su clase no lleva.
      expect(assetColumnsOf(snapshot)).toEqual({
        assetKind: 'fungible',
        tokenAddress: CONTRACT,
        amount: AMOUNT,
        tokenId: null,
      });
    });

    it('debería aplanar el NFT dejando nulo el importe', () => {
      // Arrange
      const transfer = buildStartedTransfer(nftAsset());

      // Act
      const snapshot = transfer.toSnapshot();

      // Assert
      expect(assetColumnsOf(snapshot)).toEqual({
        assetKind: 'nft',
        tokenAddress: CONTRACT,
        amount: null,
        tokenId: TOKEN_ID,
      });
    });
  });

  describe('gana la primera liquidación desde unknown', () => {
    // De los tres estados terminales, `unknown` era el único sin ni un caso: los tres que había
    // parten de `submitted` o de `rejected`. El corte en seco de hoy es agnóstico del estado —una
    // sola comparación contra `submitting`—, así que el código actual no está roto; lo que este
    // caso impide es la REGRESIÓN: reescribir ese corte como una lista por estado
    // (`=== 'submitted' || === 'rejected'`) deja `unknown` desprotegido, y medido antes de
    // escribirlo la suite del módulo pasaba entera con esa reescritura puesta.
    //
    // El daño que evita: un `markUnknown` de reintento sobre una fila ya `unknown` le cambiaría
    // el motivo —`timeout` por `unreachable`— y movería la traza, con el libro atribuyendo la
    // liquidación a quien no liquidó.
    it('debería conservar unknown y su motivo cuando se marca envío sobre una fila ya liquidada', () => {
      // Arrange
      const transfer = buildStartedTransfer();
      transfer.markUnknown('timeout', LATER, ACTOR_ID);

      // Act
      transfer.markSubmitted(TransactionHash.from(TX_HASH), MUCH_LATER, OTHER_ACTOR_ID);

      // Assert
      expect(settlementOf(transfer)).toEqual({
        status: 'unknown',
        txId: null,
        reasonCode: 'timeout',
      });
      expect(transfer.updatedAt).toEqual(LATER);
      expect(transfer.updatedBy).toBe(ACTOR_ID);
    });
  });

  describe('motivo de la liquidación (property-based)', () => {
    fcTest.prop([providerFailureReasonArb])(
      'debería guardar cualquier motivo de PROVIDER_FAILURE_REASONS tal cual',
      (reason) => {
        // Arrange
        const transfer = buildStartedTransfer();

        // Act
        transfer.markUnknown(reason, LATER, ACTOR_ID);

        // Assert — «tal cual» es la propiedad: ni se normaliza, ni se traduce, ni se sustituye por
        // texto del proveedor. Lo que impide que entre texto libre es el TIPO —`markUnknown` pide
        // un `ProviderFailureReason`, así que `transfer.markUnknown(err.message, …)` no compila—;
        // lo que esta propiedad fija es que los nueve códigos legales llegan intactos a la fila.
        expect(settlementOf(transfer)).toEqual({
          status: 'unknown',
          txId: null,
          reasonCode: reason,
        });
      },
    );
  });

  describe('aplanado del activo (property-based)', () => {
    // Los dos casos puntuales del snapshot fotografían el nativo y el multi-token, que son los
    // extremos —cero contrato y las tres columnas llenas—, y con eso las ramas `fungible` y `nft`
    // se quedaban SIN MIRAR por nadie. Medido antes de escribir esta propiedad: sustituyendo las
    // dos ramas enteras por `() => ({ tokenAddress: null, amount: null, tokenId: null })`,
    // `tsc --noEmit` sale limpio y la suite del módulo da `175 passed` — cero rojos.
    //
    // ⚠️ El fallo que evita no se vería hasta la persistencia: una transferencia `fungible`
    // escribiría `token_address` Y `amount` a NULL —la fila pierde a la vez el contrato y el
    // importe— y un `nft` perdería contrato e id, con la CI en verde y el gate de mutación
    // también, porque el dominio entero seguía por encima del umbral.
    //
    // Se escribe como PROPIEDAD y no como dos casos más porque `transferAssetArb` ya publica las
    // cuatro clases con sus valores en el orden de cada factoría: una sola aserción cierra las
    // cuatro ramas en vez de dos, y estrena un arbitrario que hasta hoy solo compilaba.
    fcTest.prop([transferAssetArb])(
      'debería aplanar cualquier clase de activo en sus cuatro columnas',
      ({ asset, kind, values }) => {
        // Arrange
        const transfer = buildStartedTransfer(asset);

        // Act
        const snapshot = transfer.toSnapshot();

        // Assert — se comparan las cuatro columnas contra los `values` que el arbitrario
        // registró al construir, NUNCA releyendo el propio activo: releerlo sería reimplementar
        // el aplanado dentro de su test, y un aplanado que reformatease un valor seguiría verde.
        expect(assetColumnsOf(snapshot)).toEqual(expectedColumns(kind, values));
      },
    );
  });
});

// Helpers

/**
 * La liquidación completa en un objeto: estado, hash y motivo.
 *
 * El motivo se lee del snapshot porque la entidad **no publica un getter para él** —la superficie
 * del contrato congelado §4 son `status`, `txId` y `toSnapshot()`—, que es exactamente por donde lo
 * leerán el mapper y el DTO. El hash se lee por su getter y como CADENA: `toEqual` sobre un
 * `TransactionHash` compararía estructura (`{ value }`) y no clase, así que comparar `.value`
 * afirma lo mismo sin arrastrar la construcción del VO a cada aserción.
 */
const settlementOf = (
  transfer: WalletTransfer,
): {
  status: TransferStatus;
  txId: string | null;
  reasonCode: ProviderFailureReason | null;
} => ({
  status: transfer.status,
  txId: transfer.txId?.value ?? null,
  reasonCode: transfer.toSnapshot().reasonCode,
});

/**
 * La clase más simple de `TransferAsset`, y la única sin contrato.
 *
 * ⚠️ **No se dice en qué unidad está `AMOUNT`, y no es un olvido.** Una versión anterior de este
 * comentario lo leía como «1 ETH», y eso contradice lo que el propio módulo ya midió: el JSDoc de
 * `token-amount.vo.ts` deja escrito, citando el esquema del proveedor, que su campo `amount` no
 * dice ni una palabra sobre la unidad. Su `pattern` admite decimales, que en wei no significan
 * nada — y si el campo fuera ETH, esta constante no sería 1 sino un billón.
 *
 * El fallo que evita: el siguiente que abra este archivo es quien escriba el mapper y decida si
 * hay que convertir unidades. Una decisión sobre dinero apoyada en un comentario de fixture que
 * afirma más de lo que nadie midió.
 */
const nativeAsset = (): TransferAsset => TransferAsset.native({ amount: TokenAmount.from(AMOUNT) });

/** La clase con contrato e importe, y sin id de token. */
const fungibleAsset = (): TransferAsset =>
  TransferAsset.fungible({
    token: EthereumAddress.from(CONTRACT),
    amount: TokenAmount.from(AMOUNT),
  });

/** La clase con contrato e id de token, y sin importe: la única que no lleva `amount`. */
const nftAsset = (): TransferAsset =>
  TransferAsset.nft({
    token: EthereumAddress.from(CONTRACT),
    tokenId: TokenId.from(TOKEN_ID),
  });

/** La clase con las TRES columnas del activo llenas: es la que caza un aplanado incompleto. */
const multiTokenAsset = (): TransferAsset =>
  TransferAsset.multiToken({
    token: EthereumAddress.from(CONTRACT),
    amount: TokenAmount.from(AMOUNT),
    tokenId: TokenId.from(TOKEN_ID),
  });

const buildStartedTransfer = (asset: TransferAsset = nativeAsset()): WalletTransfer =>
  WalletTransfer.start({
    id: TransferId.from(TRANSFER_ID),
    ownerId: OWNER_ID,
    from: EthereumAddress.from(FROM),
    recipient: EthereumAddress.from(RECIPIENT),
    asset,
    now: NOW,
    createdBy: ACTOR_ID,
  });

const buildSubmittedTransfer = (): WalletTransfer => {
  const transfer = buildStartedTransfer();
  transfer.markSubmitted(TransactionHash.from(TX_HASH), LATER, ACTOR_ID);
  return transfer;
};

const buildRejectedTransfer = (): WalletTransfer => {
  const transfer = buildStartedTransfer();
  transfer.markRejected('body-rejected', LATER, ACTOR_ID);
  return transfer;
};

const rehydrateTransfer = (row: {
  status: TransferStatus;
  txId: string | null;
  reasonCode: ProviderFailureReason | null;
  createdAt?: Date;
  updatedAt?: Date;
  createdBy?: string | null;
  updatedBy?: string | null;
}): WalletTransfer =>
  WalletTransfer.rehydrate({
    id: TransferId.from(TRANSFER_ID),
    ownerId: OWNER_ID,
    from: EthereumAddress.from(FROM),
    recipient: EthereumAddress.from(RECIPIENT),
    asset: nativeAsset(),
    status: row.status,
    txId: row.txId === null ? null : TransactionHash.from(row.txId),
    reasonCode: row.reasonCode,
    createdAt: row.createdAt ?? NOW,
    updatedAt: row.updatedAt ?? NOW,
    // ⚠️ `=== undefined` y **no `??`** en los dos actores, al revés que en las dos fechas. `??`
    // dispara también con `null`, y `null` es un valor LEGAL de estas dos columnas —«no se sabe
    // quién», según `shared/domain/system-actor.ts`—, así que con `??` el `createdBy: null` que
    // pasa el caso A10 se convertiría en `ACTOR_ID` y el caso no podría pasar nunca. Mismo apaño, y
    // por el mismo motivo ya medido, que en `wallet.entity.spec.ts`.
    createdBy: row.createdBy === undefined ? ACTOR_ID : row.createdBy,
    updatedBy: row.updatedBy === undefined ? ACTOR_ID : row.updatedBy,
  });

/** Las cuatro columnas del activo, aisladas del resto del snapshot. */
type AssetColumns = Pick<
  WalletTransferSnapshot,
  'assetKind' | 'tokenAddress' | 'amount' | 'tokenId'
>;

const assetColumnsOf = (snapshot: WalletTransferSnapshot): AssetColumns => ({
  assetKind: snapshot.assetKind,
  tokenAddress: snapshot.tokenAddress,
  amount: snapshot.amount,
  tokenId: snapshot.tokenId,
});

/**
 * La rejilla del §3.4, escrita AQUÍ y a mano en vez de derivada de la entidad: derivarla sería
 * reimplementar el aplanado dentro de su propio test, y entonces un aplanado equivocado y su
 * comprobación se moverían juntos, quedando consistentes entre sí y mal contra la especificación.
 *
 * `values` llega en el orden en que cada factoría recibe sus argumentos, que es el contrato que
 * `transferAssetArb` publica en su JSDoc: nativo `[amount]`, fungible `[token, amount]`, NFT
 * `[token, tokenId]` y multi-token `[token, amount, tokenId]`.
 */
/**
 * Lee el valor que la clase de activo EXIGE en esa posición.
 *
 * Lanza en vez de devolver `null` porque el tipo de `values` es `readonly string[]` y con
 * `noUncheckedIndexedAccess` cada índice sale como `string | undefined`. Taparlo con `?? null`
 * haría pasar el caso cuando el arbitrario NO aportase un valor obligatorio: el esperado se
 * volvería `null`, el aplanado real también lo es en las columnas que no toca, y la propiedad
 * quedaría verde sin comparar nada. Fallar aquí ruidosamente es lo que mantiene la comparación.
 */
const requiredValue = (values: readonly string[], index: number): string => {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`el arbitrario no aportó el valor obligatorio en la posición ${index}`);
  }
  return value;
};

const expectedColumns = (kind: TransferAssetKind, values: readonly string[]): AssetColumns => {
  switch (kind) {
    case 'native':
      return {
        assetKind: 'native',
        tokenAddress: null,
        amount: requiredValue(values, 0),
        tokenId: null,
      };
    case 'fungible':
      return {
        assetKind: 'fungible',
        tokenAddress: requiredValue(values, 0),
        amount: requiredValue(values, 1),
        tokenId: null,
      };
    case 'nft':
      return {
        assetKind: 'nft',
        tokenAddress: requiredValue(values, 0),
        amount: null,
        tokenId: requiredValue(values, 1),
      };
    case 'multi-token':
      return {
        assetKind: 'multi-token',
        tokenAddress: requiredValue(values, 0),
        amount: requiredValue(values, 1),
        tokenId: requiredValue(values, 2),
      };
  }
};
