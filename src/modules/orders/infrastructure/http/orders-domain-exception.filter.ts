import {
  BadRequestException,
  Catch,
  ForbiddenException,
  type ExceptionFilter,
} from '@nestjs/common';

import { CustomerGoneError, OrderDomainError } from '../../domain/errors/order.errors';

/**
 * Traduce los errores del dominio de orders al protocolo HTTP, patrón del filter de users.
 *
 * El 403 se construye con STRING y con el mensaje canónico fijo (lección del ciclo auth):
 * `new ForbiddenException('Forbidden')` hace que Nest rellene `body.error` con el nombre
 * canónico —lo que `buildErrorExample` deriva del status— y no filtra si el usuario fue
 * borrado o desactivado: para el caller es lo mismo, «este token ya no compra».
 *
 * El catch es ancho (`OrderDomainError`) y no solo `CustomerGoneError` a propósito:
 * `@Length(1, 140)` del DTO NO recorta espacios, así que un concepto de solo espacios pasa
 * el transporte y muere en `OrderConcept.from()` — entrada inválida, 400, no un 500.
 */
@Catch(OrderDomainError)
export class OrdersDomainExceptionFilter implements ExceptionFilter {
  catch(exception: OrderDomainError): never {
    if (exception instanceof CustomerGoneError) {
      throw new ForbiddenException('Forbidden');
    }

    throw new BadRequestException(exception.message);
  }
}
