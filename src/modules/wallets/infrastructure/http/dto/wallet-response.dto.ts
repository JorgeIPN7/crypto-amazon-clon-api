import { ApiProperty } from '@nestjs/swagger';

import type { Wallet } from '../../../domain/entities/wallet.entity';
import { WALLET_STATUSES, type WalletStatus } from '../../../domain/wallet-status';

/**
 * `kind` es vocabulario del TRANSPORTE y por eso sí se declara aquí: el dominio no conoce la
 * master —no tiene fila en `wallets`— y esta distinción solo existe en la respuesta. Los estados,
 * en cambio, se importan de `domain/wallet-status.ts`, que es su única fuente.
 */
export const WALLET_KINDS = ['master', 'custodial'] as const;
export type WalletKind = (typeof WALLET_KINDS)[number];

/**
 * ⚠️ **`oneOf` con `type: 'null'`, y NO `nullable: true`.** El motivo NO es el que parece.
 *
 * Lo que se lee por ahí —y lo que este comentario decía antes de medirlo— es que Ajv ignora
 * `nullable`, así que un `index: null` real fallaría los dos guardianes. **Es falso**, y por eso
 * se corrige aquí en vez de repetirse: medido con el mismo `ajv/dist/2020` y las mismas opciones
 * que usan `openapi-contract.e2e-spec.ts` y `openapi-runtime-contract.e2e-spec.ts`
 * (`{ strict: false, allErrors: true }`, `ajv@8.20.0`), `{ type: 'integer', nullable: true }`
 * **acepta `null`** y sigue rechazando `'x'` con `must be integer`. Ajv implementa `nullable`
 * como extensión de OpenAPI en cualquier modo. Lo que la cabecera de `openapi-contract.e2e-spec.ts`
 * dice —«NO detecta `nullable`»— es otra cosa: que el guardián no señala la divergencia 3.0/3.1
 * como defecto del documento, no que valide mal.
 *
 * Las DOS razones reales, las dos medidas con el mismo Ajv y con el `SchemaObjectFactory` de
 * `@nestjs/swagger@11.4.7`:
 *
 * 1. **`nullable` NO sobrevive junto a `enum`, y este módulo tiene justo ese campo.**
 *    `{ type: 'string', enum: ['a','b'], nullable: true }` valida `null` como **false**: el
 *    `enum` sigue constriñendo el valor y `null` no está en la lista. El `reason` de
 *    `wallet-transfer-response.dto.ts` es exactamente esa forma —`PROVIDER_FAILURE_REASONS` y
 *    nulo mientras no falle nada—, así que con `nullable` la respuesta real fallaría el guardián
 *    de runtime con `must be equal to one of the allowed values`. Con
 *    `oneOf: [{ type:'string', enum:[…] }, { type:'null' }]` da **true** para `null`, **true**
 *    para `'a'` y **false** para `'z'`.
 * 2. **`nullable` sin un `type:` explícito publica `type: 'object'` en silencio.** El
 *    `design:type` de un campo `string | null` es `Object`, y `createPropertyDecorator` lo mete
 *    en la metadata cuando el autor no pone `type`. Medido pasando la clase por
 *    `SchemaObjectFactory.exploreModelSchema`: con `{ nullable: true }` sale
 *    `{"type":"object","nullable":true,…}` —un esquema que rechazaría la cadena que el servidor
 *    devuelve de verdad—, mientras que con `oneOf` sale `{"oneOf":[…]}` **sin `type`**, porque
 *    `extractPropertiesFromType` borra el `type` reflejado cuando el autor declaró un
 *    combinador. `oneOf` no tiene esa trampa; `nullable` obliga a acertar un `type:` por campo.
 *
 * ⚠️ **El precio, dicho sin adornos: `type: 'null'` es vocabulario de JSON Schema 2020-12 y NO es
 * válido en OpenAPI 3.0**, que es la versión que el documento declara. Ningún guardián lo caza
 * —`null` sí es un tipo legal del meta-esquema 2020-12 contra el que Ajv compila—, así que esto
 * es una desviación consciente del dialecto publicado y un generador de SDK estricto con 3.0
 * puede atragantarse con estos cuatro campos. Se acepta porque la alternativa rompe el campo
 * `reason` de verdad, hoy, en un gate que sí corre.
 *
 * El parámetro y el retorno son `Record<string, unknown>` y eso **no** apaga el control de
 * propiedades sobrantes del decorador: medido escribiendo `exemple:` junto a este spread, `tsc`
 * saca `TS2561: Object literal may only specify known properties, but 'exemple' does not exist in
 * type 'ApiPropertyOptions'`. El índice del spread solo cubre las claves que aporta la función.
 */
const nullableOf = (schema: Record<string, unknown>): Record<string, unknown> => ({
  oneOf: [schema, { type: 'null' }],
});

/**
 * Respuesta de `POST /wallets` y de `GET /wallets/me`.
 *
 * Un solo DTO con discriminador `kind` y no dos: el admin sí tiene dirección —la master, la que
 * sostiene el gas de todo el sistema— y responderle 404 sería mentira a medias. Lo que no tiene
 * es fila en `wallets`, y por eso `id`, `index` y `activationTxId` son nulos en ese caso.
 *
 * **No publica marcas de tiempo.** La master no tiene fila, así que cualquier campo que ella no
 * pueda rellenar tendría que salir nullable para todos; un `createdAt` que es nulo la mitad de
 * las veces vale menos que no publicarlo.
 *
 * ⚠️ **`ownerAddress` NO está entre los siete campos, y esa ausencia es la decisión.** Es la EOA
 * que paga todo el gas del sistema; publicarla en la respuesta de cada usuario la repartiría a
 * cualquiera con una cuenta, y una dirección repartida no se retira. Existe en el agregado porque
 * `assertOwnedBy` la necesita, no para salir por la API. Lo que sostiene la ausencia es el caso
 * «debería exponer solo los campos del DTO», que compara la lista COMPLETA de claves con `toEqual`
 * —no una pertenencia—, así que un campo nuevo lo pone rojo aunque nadie se acuerde de esta nota.
 */
export class WalletResponseDto {
  @ApiProperty({
    description:
      'Qué clase de dirección es. `custodial` es una gas pump address derivada; `master` es la ' +
      'EOA de la plataforma, que solo ve el rol admin.',
    enum: [...WALLET_KINDS],
    example: 'custodial',
  })
  kind!: WalletKind;

  @ApiProperty({
    description: 'Identificador de la wallet. Nulo para la master, que no tiene fila propia.',
    ...nullableOf({ type: 'string', format: 'uuid' }),
    example: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  })
  id!: string | null;

  @ApiProperty({
    description: 'Dueño de la dirección: siempre el `sub` del token.',
    example: '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012',
    format: 'uuid',
  })
  ownerId!: string;

  @ApiProperty({
    description: 'La dirección, en minúsculas. Es la que hay que usar para recibir fondos.',
    example: '0x687422eea2cb73b5d3e242ba5456b782919afc85',
  })
  address!: string;

  @ApiProperty({
    description:
      'Índice con el que se derivó la dirección bajo la master. Nulo para la master, que no se ' +
      'deriva de ningún índice.',
    ...nullableOf({ type: 'integer', minimum: 0 }),
    example: 7,
  })
  index!: number | null;

  @ApiProperty({
    description:
      'Capacidad actual de la dirección. `receive-only` recibe pero no envía; `activating` ' +
      'tiene una activación enviada y no confirmada; `active` puede enviar. ⚠️ Este endpoint no ' +
      'reconcilia con la cadena, así que el estado puede ir por detrás: para saberlo con ' +
      'certeza, llama al endpoint de activación, que sí consulta al proveedor.',
    enum: [...WALLET_STATUSES],
    example: 'active',
  })
  status!: WalletStatus;

  @ApiProperty({
    description:
      'Hash de la transacción de activación. Puede seguir nulo con la dirección ya `active`: ' +
      'la cadena puede confirmarlo sin que nosotros hayamos llegado a guardar el hash.',
    ...nullableOf({ type: 'string' }),
    example: '0xc83f8818db43d9ba4accfe454aa44fc33123d47a4f89d47b314d6748eb0e9bc9',
  })
  activationTxId!: string | null;

  /** El dominio nunca se serializa directamente: siempre pasa por este DTO. */
  static fromDomain(wallet: Wallet): WalletResponseDto {
    const snapshot = wallet.toSnapshot();
    const dto = new WalletResponseDto();
    dto.kind = 'custodial';
    dto.id = snapshot.id;
    dto.ownerId = snapshot.ownerId;
    dto.address = snapshot.address;
    dto.index = snapshot.addressIndex;
    dto.status = snapshot.status;
    dto.activationTxId = snapshot.activationTxId;
    return dto;
  }

  /**
   * La EOA del admin, que **no está en la tabla `wallets`** y por eso no puede salir de un
   * agregado. Su `status` es `active` porque una EOA puede enviar desde siempre: no hay contrato
   * que desplegar.
   *
   * ⚠️ Consecuencia operativa que conviene tener escrita: responder «qué direcciones
   * controlamos» exige mirar la tabla **y** la configuración. Quien mire solo la tabla se dejará
   * fuera precisamente la que tiene los fondos de gas.
   */
  static forMaster(ownerId: string, address: string): WalletResponseDto {
    const dto = new WalletResponseDto();
    dto.kind = 'master';
    dto.id = null;
    dto.ownerId = ownerId;
    dto.address = address;
    dto.index = null;
    dto.status = 'active';
    dto.activationTxId = null;
    return dto;
  }
}
