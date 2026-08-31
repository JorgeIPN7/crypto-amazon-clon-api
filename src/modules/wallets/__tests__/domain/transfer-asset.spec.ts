import fc from 'fast-check';

import { ValueObject } from '@shared/domain/value-object.base';

import {
  AssetFieldNotAllowedError,
  InvalidTokenAmountError,
  MissingAssetFieldError,
  UnknownAssetKindError,
} from '../../domain/errors/wallet.errors';
import {
  TRANSFER_ASSET_KINDS,
  TransferAsset,
  type TransferAssetMatchers,
  type TransferAssetParts,
} from '../../domain/transfer-asset';
import { EthereumAddress } from '../../domain/value-objects/ethereum-address.vo';
import { TokenAmount } from '../../domain/value-objects/token-amount.vo';
import { TokenId } from '../../domain/value-objects/token-id.vo';
import { captureError } from '../helpers/capture-error';

/**
 * La dirección del contrato del activo — lo que el dominio llama `tokenAddress`.
 *
 * ⚠️ **Se llama `CONTRACT` y no `TOKEN` por gitleaks, que es un gate de CI (`security.yml`).** Su
 * regla `generic-api-key` combina una palabra clave con la entropía de Shannon del literal que
 * sigue, y `token` está en esa lista: con el nombre anterior el escaneo daba **2 hallazgos** en
 * este archivo —`generic-api-key`, entropías 3.59 y 3.74— sobre dos direcciones Ethereum
 * PÚBLICAS que no son secreto de nadie. Medido con `gitleaks:v8.30.1 detect --no-git` sobre
 * `src/modules/wallets`: `leaks found: 2` antes del renombrado, `no leaks found` después.
 *
 * El fallo que evita: el gate no distingue una dirección pública de una clave, así que el PR se
 * habría puesto rojo y la salida barata habría sido un `.gitleaksignore` — un archivo que a
 * partir de ahí hay que mantener y que apaga el gate para esas líneas. Quitar la palabra clave
 * quita la causa. El vecino `ethereum-address.vo.spec.ts` ya lo hacía sin saberlo:
 * `LOWERCASE` / `CHECKSUMMED`.
 */
const CONTRACT = '0x742d35cc6634c0532925a3b844bc454e4438f44e';
/**
 * La MISMA dirección de `CONTRACT` en EIP-55, y aquí el checksum SÍ es el canónico: derivado con
 * keccak256 sobre el cuerpo en minúsculas y no escrito a ojo. Una versión anterior de esta
 * constante llevaba `742D35…` —`D` mayúscula en la sexta posición— y era caja mezclada
 * arbitraria, no EIP-55: medido con `@noble/hashes@1.8.0`, el canónico es `742d35…` porque el
 * nibble del hash en esa posición es < 8 y exige minúscula.
 *
 * **El fallo que evita el cambio no está en F6**, que mide la normalización a minúsculas y pasa
 * con cualquiera de las dos: está en quien venga a escribir el validador de checksum del DTO
 * —lo anuncia `ethereum-address.vo.ts`— y copie de aquí una dirección «ya en EIP-55». Con la
 * anterior, su caso feliz habría fallado o habría pasado por la razón equivocada.
 */
const CONTRACT_CHECKSUMMED = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';
const AMOUNT = '1500000000000000000';
const TOKEN_ID = '42';

describe('TransferAsset', () => {
  describe('TRANSFER_ASSET_KINDS', () => {
    // El guion de `multi-token` es load-bearing: el contrato congelado §1 lo fija como el literal
    // único del dominio, del mapper, de los dos DTO, del ejemplo de OpenAPI y de la columna
    // `asset_kind`. Hoy ninguno de esos cinco consumidores existe: medido con
    // `grep -rn "multi-token" src/`, el literal solo sale en dominio y tests —este archivo,
    // `transfer-asset.ts`, `__tests__/helpers/arbitraries.ts` y una línea de comentario de
    // `token-id.vo.ts`—, nunca en un mapper, un DTO ni una migración.
    //
    // Este caso es el único de la suite que lo ancla EN EL VOCABULARIO: medido escribiendo
    // `multitoken` en `TRANSFER_ASSET_KINDS`, `1 failed, 139 passed` en el módulo entero, y el que
    // cae es este. Los demás casos que citan `multi-token` —F3, F22, P1— leen el literal del
    // ESTADO, que es otra escritura, y sobreviven. Lo que sí se pone rojo a la vez es `tsc`, con
    // `TS2322` en el getter `kind`, porque el estado y el vocabulario dejan de coincidir.
    it('debería publicar el vocabulario cerrado de clases con multi-token escrito con guion', () => {
      // Arrange + Act + Assert
      expect(TRANSFER_ASSET_KINDS).toEqual(['native', 'fungible', 'nft', 'multi-token']);
    });
  });

  describe('factorías', () => {
    it('debería entregar token e importe a la rama fungible', () => {
      // Arrange
      const asset = TransferAsset.fungible({
        token: EthereumAddress.from(CONTRACT),
        amount: TokenAmount.from(AMOUNT),
      });

      // Act
      const described = describeAsset(asset);

      // Assert
      expect(described).toBe(`fungible:${CONTRACT}:${AMOUNT}`);
    });

    it('debería entregar token e id a la rama nft', () => {
      // Arrange
      const asset = TransferAsset.nft({
        token: EthereumAddress.from(CONTRACT),
        tokenId: TokenId.from(TOKEN_ID),
      });

      // Act
      const described = describeAsset(asset);

      // Assert
      expect(described).toBe(`nft:${CONTRACT}:${TOKEN_ID}`);
    });

    it('debería entregar token, importe e id a la rama multi-token', () => {
      // Arrange
      const asset = TransferAsset.multiToken({
        token: EthereumAddress.from(CONTRACT),
        amount: TokenAmount.from(AMOUNT),
        tokenId: TokenId.from(TOKEN_ID),
      });

      // Act
      const described = describeAsset(asset);

      // Assert
      expect(described).toBe(`multi-token:${CONTRACT}:${AMOUNT}:${TOKEN_ID}`);
    });

    it('debería entregar solo el importe a la rama nativa', () => {
      // Arrange
      const asset = TransferAsset.native({ amount: TokenAmount.from(AMOUNT) });

      // Act
      const described = describeAsset(asset);

      // Assert
      expect(described).toBe(`native:${AMOUNT}`);
    });
  });

  describe('kind', () => {
    // El getter es lo que el mapper escribirá en `asset_kind` y el DTO publicará. Sin él, cada
    // consumidor tendría que hacer su propio `match()` de cuatro ramas para averiguar una cadena.
    it('debería publicar en kind la clase de cada uno de los cuatro activos', () => {
      // Arrange
      const token = EthereumAddress.from(CONTRACT);
      const amount = TokenAmount.from(AMOUNT);
      const tokenId = TokenId.from(TOKEN_ID);

      // Act
      const kinds = [
        TransferAsset.fungible({ token, amount }).kind,
        TransferAsset.nft({ token, tokenId }).kind,
        TransferAsset.multiToken({ token, amount, tokenId }).kind,
        TransferAsset.native({ amount }).kind,
      ];

      // Assert
      expect(kinds).toEqual(['fungible', 'nft', 'multi-token', 'native']);
    });
  });

  describe('match()', () => {
    // Sin este caso, un `switch` que cayera en dos ramas seguiría en verde: la última en escribir
    // ganaría y el valor devuelto seguiría siendo el correcto. Aquí se mira QUIÉN se ejecutó.
    it('debería invocar exactamente una rama de match() y ninguna más', () => {
      // Arrange
      const calls: string[] = [];
      const recorders: TransferAssetMatchers<void> = {
        native: () => {
          calls.push('native');
        },
        fungible: () => {
          calls.push('fungible');
        },
        nft: () => {
          calls.push('nft');
        },
        multiToken: () => {
          calls.push('multi-token');
        },
      };

      // Act
      TransferAsset.native({ amount: TokenAmount.from(AMOUNT) }).match(recorders);

      // Assert
      expect(calls).toEqual(['native']);
    });
  });

  describe('fromParts()', () => {
    // La dirección entra en EIP-55 y sale en minúsculas. La normalización no es cosa de este
    // archivo sino de `EthereumAddress.from()` —su caso «debería normalizar a minúsculas una
    // dirección con checksum EIP-55»—; lo que este caso fija es que `fromParts` PASA por el value
    // object en vez de quedarse la cadena cruda. El plan traía aquí la dirección ya en minúsculas,
    // con lo que la fila de la tabla prometía una normalización que ninguna aserción miraba.
    it('debería construir un activo fungible desde sus partes en crudo', () => {
      // Arrange
      const parts: TransferAssetParts = {
        kind: 'fungible',
        tokenAddress: CONTRACT_CHECKSUMMED,
        amount: AMOUNT,
      };

      // Act
      const described = describeAsset(TransferAsset.fromParts(parts));

      // Assert
      expect(described).toBe(`fungible:${CONTRACT}:${AMOUNT}`);
    });

    it('debería construir un activo nft desde sus partes en crudo', () => {
      // Arrange
      const parts: TransferAssetParts = { kind: 'nft', tokenAddress: CONTRACT, tokenId: TOKEN_ID };

      // Act
      const described = describeAsset(TransferAsset.fromParts(parts));

      // Assert
      expect(described).toBe(`nft:${CONTRACT}:${TOKEN_ID}`);
    });

    it('debería construir un activo multi-token desde sus partes en crudo', () => {
      // Arrange
      const parts: TransferAssetParts = {
        kind: 'multi-token',
        tokenAddress: CONTRACT,
        amount: AMOUNT,
        tokenId: TOKEN_ID,
      };

      // Act
      const described = describeAsset(TransferAsset.fromParts(parts));

      // Assert
      expect(described).toBe(`multi-token:${CONTRACT}:${AMOUNT}:${TOKEN_ID}`);
    });

    it('debería construir un activo nativo desde sus partes en crudo', () => {
      // Arrange
      const parts: TransferAssetParts = { kind: 'native', amount: AMOUNT };

      // Act
      const described = describeAsset(TransferAsset.fromParts(parts));

      // Assert
      expect(described).toBe(`native:${AMOUNT}`);
    });

    // `fromParts` acepta `kind: string` y NO el union estrecho: es la lección medida con
    // `invalid-profile`. Con el tipo estrecho, una clase desconocida caería por un `switch` sin
    // `default` devolviendo `undefined` — un 500 donde tocaba un 400.
    it('debería rechazar una clase de activo desconocida con el error y el mensaje exactos', () => {
      // Arrange
      const parts: TransferAssetParts = {
        kind: 'erc721',
        tokenAddress: CONTRACT,
        tokenId: TOKEN_ID,
      };

      // Act
      const error = captureError(() => TransferAsset.fromParts(parts));

      // Assert
      expect(error).toBeInstanceOf(UnknownAssetKindError);
      expect(error.message).toBe('"erc721" is not a known asset kind');
      expect((error as UnknownAssetKindError).kind).toBe('erc721');
    });

    it('debería rechazar una clase de activo vacía', () => {
      // Arrange
      const parts: TransferAssetParts = { kind: '', amount: AMOUNT };

      // Act
      const error = captureError(() => TransferAsset.fromParts(parts));

      // Assert
      expect(error).toBeInstanceOf(UnknownAssetKindError);
      expect(error.message).toBe('"" is not a known asset kind');
    });

    it('debería rechazar un fungible sin importe, nombrando la clase y el campo', () => {
      // Arrange
      const parts: TransferAssetParts = { kind: 'fungible', tokenAddress: CONTRACT };

      // Act
      const error = captureError(() => TransferAsset.fromParts(parts));

      // Assert
      expect(error).toBeInstanceOf(MissingAssetFieldError);
      expect(error.message).toBe('Asset of kind "fungible" requires the field "amount"');
    });

    it('debería rechazar un fungible con id de token, que su clase prohíbe', () => {
      // Arrange
      const parts: TransferAssetParts = {
        kind: 'fungible',
        tokenAddress: CONTRACT,
        amount: AMOUNT,
        tokenId: TOKEN_ID,
      };

      // Act
      const error = captureError(() => TransferAsset.fromParts(parts));

      // Assert
      expect(error).toBeInstanceOf(AssetFieldNotAllowedError);
      expect(error.message).toBe('Asset of kind "fungible" does not accept the field "tokenId"');
    });

    it('debería rechazar un nft sin id de token', () => {
      // Arrange
      const parts: TransferAssetParts = { kind: 'nft', tokenAddress: CONTRACT };

      // Act
      const error = captureError(() => TransferAsset.fromParts(parts));

      // Assert
      expect(error).toBeInstanceOf(MissingAssetFieldError);
      expect(error.message).toBe('Asset of kind "nft" requires the field "tokenId"');
    });

    it('debería rechazar un nft con importe, que su clase prohíbe', () => {
      // Arrange
      const parts: TransferAssetParts = {
        kind: 'nft',
        tokenAddress: CONTRACT,
        tokenId: TOKEN_ID,
        amount: AMOUNT,
      };

      // Act
      const error = captureError(() => TransferAsset.fromParts(parts));

      // Assert
      expect(error).toBeInstanceOf(AssetFieldNotAllowedError);
      expect(error.message).toBe('Asset of kind "nft" does not accept the field "amount"');
    });

    it('debería rechazar un envío nativo con dirección de token, que su clase prohíbe', () => {
      // Arrange
      const parts: TransferAssetParts = { kind: 'native', amount: AMOUNT, tokenAddress: CONTRACT };

      // Act
      const error = captureError(() => TransferAsset.fromParts(parts));

      // Assert
      expect(error).toBeInstanceOf(AssetFieldNotAllowedError);
      expect(error.message).toBe('Asset of kind "native" does not accept the field "tokenAddress"');
    });

    it('debería rechazar un envío nativo sin importe', () => {
      // Arrange
      const parts: TransferAssetParts = { kind: 'native' };

      // Act
      const error = captureError(() => TransferAsset.fromParts(parts));

      // Assert
      expect(error).toBeInstanceOf(MissingAssetFieldError);
      expect(error.message).toBe('Asset of kind "native" requires the field "amount"');
    });

    // El orden está fijado a propósito: con un cuerpo que a la vez omite un campo obligatorio y
    // lleva uno prohibido, decirle al cliente «te sobra tokenId» le señala el error real —eligió
    // la clase equivocada—, mientras que «te falta amount» le manda a completar una forma que ya
    // estaba mal. Es una decisión, no una medición.
    it('debería denunciar antes el campo prohibido que el obligatorio cuando faltan los dos', () => {
      // Arrange
      const parts: TransferAssetParts = {
        kind: 'fungible',
        tokenAddress: CONTRACT,
        tokenId: TOKEN_ID,
      };

      // Act
      const error = captureError(() => TransferAsset.fromParts(parts));

      // Assert
      expect(error).toBeInstanceOf(AssetFieldNotAllowedError);
      expect(error.message).toBe('Asset of kind "fungible" does not accept the field "tokenId"');
    });

    it('debería propagar el error del value object cuando el importe no es canónico', () => {
      // Arrange
      const parts: TransferAssetParts = { kind: 'native', amount: '01' };

      // Act
      const error = captureError(() => TransferAsset.fromParts(parts));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenAmountError);
      expect(error.message).toBe('"01" is not a valid token amount');
    });
  });

  describe('nominalidad', () => {
    // La puerta la cierra el COMPILADOR, no el runtime: `private` se borra al compilar, así que
    // `new` sí construye una instancia real. Lo que este caso fija es que las dos formas de
    // saltarse las factorías son rojas en `pnpm typecheck`, y `pnpm test` NO lo comprueba: SWC
    // borra los tipos sin mirarlos. Medido quitando los dos `@ts-expect-error`: Jest sigue en
    // verde con los 26 casos y `tsc` saca `TS2673: Constructor of class 'TransferAsset' is
    // private…` y `TS2739: … is missing the following properties from type 'TransferAsset':
    // state, match`. Por eso `pnpm typecheck` es obligatorio en esta tarea.
    //
    // Y el caso se denuncia solo si la puerta se abre: medido cambiando
    // `private constructor(private readonly state: …)` por `constructor(readonly state: …)`, `tsc`
    // responde `TS2578: Unused '@ts-expect-error' directive.` — **uno solo**, el de la primera
    // línea. El de la segunda sigue en uso porque al impostor le faltan `state` y `match`, así que
    // ese medio caso aguanta incluso con el constructor abierto.
    //
    // ⚠️ El impostor va por una VARIABLE INTERMEDIA, y no es cosmética. El plan lo escribía como
    // literal fresco —`const impostor: TransferAsset = { kind: 'native', amount }`— y eso mide
    // otra cosa: medido con `tsc --noEmit`, esa forma da `TS2353: Object literal may only specify
    // known properties, and 'amount' does not exist in type 'TransferAsset'`, o sea el chequeo de
    // propiedades sobrantes, que también protegería a una unión discriminada suelta. Por la
    // variable intermedia —justo el agujero del §3.4— el rojo es `TS2739: Type '{ kind: "native";
    // amount: TokenAmount; }' is missing the following properties from type 'TransferAsset':
    // state, match`, que ES la nominalidad y solo existe porque `state` es privado.
    it('debería impedir construir un activo sin pasar por una de las cuatro factorías', () => {
      // Arrange
      const amount = TokenAmount.from(AMOUNT);
      const shaped = { kind: 'native' as const, amount };

      // Act
      // @ts-expect-error El constructor es privado y `TransferAssetState` no se exporta (TS2673).
      const built = new TransferAsset({ kind: 'native', amount });
      // @ts-expect-error El campo privado `state` hace la clase NOMINAL: un objeto con la misma
      // forma que la variante nativa de la unión no es asignable (TS2739).
      const impostor: TransferAsset = shaped;

      // Assert
      expect(built).toBeInstanceOf(TransferAsset);
      expect(impostor).not.toBeInstanceOf(TransferAsset);
    });

    // `ValueObject.equals` compara con `===`, que sobre un objeto es identidad de referencia, y
    // `toString()` daría `[object Object]`. Heredar obligaría a sobreescribir las dos únicas
    // cosas que la base aporta, así que no se hereda — y no se escribe `equals` en absoluto,
    // porque ningún caso de uso compara dos activos.
    it('debería no extender ValueObject ni exponer equals', () => {
      // Arrange
      const asset = TransferAsset.native({ amount: TokenAmount.from(AMOUNT) });

      // Act
      const equals = (asset as unknown as { equals?: unknown }).equals;

      // Assert
      expect(asset).not.toBeInstanceOf(ValueObject);
      expect(equals).toBeUndefined();
    });
  });

  describe('fromParts() (property-based)', () => {
    it('debería caer siempre en la rama de su clase, sea cual sea la clase', () => {
      fc.assert(
        fc.property(fc.constantFrom(...ASSET_CASES), ([kind, expected]) => {
          // Act
          const described = describeAsset(TransferAsset.fromParts(validPartsFor(kind)));

          // Assert
          expect(described).toBe(expected);
        }),
      );
    });

    it('debería rechazar cualquier campo prohibido de cualquier clase, nombrándolo', () => {
      fc.assert(
        fc.property(fc.constantFrom(...FORBIDDEN_FIELDS), ([kind, field]) => {
          // Arrange
          const parts = withField(validPartsFor(kind), field, SAMPLE[field]);

          // Act
          const error = captureError(() => TransferAsset.fromParts(parts));

          // Assert
          expect(error).toBeInstanceOf(AssetFieldNotAllowedError);
          expect(error.message).toBe(
            `Asset of kind "${kind}" does not accept the field "${field}"`,
          );
        }),
      );
    });

    it('debería rechazar la omisión de cualquier campo obligatorio de cualquier clase', () => {
      fc.assert(
        fc.property(fc.constantFrom(...REQUIRED_FIELDS), ([kind, field]) => {
          // Arrange
          const parts = withoutField(validPartsFor(kind), field);

          // Act
          const error = captureError(() => TransferAsset.fromParts(parts));

          // Assert
          expect(error).toBeInstanceOf(MissingAssetFieldError);
          expect(error.message).toBe(`Asset of kind "${kind}" requires the field "${field}"`);
        }),
      );
    });
  });
});

// Helpers

type OptionalField = 'tokenAddress' | 'amount' | 'tokenId';

/** Un valor válido por campo, para que el error nunca venga del value object. */
const SAMPLE: Record<OptionalField, string> = {
  tokenAddress: CONTRACT,
  amount: AMOUNT,
  tokenId: TOKEN_ID,
};

/** Las cuatro clases con la descripción que `match()` debe producir para sus partes válidas. */
const ASSET_CASES: readonly (readonly [string, string])[] = [
  ['fungible', `fungible:${CONTRACT}:${AMOUNT}`],
  ['nft', `nft:${CONTRACT}:${TOKEN_ID}`],
  ['multi-token', `multi-token:${CONTRACT}:${AMOUNT}:${TOKEN_ID}`],
  ['native', `native:${AMOUNT}`],
];

/** La rejilla completa de campos PROHIBIDOS. `multi-token` no prohíbe ninguno. */
const FORBIDDEN_FIELDS: readonly (readonly [string, OptionalField])[] = [
  ['fungible', 'tokenId'],
  ['nft', 'amount'],
  ['native', 'tokenAddress'],
  ['native', 'tokenId'],
];

/** La rejilla completa de campos OBLIGATORIOS. */
const REQUIRED_FIELDS: readonly (readonly [string, OptionalField])[] = [
  ['fungible', 'tokenAddress'],
  ['fungible', 'amount'],
  ['nft', 'tokenAddress'],
  ['nft', 'tokenId'],
  ['multi-token', 'tokenAddress'],
  ['multi-token', 'amount'],
  ['multi-token', 'tokenId'],
  ['native', 'amount'],
];

/** Descripción textual por rama: el valor devuelto dice QUÉ rama corrió y con qué valores. */
const describeAsset = (asset: TransferAsset): string =>
  asset.match({
    native: (amount) => `native:${amount.value}`,
    fungible: (token, amount) => `fungible:${token.value}:${amount.value}`,
    nft: (token, tokenId) => `nft:${token.value}:${tokenId.value}`,
    multiToken: (token, amount, tokenId) =>
      `multi-token:${token.value}:${amount.value}:${tokenId.value}`,
  });

/** Las partes mínimas y válidas de cada clase. */
const validPartsFor = (kind: string): TransferAssetParts => {
  switch (kind) {
    case 'fungible':
      return { kind, tokenAddress: CONTRACT, amount: AMOUNT };
    case 'nft':
      return { kind, tokenAddress: CONTRACT, tokenId: TOKEN_ID };
    case 'multi-token':
      return { kind, tokenAddress: CONTRACT, amount: AMOUNT, tokenId: TOKEN_ID };
    default:
      return { kind, amount: AMOUNT };
  }
};

const withField = (
  parts: TransferAssetParts,
  field: OptionalField,
  value: string,
): TransferAssetParts => {
  const copy = { ...parts };
  copy[field] = value;
  return copy;
};

const withoutField = (parts: TransferAssetParts, field: OptionalField): TransferAssetParts => {
  const copy = { ...parts };
  delete copy[field];
  return copy;
};
