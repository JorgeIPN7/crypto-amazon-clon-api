import {
  BadRequestException,
  Catch,
  ConflictException,
  NotFoundException,
  type ExceptionFilter,
} from '@nestjs/common';

import { DomainExceptionFilter, type DomainErrorMapping } from '../../http/domain-exception.filter';

describe('DomainExceptionFilter', () => {
  describe('catch()', () => {
    it('debería traducir con el primer mapeo que coincide', () => {
      // Arrange
      const filter = new SampleFilter();

      // Act + Assert
      expect(() => filter.catch(new NotFoundSampleError())).toThrow(NotFoundException);
    });

    it('debería traducir cada error a la excepción que le corresponde', () => {
      // Arrange
      const filter = new SampleFilter();

      // Act + Assert
      expect(() => filter.catch(new ConflictSampleError())).toThrow(ConflictException);
    });

    it('debería propagar el mensaje del error de dominio', () => {
      // Arrange
      const filter = new SampleFilter();

      // Act + Assert
      expect(() => filter.catch(new NotFoundSampleError())).toThrow('no encontrado');
    });

    it('debería usar el fallback 400 cuando ningún mapeo coincide', () => {
      // Arrange
      const filter = new SampleFilter();

      // Act + Assert
      // El mensaje se comprueba además de la clase, y no es redundante: medido, cambiar el
      // `exception.message` del fallback por una constante deja TODA la suite en verde. El
      // caso 3 sí afirma el mensaje, pero entra por un mapeo acertado, nunca por el fallback.
      expect(() => filter.catch(new UnmappedSampleError())).toThrow(BadRequestException);
      expect(() => filter.catch(new UnmappedSampleError())).toThrow('sin mapear');
    });

    it('debería usar el fallback 400 cuando el mapa está vacío', () => {
      // Arrange
      const filter = new EmptyFilter();

      // Act + Assert
      expect(() => filter.catch(new NotFoundSampleError())).toThrow(BadRequestException);
    });

    it('debería respetar el orden del mapa cuando dos entradas podrían coincidir', () => {
      // Arrange — `SpecificError` extiende `NotFoundSampleError`, así que las DOS entradas
      // le encajan por `instanceof`. Gana la primera declarada, que aquí es la específica.
      const filter = new OrderedFilter();

      // Act + Assert
      expect(() => filter.catch(new SpecificError())).toThrow(ConflictException);
    });
  });
});

// Helpers
//
// Errores sintéticos, no los reales de un módulo: el contrato que se prueba aquí es el
// RECORRIDO del mapa —primer match gana, fallback 400—, no la tabla de traducción de ningún
// contexto concreto. Con los errores de `users` este spec se pondría rojo cada vez que ese
// módulo añadiera un error, sin que la base hubiera cambiado.
//
// Que el CÓDIGO de `common/` no pueda importar de `modules/` es cierto y es otra cosa: el
// gate ignora `src/**/__tests__/**`, así que a este archivo no le aplica.

abstract class SampleDomainError extends Error {}

class NotFoundSampleError extends SampleDomainError {
  constructor() {
    super('no encontrado');
  }
}

class ConflictSampleError extends SampleDomainError {
  constructor() {
    super('en conflicto');
  }
}

class UnmappedSampleError extends SampleDomainError {
  constructor() {
    super('sin mapear');
  }
}

class SpecificError extends NotFoundSampleError {}

@Catch(SampleDomainError)
class SampleFilter extends DomainExceptionFilter<SampleDomainError> implements ExceptionFilter {
  protected readonly mappings: DomainErrorMapping<SampleDomainError> = [
    [NotFoundSampleError, (error) => new NotFoundException(error.message)],
    [ConflictSampleError, (error) => new ConflictException(error.message)],
  ];
}

@Catch(SampleDomainError)
class EmptyFilter extends DomainExceptionFilter<SampleDomainError> implements ExceptionFilter {
  protected readonly mappings: DomainErrorMapping<SampleDomainError> = [];
}

@Catch(SampleDomainError)
class OrderedFilter extends DomainExceptionFilter<SampleDomainError> implements ExceptionFilter {
  protected readonly mappings: DomainErrorMapping<SampleDomainError> = [
    [SpecificError, (error) => new ConflictException(error.message)],
    [NotFoundSampleError, (error) => new NotFoundException(error.message)],
  ];
}
