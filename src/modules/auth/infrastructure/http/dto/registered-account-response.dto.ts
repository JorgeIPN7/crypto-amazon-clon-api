import { ApiProperty } from '@nestjs/swagger';

// Ver `authenticated-user.dto.ts`: se importa el `type` de datos del puerto, no el puerto.
// eslint-disable-next-line no-restricted-syntax
import type { DirectoryUser } from '../../../domain/ports/user-directory';

import { AuthenticatedUserDto } from './authenticated-user.dto';

/**
 * Respuesta del alta. Envuelve al usuario en un campo `user` en vez de publicarlo plano —a
 * diferencia del `POST /users` que sustituye— para que la respuesta tenga la misma forma que
 * la del login: el día que el registro emita también un token, `accessToken` entra al lado de
 * `user` sin romper a nadie.
 *
 * NO devuelve token hoy, y es deliberado: registrarse y autenticarse son dos intenciones, y
 * emitir un JWT en el alta saltaría el límite de 10/min del login para cualquiera que quiera
 * un token nuevo.
 */
export class RegisteredAccountResponseDto {
  @ApiProperty({ description: 'La cuenta recién registrada.', type: AuthenticatedUserDto })
  user!: AuthenticatedUserDto;

  static fromDirectory(user: DirectoryUser): RegisteredAccountResponseDto {
    const dto = new RegisteredAccountResponseDto();
    dto.user = AuthenticatedUserDto.fromDirectory(user);
    return dto;
  }
}
