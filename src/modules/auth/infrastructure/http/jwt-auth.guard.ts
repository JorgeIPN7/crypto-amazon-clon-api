import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import { AuthRoles } from '@common/decorators/auth.decorator';
import { Public } from '@common/decorators/public.decorator';

// Única excepción legítima al blindaje de `ports/`: de este archivo el guard no consume el
// PUERTO (`TokenSigner`, que nunca inyecta — verifica, no firma) sino el `type` de datos que
// lo acompaña. No hay referencia que borrar del emit, así que `import type` es correcto aquí
// y la forma inline no es alternativa: `no-import-type-side-effects` la rechaza. Si algún día
// este archivo inyectara un puerto, el import pasa a valor y este disable desaparece.
// eslint-disable-next-line no-restricted-syntax
import type { TokenClaims } from '../../domain/ports/token-signer';

/**
 * Guard ÚNICO y GLOBAL. Desde el ciclo 4 lo registra `auth.module` vía `APP_GUARD`: la
 * verificación del token es de `auth`, no de `users`, y app-root no puede importar internals
 * de un módulo (regla 3 del gate de boundaries). `APP_GUARD` es un multi-provider, así que
 * registrarlo desde cualquier módulo lo hace global.
 *
 * 1. `@Public()` (handler o clase) → bypass total.
 * 2. Bearer ausente/inválido/expirado → 401 uniforme.
 * 3. Adjunta los claims a `request.user`.
 * 4. `@Auth(roles)` con roles y claim que no coincide → 403.
 *
 * `getAllAndOverride`: el handler tiene precedencia sobre la clase (lección del guard
 * de referencia — un `reflector.get` solo-handler dejaba pasar controllers gated).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride(Public, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: TokenClaims }>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    if (!token) {
      throw new UnauthorizedException('Unauthorized');
    }

    let claims: TokenClaims;
    try {
      claims = await this.jwt.verifyAsync<TokenClaims>(token);
    } catch {
      // Mensaje único: no distinguir expirado de inválido evita dar pistas.
      throw new UnauthorizedException('Unauthorized');
    }
    request.user = claims;

    const roles = this.reflector.getAllAndOverride(AuthRoles, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles !== undefined && roles.length > 0 && !roles.includes(claims.role)) {
      throw new ForbiddenException('Forbidden');
    }
    return true;
  }
}
