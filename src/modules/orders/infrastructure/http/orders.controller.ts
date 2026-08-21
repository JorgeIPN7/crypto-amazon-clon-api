import { Body, Controller, HttpStatus, Post, UseFilters } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { AuthenticatedUser } from '@common/auth/authenticated-user';
import { ApiStandardErrors } from '@common/decorators/api-standard-errors.decorator';
import { Auth } from '@common/decorators/auth.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { ApiEnvelope } from '@common/dto/api-envelope.dto';
import { buildErrorExample } from '@common/dto/error-example.factory';
import { ErrorResponseDto, ValidationErrorResponseDto } from '@common/dto/error-response.dto';

import { PlaceOrderUseCase } from '../../application/use-cases/place-order.use-case';

import { OrderResponseDto } from './dto/order-response.dto';
import { PlaceOrderDto } from './dto/place-order.dto';
import { OrdersDomainExceptionFilter } from './orders-domain-exception.filter';

const COLLECTION_PATH = '/api/v1/orders';

/** Lo que `TransformInterceptor` añade a toda respuesta de éxito — mismos valores fijos que users. */
const requestMeta = (path: string) => ({
  timestamp: '2026-08-01T10:15:00.000Z',
  path,
  requestId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
});

const ORDER_EXAMPLE = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  customerId: '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012',
  concept: 'Suscripción anual plan Pro',
  amountCents: 149_900,
  placedAt: '2026-08-01T10:15:00.000Z',
} as const;

/** Los ejemplos de error salen SIEMPRE de la factoría: `error` se deriva del status. */
const errorExample = (statusCode: number, message: string, path: string) =>
  buildErrorExample(statusCode, { path, message });

/**
 * Adaptador de entrada. Primer consumidor real de `@CurrentUser()`: el `customerId` sale
 * del `sub` del token y JAMÁS del body (anti-spoof, spec §2 — el DTO ni declara el campo
 * y `forbidNonWhitelisted` rechaza al que lo mande).
 */
@ApiTags('Orders')
@Controller('orders')
@UseFilters(OrdersDomainExceptionFilter)
export class OrdersController {
  constructor(private readonly placeOrder: PlaceOrderUseCase) {}

  @Auth()
  @Post()
  @ApiOperation({
    operationId: 'placeOrder',
    summary: 'Coloca una orden a nombre del usuario autenticado',
    description:
      'Registra una orden mínima (concepto + importe en céntimos) para el usuario del token. ' +
      'Antes de guardar se re-verifica que el usuario siga existiendo y activo: un JWT válido ' +
      'puede sobrevivir a su usuario, y en ese caso la respuesta es 403. La orden y su evento ' +
      'OrderPlaced se persisten en la misma transacción (outbox).',
  })
  // El contract guard NO valida los examples de request contra el schema: completos a mano.
  @ApiBody({
    type: PlaceOrderDto,
    examples: {
      standard: {
        summary: 'Orden típica',
        value: { concept: 'Suscripción anual plan Pro', amountCents: 149_900 },
      },
      minimumAmount: {
        summary: 'Importe en el límite inferior (1 céntimo)',
        value: { concept: 'Ajuste de saldo', amountCents: 1 },
      },
    },
  })
  @ApiEnvelope(OrderResponseDto, {
    status: HttpStatus.CREATED,
    description: 'Orden colocada.',
    example: {
      success: true,
      data: ORDER_EXAMPLE,
      request: requestMeta(COLLECTION_PATH),
    },
  })
  // `@Auth()` sin roles no declara 403 — este es del endpoint: token válido cuyo usuario
  // ya no existe o está inactivo. El mensaje es el canónico que publica el filter.
  @ApiForbiddenResponse({
    description: 'El usuario del token ya no existe o está inactivo.',
    type: ErrorResponseDto,
    example: errorExample(403, 'Forbidden', COLLECTION_PATH),
  })
  @ApiBadRequestResponse({
    description: 'El cuerpo no supera la validación de entrada.',
    type: ValidationErrorResponseDto,
    example: errorExample(
      400,
      'concept must be longer than or equal to 1 characters, amountCents must not be less than 1',
      COLLECTION_PATH,
    ),
  })
  @ApiStandardErrors()
  async place(
    @Body() dto: PlaceOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrderResponseDto> {
    const order = await this.placeOrder.execute({
      customerId: user.sub,
      concept: dto.concept,
      amountCents: dto.amountCents,
    });
    return OrderResponseDto.fromDomain(order);
  }
}
