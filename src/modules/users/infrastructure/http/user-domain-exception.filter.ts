import {
  BadRequestException,
  Catch,
  ConflictException,
  NotFoundException,
  type ExceptionFilter,
} from '@nestjs/common';

import {
  EmailAlreadyTakenError,
  InvalidEmailError,
  InvalidUserIdError,
  InvalidUserNameError,
  UserDomainError,
  UserNotFoundError,
} from '../../domain/errors/user.errors';

/**
 * Traduce los errores del dominio al protocolo HTTP. Vive en `infrastructure/http/`
 * justamente para que el dominio no tenga que saber qué es un 404: el dominio lanza
 * `UserNotFoundError` y es el adaptador quien decide el código de estado.
 */
@Catch(UserDomainError)
export class UserDomainExceptionFilter implements ExceptionFilter {
  catch(exception: UserDomainError): never {
    if (exception instanceof UserNotFoundError) {
      throw new NotFoundException(exception.message);
    }

    if (exception instanceof EmailAlreadyTakenError) {
      throw new ConflictException(exception.message);
    }

    // La rama de credenciales se fue con el hash al filtro de `auth` (ciclo 4): este
    // contexto ya no puede producir un 401 de negocio. Las que quedan se construyen con
    // string a propósito, así Nest rellena `body.error` con el nombre canónico —que es lo
    // que `buildErrorExample` deriva del status— en vez del nombre de la clase de dominio.
    if (
      exception instanceof InvalidEmailError ||
      exception instanceof InvalidUserIdError ||
      exception instanceof InvalidUserNameError
    ) {
      throw new BadRequestException(exception.message);
    }

    // Un error de dominio nuevo sin mapeo explícito se trata como entrada inválida
    // antes que como fallo del servidor: el cliente pidió algo que el dominio rechaza.
    throw new BadRequestException(exception.message);
  }
}
