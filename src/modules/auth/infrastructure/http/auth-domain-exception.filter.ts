import {
  BadRequestException,
  Catch,
  ConflictException,
  InternalServerErrorException,
  UnauthorizedException,
  type ExceptionFilter,
} from '@nestjs/common';

import {
  AuthDomainError,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  InvalidPasswordHashError,
} from '../../domain/errors/auth.errors';

/**
 * Traduce los errores del dominio de `auth` al protocolo HTTP. Vive en `infrastructure/http/`
 * justamente para que el dominio no tenga que saber qué es un 401: el dominio lanza
 * `InvalidCredentialsError` y es el adaptador quien decide el código de estado.
 *
 * **Todas las excepciones se construyen con un STRING**, nunca con un objeto (lección del
 * ciclo de auth original, hoy fijada además en `error-example.factory.spec.ts`): así Nest
 * rellena `body.error` con el nombre CANÓNICO del status —`Unauthorized`, `Conflict`,
 * `Bad Request`— que es exactamente lo que `buildErrorExample` deriva, y el nombre de la
 * clase de dominio no llega jamás al cliente.
 *
 * El `message` del 401 se conserva —`Invalid credentials`— y no se reemplaza por el canónico
 * `Unauthorized`: es el cuerpo que el contrato publicado ya promete para `POST /auth/login`,
 * el ciclo 4 solo muda el endpoint de contexto y no cambia lo que responde. Sigue sin
 * enumerar nada: es el MISMO mensaje para email inexistente, cuenta sin credencial, password
 * incorrecto y usuario inactivo.
 *
 * El catch es ancho (`AuthDomainError`) y no solo los casos mapeados: un error de dominio
 * nuevo sin mapeo explícito se trata como entrada inválida antes que como fallo del servidor
 * —el cliente pidió algo que el dominio rechaza—, que es donde cae hoy `InvalidProfileError`.
 *
 * `InvalidPasswordHashError` es la EXCEPCIÓN a ese fallback y por eso está mapeado aparte: no
 * describe una entrada del usuario, describe una fila corrupta. Ver su bloque más abajo.
 */
@Catch(AuthDomainError)
export class AuthDomainExceptionFilter implements ExceptionFilter {
  catch(exception: AuthDomainError): never {
    if (exception instanceof InvalidCredentialsError) {
      throw new UnauthorizedException(exception.message);
    }

    if (exception instanceof EmailAlreadyRegisteredError) {
      throw new ConflictException(exception.message);
    }

    /**
     * 500 y no 400, ni 401. `PasswordHash.from()` solo lanza esto al RECONSTITUIR una
     * credencial ya persistida (`credential.mapper.ts`); nada del body del cliente pasa por
     * ahí. Llegar aquí significa que la fila de `auth_credentials` no contiene un hash
     * argon2id — alcanzable de verdad: la migración copia el valor verbatim y no valida
     * formato, así que basta una carga por SQL desde otro sistema. Es corrupción de datos del
     * servidor, y el fallback de «error de dominio = entrada inválida» lo publicaba como
     * `400 Value is not a valid argon2id hash`: un detalle del almacenamiento, en el cuerpo.
     *
     * Descartado tratarlo como credenciales inválidas (401) pese a que uniformaría el login:
     * la propiedad anti-enumeración protege de los caminos que un ATACANTE puede provocar por
     * email, y una fila corrupta no es uno — es un fallo de operación. Con 401 la cuenta
     * quedaría sin poder entrar para siempre y el filtro global loguearía un `warn` sin `err`,
     * indistinguible de un password mal escrito: nadie se enteraría nunca.
     *
     * El cuerpo se construye para salir IDÉNTICO al de cualquier otro fallo del servidor —
     * `message: 'Internal server error'` y `error: 'InternalServerError'` son literalmente lo
     * que `AllExceptionsFilter` emite en su rama de 500 y lo que publica
     * `buildErrorExample(500, …)`. El mensaje del dominio NO viaja en el body en NINGÚN
     * entorno (la rama `isProductionLike` del filtro global solo sanea los `Error` no-HTTP, y
     * esto ya es una `HttpException`): va como `cause`, que solo ve el logger.
     */
    if (exception instanceof InvalidPasswordHashError) {
      throw new InternalServerErrorException('Internal server error', {
        description: 'InternalServerError',
        cause: exception,
      });
    }

    throw new BadRequestException(exception.message);
  }
}
