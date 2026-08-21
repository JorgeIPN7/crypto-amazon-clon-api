import { PaginatedResponseDto } from '../../dto/paginated-response.dto';

describe('PaginatedResponseDto', () => {
  describe('of()', () => {
    it('debería devolver 0 totalPages cuando total es 0', () => {
      // Arrange
      const items: number[] = [];

      // Act
      const result = PaginatedResponseDto.of(items, 0, 1, 20);

      // Assert
      expect(result.meta.totalPages).toBe(0);
      expect(result.meta.hasNextPage).toBe(false);
      expect(result.meta.hasPreviousPage).toBe(false);
    });

    it('debería calcular totalPages y los flags de una página intermedia completa', () => {
      // Arrange
      const items = [1, 2];

      // Act
      const result = PaginatedResponseDto.of(items, 21, 2, 10);

      // Assert
      expect(result.meta.totalPages).toBe(3);
      expect(result.meta.page).toBe(2);
      expect(result.meta.hasNextPage).toBe(true);
      expect(result.meta.hasPreviousPage).toBe(true);
    });

    it('debería manejar correctamente la última página', () => {
      // Arrange
      const items = [1];

      // Act
      const result = PaginatedResponseDto.of(items, 21, 3, 10);

      // Assert
      expect(result.meta.totalPages).toBe(3);
      expect(result.meta.hasNextPage).toBe(false);
      expect(result.meta.hasPreviousPage).toBe(true);
    });

    it('debería protegerse de limit=0 para evitar Infinity', () => {
      // Arrange
      const items: number[] = [];

      // Act
      const result = PaginatedResponseDto.of(items, 5, 1, 0);

      // Assert
      expect(Number.isFinite(result.meta.totalPages)).toBe(true);
      expect(result.meta.totalPages).toBe(5);
    });

    it('debería conservar los items recibidos sin modificarlos', () => {
      // Arrange
      const items = [{ id: 'a' }, { id: 'b' }];

      // Act
      const result = PaginatedResponseDto.of(items, 2, 1, 10);

      // Assert
      expect(result.items).toEqual(items);
    });

    // Pedir una página más allá del final es un caso real: un cliente que guarda la
    // página en la URL y vuelve cuando el total ha bajado. La respuesta viene vacía, pero
    // sí hay páginas anteriores — decir lo contrario deja al usuario sin forma de volver.
    it.each([
      [4, 3],
      [5, 3],
      [99, 3],
    ])('debería seguir indicando página anterior en la página %i de %i', (page) => {
      // Arrange
      const items: number[] = [];

      // Act
      const result = PaginatedResponseDto.of(items, 21, page, 10);

      // Assert
      expect(result.meta.hasPreviousPage).toBe(true);
      expect(result.meta.hasNextPage).toBe(false);
      expect(result.items).toEqual([]);
    });

    it('debería indicar que no hay página anterior en la primera página', () => {
      // Arrange
      const items = [1];

      // Act
      const result = PaginatedResponseDto.of(items, 21, 1, 10);

      // Assert
      expect(result.meta.hasPreviousPage).toBe(false);
    });
  });
});
