import { ApiProperty } from '@nestjs/swagger';

import { TIMESTAMP } from '@common/dto/error-example.factory';

import type { WalletTransfer } from '../../../domain/entities/wallet-transfer.entity';
import {
  PROVIDER_FAILURE_REASONS,
  type ProviderFailureReason,
} from '../../../domain/errors/wallet.errors';
import { TRANSFER_ASSET_KINDS, type TransferAssetKind } from '../../../domain/transfer-asset';
import { TRANSFER_STATUSES, type TransferStatus } from '../../../domain/transfer-status';

/**
 * Mismo criterio, y las mismas dos mediciones, que en `wallet-response.dto.ts` — su JSDoc lleva
 * el detalle. El resumen: Ajv **sí** honra `nullable`, pero deja de hacerlo en cuanto hay un
 * `enum` al lado, y `reason` es exactamente ese caso.
 */
const nullableOf = (schema: Record<string, unknown>): Record<string, unknown> => ({
  oneOf: [schema, { type: 'null' }],
});

/**
 * Una fila del libro de transferencias. La fila se escribe ANTES de llamar al proveedor, así que
 * un timeout deja rastro — que es justo el caso para el que el libro existe.
 *
 * ⚠️ **Este DTO NO traduce `submitting` a `unknown`, y la regla de §3.2 dice que alguien debería.**
 * `list-wallet-transfers.use-case.ts` apuntaba a este archivo como el responsable, así que la
 * decisión se escribe aquí en vez de dejar la promesa colgando: no se aplica porque desde aquí los
 * dos casos son indistinguibles. La fila que se acaba de escribir en la petición que estamos
 * respondiendo **es** `submitting` de verdad; la que quedó colgada de una petición anterior
 * miente. Separarlas exige comparar `createdAt` contra un umbral de antigüedad, y elegir ese
 * umbral es una decisión de negocio —¿el timeout del proveedor?, ¿el doble?— que nadie ha tomado.
 * Lo que sí hace este DTO es publicar la convención en el `description` de `status`, para que el
 * cliente la aplique al LEER. Inventar aquí un umbral por nuestra cuenta sería peor: pondría una
 * regla de negocio sin dueño en el borde HTTP.
 */
export class WalletTransferResponseDto {
  @ApiProperty({
    description: 'Identificador de la transferencia.',
    example: 'a3f1c2d4-5b6e-4f7a-8c9d-0e1f2a3b4c5d',
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({
    description: 'Dueño de la wallet que envió: siempre el `sub` del token.',
    example: '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012',
    format: 'uuid',
  })
  ownerId!: string;

  @ApiProperty({
    description:
      'Dirección desde la que salió el activo: la de la wallet custodiada, nunca la master. ' +
      'La master firma y paga el gas; no envía.',
    example: '0x687422eea2cb73b5d3e242ba5456b782919afc85',
  })
  from!: string;

  @ApiProperty({
    description: 'Dirección que recibe el activo.',
    example: '0xe242ba5456b782919afc85687422eea2cb73b5d3',
  })
  recipient!: string;

  @ApiProperty({
    description: 'Clase del activo transferido.',
    enum: [...TRANSFER_ASSET_KINDS],
    example: 'native',
  })
  kind!: TransferAssetKind;

  @ApiProperty({
    description: 'Contrato del token. Nulo en un envío de moneda nativa.',
    ...nullableOf({ type: 'string' }),
    example: null,
  })
  tokenAddress!: string | null;

  @ApiProperty({
    description: 'Importe enviado, como cadena decimal. Nulo en un envío de NFT.',
    ...nullableOf({ type: 'string' }),
    example: '100000',
  })
  amount!: string | null;

  @ApiProperty({
    description: 'Identificador del token. Nulo salvo en NFT y multi-token.',
    ...nullableOf({ type: 'string' }),
    example: null,
  })
  tokenId!: string | null;

  @ApiProperty({
    description:
      'Qué sabemos del envío. `submitting`: la fila se escribió y aún no hay respuesta. ' +
      '`submitted`: el proveedor devolvió un hash, la transacción está enviada —no ' +
      'necesariamente minada—. `rejected`: el proveedor rechazó el cuerpo y NO pasó nada en la ' +
      'cadena. ⚠️ `unknown`: hubo timeout, red caída o un fallo de nuestra cuenta con el ' +
      'proveedor, y la transacción **pudo minarse o no**. Una fila que se queda en ' +
      '`submitting` tras responder la petición se lee como `unknown`.',
    enum: [...TRANSFER_STATUSES],
    example: 'submitted',
  })
  status!: TransferStatus;

  @ApiProperty({
    description: 'Hash de la transacción. Solo lo hay en `submitted`.',
    ...nullableOf({ type: 'string' }),
    example: '0xc83f8818db43d9ba4accfe454aa44fc33123d47a4f89d47b314d6748eb0e9bc9',
  })
  txId!: string | null;

  @ApiProperty({
    description:
      'Código de motivo del fallo, de la lista cerrada `PROVIDER_FAILURE_REASONS`. Nulo mientras ' +
      'no haya fallado nada.',
    ...nullableOf({ type: 'string', enum: [...PROVIDER_FAILURE_REASONS] }),
    example: null,
  })
  reason!: ProviderFailureReason | null;

  // `type: String` + `format` explícitos, misma red de seguridad que documenta `placedAt` en
  // `order-response.dto.ts`.
  @ApiProperty({
    description: 'Momento en que se escribió la fila, antes de llamar al proveedor. En UTC.',
    example: TIMESTAMP,
    type: String,
    format: 'date-time',
  })
  createdAt!: Date;

  /**
   * ⚠️ **`reason` es un código NUESTRO, jamás el `message` del proveedor.** El del 401 de Tatum
   * interpola la API key —`"Unable to find valid subscription for '${apiKey}'"`, medido en su
   * `openapi.json`—, y este campo se publica por `GET /wallets/me/transfers`. Copiar aquí el
   * texto del proveedor sería publicar un secreto a cualquiera que liste su propio libro. Por eso
   * el tipo del campo es `ProviderFailureReason` y no `string`: lo que no esté en la lista cerrada
   * no compila.
   *
   * ⚠️ El tipo es una comprobación de COMPILACIÓN y no cierra el hueco entero: la ruta de lectura
   * castea `row.reasonCode as ProviderFailureReason | null` en `wallet-transfer.mapper.ts`, así
   * que una cadena arbitraria escrita por SQL crudo en `reason_code` sale intacta por aquí. Quien
   * lo cerraría es un `CHECK` en la tabla, y el razonamiento de por qué hoy no lo hay vive en
   * `wallet-transfer.orm-entity.ts`.
   *
   * El snapshot llama a ese dato `reasonCode` —igual que la columna `reason_code`— y el contrato
   * HTTP lo publica como `reason`. Esta línea es el único punto donde los dos nombres se cruzan.
   */
  static fromDomain(transfer: WalletTransfer): WalletTransferResponseDto {
    const snapshot = transfer.toSnapshot();
    const dto = new WalletTransferResponseDto();
    dto.id = snapshot.id;
    dto.ownerId = snapshot.ownerId;
    dto.from = snapshot.from;
    dto.recipient = snapshot.recipient;
    dto.kind = snapshot.assetKind;
    dto.tokenAddress = snapshot.tokenAddress;
    dto.amount = snapshot.amount;
    dto.tokenId = snapshot.tokenId;
    dto.status = snapshot.status;
    dto.txId = snapshot.txId;
    dto.reason = snapshot.reasonCode;
    dto.createdAt = snapshot.createdAt;
    return dto;
  }
}
