import fc from 'fast-check';

import { type TransferAssetKind, TransferAsset } from '../../../domain/transfer-asset';
import { EthereumAddress } from '../../../domain/value-objects/ethereum-address.vo';
import { TokenAmount } from '../../../domain/value-objects/token-amount.vo';
import { TokenId } from '../../../domain/value-objects/token-id.vo';
import { mapAssetToTatumFields } from '../../../infrastructure/gateways/tatum-asset.mapper';
import { transferAssetArb } from '../../helpers/arbitraries';

/**
 * La dirección del contrato del activo — lo que el dominio llama `tokenAddress`.
 *
 * ⚠️ **Se llama `CONTRACT` y no `TOKEN` por gitleaks**, que es un gate de CI (`security.yml`),
 * exactamente por el mismo motivo que ya documentan `__tests__/domain/transfer-asset.spec.ts` y la
 * cabecera de `.gitleaksignore`: su regla `generic-api-key` cruza una palabra clave —`TOKEN` está
 * en esa lista— con la entropía de Shannon del literal que sigue, y una dirección Ethereum
 * PÚBLICA da de sobra. Remedido aquí con `gitleaks:v8.30.1 detect --no-git` sobre
 * `src/modules/wallets`: con el nombre `TOKEN` de la tarea, este archivo aporta **un** hallazgo
 * —`generic-api-key`, entropía 3.8855505, línea 25—; renombrado a `CONTRACT`, aporta **cero**.
 *
 * El fallo que evita: el PR se pondría rojo y la salida barata sería un `.gitleaksignore`, que
 * apaga el gate para esa línea y hay que mantener a partir de ahí. Quitar la palabra clave quita
 * la causa.
 *
 * ⚠️ La misma corrida deja **un hallazgo que NO es de este archivo y sigue vivo**:
 * `__tests__/helpers/wallet-transfer.factory.ts:21`, `TRANSFER_CONTRACT`, misma regla y misma
 * entropía. Ese archivo tiene otro dueño (contrato congelado §9) y no se toca desde aquí; queda
 * reportado.
 */
const CONTRACT = '0x782919afc85eea2cb736874225456bb5d3e242ba';

/** El ejemplo del propio proveedor para `amount` en `TransferCustodialWallet`. */
const AMOUNT = '100000';

/**
 * ⚠️ Distinto de `AMOUNT` a propósito, y es lo único que hace que M3 cace un mapper que
 * intercambie `amount` y `tokenId` en la rama del multi-token. Medido cruzando esos dos campos en
 * la rama `multiToken` del mapper: con los dos literales distintos cae **1 caso**, M3
 * (cae **un** caso); igualándolos aquí a `'100000'`, la suite entera vuelve a verde con el
 * mapper roto. Ni P1 ni P2 lo cazan —P1 mira el JUEGO de claves y P2 el MULTICONJUNTO de valores,
 * y un intercambio no cambia ninguno de los dos—, así que este literal es toda la red.
 */
const TOKEN_ID = '42';

describe('mapAssetToTatumFields', () => {
  it('debería traducir un token fungible a contractType 0 con tokenAddress y amount, y sin tokenId', () => {
    // Arrange
    const asset = TransferAsset.fungible({
      token: EthereumAddress.from(CONTRACT),
      amount: TokenAmount.from(AMOUNT),
    });

    // Act
    const fields = mapAssetToTatumFields(asset);

    // Assert
    expect(fields).toEqual({ contractType: 0, tokenAddress: CONTRACT, amount: AMOUNT });
  });

  it('debería traducir un NFT a contractType 1 con tokenAddress y tokenId, y sin amount', () => {
    // Arrange
    const asset = TransferAsset.nft({
      token: EthereumAddress.from(CONTRACT),
      tokenId: TokenId.from(TOKEN_ID),
    });

    // Act
    const fields = mapAssetToTatumFields(asset);

    // Assert
    expect(fields).toEqual({ contractType: 1, tokenAddress: CONTRACT, tokenId: TOKEN_ID });
  });

  it('debería traducir un multi-token a contractType 2 con los tres campos', () => {
    // Arrange
    const asset = TransferAsset.multiToken({
      token: EthereumAddress.from(CONTRACT),
      amount: TokenAmount.from(AMOUNT),
      tokenId: TokenId.from(TOKEN_ID),
    });

    // Act
    const fields = mapAssetToTatumFields(asset);

    // Assert
    expect(fields).toEqual({
      contractType: 2,
      tokenAddress: CONTRACT,
      amount: AMOUNT,
      tokenId: TOKEN_ID,
    });
  });

  it('debería traducir la moneda nativa a contractType 3 con solo amount, sin tokenAddress ni tokenId', () => {
    // Arrange
    const asset = TransferAsset.native({ amount: TokenAmount.from(AMOUNT) });

    // Act
    const fields = mapAssetToTatumFields(asset);

    // Assert
    expect(fields).toEqual({ contractType: 3, amount: AMOUNT });
  });

  describe('mapAssetToTatumFields() (property-based)', () => {
    // ⚠️ Las dos propiedades van con `fc.assert` dentro de un `it` normal, NO con `fcTest.prop`.
    // Es la forma mayoritaria del módulo —medido con `grep -rl "fc\.assert(" src/modules/wallets`:
    // Los únicos LLAMADORES de `fcTest.prop` en el módulo son `wallet.entity.spec.ts` y
    // `wallet-transfer.entity.spec.ts`. El resto de coincidencias de un `grep` por ese nombre
    // son PROSA —comentarios que lo citan, este incluido—, así que la cifra que devuelva el
    // grep no dice nada: crece cada vez que alguien explica la regla. Lo estable son los dos
    // llamadores.
    //
    // Aquí el motivo NO es el de siempre: el gate de mutación no llega a este archivo —medido, los
    // tres patrones de `mutate` en `stryker.config.mjs` apuntan a `domain` y `application` de cada
    // módulo y al kernel `shared/domain`, y ninguno alcanza `infrastructure/`—, así que el
    // emparejamiento por nombre de `coverageAnalysis: 'perTest'` que rompe `@fast-check/jest`
    // (backlog #18) no tiene aquí ninguna consecuencia. Se escribe así por consistencia y porque
    // no cuesta nada; decir que "mata mutantes" sería falso en este archivo.
    it('debería producir siempre el contractType y el juego exacto de claves que su clase permite', () => {
      fc.assert(
        fc.property(transferAssetArb, ({ asset, kind }) => {
          // Arrange
          const expected = TATUM_CONTRACT[kind];

          // Act
          const fields = mapAssetToTatumFields(asset);

          // Assert
          expect(fields.contractType).toBe(expected.contractType);
          expect(Object.keys(fields).sort()).toEqual([...expected.keys].sort());
        }),
      );
    });

    it('debería copiar los valores tal cual los rinde cada value object, sin reformatearlos', () => {
      fc.assert(
        fc.property(transferAssetArb, ({ asset, values }) => {
          // Arrange
          const expected = [...values].sort();

          // Act
          const fields = mapAssetToTatumFields(asset);

          // Assert
          const copied = Object.entries(fields)
            .filter(([key]) => key !== 'contractType')
            .map(([, value]) => String(value))
            .sort();
          expect(copied).toEqual(expected);
        }),
      );
    });
  });
});

// Helpers

/**
 * La tabla de exclusión mutua del proveedor, escrita como DATO y no como código: es la
 * expectativa, y tenerla aquí es lo que impide que la propiedad se vuelva tautológica leyendo el
 * `contractType` que el propio mapper devolvió para decidir qué claves esperar.
 *
 * Los cuatro números y los tres campos salen de `docs/tatum/gas-pump/openapi.json`, esquema
 * `components/schemas/TransferCustodialWallet` —el de la cadena ETH con clave privada, que es la
 * operación que usamos—, leídos y no recordados:
 *
 * - `contractType`: `enum [0, 1, 2, 3]`, «Set `0` for fungible tokens (ERC-20 or equivalent), `1`
 *   for NFTs (ERC-721 or equivalent), `2` for Multi Tokens (ERC-1155 or equivalent), or `3` for
 *   native blockchain currencies.»
 * - `tokenAddress`: «(Only if the asset is a fungible token, NFT, or Multi Token) … Do not use if
 *   the asset is a native blockchain currency.»
 * - `amount`: «(Only if the asset is a fungible token, Multi Token, or native blockchain currency)
 *   … Do not use if the asset is an NFT.»
 * - `tokenId`: «(Only if the asset is a Multi Token or NFT) … Do not use if the asset is a
 *   fungible token or native blockchain currency.»
 *
 * ⚠️ El esquema del `approve` (`ApproveTransferCustodialWallet`) declara `enum [0, 1, 2]` — sin el
 * `3` — y el de Tron `[0, 1, 3]` — sin el `2`. Ninguno de los dos es el nuestro, y copiar de ellos
 * habría dejado una clase fuera.
 *
 * Está indexada por `TransferAssetKind`, así que la entrada del multi-token se escribe con el
 * literal del vocabulario, `'multi-token'` con guion, y NO con la clave `multiToken` del matcher.
 */
const TATUM_CONTRACT = {
  native: { contractType: 3, keys: ['contractType', 'amount'] },
  fungible: { contractType: 0, keys: ['contractType', 'tokenAddress', 'amount'] },
  nft: { contractType: 1, keys: ['contractType', 'tokenAddress', 'tokenId'] },
  'multi-token': {
    contractType: 2,
    keys: ['contractType', 'tokenAddress', 'amount', 'tokenId'],
  },
} as const satisfies Record<TransferAssetKind, { contractType: number; keys: readonly string[] }>;
