import { applyDecorators, type Type } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiProperty,
  ApiResponse,
  getSchemaPath,
  type ApiResponseOptions,
} from '@nestjs/swagger';

import { PaginatedResponseDto, PaginationMetaDto } from './paginated-response.dto';

export class RequestMetaDto {
  @ApiProperty({ example: '2026-07-28T10:15:00.000Z' })
  timestamp!: string;

  @ApiProperty({ example: '/api/v1/users' })
  path!: string;

  @ApiProperty({ example: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' })
  requestId!: string;
}

/**
 * Forma real de toda respuesta JSON con éxito, la que produce `TransformInterceptor`.
 *
 * Declararla importa: los controllers anotaban el DTO desnudo, así que un SDK generado
 * desde `/api/docs-json` deserializaba `id` como `undefined` — el cuerpo real nunca fue
 * `{...}` sino `{ success, data: {...}, request: {...} }`. El contrato publicado describía
 * una respuesta que el servidor no devuelve.
 */
export class ApiEnvelopeDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: RequestMetaDto })
  request!: RequestMetaDto;
}

/**
 * `Omit<ApiResponseOptions, 'schema'>` no deja pasar `example`: `ApiResponseOptions` es una unión
 * y `keyof` sobre una unión solo devuelve las claves comunes a todas sus ramas, así que `example`
 * —que vive únicamente en la rama sin `schema`— desaparece. Reintroducirlo es lo que permite
 * documentar el cuerpo completo, envelope incluido; el `$ref` solo describe la forma.
 */
type WithExample = {
  /** Cuerpo de ejemplo completo, envelope incluido. Lo exige `openapi-contract.e2e-spec.ts`. */
  example?: unknown;
};

type EnvelopeOptions = Omit<ApiResponseOptions, 'schema'> & WithExample & { status?: number };

type PaginatedEnvelopeOptions = Omit<ApiResponseOptions, 'schema'> & WithExample;

/** Declara `{ success, data: <model>, request }` como cuerpo de la respuesta. */
export const ApiEnvelope = <TModel extends Type<unknown>>(
  model: TModel,
  { status = 200, example, ...options }: EnvelopeOptions = {},
): MethodDecorator & ClassDecorator =>
  applyDecorators(
    ApiExtraModels(ApiEnvelopeDto, RequestMetaDto, model),
    ApiResponse({
      ...options,
      status,
      // Condicional y no `example` a secas: cuando dos decoradores declaran el mismo status,
      // `mergeResponseEntry` los funde con `Object.assign`, y una clave `example` propia con
      // valor `undefined` machacaría el ejemplo que el otro ya hubiera registrado.
      ...(example !== undefined ? { example } : {}),
      schema: {
        allOf: [
          { $ref: getSchemaPath(ApiEnvelopeDto) },
          { properties: { data: { $ref: getSchemaPath(model) } } },
        ],
      },
    }),
  );

/** Igual que `ApiEnvelope`, con una página tipada dentro de `data`. */
export const ApiPaginatedEnvelope = <TModel extends Type<unknown>>(
  model: TModel,
  { example, ...options }: PaginatedEnvelopeOptions = {},
): MethodDecorator & ClassDecorator =>
  applyDecorators(
    ApiExtraModels(ApiEnvelopeDto, RequestMetaDto, PaginatedResponseDto, PaginationMetaDto, model),
    ApiOkResponse({
      ...options,
      ...(example !== undefined ? { example } : {}),
      schema: {
        allOf: [
          { $ref: getSchemaPath(ApiEnvelopeDto) },
          {
            properties: {
              data: {
                allOf: [
                  { $ref: getSchemaPath(PaginatedResponseDto) },
                  {
                    properties: {
                      items: { type: 'array', items: { $ref: getSchemaPath(model) } },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    }),
  );
