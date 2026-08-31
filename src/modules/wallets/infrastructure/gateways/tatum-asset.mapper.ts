// `import type` es OBLIGATORIO aquí y no contradice la regla de los puertos: este archivo no tiene
// decoradores, `TransferAsset` no es inyectable y no vive en `ports/`, así que
// `consistent-type-imports` EXIGE la forma `type`. Medido con el import de valor:
// `error  All imports in the declaration are only used as types. Use 'import type'`.
import type { TransferAsset, TransferAssetKind } from '../../domain/transfer-asset';

/**
 * Los cuatro números del `contractType` de Tatum. Son un enum del contrato del PROVEEDOR y no un
 * concepto del negocio, por eso el dominio no los conoce y viven aquí.
 *
 * Leídos de `docs/tatum/gas-pump/openapi.json`, esquema `TransferCustodialWallet` —el de la cadena
 * ETH con clave privada, que es la operación que usamos—: `enum [0, 1, 2, 3]`, «Set `0` for
 * fungible tokens (ERC-20 or equivalent), `1` for NFTs (ERC-721 or equivalent), `2` for Multi
 * Tokens (ERC-1155 or equivalent), or `3` for native blockchain currencies.»
 *
 * ⚠️ **No todos sus esquemas declaran los mismos cuatro.** `ApproveTransferCustodialWallet` es
 * `[0, 1, 2]` —sin el nativo— y `TransferCustodialWalletTron` es `[0, 1, 3]` —sin el multi-token—.
 * Copiar el enum del vecino equivocado habría dejado una clase de activo sin número.
 */
export type TatumContractType = 0 | 1 | 2 | 3;

/**
 * Las cuatro formas EXCLUYENTES del cuerpo, una por clase de activo, y no un objeto con tres
 * campos opcionales. Con campos opcionales, `{ contractType: 3, amount, tokenId }` compilaría y la
 * exclusión mutua que el proveedor exige volvería a depender de que nadie se equivoque.
 *
 * Qué campo admite cada clase sale de las descripciones del mismo esquema, no de la simetría:
 * `tokenAddress` «(Only if the asset is a fungible token, NFT, or Multi Token)», `amount` «(Only
 * if the asset is a fungible token, Multi Token, or native blockchain currency)» y `tokenId`
 * «(Only if the asset is a Multi Token or NFT)».
 *
 * ⚠️ **La unión sola NO basta para cerrar el campo de más, y el plan de esta tarea afirmaba que
 * sí** («la rama de la moneda nativa NO TIENE dónde escribir un `tokenId`»). Medido con
 * `pnpm typecheck` escribiendo `tokenId: '0'` en la rama `native` de abajo: sale **en verde**. Y
 * también con `chain: 'ETH'`, un campo que no está en NINGÚN miembro de la unión — verde igual.
 *
 * La causa, aislada en una sonda con `tsc --strict` sobre una unión de dos miembros: el chequeo de
 * propiedades sobrantes se pierde cuando el tipo contextual del literal llega a través de un
 * PARÁMETRO GENÉRICO. `const x: Fields = { …, tokenId }` da `TS2353`; con `chain` en vez de
 * `tokenId` —un campo de ningún miembro— también; una `arrow` con retorno declarado
 * `(): Fields => ({ …, tokenId })` también. La MISMA rama dentro de
 * `match<Fields>({ native: (x) => ({ …, tokenId }) })` **no da nada**, y volviendo a anotarla
 * —`native: (x): Fields => …`— vuelve el `TS2353`.
 *
 * Por eso las cuatro ramas de abajo anotan su retorno: `native: (amount): TatumAssetFields => …`
 * parece redundante junto al `match<TatumAssetFields>` y no lo es. Con la anotación, el mismo
 * `tokenId: '0'` en la rama nativa da:
 *
 *     src/modules/wallets/infrastructure/gateways/tatum-asset.mapper.ts(…): error TS2353: Object
 *     literal may only specify known properties, and 'tokenId' does not exist in type
 *     '{ contractType: 3; amount: string; }'.
 *
 * Lo que la unión SÍ caza sin anotación —medido igual— es el campo que FALTA (`TS2322: Property
 * 'tokenAddress' is missing …`) y el campo con el tipo cambiado (`TS2322: Type 'number' is not
 * assignable to type 'string'`). Lo que se escapaba era solo el campo de más.
 */
export type TatumAssetFields =
  | { contractType: 0; tokenAddress: string; amount: string }
  | { contractType: 1; tokenAddress: string; tokenId: string }
  | { contractType: 2; tokenAddress: string; amount: string; tokenId: string }
  | { contractType: 3; amount: string };

/**
 * ⚠️ El `satisfies Record<TransferAssetKind, …>` es el gate de una quinta clase de activo, y está
 * MEDIDO: añadiendo `'bond'` a `TRANSFER_ASSET_KINDS` en `domain/transfer-asset.ts` y corriendo
 * `pnpm typecheck`, la compilación se rompe AQUÍ y no en producción, con el union ya expandido en
 * el mensaje:
 *
 *     src/modules/wallets/infrastructure/gateways/tatum-asset.mapper.ts(…): error TS1360:
 *     Type '{ readonly native: 3; readonly fungible: 0; readonly nft: 1; readonly 'multi-token':
 *     2; }' does not satisfy the expected type 'Record<"native" | "fungible" | "nft" |
 *     "multi-token" | "bond", TatumContractType>'. Property 'bond' is missing …
 *
 * Sin el `satisfies` el mapa seguiría compilando con cuatro entradas y la clase nueva habría
 * llegado al proveedor sin `contractType`, que es un 400 con los créditos ya gastados. La misma
 * corrida pone rojo también el `TATUM_CONTRACT` del spec, con un TS1360 propio y un TS7053: son
 * dos tablas distintas y ninguna cubre a la otra.
 *
 * ⚠️ **El `as const` NO es lo que sostiene el estrechamiento, y el plan de esta tarea afirmaba
 * que sí.** Medido quitándolo y dejando el `satisfies`: `pnpm typecheck` sale **en verde**, porque
 * el `satisfies` ya aporta el tipo contextual que impide que los valores se ensanchen. Quitando
 * LOS DOS es cuando aparecen los cuatro `TS2322` —uno por rama de `match()`—
 * `Type 'number' is not assignable to type '0 | 1 | 2 | 3'`. O sea: el estrechamiento lo hace el
 * `satisfies`; el `as const` solo añade `readonly`, y se queda por eso y por convención del repo,
 * no porque nada se rompa sin él.
 *
 * La clave del multi-token es `'multi-token'` porque el mapa se indexa por `TransferAssetKind`,
 * que es el vocabulario del dominio. `multiToken`, la otra escritura, es la clave del matcher de
 * `match()` y aparece unas líneas más abajo: son cosas distintas y las dos son correctas.
 */
const CONTRACT_TYPE = {
  native: 3,
  fungible: 0,
  nft: 1,
  'multi-token': 2,
} as const satisfies Record<TransferAssetKind, TatumContractType>;

/**
 * Traduce el vocabulario del dominio al cuerpo del proveedor. Función PURA: no ve la clave
 * privada, no ve la de API y no hace red — por eso se puede probar con igualdad exacta del cuerpo
 * entero y con propiedades, sin levantar nada.
 *
 * La exclusión mutua se cumple POR CONSTRUCCIÓN, no por validación, y son DOS mecanismos, no uno:
 *
 * 1. `match()` es posicional y cada rama recibe solo los value objects de su clase, así que en la
 *    rama del NFT no hay ningún `amount` que copiar — medido: `amount: amount.value` ahí da
 *    `TS2304: Cannot find name 'amount'` (además del TS2353 del punto 2). Es el motivo por el que
 *    `TransferAsset` es una clase con factorías y `match()` en vez de una unión discriminada
 *    suelta.
 * 2. La anotación `: TatumAssetFields` de cada rama cierra el otro flanco, el de copiar un valor
 *    ajeno bajo la clave prohibida: `amount: tokenId.value` en la rama del NFT da
 *    `TS2353: … 'amount' does not exist in type '{ contractType: 1; tokenAddress: string; tokenId:
 *    string; }'` — medido, y **sin la anotación ese mismo código compila**. Ver el JSDoc de
 *    `TatumAssetFields`.
 *
 * ⚠️ **Aquí no vive ninguna invariante del dominio, y eso es deliberado.** `stryker.config.mjs` no
 * muta `infrastructure/`: su `mutate` tiene TRES patrones y ninguno la nombra —los de `domain` y
 * `application` de cada módulo, más el del kernel `shared/domain`—, así que una regla que se
 * mudara a este archivo saldría del denominador y subiría el score sin que nadie probase más. Lo
 * único que hay aquí es la tabla de números del proveedor y una copia campo a campo.
 *
 * (Los patrones no se transcriben literalmente porque llevan `*` seguido de `/`, que cierra este
 * comentario — medido: con la cita literal, `@swc/jest` tumba la suite entera del archivo con
 * `x Expression expected`.)
 */
export const mapAssetToTatumFields = (asset: TransferAsset): TatumAssetFields =>
  asset.match<TatumAssetFields>({
    native: (amount): TatumAssetFields => ({
      contractType: CONTRACT_TYPE.native,
      amount: amount.value,
    }),
    fungible: (token, amount): TatumAssetFields => ({
      contractType: CONTRACT_TYPE.fungible,
      tokenAddress: token.value,
      amount: amount.value,
    }),
    nft: (token, tokenId): TatumAssetFields => ({
      contractType: CONTRACT_TYPE.nft,
      tokenAddress: token.value,
      tokenId: tokenId.value,
    }),
    multiToken: (token, amount, tokenId): TatumAssetFields => ({
      contractType: CONTRACT_TYPE['multi-token'],
      tokenAddress: token.value,
      amount: amount.value,
      tokenId: tokenId.value,
    }),
  });
