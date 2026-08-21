import { Reflector } from '@nestjs/core';

import { Auth, AuthRoles, GENERIC_PATH } from '../../decorators/auth.decorator';
import { buildErrorExample } from '../../dto/error-example.factory';
import { ErrorResponseDto } from '../../dto/error-response.dto';
import {
  declaredResponses,
  declaredStatuses,
  responsesOf,
  securityOf,
  statusesIn,
} from '../helpers/swagger-metadata';

describe('Auth', () => {
  it('debería declarar bearer y 401 sin roles', () => {
    // Arrange
    class Target {
      @Auth()
      handler(): void {
        // Solo existe para portar la metadata del decorador.
      }
    }

    // Act
    const statuses = declaredStatuses(Target, 'handler');
    const security = securityOf(Target, 'handler');

    // Assert
    expect(statuses).toEqual([401]);
    expect(security).toEqual([{ bearer: [] }]);
  });

  it('debería NO declarar 403 cuando no se piden roles', () => {
    // Arrange
    class Target {
      @Auth()
      handler(): void {
        // Solo existe para portar la metadata del decorador.
      }
    }

    // Act
    const statuses = declaredStatuses(Target, 'handler');

    // Assert
    expect(statuses).not.toContain(403);
  });

  it('debería declarar 403 cuando se pide un rol', () => {
    // Arrange
    class Target {
      @Auth('admin')
      handler(): void {
        // Solo existe para portar la metadata del decorador.
      }
    }

    // Act
    const statuses = declaredStatuses(Target, 'handler');

    // Assert
    expect(statuses).toEqual([401, 403]);
  });

  it('debería incluir los roles pedidos en la description del 403', () => {
    // Arrange
    class Target {
      @Auth('admin', 'user')
      handler(): void {
        // Solo existe para portar la metadata del decorador.
      }
    }

    // Act
    const description = declaredResponses(Target, 'handler')['403']?.description;

    // Assert
    expect(description).toContain('admin | user');
  });

  it('debería publicar en el 401 el example y el DTO reales de AllExceptionsFilter', () => {
    // Arrange
    class Target {
      @Auth()
      handler(): void {
        // Solo existe para portar la metadata del decorador.
      }
    }

    // Act
    const response = declaredResponses(Target, 'handler')['401'];

    // Assert
    expect(response?.type).toBe(ErrorResponseDto);
    expect(response?.example).toEqual(
      buildErrorExample(401, { path: GENERIC_PATH, message: 'Unauthorized' }),
    );
  });

  it('debería publicar en el 403 el example y el DTO reales de AllExceptionsFilter', () => {
    // Arrange
    class Target {
      @Auth('admin')
      handler(): void {
        // Solo existe para portar la metadata del decorador.
      }
    }

    // Act
    const response = declaredResponses(Target, 'handler')['403'];

    // Assert
    expect(response?.type).toBe(ErrorResponseDto);
    expect(response?.example).toEqual(
      buildErrorExample(403, { path: GENERIC_PATH, message: 'Forbidden' }),
    );
  });

  it('debería poder aplicarse a nivel de clase', () => {
    // Arrange
    @Auth('admin')
    class Target {}

    // Act
    const statuses = statusesIn(responsesOf(Target));

    // Assert
    expect(statuses).toEqual([401, 403]);
  });

  // El guard (Task 7) resuelve roles con `getAllAndOverride`, que consulta la metadata a nivel
  // de clase cuando el handler no la trae — sin este caso, aplicar `@Auth('admin')` al
  // controller entero podría no dejar nada legible ahí y el guard fallaría en silencio.
  it('debería dejar leíble la metadata de AuthRoles a nivel de clase', () => {
    // Arrange
    @Auth('admin')
    class Target {}

    // Act
    const roles = new Reflector().get(AuthRoles, Target);

    // Assert
    expect(roles).toEqual(['admin']);
  });
});

describe('AuthRoles', () => {
  it('debería guardar la lista de roles pedida', () => {
    // Arrange
    class Target {
      @Auth('admin')
      handler(): void {
        // Solo existe para portar la metadata del decorador.
      }
    }

    // Act
    const roles = rolesOf(Target.prototype.handler);

    // Assert
    expect(roles).toEqual(['admin']);
  });

  // Distinto del caso de arriba ("description del 403"), que solo comprueba el join en texto:
  // este lee la metadata cruda que `JwtAuthGuard` consulta de verdad para decidir acceso, así
  // que un `AuthRoles(roles)` que perdiera el orden o un elemento seguiría con la description
  // en verde y este `it` en rojo.
  it('debería guardar varios roles en el orden pedido', () => {
    // Arrange
    class Target {
      @Auth('admin', 'user')
      handler(): void {
        // Solo existe para portar la metadata del decorador.
      }
    }

    // Act
    const roles = rolesOf(Target.prototype.handler);

    // Assert
    expect(roles).toEqual(['admin', 'user']);
  });

  it('debería guardar un array vacío sin roles', () => {
    // Arrange
    class Target {
      @Auth()
      handler(): void {
        // Solo existe para portar la metadata del decorador.
      }
    }

    // Act
    const roles = rolesOf(Target.prototype.handler);

    // Assert
    expect(roles).toEqual([]);
  });
});

// Helpers

const rolesOf = (handler: () => void): readonly string[] | undefined =>
  new Reflector().get(AuthRoles, handler);
