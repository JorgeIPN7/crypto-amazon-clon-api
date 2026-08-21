import { ApiProperty } from '@nestjs/swagger';

export class PaginationMetaDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 100 })
  total!: number;

  @ApiProperty({ example: 5 })
  totalPages!: number;

  @ApiProperty({ example: true })
  hasNextPage!: boolean;

  @ApiProperty({ example: false })
  hasPreviousPage!: boolean;
}

export class PaginatedResponseDto<T> {
  /**
   * `type: 'array'` con `items` explícito, no `isArray: true`.
   *
   * `T` es genérico y en tiempo de ejecución no existe: `design:type` refleja `Array`, así que
   * `isArray: true` lo envolvía otra vez y publicaba `{ type: 'array', items: { type: 'array' } }`
   * — una lista de listas. Como `ApiPaginatedEnvelope` refina `items` con un `$ref` mediante
   * `allOf`, el contrato resultante exigía que cada elemento fuese a la vez un array y el DTO:
   * insatisfacible para cualquier validador estricto.
   *
   * Con `items: { type: 'object' }` el `allOf` estrecha en vez de contradecir.
   */
  @ApiProperty({ type: 'array', items: { type: 'object' } })
  items!: T[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;

  static of<T>(items: T[], total: number, page: number, limit: number): PaginatedResponseDto<T> {
    const safeLimit = Math.max(1, limit);
    const totalPages = total === 0 ? 0 : Math.ceil(total / safeLimit);
    const response = new PaginatedResponseDto<T>();
    response.items = items;
    response.meta = {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      // Solo depende de si hay algo antes de esta página. La condición anterior añadía
      // `page <= totalPages + 1`, sin justificación: con 3 páginas, `page=4` devolvía
      // `true` y `page=5` devolvía `false`, así que un paginador de UI deshabilitaba el
      // botón «anterior» y dejaba al usuario atrapado en una página vacía.
      hasPreviousPage: page > 1,
    };
    return response;
  }
}
