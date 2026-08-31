import fc from 'fast-check';

import {
  PROVIDER_FAILURE_REASONS,
  type ProviderFailureReason,
} from '../../domain/errors/wallet.errors';
import { TransferAsset, type TransferAssetKind } from '../../domain/transfer-asset';
import { EthereumAddress } from '../../domain/value-objects/ethereum-address.vo';
import { TokenAmount } from '../../domain/value-objects/token-amount.vo';
import { TokenId } from '../../domain/value-objects/token-id.vo';

/**
 * Arbitrarios del módulo `wallets`. Todos están **construidos** — `fc.constantFrom`, `fc.array`
 * de dígitos, `fc.tuple` + `map` —, nunca filtrados de `fc.string()`: un filtro descartaría
 * prácticamente todo lo generado y fast-check acabaría abortando la propiedad por exceso de
 * descartes.
 *
 * Ninguno de los que abren el archivo importa un value object: producen cadenas y números sueltos,
 * y por eso pudieron nacer todos con el módulo, sin arrastrar a ninguna otra pieza.
 *
 * El último bloque, `transferAssetArb`, es el primero que rompe esa regla —construye
 * `TransferAsset` y tres value objects— y por eso llegó después: escrito antes de que existiera
 * `../../domain/transfer-asset`, habría tumbado con `Cannot find module` a `wallet.errors.spec.ts`,
 * que importa este archivo desde el primer día del módulo.
 *
 * ⚠️ Todavía faltan por llegar `pageArb` / `limitArb`, que acompañarán al listado paginado
 * (`list-wallet-transfers.use-case.spec.ts`, aún no en el árbol). Esos dos no dependen de nada:
 * están pendientes por calendario, no por un `import`.
 */

const HEX_DIGITS = '0123456789abcdefABCDEF';

/** `length` hexadecimales con mayúsculas y minúsculas mezcladas a voluntad. */
const hexArb = (length: number): fc.Arbitrary<string> =>
  fc
    .array(fc.constantFrom(...HEX_DIGITS.split('')), { minLength: length, maxLength: length })
    .map((chars) => chars.join(''));

/** Cadenas de dígitos decimales de longitud acotada. */
const digitsArb = (min: number, max: number): fc.Arbitrary<string> =>
  fc
    .array(fc.integer({ min: 0, max: 9 }), { minLength: min, maxLength: max })
    .map((digits) => digits.join(''));

/** Enteros canónicos distintos de cero: `1`, `907`, `10000000000000000000`. */
const nonZeroIntegerArb = fc
  .tuple(fc.integer({ min: 1, max: 9 }), digitsArb(0, 30))
  .map(([head, tail]) => `${head}${tail}`);

/** `0.` seguido de una fracción que SIEMPRE acaba en un dígito no nulo, así que no es cero. */
const zeroIntegerAmountArb = fc
  .tuple(digitsArb(0, 10), fc.integer({ min: 1, max: 9 }))
  .map(([head, last]) => `0.${head}${last}`);

/**
 * Los motivos salen de la lista CERRADA de `wallet.errors.ts`, no de una copia escrita a mano:
 * copiarla haría que añadir un motivo dejara la propiedad P2 sin cubrirlo, en verde y en
 * silencio.
 */
export const providerFailureReasonArb: fc.Arbitrary<ProviderFailureReason> = fc.constantFrom(
  ...PROVIDER_FAILURE_REASONS,
);

/** Cualquier status de error que el proveedor puede devolver. */
export const providerStatusArb = fc.integer({ min: 400, max: 599 });

/** Direcciones que `EthereumAddress.from()` acepta: `0x` + 40 hexadecimales. */
export const ethereumAddressArb = hexArb(40).map((hex) => `0x${hex}`);

/** Hashes que `TransactionHash.from()` acepta: `0x` + 64 hexadecimales. */
export const transactionHashArb = hexArb(64).map((hex) => `0x${hex}`);

/** La mitad NO NEGATIVA del rango de la columna `integer` de PostgreSQL: los índices nunca lo son. */
export const addressIndexArb = fc.integer({ min: 0, max: 2_147_483_647 });

/** Importes que `TokenAmount.from()` acepta: canónicos, sin signo y distintos de cero. */
export const tokenAmountArb = fc.oneof(
  fc
    .tuple(nonZeroIntegerArb, fc.option(digitsArb(1, 18), { nil: undefined }))
    .map(([integer, fraction]) => (fraction === undefined ? integer : `${integer}.${fraction}`)),
  zeroIntegerAmountArb,
);

/** Importes que solo contienen ceros: `0`, `0.0`, `0.000…`. Todos deben ser rechazados. */
export const allZeroAmountArb = fc
  .nat({ max: 30 })
  .map((decimals) => (decimals === 0 ? '0' : `0.${'0'.repeat(decimals)}`));

/** Ids que `TokenId.from()` acepta, `"0"` incluido — la asimetría deliberada con el importe. */
export const tokenIdArb = fc.oneof(
  fc.constant('0'),
  fc
    .tuple(fc.integer({ min: 1, max: 9 }), digitsArb(0, 77))
    .map(([head, tail]) => `${head}${tail}`),
);

/** Ids con al menos un cero a la izquierda: `01`, `007`, `0009`. Todos deben ser rechazados. */
export const leadingZeroTokenIdArb = fc
  .tuple(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 9 }), digitsArb(0, 20))
  .map(([zeros, head, tail]) => `${'0'.repeat(zeros)}${head}${tail}`);

/**
 * Un activo de una de las cuatro clases, con el rastro de cómo se construyó: la clase con la que se
 * pidió —el literal del vocabulario, o sea `'multi-token'` CON GUION— y los valores que lleva
 * dentro, en el orden en que los recibe su factoría.
 *
 * `values` existe para que quien pruebe el mapper compare lo que copió contra lo que el activo
 * lleva dentro **sin volver a leerlo del propio activo**: leerlo de ahí sería reimplementar el
 * mapper dentro de su test, y un mapper que reformatease un valor seguiría verde.
 *
 * ⚠️ Los valores salen de `.value` del value object ya construido, **nunca de la cadena cruda que
 * generó el arbitrario**. `EthereumAddress.from()` normaliza a minúsculas y `ethereumAddressArb`
 * produce hexadecimal con las dos cajas mezcladas, así que con la cadena cruda la propiedad se
 * pondría roja en cuanto el generador sacase una mayúscula, culpando al mapper de una normalización
 * que hizo el dominio.
 */
export type TransferAssetSample = {
  asset: TransferAsset;
  kind: TransferAssetKind;
  values: readonly string[];
};

const nativeAssetArb: fc.Arbitrary<TransferAssetSample> = tokenAmountArb.map((rawAmount) => {
  const amount = TokenAmount.from(rawAmount);
  return { asset: TransferAsset.native({ amount }), kind: 'native', values: [amount.value] };
});

const fungibleAssetArb: fc.Arbitrary<TransferAssetSample> = fc
  .tuple(ethereumAddressArb, tokenAmountArb)
  .map(([rawToken, rawAmount]) => {
    const token = EthereumAddress.from(rawToken);
    const amount = TokenAmount.from(rawAmount);
    return {
      asset: TransferAsset.fungible({ token, amount }),
      kind: 'fungible',
      values: [token.value, amount.value],
    };
  });

const nftAssetArb: fc.Arbitrary<TransferAssetSample> = fc
  .tuple(ethereumAddressArb, tokenIdArb)
  .map(([rawToken, rawTokenId]) => {
    const token = EthereumAddress.from(rawToken);
    const tokenId = TokenId.from(rawTokenId);
    return {
      asset: TransferAsset.nft({ token, tokenId }),
      kind: 'nft',
      values: [token.value, tokenId.value],
    };
  });

const multiTokenAssetArb: fc.Arbitrary<TransferAssetSample> = fc
  .tuple(ethereumAddressArb, tokenAmountArb, tokenIdArb)
  .map(([rawToken, rawAmount, rawTokenId]) => {
    const token = EthereumAddress.from(rawToken);
    const amount = TokenAmount.from(rawAmount);
    const tokenId = TokenId.from(rawTokenId);
    return {
      asset: TransferAsset.multiToken({ token, amount, tokenId }),
      kind: 'multi-token',
      values: [token.value, amount.value, tokenId.value],
    };
  });

/**
 * Las cuatro clases, cada una construida por su factoría y compuesta a partir de los arbitrarios de
 * dirección, importe e id que ya viven arriba en este mismo archivo. Reutilizarlos es lo que hace
 * que endurecer un value object llegue solo a estas propiedades: un `TokenAmount` más estricto
 * cambia `tokenAmountArb` y con él las cuatro ramas, sin tocar nada más.
 *
 * ⚠️ Nadie lo consume todavía: su cliente es el spec del mapper del activo
 * (`__tests__/infrastructure/gateways/tatum-asset.mapper.spec.ts`, aún no en el árbol), así que
 * hoy este arbitrario NO está ejercitado por ninguna aserción — solo compilado. Es andamio
 * publicado por adelantado, no cobertura.
 */
export const transferAssetArb: fc.Arbitrary<TransferAssetSample> = fc.oneof(
  nativeAssetArb,
  fungibleAssetArb,
  nftAssetArb,
  multiTokenAssetArb,
);
