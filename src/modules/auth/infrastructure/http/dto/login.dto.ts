import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description: 'Correo con el que se registró el usuario.',
    example: 'maria.gonzalez@empresa.com.mx',
    format: 'email',
  })
  // Mismo mensaje que `CreateUserDto`: el ejemplo del 400 lo cita literalmente.
  @IsEmail({}, { message: 'email must be a valid address' })
  email!: string;

  @ApiProperty({
    description: 'Contraseña en claro. Mismos límites que en el alta: entre 12 y 128 caracteres.',
    example: 'una-frase-larga-y-dificil-de-adivinar',
    minLength: 12,
    maxLength: 128,
  })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}
