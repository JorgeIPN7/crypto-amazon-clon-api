import { Catch, ForbiddenException } from '@nestjs/common';

import {
  DomainExceptionFilter,
  type DomainErrorMapping,
} from '@common/http/domain-exception.filter';

import { CustomerGoneError, OrderDomainError } from '../../domain/errors/order.errors';

/**
 * Traduce los errores del dominio de orders al protocolo HTTP, patrón del filtro de users.
 * El recorrido del mapa lo pone `DomainExceptionFilter`; aquí solo la tabla de este contexto.
 *
 * El 403 se construye con STRING y con el mensaje canónico FIJO (lección del ciclo auth):
 * `new ForbiddenException('Forbidden')` hace que Nest rellene `body.error` con el nombre
 * canónico —lo que `buildErrorExample` deriva del status— y no filtra si el usuario fue
 * borrado o desactivado: para el caller es lo mismo, «este token ya no compra». Por eso el
 * callback ignora el error que recibe en vez de propagar su `message`.
 *
 * El `@Catch` es ancho (`OrderDomainError`) y no solo `CustomerGoneError` a propósito:
 * `@Length(1, 140)` del DTO NO recorta espacios, así que un concepto de solo espacios pasa
 * el transporte y muere en `OrderConcept.from()` — entrada inválida, 400 por el fallback de
 * la base, no un 500.
 */
@Catch(OrderDomainError)
export class OrdersDomainExceptionFilter extends DomainExceptionFilter<OrderDomainError> {
  protected readonly mappings: DomainErrorMapping<OrderDomainError> = [
    [CustomerGoneError, () => new ForbiddenException('Forbidden')],
  ];
}
