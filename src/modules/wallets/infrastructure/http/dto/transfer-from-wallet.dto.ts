import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

import { TRANSFER_ASSET_KINDS, type TransferAssetKind } from '../../../domain/transfer-asset';
import { IsChecksummedAddress } from '../validators/is-checksummed-address.validator';

/**
 * ⚠️ **La lista de clases de activo se IMPORTA del dominio, no se copia.** Es la misma cadena en
 * el dominio, en el mapper, en la columna `asset_kind` y en este contrato, `multi-token` con guion
 * incluido. (Sin recuento: el JSDoc de `TRANSFER_ASSET_KINDS` explica por qué inventariar los
 * sitios donde aparece el literal caduca en cuanto alguien añade uno, este comentario incluido.)
 * Una segunda lista aquí publicaría un enum que podría divergir del que el dominio acepta, y la
 * divergencia solo se vería el día que alguien añadiera una clase a una de las dos.
 *
 * Lo que sí se mantiene es que la clase viaje al caso de uso como `string`
 * (`TransferAssetParts.kind`): así una clase que este DTO dejara pasar muere en el dominio con
 * `UnknownAssetKindError` → 400 con nombre, en vez de en un `switch` sin rama devolviendo
 * `undefined`, que habría sido un 500 donde tocaba un 400.
 *
 * ⚠️ **Estas tres listas SÍ se escriben aquí, y no se derivan de `TransferAsset.fromParts`.** Son
 * la misma partición vista desde el transporte, y no hay forma de leerlas del dominio: `fromParts`
 * la expresa como un `switch` con llamadas a `requiredField`/`forbiddenField`, no como un dato.
 *
 * El precio es que una quinta clase de activo obliga a tocar los dos archivos, y **el compilador
 * te para, pero NO te trae aquí.** Medido añadiendo `'erc777'` a `TRANSFER_ASSET_KINDS` sin tocar
 * nada más: `npx tsc --noEmit` sale EXIT=2 con **cinco** errores —dos TS2366 en
 * `wallet-transfer.factory.ts` y en `wallet-transfer.entity.spec.ts`, y tres en
 * `tatum-asset.mapper.ts` y su spec (TS1360/TS7053 por el `Record` del `contractType`)— y **ni
 * uno solo apunta a este archivo**. O sea que el rojo global existe, pero quien lo arregle no
 * llega hasta aquí siguiéndolo.
 *
 * ⚠️ **Y tiparlas al union NO lo arreglaría**, para que nadie lo intente creyendo que sí: medido
 * con una sonda de seis líneas —`const NEEDS_AMOUNT: readonly Kind[] = ['fungible',
 * 'multi-token', 'native']` con `'erc777'` ya en `Kind`—, `tsc --noEmit` no dice **nada**. Una
 * lista de literales no se comprueba por exhaustividad; añadir un miembro a una unión no
 * invalida un array de un subconjunto suyo. Lo que sí haría el union es un daño real, y es el
 * motivo de que sean `readonly string[]`: el `dto.kind` que se les pasa **todavía no ha pasado
 * `@IsIn`** —`@ValidateIf` corre sobre el valor crudo del cliente—, así que el tipo estrecho
 * afirmaría de ese valor algo que en tiempo de ejecución no es cierto.
 *
 * Si se olvidaran, el resultado no es un agujero: el borde dejaría pasar un cuerpo sin `amount`
 * y `TransferAsset.fromParts` lo rechazaría con `MissingAssetFieldError` → 400 con nombre. Es
 * degradación —el 400 lo pone el dominio y no el DTO—, el mismo reparto de trabajo que documenta
 * `@ValidateIf` más abajo.
 */
const NEEDS_TOKEN_ADDRESS: readonly string[] = ['fungible', 'nft', 'multi-token'];
const NEEDS_AMOUNT: readonly string[] = ['fungible', 'multi-token', 'native'];
const NEEDS_TOKEN_ID: readonly string[] = ['nft', 'multi-token'];

/**
 * Decimal canónico: sin signo, sin ceros a la izquierda, con parte entera y parte decimal
 * opcional.
 *
 * ⚠️ **Es MÁS estricto que el patrón del proveedor, a propósito.** El suyo, leído en
 * `docs/tatum/gas-pump/openapi.json`, es `^[+]?((\d+(\.\d*)?)|(\.\d+))$` para el importe y
 * `^[+]?\d+$` para el identificador: aceptan `+1`, `.5`, `1.` y `007`. Las cuatro grafías
 * designan el mismo número pero son **cadenas distintas**, y el libro guarda el importe como
 * texto —`amount` es `varchar(79)` y `tokenId` `varchar(78)`, no columnas numéricas, porque 18
 * decimales no pasan por un flotante—, así que dos filas idénticas para el negocio se leerían y
 * se publicarían distintas. Quien impone de verdad la forma canónica es `TokenAmount`; este
 * patrón es el mismo criterio adelantado al borde, no una segunda regla. El `0` sí pasa aquí y
 * muere allí, igual que con `@ValidateIf`: el transporte valida forma, el dominio decide.
 */
const AMOUNT_SHAPE = /^(0|[1-9]\d*)(\.\d+)?$/;
const TOKEN_ID_SHAPE = /^(0|[1-9]\d*)$/;

/**
 * Cuerpo de `POST /wallets/me/transfers`.
 *
 * ⚠️ **`@ValidateIf` hace OBLIGATORIO, no PROHIBIDO, y la diferencia es la que confunde.** Con
 * `whitelist` y `forbidNonWhitelisted` activos, un campo **declarado** en este DTO NO se rechaza
 * aunque su condición sea falsa: la lista blanca de `class-validator` se construye con los nombres
 * de propiedad que tienen metadata de validación —cualquiera, `@ValidateIf` incluida—, así que un
 * envío nativo que traiga `tokenId` pasa el transporte. Medido: el caso «debería aceptar un cuerpo
 * con un campo cuya condición es falsa» de `transfer-from-wallet.dto.spec.ts` afirma exactamente
 * eso con `{ kind: 'native', amount: '1', tokenId: '7' }` → `errors` vacío, y el de al lado
 * comprueba la otra mitad: `fromPrivateKey`, que el DTO NO declara, sí lo rechaza.
 *
 * Y está bien que pase: la exclusividad real entre `tokenAddress`, `amount` y `tokenId` es una
 * invariante de NEGOCIO y vive en `TransferAsset.fromParts`, que la hace imposible por
 * construcción y sale como `AssetFieldNotAllowedError` → 400 por el fallback de
 * `WalletsDomainExceptionFilter`. Meterla aquí sería mantener la misma regla en dos sitios, y el
 * sitio donde el compilador no la puede sostener.
 *
 * No lleva `custodialAddress` ni nada parecido: el origen del envío es la dirección de la wallet
 * del `sub` del token, jamás un dato del cuerpo. Y no lleva —ni podrá llevar— `fromPrivateKey`:
 * la clave de la master no entra por HTTP.
 */
export class TransferFromWalletDto {
  @ApiProperty({
    description:
      'Dirección que recibe el activo. Si viene con mayúsculas y minúsculas mezcladas se ' +
      'verifica su checksum EIP-55; toda en minúsculas se acepta, porque entonces no lleva ' +
      'checksum que comprobar.',
    example: '0xe242ba5456b782919afc85687422eea2cb73b5d3',
    minLength: 42,
    maxLength: 42,
  })
  @IsString()
  @IsChecksummedAddress()
  recipient!: string;

  @ApiProperty({
    description:
      'Clase del activo. Determina qué campos son obligatorios: `native` solo importe; ' +
      '`fungible` token e importe; `nft` token e identificador; `multi-token` los tres.',
    enum: [...TRANSFER_ASSET_KINDS],
    example: 'native',
  })
  @IsIn([...TRANSFER_ASSET_KINDS])
  kind!: TransferAssetKind;

  @ApiPropertyOptional({
    description:
      'Dirección del contrato del token. Obligatoria salvo en `native`, que es moneda nativa ' +
      'de la cadena y no tiene contrato.',
    example: '0x782919afc85eea2cb736874225456bb5d3e242ba',
  })
  @ValidateIf((dto: TransferFromWalletDto) => NEEDS_TOKEN_ADDRESS.includes(dto.kind))
  @IsString()
  @IsChecksummedAddress()
  tokenAddress?: string;

  @ApiPropertyOptional({
    description:
      'Importe a enviar, como cadena decimal canónica. Cadena y no número: un token de 18 ' +
      'decimales no cabe en un flotante sin perder precisión. Obligatorio salvo en `nft`.',
    example: '100000',
    maxLength: 79,
  })
  // ⚠️ **`string` y no `number`, y el motivo está medido en el JSDoc de `TokenAmount`**: los 18
  // decimales de un ERC-20 desbordan el double de JavaScript, y el desbordamiento es SILENCIOSO —
  // `Number('1500000000000000001').toString()` devuelve `'1500000000000000000'`, porque los dos
  // literales son el MISMO double. Un `@IsNumberString()` o un `@Type(() => Number)` aquí
  // enviarían un wei menos sin que nada avisara. El caso «debería rechazar un importe como
  // número» fija que un `amount: 1` del cliente sale 400 en vez de coaccionarse.
  @ValidateIf((dto: TransferFromWalletDto) => NEEDS_AMOUNT.includes(dto.kind))
  @IsString()
  @MaxLength(79)
  @Matches(AMOUNT_SHAPE)
  amount?: string;

  @ApiPropertyOptional({
    description:
      'Identificador del token, entero decimal como cadena. El token `0` existe, así que aquí ' +
      'sí se acepta el cero. Obligatorio en `nft` y en `multi-token`.',
    example: '100000',
    maxLength: 78,
  })
  @ValidateIf((dto: TransferFromWalletDto) => NEEDS_TOKEN_ID.includes(dto.kind))
  @IsString()
  @MaxLength(78)
  @Matches(TOKEN_ID_SHAPE)
  tokenId?: string;
}
