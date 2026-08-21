import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/authenticated-user';

/**
 * Inyecta los claims que JwtAuthGuard adjuntó a `request.user`.
 *
 * Si no hay claims, el endpoint no pasó por el guard (¿está marcado `@Public()`?): eso es un
 * bug de wiring del autor, no un fallo de auth — Error plano y ruidoso (→ 500 vía
 * AllExceptionsFilter), nunca un `undefined` silencioso.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const { user } = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!user) {
      throw new Error(
        '@CurrentUser() sin claims: la ruta no pasó por JwtAuthGuard (¿endpoint @Public()?).',
      );
    }
    return user;
  },
);
