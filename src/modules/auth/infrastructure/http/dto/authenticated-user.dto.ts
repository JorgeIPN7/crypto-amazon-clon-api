import { ApiProperty } from '@nestjs/swagger';

// Misma excepción legítima al blindaje de `ports/` que `jwt-auth.guard.ts`: de este archivo
// no se consume el PUERTO (`UserDirectory`, que un DTO jamás inyecta) sino el `type` de datos
// que lo acompaña. No hay referencia que borrar del emit, así que `import type` es correcto
// aquí, y la forma inline no es alternativa: `no-import-type-side-effects` la rechaza.
// eslint-disable-next-line no-restricted-syntax
import type { DirectoryUser } from '../../../domain/ports/user-directory';

/**
 * El usuario tal y como lo publica `auth` en las respuestas de login y registro.
 *
 * **Es un gemelo deliberado de `UserResponseDto` (users), no una reutilización.** `auth` no
 * puede importar un DTO de otro contexto —regla 3 del gate de boundaries—, y el contrato
 * HTTP publicado no puede cambiar porque el login se haya mudado de módulo. La paridad campo
 * a campo la sella `__tests__/infrastructure/http/dto/authenticated-user.dto.spec.ts`
 * comparando la metadata real de `@ApiProperty` de ambas clases: si una gana un campo y la
 * otra no, el spec se pone rojo. La comparación es por lista NEGRA —toda la metadata salvo
 * `type`, que lo rellena el `design:type` y no el autor—, así que una opción que llegue a
 * `components.schemas` (`required`, `nullable`, `maxLength`, `deprecated`…) entra comparada
 * por defecto en vez de colarse por no estar en una lista blanca.
 *
 * El `enum` de `role` SÍ se escribe a mano aquí, y es la única divergencia estructural:
 * `UserResponseDto` lo deriva de `USER_ROLES`, la constante del dominio de users, que auth no
 * puede importar. El spec de paridad compara los VALORES publicados, así que añadir un rol en
 * users y no aquí rompe el gate — que es la protección que la constante compartida daba.
 */
export class AuthenticatedUserDto {
  @ApiProperty({
    description: 'Identificador del usuario.',
    example: '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012',
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({
    description: 'Correo registrado.',
    example: 'maria.gonzalez@empresa.com.mx',
    format: 'email',
  })
  email!: string;

  @ApiProperty({ description: 'Nombre visible.', example: 'María González' })
  name!: string;

  @ApiProperty({
    description: 'Rol del usuario. Gobierna el acceso a los endpoints administrativos.',
    enum: ['admin', 'user'],
    example: 'user',
  })
  role!: string;

  @ApiProperty({
    description: 'Un usuario desactivado conserva sus datos pero no opera.',
    example: true,
  })
  active!: boolean;

  @ApiProperty({
    description: 'Alta, en UTC.',
    example: '2026-08-01T10:15:00.000Z',
    type: String,
    format: 'date-time',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'Última modificación, en UTC.',
    example: '2026-08-01T10:15:00.000Z',
    type: String,
    format: 'date-time',
  })
  updatedAt!: Date;

  /** Campo a campo, nunca spread: un campo nuevo del directorio no se filtra sin decidirlo. */
  static fromDirectory(user: DirectoryUser): AuthenticatedUserDto {
    const dto = new AuthenticatedUserDto();
    dto.id = user.id;
    dto.email = user.email;
    dto.name = user.name;
    dto.role = user.role;
    dto.active = user.active;
    dto.createdAt = user.createdAt;
    dto.updatedAt = user.updatedAt;
    return dto;
  }
}
