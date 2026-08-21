import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Length, Max, Min } from 'class-validator';

/**
 * Sin `customerId` A PROPÓSITO (anti-spoof, spec §2): sale del `sub` del token. Si el
 * body lo trae igualmente, `forbidNonWhitelisted` del ValidationPipe global responde 400.
 */
export class PlaceOrderDto {
  @ApiProperty({
    description:
      'Concepto de la orden, entre 1 y 140 caracteres. El dominio recorta espacios: un ' +
      'concepto de solo espacios se rechaza con 400 aunque pase la longitud.',
    example: 'Suscripción anual plan Pro',
    minLength: 1,
    maxLength: 140,
  })
  @IsString()
  @Length(1, 140)
  concept!: string;

  @ApiProperty({
    description:
      'Importe en céntimos: entero positivo, máximo 10 000 000. Céntimos y no decimales ' +
      'para que el importe nunca pase por un flotante.',
    example: 149_900,
    minimum: 1,
    maximum: 10_000_000,
  })
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  amountCents!: number;
}
