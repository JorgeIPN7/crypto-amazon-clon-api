import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';

import { buildErrorExample } from '../dto/error-example.factory';
import { ErrorResponseDto } from '../dto/error-response.dto';

export type StandardErrorsOptions = {
  /**
   * Declara 429. Por defecto `true`, porque `ThrottlerGuard` es global. Ponlo en `false` en
   * los controllers marcados con `@SkipThrottle()`, que nunca devuelven 429.
   */
  throttled?: boolean;
};

/**
 * Ruta de relleno, y el **único campo de estos ejemplos que se sabe irreal**.
 *
 * Este decorador vive en `common/` y lo usa cualquier contexto, así que no puede conocer la ruta
 * del endpoint que documenta; con `/api/v1/users` fijo aquí, el día que exista un segundo bounded
 * context sus errores mostrarían una ruta de otro módulo. Ningún guardián lo verifica —no hay
 * nada contra qué contrastarlo— de ahí que se deje dicho en vez de implícito. Los ejemplos con
 * ruta real van en cada controller, donde sí se conoce.
 */
const GENERIC_PATH = '/api/v1/resource';

/**
 * Declara los errores que cualquier endpoint puede devolver, con el cuerpo real de
 * `AllExceptionsFilter`. Sin este decorador cada operación repetiría ~40 líneas, y la
 * duplicación acaba siempre en documentación incompleta.
 *
 * Los cuerpos salen de `buildErrorExample`, nunca escritos a mano: así el `error` se deriva del
 * status en vez de inventarse, que es donde aparecieron las divergencias durante la migración.
 *
 * Qué se declara es deliberadamente condicional: ver `openapi-contract.e2e-spec.ts`, que verifica
 * la coherencia entre lo declarado y lo que el endpoint puede devolver de verdad.
 */
export const ApiStandardErrors = ({
  throttled = true,
}: StandardErrorsOptions = {}): MethodDecorator & ClassDecorator => {
  const decorators: (MethodDecorator & ClassDecorator)[] = [];

  if (throttled) {
    decorators.push(
      ApiResponse({
        status: 429,
        description: 'Se superó el límite de peticiones. Reintenta según `Retry-After`.',
        type: ErrorResponseDto,
        example: buildErrorExample(429, {
          path: GENERIC_PATH,
          message: 'ThrottlerException: Too Many Requests',
        }),
      }),
    );
  }

  decorators.push(
    ApiResponse({
      status: 500,
      description: 'Error no controlado. El `requestId` correlaciona con la traza en los logs.',
      type: ErrorResponseDto,
      // El cuerpo saneado de la rama `isProductionLike`: ni mensaje crudo ni nombre real de la
      // excepción, para no filtrar topología interna.
      example: buildErrorExample(500, { path: GENERIC_PATH, message: 'Internal server error' }),
    }),
  );

  return applyDecorators(...decorators);
};
