import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import {
  EmailAlreadyTakenError,
  InvalidEmailError,
  InvalidUserIdError,
  InvalidUserNameError,
  UserDomainError,
  UserNotFoundError,
} from '../../../domain/errors/user.errors';
import { UserDomainExceptionFilter } from '../../../infrastructure/http/user-domain-exception.filter';

describe('UserDomainExceptionFilter', () => {
  describe('catch()', () => {
    it('debería traducir UserNotFoundError a 404', () => {
      // Arrange
      const filter = new UserDomainExceptionFilter();
      const error = new UserNotFoundError('3f2504e0-4f89-41d3-9a0c-0305e82c3301');

      // Act + Assert
      expect(() => filter.catch(error)).toThrow(NotFoundException);
    });

    it('debería traducir EmailAlreadyTakenError a 409', () => {
      // Arrange
      const filter = new UserDomainExceptionFilter();
      const error = new EmailAlreadyTakenError('taken@example.com');

      // Act + Assert
      expect(() => filter.catch(error)).toThrow(ConflictException);
    });

    it.each([
      ['InvalidEmailError', new InvalidEmailError('bad')],
      ['InvalidUserIdError', new InvalidUserIdError('bad')],
      ['InvalidUserNameError', new InvalidUserNameError('x')],
    ])('debería traducir %s a 400', (_caso, error) => {
      // Arrange
      const filter = new UserDomainExceptionFilter();

      // Act + Assert
      expect(() => filter.catch(error)).toThrow(BadRequestException);
    });

    it('debería tratar un error de dominio sin mapeo como 400', () => {
      // Arrange
      const filter = new UserDomainExceptionFilter();

      // Act + Assert
      expect(() => filter.catch(new UnmappedDomainError())).toThrow(BadRequestException);
    });

    it('debería conservar el mensaje del error de dominio', () => {
      // Arrange
      const filter = new UserDomainExceptionFilter();
      const error = new EmailAlreadyTakenError('taken@example.com');

      // Act
      const thrown = captureError(() => filter.catch(error));

      // Assert
      expect(thrown.message).toContain('taken@example.com');
    });
  });
});

// Helpers

class UnmappedDomainError extends UserDomainError {
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
