import { applyDecorators } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiBearerAuth, ApiForbiddenResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';

import { buildErrorExample } from '../dto/error-example.factory';
import { ErrorResponseDto } from '../dto/error-response.dto';

/**
 * Metadata de roles que el JwtAuthGuard resuelve con getAllAndOverride
 * (handler tiene precedencia sobre clase). Tipada laxa a propósito (D1-a de la
 * spec 2026-08-05-auth): el union real `UserRole` vive en
 * `modules/users/domain/value-objects/user-role.ts` y common no puede importarlo (matriz de
 * boundaries); el guard revalida contra el claim real en runtime.
 */
export const AuthRoles = Reflector.createDecorator<readonly string[]>();

/**
 * Ruta de relleno, y el **único campo de estos ejemplos que se sabe irreal** — mismo
 * razonamiento y mismo valor que `GENERIC_PATH` en `api-standard-errors.decorator.ts`: este
 * decorador vive en `common/` y no puede conocer la ruta del endpoint que lo aplica. Se declara
 * localmente (el precedente no se exporta) en vez de inventar un segundo valor de relleno.
 */
export const GENERIC_PATH = '/api/v1/resource';

/**
 * `@Auth()` → cualquier usuario autenticado. `@Auth('admin')` → solo ese rol (403 si no).
 * Adjunta la documentación OpenAPI que el contract guard exige a los endpoints
 * protegidos: bearer + 401 (+403 solo con roles) — la documentación viaja con la
 * protección, imposible declararla a medias.
 */
export function Auth(...roles: readonly string[]): ClassDecorator & MethodDecorator {
  const decorators = [
    AuthRoles(roles),
    ApiBearerAuth('bearer'),
    ApiUnauthorizedResponse({
      description: 'Token ausente, inválido o expirado.',
      type: ErrorResponseDto,
      example: buildErrorExample(401, { path: GENERIC_PATH, message: 'Unauthorized' }),
    }),
  ];
  if (roles.length > 0) {
    decorators.push(
      ApiForbiddenResponse({
        description: `Requiere rol: ${roles.join(' | ')}.`,
        type: ErrorResponseDto,
        example: buildErrorExample(403, { path: GENERIC_PATH, message: 'Forbidden' }),
      }),
    );
  }
  return applyDecorators(...decorators);
}
