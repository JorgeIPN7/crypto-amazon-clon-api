import type { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '../../nest-metadata.constants';

import type { AuthenticatedUser } from '../../auth/authenticated-user';
import { CurrentUser } from '../../decorators/current-user.decorator';

// Chequeo de compilación (no es un it): el TokenClaims del dominio debe seguir siendo
// asignable al tipo laxo de common. Si divergen, esto rompe `pnpm typecheck`. Los tests
// están exentos de la matriz de boundaries, así que este import cruzado a `@modules/auth`
// es legal aquí y en ningún otro lugar de `common/`. Apunta a `auth` desde el ciclo 4: los
// claims son de quien firma y verifica el token, no del perfil.
import type { TokenClaims } from '@modules/auth/domain/ports/token-signer';

const _claimsAssignable: AuthenticatedUser = {} as TokenClaims;
void _claimsAssignable;

describe('CurrentUser', () => {
  it('debería devolver los claims cuando el guard los adjuntó', () => {
    // Arrange
    const user = { sub: 'u-1', email: 'maria@example.com', role: 'user' };
    const factory = extractFactory();
    const context = contextWithUser(user);

    // Act
    const result = factory(undefined, context);

    // Assert
    expect(result).toEqual(user);
  });

  it('debería lanzar un Error explicativo cuando la ruta no pasó por el guard', () => {
    // Arrange
    const factory = extractFactory();
    const context = contextWithUser(undefined);

    // Act + Assert
    expect(() => factory(undefined, context)).toThrow(/JwtAuthGuard|@Public/);
  });
});

// Helpers

type ParamFactory = (data: unknown, ctx: ExecutionContext) => AuthenticatedUser;

/**
 * `createParamDecorator` no expone su factory: la guarda en la metadata de ruta que
 * Nest lee en tiempo de ejecución. Aplicamos el decorador a una clase de prueba y la
 * recuperamos desde ahí, que es la única vía sin duplicar la implementación (mismo
 * patrón que `request-id.decorator.spec.ts`).
 */
class Probe {
  handler(@CurrentUser() _user: AuthenticatedUser): void {
    // Solo existe para que el decorador registre su metadata.
  }
}

function extractFactory(): ParamFactory {
  const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, Probe, 'handler') as Record<
    string,
    { factory: ParamFactory }
  >;
  const entry = Object.values(metadata)[0];
  if (!entry) {
    throw new Error('No se encontró la metadata del decorador CurrentUser');
  }
  return entry.factory;
}

function contextWithUser(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}
