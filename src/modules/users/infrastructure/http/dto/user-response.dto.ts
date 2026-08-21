import { ApiProperty } from '@nestjs/swagger';

import { USER_ROLES, type UserRole } from '../../../domain/value-objects/user-role';
import type { User } from '../../../domain/entities/user.entity';

export class UserResponseDto {
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

  // `enum` desde `USER_ROLES`, la misma constante del dominio: un rol nuevo entra al
  // contrato publicado sin que nadie tenga que acordarse de duplicarlo aquí.
  @ApiProperty({
    description: 'Rol del usuario. Gobierna el acceso a los endpoints administrativos.',
    enum: [...USER_ROLES],
    example: 'user',
  })
  role!: UserRole;

  @ApiProperty({
    description: 'Un usuario desactivado conserva sus datos pero no opera.',
    example: true,
  })
  active!: boolean;

  /**
   * El valor serializado es la cadena ISO-8601 de `Date.prototype.toJSON()`, y el esquema
   * publicado dice `type: 'string', format: 'date-time'` — que es lo que importa.
   *
   * `type: String` y `format` son, medidos, **redundantes**: con `decoratorMetadata` activo en
   * `.swcrc`, `@nestjs/swagger` ya mapea por su cuenta un `design:type` de `Date` a
   * `string`/`date-time`. Se conservan como red de seguridad porque esa inferencia depende de
   * que la metadata de decoradores siga emitiéndose; si alguien la desactiva, lo explícito
   * sobrevive y lo inferido no. Lo que NO son es la diferencia entre `string` y `object`.
   */
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

  /** El dominio nunca se serializa directamente: siempre pasa por este DTO. */
  static fromDomain(user: User): UserResponseDto {
    const snapshot = user.toSnapshot();
    const dto = new UserResponseDto();
    dto.id = snapshot.id;
    dto.email = snapshot.email;
    dto.name = snapshot.name;
    dto.role = snapshot.role;
    dto.active = snapshot.active;
    dto.createdAt = snapshot.createdAt;
    dto.updatedAt = snapshot.updatedAt;
    return dto;
  }
}
