import { Catch, ConflictException, NotFoundException } from '@nestjs/common';

import {
  DomainExceptionFilter,
  type DomainErrorMapping,
} from '@common/http/domain-exception.filter';

import {
  EmailAlreadyTakenError,
  UserDomainError,
  UserNotFoundError,
} from '../../domain/errors/user.errors';

/**
 * Traduce los errores del dominio al protocolo HTTP. Vive en `infrastructure/http/`
 * justamente para que el dominio no tenga que saber qué es un 404: el dominio lanza
 * `UserNotFoundError` y es el adaptador quien decide el código de estado.
 *
 * El recorrido del mapa —primer `instanceof` que coincide gana, fallback 400— vive en
 * `DomainExceptionFilter`; aquí solo queda la tabla de traducción de este contexto.
 *
 * Las excepciones se construyen con STRING a propósito: así Nest rellena `body.error` con el
 * nombre canónico —que es lo que `buildErrorExample` deriva del status— en vez del nombre de
 * la clase de dominio.
 *
 * `InvalidEmailError`, `InvalidUserIdError` e `InvalidUserNameError` NO están en el mapa: el
 * fallback de la base ya las convierte en 400, que es exactamente lo que hacían sus tres
 * ramas explícitas. La rama de credenciales se fue con el hash al filtro de `auth` (ciclo 4):
 * este contexto ya no puede producir un 401 de negocio.
 */
@Catch(UserDomainError)
export class UserDomainExceptionFilter extends DomainExceptionFilter<UserDomainError> {
  protected readonly mappings: DomainErrorMapping<UserDomainError> = [
    [UserNotFoundError, (error) => new NotFoundException(error.message)],
    [EmailAlreadyTakenError, (error) => new ConflictException(error.message)],
  ];
}
