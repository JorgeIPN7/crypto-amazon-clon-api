import { ApiProperty } from '@nestjs/swagger';

import type { LoginResult } from '../../../application/use-cases/login.use-case';

import { AuthenticatedUserDto } from './authenticated-user.dto';

export class LoginResponseDto {
  @ApiProperty({
    description: 'JWT de acceso (HS256). Va en `Authorization: Bearer <token>`.',
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      'eyJzdWIiOiI5ZDJhMWM3ZS0xZjZiLTRhMmUtOWMzZC03N2ExYjBlNWYwMTIiLCJlbWFpbCI6Im1hcmlhLmdvbnph' +
      'bGV6QGVtcHJlc2EuY29tLm14Iiwicm9sZSI6InVzZXIiLCJpYXQiOjE3NzUwMzg1MDAsImV4cCI6MTc3NTA0MjEwMH0.' +
      '3fdVXyXou3-1S4jEsRfF1sBOesDNJlSGRRzqQ8mzq0k',
  })
  accessToken!: string;

  @ApiProperty({
    description:
      'Vida del token en segundos. No hay refresh token: al expirar, el cliente vuelve a ' +
      'autenticarse.',
    example: 3600,
  })
  expiresInSeconds!: number;

  @ApiProperty({ description: 'El usuario autenticado.', type: AuthenticatedUserDto })
  user!: AuthenticatedUserDto;

  /** Campo a campo, nunca spread: un campo nuevo del resultado no se filtra sin decidirlo. */
  static fromResult(result: LoginResult): LoginResponseDto {
    const dto = new LoginResponseDto();
    dto.accessToken = result.accessToken;
    dto.expiresInSeconds = result.expiresInSeconds;
    dto.user = AuthenticatedUserDto.fromDirectory(result.user);
    return dto;
  }
}
