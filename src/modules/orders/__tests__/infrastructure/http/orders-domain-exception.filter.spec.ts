import { BadRequestException, ForbiddenException } from '@nestjs/common';

import {
  CustomerGoneError,
  InvalidOrderAmountError,
  InvalidOrderConceptError,
} from '../../../domain/errors/order.errors';
import { OrdersDomainExceptionFilter } from '../../../infrastructure/http/orders-domain-exception.filter';

describe('OrdersDomainExceptionFilter', () => {
  describe('catch()', () => {
    it('debería traducir CustomerGoneError a 403', () => {
      // Arrange
      const filter = new OrdersDomainExceptionFilter();

      // Act + Assert
      expect(() =>
        filter.catch(new CustomerGoneError('9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012')),
      ).toThrow(ForbiddenException);
    });

    it('debería publicar el mensaje canónico Forbidden, no el del dominio', () => {
      // Arrange
      const filter = new OrdersDomainExceptionFilter();
      const error = new CustomerGoneError('9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012');

      // Act
      const thrown = captureError(() => filter.catch(error));

      // Assert: el motivo (usuario borrado vs inactivo) es información interna.
      expect(thrown.message).toBe('Forbidden');
      expect(thrown.message).not.toContain('9d2a1c7e');
    });

    it.each([
      ['InvalidOrderConceptError', new InvalidOrderConceptError('   ')],
      ['InvalidOrderAmountError', new InvalidOrderAmountError(-1)],
    ])('debería traducir %s a 400', (_caso, error) => {
      // Arrange
      const filter = new OrdersDomainExceptionFilter();

      // Act + Assert
      expect(() => filter.catch(error)).toThrow(BadRequestException);
    });
  });
});

// Helpers

const captureError = (fn: () => unknown): Error => {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error('Se esperaba que la función lanzara un error y no lo hizo');
};
