import { ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginationDto {
  @ApiPropertyOptional({
    description: 'Página a devolver, empezando en 1.',
    minimum: 1,
    default: 1,
    example: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Elementos por página. El máximo es 100; pedir más devuelve 400.',
    minimum: 1,
    maximum: 100,
    default: 20,
    example: 20,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 20;

  /**
   * Derivado, no un parámetro de entrada: deliberadamente sin `@ApiPropertyOptional`, para que
   * no aparezca en el documento OpenAPI como un query param que el servidor ignoraría.
   * `@Exclude({ toPlainOnly: true })` cubre la serialización; la ausencia de decorador de
   * documentación cubre el contrato publicado. Son dos cosas distintas.
   */
  @Exclude({ toPlainOnly: true })
  get skip(): number {
    return ((this.page ?? 1) - 1) * (this.limit ?? 20);
  }
}
