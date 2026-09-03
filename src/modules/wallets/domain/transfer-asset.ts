import {
  AssetFieldNotAllowedError,
  MissingAssetFieldError,
  UnknownAssetKindError,
} from './errors/wallet.errors';
import { EthereumAddress } from './value-objects/ethereum-address.vo';
import { TokenAmount } from './value-objects/token-amount.vo';
import { TokenId } from './value-objects/token-id.vo';

/**
 * Vocabulario cerrado de clases de activo. Vive aquí, junto a la clase que lo hace cumplir, y no
 * en un archivo aparte: el literal y las cuatro ramas de `match()` describen la misma partición y
 * tienen que cambiar a la vez.
 *
 * ⚠️ **`'multi-token'` va CON GUION.** El contrato congelado §1 lo fija como el literal único para
 * el dominio, los mappers, los dos DTO, el ejemplo de OpenAPI y la columna `asset_kind`; no existe
 * `'multitoken'`.
 *
 * ⚠️ **Aquí vivía un recuento de archivos y se ha quitado, no actualizado.** Decía «diez» y ya
 * valía once el día que se escribió; con `wallet-transfer.orm-entity.ts` y su mapper de
 * persistencia son trece. Un inventario de este literal caduca cada vez que alguien añade un
 * archivo que lo menciona —incluido un comentario como este, que el propio `grep` se cuenta—, así
 * que el número no era el dato: el dato es que ninguna de esas escrituras puede divergir en
 * silencio, y eso lo sostienen el getter `kind` y el tipo del arbitrario, medidos justo debajo.
 *
 * Esta lista, el `kind` de `TransferAssetState` y el catálogo de arbitrarios son **tres escrituras
 * del mismo literal**, y quien las ata son el getter `kind` y el tipo del arbitrario. Medido
 * escribiendo `multitoken` aquí, `tsc` saca **DOS** `TS2322` —`transfer-asset.ts(206,5)`, el
 * getter, y `arbitraries.ts(152,7)`, el catálogo— y Jest tumba exactamente un caso del módulo, el
 * F23, con cae **un** caso.
 *
 * ⚠️ La cuenta cambió DENTRO de esta misma tarea: eran dos escrituras y un solo `TS2322` hasta que
 * el catálogo de arbitrarios entró unos pasos después. Un inventario medido caduca cuando alguien
 * añade el archivo número tres, así que lo que aquí importa no es el número sino la propiedad:
 * ninguna de esas escrituras puede divergir en silencio.
 *
 * La clave del matcher, en cambio, es `multiToken` en camelCase porque es un identificador de
 * TypeScript: son cosas distintas y las dos son correctas en su sitio.
 */
export const TRANSFER_ASSET_KINDS = ['native', 'fungible', 'nft', 'multi-token'] as const;
export type TransferAssetKind = (typeof TRANSFER_ASSET_KINDS)[number];

/**
 * El estado interno, con una variante por clase de activo. **No se exporta**, y eso es la mitad de
 * la nominalidad: sin este tipo a mano, nadie de fuera puede ni siquiera nombrar el argumento del
 * constructor. Lo que sale de aquí es la clase, no su forma.
 */
type TransferAssetState =
  | { kind: 'native'; amount: TokenAmount }
  | { kind: 'fungible'; token: EthereumAddress; amount: TokenAmount }
  | { kind: 'nft'; token: EthereumAddress; tokenId: TokenId }
  | { kind: 'multi-token'; token: EthereumAddress; amount: TokenAmount; tokenId: TokenId };

/**
 * Una función por rama, cada una recibiendo SOLO los valores que su clase tiene, y **posicionales**
 * (contrato congelado §5): el adaptador no puede leer un `amount` en la rama del NFT porque esa
 * rama no lo recibe.
 *
 * ⚠️ **Este tipo se escribe a mano y NO se deriva de `TransferAssetState`**, así que una quinta
 * clase no rompe los `match()` del árbol de golpe: los rompe en el segundo paso de una cadena de
 * tres. Medido con `pnpm typecheck`, añadiendo una variante `{ kind: 'erc777'; amount: TokenAmount }`:
 *
 * 1. Solo en `TransferAssetState` → **dos rojos, los dos en este archivo**: TS2366 en `match()`
 *    (ver su JSDoc) y `TS2322: Type '… | "erc777"' is not assignable to type '"native" |
 *    "fungible" | "nft" | "multi-token"'` en el getter `kind`. Los dos `match()` del árbol siguen
 *    compilando.
 * 2. Añadiendo además la clave aquí y su `case` → ahí sí caen los dos: `transfer-asset.spec.ts:
 *    error TS2741: Property 'erc777' is missing in type '{ native: …; fungible: …; nft: …;
 *    multiToken: …; }' but required in type 'TransferAssetMatchers<void>'` (el objeto anotado de
 *    F5) y `error TS2345: … Property 'erc777' is missing …` (el `describeAsset` de los helpers).
 * 3. Añadiendo el literal a `TRANSFER_ASSET_KINDS` se apaga el TS2322 y el rojo se muda a Jest,
 *    donde el caso F23 lo espera.
 *
 * O sea: quien obliga a pasar por el paso 2 es el paso 1, y el paso 1 es local a este archivo. La
 * garantía sigue siendo de compilación, pero no es «todo el árbol a la vez».
 */
export type TransferAssetMatchers<TResult> = {
  native: (amount: TokenAmount) => TResult;
  fungible: (token: EthereumAddress, amount: TokenAmount) => TResult;
  nft: (token: EthereumAddress, tokenId: TokenId) => TResult;
  multiToken: (token: EthereumAddress, amount: TokenAmount, tokenId: TokenId) => TResult;
};

/**
 * Las partes en crudo, tal como llegan del DTO. `kind` es `string` a propósito — ver `fromParts`.
 *
 * ⚠️ La dirección del contrato se llama **`tokenAddress`**, igual que la columna `token_address` y
 * que el campo del snapshot de `WalletTransfer` (contrato congelado §4 y §8). Las dos piezas ya existen:
 * `infrastructure/persistence/wallet-transfer.orm-entity.ts` y la migración que crea las dos
 * tablas del módulo. Las factorías, que reciben value objects ya construidos y no
 * partes, la llaman `token`.
 */
export type TransferAssetParts = {
  kind: string;
  tokenAddress?: string;
  amount?: string;
  tokenId?: string;
};

/**
 * El activo a transferir. El proveedor exige exclusión mutua entre `tokenAddress`, `amount` y
 * `tokenId` según el `contractType`, y esta clase la hace **imposible de incumplir**.
 *
 * ⚠️ **Una unión discriminada suelta no basta, y está medido.** TypeScript es estructural y el
 * chequeo de propiedades sobrantes solo se aplica a literales *frescos*, así que con una variable
 * intermedia la combinación ilegal COMPILA. Medido con `tsc 6.0.3 --noEmit --strict` sobre esta
 * sonda, que sale **sin un solo error**:
 *
 * ```ts
 * type Suelta = { kind: 'native'; amount: string } | { kind: 'nft'; tokenId: string };
 * const x = { kind: 'native' as const, amount: '1', tokenId: '42' };
 * const ilegal: Suelta = x;   // ← acepta un nativo CON tokenId
 * ```
 *
 * El campo privado `state` es lo que hace la clase nominal y cierra esa puerta; el caso F20 de
 * `transfer-asset.spec.ts` lo fija con dos `@ts-expect-error`, que **solo `pnpm typecheck`
 * comprueba** — SWC borra los tipos, así que `pnpm test` los ignora.
 *
 * ⚠️ **No extiende `ValueObject`, y por eso vive suelta en `domain/` y no en `value-objects/`.**
 * `ValueObject.equals` compara con `===`, que sobre un objeto es identidad de referencia, y
 * `toString()` daría `[object Object]`: heredar obligaría a sobreescribir las dos únicas cosas que
 * la base aporta. La salida es **no escribir `equals` en absoluto**, porque ningún caso de uso
 * compara dos activos.
 *
 * **El dominio no conoce los números `0`, `1`, `2` y `3`.** Son el `contractType` del contrato del
 * proveedor, no un concepto del negocio: la traducción vive en el adaptador
 * `infrastructure/gateways/tatum-asset.mapper.ts`, una rama de `match()` por clase. Ese archivo
 * es el único sitio de PRODUCCIÓN donde se escriben esos cuatro números; fuera de él solo los
 * escriben tests. Un `grep` por `contractType` devuelve además su spec, el del adaptador y este
 * mismo comentario, así que la CIFRA que dé no significa nada — se caza a sí misma y crece cada
 * vez que alguien explica la regla.
 */
export class TransferAsset {
  private constructor(private readonly state: TransferAssetState) {}

  static native(parts: { amount: TokenAmount }): TransferAsset {
    return new TransferAsset({ kind: 'native', amount: parts.amount });
  }

  static fungible(parts: { token: EthereumAddress; amount: TokenAmount }): TransferAsset {
    return new TransferAsset({ kind: 'fungible', token: parts.token, amount: parts.amount });
  }

  static nft(parts: { token: EthereumAddress; tokenId: TokenId }): TransferAsset {
    return new TransferAsset({ kind: 'nft', token: parts.token, tokenId: parts.tokenId });
  }

  static multiToken(parts: {
    token: EthereumAddress;
    amount: TokenAmount;
    tokenId: TokenId;
  }): TransferAsset {
    return new TransferAsset({
      kind: 'multi-token',
      token: parts.token,
      amount: parts.amount,
      tokenId: parts.tokenId,
    });
  }

  /**
   * ⚠️ Acepta la clase como `string`, **no** como el union estrecho, y esa es la lección medida con
   * `invalid-profile`: hay entradas que pasan el DTO y mueren en el dominio. Con `kind:
   * TransferAssetKind` el compilador da el `switch` por agotado y **deja de pedir nada al final**:
   * medido con `tsc --noEmit --strict` sobre una función así, compila igual con `default` y sin él
   * —TypeScript no marca el `default` sobrante ni echa en falta el que no está—. O sea que el
   * único aviso desaparece justo donde hace falta, y una clase que llegue de HTTP fuera del union
   * sale por el final devolviendo `undefined` (medido en Node con ese mismo `switch`): un 500
   * donde tocaba un 400. Con `string`, el `default` es alcanzable de verdad y lanza.
   *
   * El campo PROHIBIDO se comprueba antes que el obligatorio: con un cuerpo que a la vez omite un
   * campo y lleva uno de más, «te sobra tokenId» señala el error real —el cliente eligió la clase
   * equivocada— mientras que «te falta amount» le manda a completar una forma que ya estaba mal.
   * Es una decisión, no una medición, y el caso F18 la fija para que no cambie por accidente.
   *
   * Los value objects se construyen DESPUÉS de las dos comprobaciones de forma, y ese orden
   * también se ve: F19 llega hasta `TokenAmount.from('01')` porque sus campos ya eran los
   * correctos, y ahí el error que sale es el del value object, no uno de este archivo.
   */
  static fromParts(parts: TransferAssetParts): TransferAsset {
    switch (parts.kind) {
      case 'native':
        TransferAsset.forbiddenField(parts.kind, 'tokenAddress', parts.tokenAddress);
        TransferAsset.forbiddenField(parts.kind, 'tokenId', parts.tokenId);
        return TransferAsset.native({
          amount: TokenAmount.from(TransferAsset.requiredField(parts.kind, 'amount', parts.amount)),
        });
      case 'fungible':
        TransferAsset.forbiddenField(parts.kind, 'tokenId', parts.tokenId);
        return TransferAsset.fungible({
          token: EthereumAddress.from(
            TransferAsset.requiredField(parts.kind, 'tokenAddress', parts.tokenAddress),
          ),
          amount: TokenAmount.from(TransferAsset.requiredField(parts.kind, 'amount', parts.amount)),
        });
      case 'nft':
        TransferAsset.forbiddenField(parts.kind, 'amount', parts.amount);
        return TransferAsset.nft({
          token: EthereumAddress.from(
            TransferAsset.requiredField(parts.kind, 'tokenAddress', parts.tokenAddress),
          ),
          tokenId: TokenId.from(TransferAsset.requiredField(parts.kind, 'tokenId', parts.tokenId)),
        });
      case 'multi-token':
        return TransferAsset.multiToken({
          token: EthereumAddress.from(
            TransferAsset.requiredField(parts.kind, 'tokenAddress', parts.tokenAddress),
          ),
          amount: TokenAmount.from(TransferAsset.requiredField(parts.kind, 'amount', parts.amount)),
          tokenId: TokenId.from(TransferAsset.requiredField(parts.kind, 'tokenId', parts.tokenId)),
        });
      default:
        throw new UnknownAssetKindError(parts.kind);
    }
  }

  /** Lo que el mapper escribirá en `asset_kind` y el DTO publicará, sin obligar a hacer un `match()`. */
  get kind(): TransferAssetKind {
    return this.state.kind;
  }

  /**
   * Entrega los valores ya estrechados por rama. **Sin `default` a propósito**: el `switch` es
   * exhaustivo sobre la unión, así que una quinta clase deja el final de la función alcanzable y
   * el compilador la pone roja. Medido añadiendo una variante `{ kind: 'erc777'; … }` a
   * `TransferAssetState` y corriendo `pnpm typecheck`:
   * `transfer-asset.ts(…): error TS2366: Function lacks ending return statement and return type`
   * `does not include 'undefined'.`
   *
   * ⚠️ Quien la caza es **`strict`** (por el tipo de retorno declarado `TResult`, que no incluye
   * `undefined`), **no `noImplicitReturns`** —que es lo que decía el plan—: medido corriendo el
   * mismo mutante contra un `tsconfig` que hereda del nuestro con `noImplicitReturns: false`, y el
   * TS2366 sigue ahí igual. Sin la anotación de retorno el rojo sería el TS7030 de esa otra
   * bandera; con ella, la red la sostiene `strict`.
   *
   * Con un `default` que lanzara, esa red desaparecería: la quinta clase compilaría y el fallo se
   * mudaría al runtime.
   */
  match<TResult>(matchers: TransferAssetMatchers<TResult>): TResult {
    const state = this.state;
    switch (state.kind) {
      case 'native':
        return matchers.native(state.amount);
      case 'fungible':
        return matchers.fungible(state.token, state.amount);
      case 'nft':
        return matchers.nft(state.token, state.tokenId);
      case 'multi-token':
        return matchers.multiToken(state.token, state.amount, state.tokenId);
    }
  }

  /**
   * ⚠️ Los parámetros de este helper van (clase, campo) y los del error van **(campo, clase)**. La
   * inversión es deliberada en el error —ver su JSDoc en `wallet.errors.ts`— y los dos son
   * `string`, así que invertirlos compila y publica el mensaje al revés sin que nada avise. Este
   * archivo es el único de `src/` fuera de los tests que construye `MissingAssetFieldError` y
   * `AssetFieldNotAllowedError` —medido con
   * `grep -rn "new MissingAssetFieldError\|new AssetFieldNotAllowedError" src/`, que solo devuelve
   * este archivo y `wallet.errors.spec.ts`—, así que es el único sitio donde la inversión puede
   * colarse. Y se cuela en verde para el compilador: medido invirtiendo los dos argumentos en las
   * dos llamadas de abajo, `tsc --noEmit` **no dice nada** y quien la caza es la suite, con
   * caen **9** casos en el módulo — los siete casos puntuales de mensaje exacto (F12-F18)
   * más las propiedades P2 y P3.
   */
  private static requiredField(kind: string, field: string, value: string | undefined): string {
    if (value === undefined) {
      throw new MissingAssetFieldError(field, kind);
    }
    return value;
  }

  /** Mismo cruce de orden que `requiredField`, y por la misma razón. */
  private static forbiddenField(kind: string, field: string, value: string | undefined): void {
    if (value !== undefined) {
      throw new AssetFieldNotAllowedError(field, kind);
    }
  }
}
