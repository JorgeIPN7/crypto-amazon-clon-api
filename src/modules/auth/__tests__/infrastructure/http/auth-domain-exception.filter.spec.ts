import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';

import {
  AuthDomainError,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  InvalidPasswordHashError,
  InvalidProfileError,
} from '../../../domain/errors/auth.errors';
import { AuthDomainExceptionFilter } from '../../../infrastructure/http/auth-domain-exception.filter';

describe('AuthDomainExceptionFilter', () => {
  describe('catch()', () => {
    it('debería traducir InvalidCredentialsError a 401', () => {
      // Arrange
      const filter = new AuthDomainExceptionFilter();

      // Act + Assert
      expect(() => filter.catch(new InvalidCredentialsError())).toThrow(UnauthorizedException);
    });

    it('debería traducir EmailAlreadyRegisteredError a 409', () => {
      // Arrange
      const filter = new AuthDomainExceptionFilter();

      // Act + Assert
      expect(() => filter.catch(new EmailAlreadyRegisteredError('taken@example.com'))).toThrow(
        ConflictException,
      );
    });

    // `InvalidPasswordHashError` SALIÓ de esta tabla en la revisión adversarial: no es entrada
    // del usuario sino una fila corrupta, y ahora es un 500 (ver los dos casos de más abajo).
    // La forma `it.each` se conserva porque el fallback de 400 sigue siendo el destino por
    // defecto de todo error de dominio nuevo.
    it.each([['InvalidProfileError', new InvalidProfileError('"x" is not a valid email address')]])(
      'debería traducir %s a 400',
      (_caso, error) => {
        // Arrange
        const filter = new AuthDomainExceptionFilter();

        // Act + Assert
        expect(() => filter.catch(error)).toThrow(BadRequestException);
      },
    );

    it('debería traducir InvalidPasswordHashError a 500', () => {
      // Arrange
      const filter = new AuthDomainExceptionFilter();

      // Act + Assert
      expect(() => filter.catch(new InvalidPasswordHashError())).toThrow(
        InternalServerErrorException,
      );
    });

    /**
     * El caso que motivó el cambio: el hash corrupto salía como `400 Value is not a valid
     * argon2id hash`, o sea un detalle del almacenamiento publicado en el cuerpo, y antes de
     * ejecutar un solo argon2. El 500 debe ser INDISTINGUIBLE de cualquier otro fallo del
     * servidor —el mismo cuerpo que produce `buildErrorExample(500, …)`— y el mensaje del
     * dominio solo puede viajar como `cause`, que nunca se serializa a la respuesta.
     */
    it('debería publicar el 500 sin el detalle del almacenamiento y con el cause intacto', () => {
      // Arrange
      const filter = new AuthDomainExceptionFilter();
      const domainError = new InvalidPasswordHashError();

      // Act
      const thrown = captureError(() => filter.catch(domainError)) as InternalServerErrorException;

      // Assert
      const published = thrown.getResponse();
      expect(published).toEqual({
        statusCode: 500,
        message: 'Internal server error',
        // `expectedErrorName(500)` de `error-example.factory.ts`, no el canónico HTTP
        // `Internal Server Error`: el 500 del contrato es el de la rama saneada del filtro
        // global, y este tiene que salir igual.
        error: 'InternalServerError',
      });
      expect(JSON.stringify(published)).not.toContain('argon2');
      expect(thrown.cause).toBe(domainError);
    });

    it('debería tratar un error de dominio sin mapeo como 400', () => {
      // Arrange
      const filter = new AuthDomainExceptionFilter();

      // Act + Assert
      expect(() => filter.catch(new UnmappedDomainError())).toThrow(BadRequestException);
    });

    /**
     * El pin de construcción-por-string. El contrato publicado promete `error: 'Unauthorized'`
     * / `'Conflict'` canónicos, y eso solo se sostiene si el filtro construye la excepción con
     * un string: `new UnauthorizedException({...})` dejaría `body.error` con lo que se le
     * pase, y `buildErrorExample` —que lo deriva del status— empezaría a mentir.
     */
    it('debería publicar el body canónico exacto del 401 y del 409', () => {
      // Arrange
      const filter = new AuthDomainExceptionFilter();

      // Act
      const unauthorized = captureError(() => filter.catch(new InvalidCredentialsError()));
      const conflict = captureError(() =>
        filter.catch(new EmailAlreadyRegisteredError('taken@example.com')),
      );

      // Assert
      expect((unauthorized as UnauthorizedException).getResponse()).toEqual({
        statusCode: 401,
        // El mensaje del dominio se conserva: es el que el contrato ya publicaba para
        // `POST /auth/login` antes de que el endpoint cambiara de contexto.
        message: 'Invalid credentials',
        error: 'Unauthorized',
      });
      expect((conflict as ConflictException).getResponse()).toEqual({
        statusCode: 409,
        message: 'Email taken@example.com is already registered',
        error: 'Conflict',
      });
    });
  });
});

// Helpers

class UnmappedDomainError extends AuthDomainError {
  constructor() {
    super('Regla de dominio nueva sin mapeo HTTP');
  }
}

const captureError = (fn: () => unknown): Error => {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error('Se esperaba que la función lanzara un error y no lo hizo');
};
