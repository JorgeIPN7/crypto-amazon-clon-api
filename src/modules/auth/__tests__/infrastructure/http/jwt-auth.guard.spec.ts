import { ForbiddenException, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { Auth } from '@common/decorators/auth.decorator';
import { Public } from '@common/decorators/public.decorator';

import type { TokenClaims } from '../../../domain/ports/token-signer';
import { JwtAuthGuard } from '../../../infrastructure/http/jwt-auth.guard';

const SECRET = 's'.repeat(32);

const USER_CLAIMS: TokenClaims = { sub: 'user-1', email: 'maria@example.com', role: 'user' };
const ADMIN_CLAIMS: TokenClaims = { sub: 'admin-1', email: 'root@example.com', role: 'admin' };

// Carrier classes — solo existen para portar la metadata de los decoradores que el
// guard resuelve con `getAllAndOverride`.
class PublicHandlerCarrier {
  @Public()
  handler(): void {
    // Solo existe para portar la metadata del decorador.
  }
}

@Public()
class PublicClassCarrier {
  handler(): void {
    // Solo existe para portar la metadata del decorador.
  }
}

class ProtectedCarrier {
  @Auth()
  handler(): void {
    // Solo existe para portar la metadata del decorador.
  }
}

class AdminOnlyCarrier {
  @Auth('admin')
  handler(): void {
    // Solo existe para portar la metadata del decorador.
  }
}

describe('JwtAuthGuard', () => {
  it('debería dejar pasar sin token cuando el handler es público', async () => {
    // Arrange
    const { guard } = build();
    const context = buildContext(PublicHandlerCarrier, {});

    // Act
    const result = await guard.canActivate(context);

    // Assert
    expect(result).toBe(true);
  });

  // Caso añadido (infra exenta de tabla) — getAllAndOverride cae a la clase cuando el
  // handler no trae metadata propia; sin este caso un `@Public()` a nivel de clase
  // (como HealthController) podría no bastar y quedaría sin cubrir.
  it('debería dejar pasar sin token cuando la CLASE es pública', async () => {
    // Arrange
    const { guard } = build();
    const context = buildContext(PublicClassCarrier, {});

    // Act
    const result = await guard.canActivate(context);

    // Assert
    expect(result).toBe(true);
  });

  it('debería lanzar 401 cuando no hay token', async () => {
    // Arrange
    const { guard } = build();
    const context = buildContext(ProtectedCarrier, { headers: {} });

    // Act + Assert
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('debería pasar con un token válido y adjuntar los claims a request.user', async () => {
    // Arrange
    const { guard, jwt } = build();
    const token = await jwt.signAsync(USER_CLAIMS);
    const request = { headers: { authorization: `Bearer ${token}` } };
    const context = buildContext(ProtectedCarrier, request);

    // Act
    const result = await guard.canActivate(context);

    // Assert
    expect(result).toBe(true);
    expect((request as { user?: TokenClaims }).user).toMatchObject(USER_CLAIMS);
  });

  it('debería lanzar 401 con el mismo mensaje ante un token inválido o malformado', async () => {
    // Arrange
    const { guard } = build();
    const noTokenContext = buildContext(ProtectedCarrier, { headers: {} });
    const badTokenContext = buildContext(ProtectedCarrier, {
      headers: { authorization: 'Bearer no-es-un-jwt' },
    });

    // Act
    const noTokenError = await catchError(() => guard.canActivate(noTokenContext));
    const badTokenError = await catchError(() => guard.canActivate(badTokenContext));

    // Assert
    expect(noTokenError).toBeInstanceOf(UnauthorizedException);
    expect(badTokenError).toBeInstanceOf(UnauthorizedException);
    expect((badTokenError as UnauthorizedException).getResponse()).toEqual(
      (noTokenError as UnauthorizedException).getResponse(),
    );
  });

  // Caso añadido (infra exenta de tabla) — el comentario del guard promete «expirado →
  // 401 uniforme»; sin este caso nada lo fija.
  it('debería lanzar 401 uniforme ante un token expirado', async () => {
    // Arrange
    const { guard, jwt } = build();
    const noTokenContext = buildContext(ProtectedCarrier, { headers: {} });
    const expiredToken = await jwt.signAsync(USER_CLAIMS, { expiresIn: -10 });
    const expiredContext = buildContext(ProtectedCarrier, {
      headers: { authorization: `Bearer ${expiredToken}` },
    });

    // Act
    const noTokenError = await catchError(() => guard.canActivate(noTokenContext));
    const expiredError = await catchError(() => guard.canActivate(expiredContext));

    // Assert
    expect(expiredError).toBeInstanceOf(UnauthorizedException);
    expect((expiredError as UnauthorizedException).getResponse()).toEqual(
      (noTokenError as UnauthorizedException).getResponse(),
    );
  });

  // Caso añadido (infra exenta de tabla) — pin de la razón de ser del guard bajo HS256:
  // un token con forma válida pero firmado con otro secret debe rechazarse igual que uno
  // ausente, nunca aceptarse ni fallar de forma distinguible.
  it('debería lanzar 401 uniforme ante un token firmado con otro secret', async () => {
    // Arrange
    const { guard } = build();
    const otherJwt = new JwtService({ secret: 'x'.repeat(32) });
    const noTokenContext = buildContext(ProtectedCarrier, { headers: {} });
    const wrongSignatureToken = await otherJwt.signAsync(USER_CLAIMS);
    const wrongSignatureContext = buildContext(ProtectedCarrier, {
      headers: { authorization: `Bearer ${wrongSignatureToken}` },
    });

    // Act
    const noTokenError = await catchError(() => guard.canActivate(noTokenContext));
    const wrongSignatureError = await catchError(() => guard.canActivate(wrongSignatureContext));

    // Assert
    expect(wrongSignatureError).toBeInstanceOf(UnauthorizedException);
    expect((wrongSignatureError as UnauthorizedException).getResponse()).toEqual(
      (noTokenError as UnauthorizedException).getResponse(),
    );
  });

  it('debería lanzar 403 cuando el rol del token no coincide con @Auth(admin)', async () => {
    // Arrange
    const { guard, jwt } = build();
    const token = await jwt.signAsync(USER_CLAIMS);
    const context = buildContext(AdminOnlyCarrier, {
      headers: { authorization: `Bearer ${token}` },
    });

    // Act + Assert
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('debería pasar cuando el rol del token coincide con @Auth(admin)', async () => {
    // Arrange
    const { guard, jwt } = build();
    const token = await jwt.signAsync(ADMIN_CLAIMS);
    const context = buildContext(AdminOnlyCarrier, {
      headers: { authorization: `Bearer ${token}` },
    });

    // Act
    const result = await guard.canActivate(context);

    // Assert
    expect(result).toBe(true);
  });

  // Caso añadido (infra exenta de tabla) — `@Auth()` sin roles no exige ningún rol
  // concreto: solo pide un token válido, distinto de `@Auth('admin')`.
  it('debería pasar con @Auth() sin roles ante cualquier token válido', async () => {
    // Arrange
    const { guard, jwt } = build();
    const token = await jwt.signAsync(USER_CLAIMS);
    const context = buildContext(ProtectedCarrier, {
      headers: { authorization: `Bearer ${token}` },
    });

    // Act
    const result = await guard.canActivate(context);

    // Assert
    expect(result).toBe(true);
  });

  // Caso añadido (infra exenta de tabla) — pin de construcción-por-string (hallazgo de
  // la review de Task 6, ahora fijado en error-example.factory.spec.ts): el contrato
  // publicado promete `error: 'Unauthorized'` / `'Forbidden'` canónicos, que solo se
  // sostienen si el guard construye las excepciones con el string, nunca sin argumento.
  it('debería construir el 401 y el 403 con el body canónico exacto', async () => {
    // Arrange
    const { guard, jwt } = build();
    const noTokenContext = buildContext(ProtectedCarrier, { headers: {} });
    const userToken = await jwt.signAsync(USER_CLAIMS);
    const forbiddenContext = buildContext(AdminOnlyCarrier, {
      headers: { authorization: `Bearer ${userToken}` },
    });

    // Act
    const unauthorizedError = await catchError(() => guard.canActivate(noTokenContext));
    const forbiddenError = await catchError(() => guard.canActivate(forbiddenContext));

    // Assert
    expect((unauthorizedError as UnauthorizedException).getResponse()).toEqual({
      statusCode: 401,
      message: 'Unauthorized',
      error: 'Unauthorized',
    });
    expect((forbiddenError as ForbiddenException).getResponse()).toEqual({
      statusCode: 403,
      message: 'Forbidden',
      error: 'Forbidden',
    });
  });
});

// Helpers

function build() {
  const jwt = new JwtService({ secret: SECRET });
  const guard = new JwtAuthGuard(new Reflector(), jwt);
  return { guard, jwt };
}

/** Fabrica un ExecutionContext mínimo: solo lo que el guard consume. */
const buildContext = (
  carrierClass: { prototype: { handler: () => void } },
  request: Record<string, unknown>,
): ExecutionContext =>
  ({
    getHandler: () => carrierClass.prototype.handler,
    getClass: () => carrierClass,
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

const catchError = async (fn: () => Promise<unknown>): Promise<unknown> => {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  // FUERA del try/catch: si quedara dentro, este mismo throw caería en el catch de
  // arriba y el test vería su propio sentinel como si fuera el error del SUT — el
  // diagnóstico jamás llegaría a superficie.
  throw new Error('Se esperaba que la función lanzara.');
};
