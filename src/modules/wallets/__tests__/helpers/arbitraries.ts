import fc from 'fast-check';

import {
  PROVIDER_FAILURE_REASONS,
  type ProviderFailureReason,
} from '../../domain/errors/wallet.errors';

/**
 * Arbitrarios del módulo `wallets`. Todos están **construidos** — `fc.constantFrom`, `fc.array`
 * de dígitos, `fc.tuple` + `map` —, nunca filtrados de `fc.string()`: un filtro descartaría
 * prácticamente todo lo generado y fast-check acabaría abortando la propiedad por exceso de
 * descartes.
 *
 * Ninguno de los que nacen aquí importa un value object: todos producen cadenas y números sueltos,
 * y por eso el archivo puede nacer entero en la primera tarea del módulo sin arrastrar a ninguna
 * otra.
 *
 * ⚠️ Los dos arbitrarios que SÍ necesitan código de más adelante se añaden en la tarea que crea esa
 * dependencia: `transferAssetArb` en la Task 8 (construye `TransferAsset` y tres value objects) y
 * `pageArb` / `limitArb` en la Task 16. Adelantarlos aquí rompería la suite de esta misma tarea,
 * que importa este archivo, con `Cannot find module`.
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
