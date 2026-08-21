import { fc, it as itProp } from '@fast-check/jest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { PaginationDto } from '../../dto/pagination.dto';

describe('PaginationDto', () => {
  it('debería aplicar los valores por defecto cuando el input está vacío', () => {
    // Arrange
    const input = {};

    // Act
    const dto = plainToInstance(PaginationDto, input);

    // Assert
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
    expect(dto.skip).toBe(0);
  });

  it('debería convertir a número los query params que llegan como string', () => {
    // Arrange
    const input = { page: '3', limit: '50' };

    // Act
    const dto = plainToInstance(PaginationDto, input);

    // Assert
    expect(dto.page).toBe(3);
    expect(dto.limit).toBe(50);
    expect(dto.skip).toBe(100);
  });

  it('debería rechazar un limit mayor que 100', () => {
    // Arrange
    const dto = plainToInstance(PaginationDto, { page: 1, limit: 101 });

    // Act
    const errors = validateSync(dto);

    // Assert
    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('limit');
  });

  it('debería rechazar un page que no sea positivo', () => {
    // Arrange
    const dto = plainToInstance(PaginationDto, { page: 0, limit: 10 });

    // Act
    const errors = validateSync(dto);

    // Assert
    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('page');
  });

  it('debería excluir skip del payload serializado', () => {
    // Arrange
    const dto = plainToInstance(PaginationDto, { page: 2, limit: 10 });

    // Act
    const plain = JSON.parse(JSON.stringify(dto)) as Record<string, unknown>;

    // Assert
    expect(plain.skip).toBeUndefined();
  });

  it('debería dejar skip fuera del documento OpenAPI, no solo del payload', () => {
    // Arrange
    const documented = documentedKeys(PaginationDto);

    // Act
    const declaresSkip = documented.includes('skip');

    // Assert
    // `@Exclude({ toPlainOnly: true })` gobierna la serialización y el test anterior lo cubre,
    // pero la documentación se alimenta de otra metadata distinta: excluir una cosa no excluye
    // la otra. `skip` es derivado de `page` y `limit`, así que publicarlo anunciaría un query
    // param que el servidor ignora — el contrato falso que este trabajo viene a corregir.
    expect(declaresSkip).toBe(false);
    expect(documented).toEqual(['page', 'limit']);
  });

  it.each([
    ['page', 1],
    ['limit', 20],
  ])('debería publicar description y example en %s, que el guardián exige', (key, example) => {
    // Arrange
    const metadata = propertyMetadata(PaginationDto, key);

    // Act
    const published = { description: metadata?.description, example: metadata?.example };

    // Assert
    // Ambas acaban en el parámetro de query de `GET /users`: la `description` al nivel del
    // parámetro y el `example` dentro de su `schema`.
    expect(published.description).toEqual(expect.any(String));
    expect(published.example).toBe(example);
  });
});

describe('PaginationDto (property-based)', () => {
  itProp.prop([fc.integer({ min: 1, max: 1_000_000 }), fc.integer({ min: 1, max: 100 })])(
    'debería derivar siempre skip como (page - 1) * limit',
    (page, limit) => {
      // Arrange
      const dto = plainToInstance(PaginationDto, { page, limit });

      // Act
      const skip = dto.skip;

      // Assert
      expect(skip).toBe((page - 1) * limit);
    },
  );

  itProp.prop([fc.integer({ min: 1, max: 100 })])(
    'debería aceptar cualquier limit dentro de [1,100] sin errores de validación',
    (limit) => {
      // Arrange
      const dto = plainToInstance(PaginationDto, { page: 1, limit });

      // Act
      const errors = validateSync(dto);

      // Assert
      expect(errors).toHaveLength(0);
    },
  );
});

// Helpers

// `@nestjs/swagger` acumula los nombres decorados en este array, cada uno prefijado con `:`, y
// guarda las opciones de cada propiedad bajo la otra clave, indexadas por nombre de propiedad.
const KEYS_META = 'swagger/apiModelPropertiesArray';
const PROPERTY_META = 'swagger/apiModelProperties';

// Se tipa por el `prototype` y no como `new () => unknown`: en esa forma `prototype` es `any`
// y `Reflect.getMetadata` dispara `no-unsafe-argument`.
type DtoClass = { prototype: object };

type PropertyMetadata = { description?: unknown; example?: unknown };

/** Nombres de propiedad que `@ApiPropertyOptional` registró: la fuente del documento OpenAPI. */
const documentedKeys = (dto: DtoClass): string[] =>
  ((Reflect.getMetadata(KEYS_META, dto.prototype) as string[] | undefined) ?? []).map((key) =>
    key.replace(/^:/, ''),
  );

/** Las opciones con las que se decoró una propiedad concreta: lo que acaba en el esquema. */
const propertyMetadata = (dto: DtoClass, key: string): PropertyMetadata | undefined =>
  Reflect.getMetadata(PROPERTY_META, dto.prototype, key) as PropertyMetadata | undefined;
