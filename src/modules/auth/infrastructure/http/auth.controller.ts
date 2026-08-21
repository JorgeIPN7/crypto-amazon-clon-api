import { Body, Controller, HttpCode, HttpStatus, Post, UseFilters } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { ApiStandardErrors } from '@common/decorators/api-standard-errors.decorator';
import { Public } from '@common/decorators/public.decorator';
import { ApiEnvelope } from '@common/dto/api-envelope.dto';
import { buildErrorExample } from '@common/dto/error-example.factory';
import { ErrorResponseDto, ValidationErrorResponseDto } from '@common/dto/error-response.dto';

import { LoginUseCase } from '../../application/use-cases/login.use-case';
import { RegisterAccountUseCase } from '../../application/use-cases/register-account.use-case';

import { AuthDomainExceptionFilter } from './auth-domain-exception.filter';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { RegisterAccountDto } from './dto/register-account.dto';
import { RegisteredAccountResponseDto } from './dto/registered-account-response.dto';

const LOGIN_PATH = '/api/v1/auth/login';
const REGISTER_PATH = '/api/v1/auth/register';

/** Lo que `TransformInterceptor` añade a toda respuesta de éxito. */
const requestMeta = (path: string) => ({
  timestamp: '2026-08-01T10:15:00.000Z',
  path,
  requestId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
});

const ACCOUNT_EXAMPLE = {
  id: '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012',
  email: 'maria.gonzalez@empresa.com.mx',
  name: 'María González',
  role: 'user',
  active: true,
  createdAt: '2026-08-01T10:15:00.000Z',
  updatedAt: '2026-08-01T10:15:00.000Z',
} as const;

/** Los ejemplos de error salen SIEMPRE de la factoría: `error` se deriva del status. */
const errorExample = (statusCode: number, message: string, path: string) =>
  buildErrorExample(statusCode, { path, message });

/**
 * Adaptador de entrada (driver) del bounded context. No verifica credenciales ni crea nada:
 * traduce transporte a entrada del caso de uso y resultado a DTO.
 *
 * El límite de 10/min va en la CLASE y cubre los dos endpoints. `ThrottlerGuard` genera la
 * clave con `clase + handler + ip`, así que registro y login llevan CONTADORES SEPARADOS: el
 * decorador compartido fija la política, no el cupo.
 */
@ApiTags('Auth')
@Controller('auth')
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@UseFilters(AuthDomainExceptionFilter)
export class AuthController {
  constructor(
    private readonly registerAccount: RegisterAccountUseCase,
    // El sufijo evita la colisión con el método `login()` de abajo — un parameter property y
    // un método no pueden compartir nombre.
    private readonly loginUseCase: LoginUseCase,
  ) {}

  // `@Public()`: sin alta pública nadie llegaría a tener credenciales que presentar en
  // `/auth/login`. El rol siempre nace `user` — promover es cosa del seed.
  @Public()
  @Post('register')
  @ApiOperation({
    operationId: 'registerAccount',
    summary: 'Registra una cuenta nueva',
    description:
      'Crea el perfil del usuario y su credencial de acceso. El email debe ser único: si ya ' +
      'está registrado devuelve 409, tanto si lo detecta la comprobación previa como si lo ' +
      'detecta el índice único de PostgreSQL en un alta concurrente. El email se normaliza a ' +
      'minúsculas antes de guardarse. Perfil y credencial viven en tablas distintas y con ' +
      'dueños distintos: si la credencial no puede escribirse, se borran las dos filas y la ' +
      'petición falla — nunca queda una cuenta sin forma de entrar ni una credencial sin ' +
      'dueño. Tiene un límite de peticiones propio, más estricto que el global: 10 por ' +
      'minuto. A diferencia de /auth/login, este endpoint SÍ revela si un email ya tiene ' +
      'cuenta: es un compromiso aceptado a favor de la usabilidad del alta, no un descuido ' +
      '— sin el 409 quien ya tiene cuenta no sabría por qué no puede registrarse. Lo que no ' +
      'se revela es nada más: los dos caminos cuestan lo mismo, porque la contraseña se ' +
      'hashea antes de comprobar la unicidad.',
  })
  // El contract guard NO valida los examples de request contra el schema, así que un
  // example sin `password` se publicaría en silencio: se mantienen a mano, completos.
  @ApiBody({
    type: RegisterAccountDto,
    examples: {
      standard: {
        summary: 'Alta estándar',
        value: {
          email: 'maria.gonzalez@empresa.com.mx',
          name: 'María González',
          password: 'una-frase-larga-y-dificil-de-adivinar',
        },
      },
      minimumName: {
        summary: 'Nombre en el límite inferior (2 caracteres)',
        value: {
          email: 'jl@empresa.com.mx',
          name: 'JL',
          password: 'otra-frase-larga-distinta',
        },
      },
    },
  })
  @ApiEnvelope(RegisteredAccountResponseDto, {
    status: HttpStatus.CREATED,
    description: 'Cuenta registrada.',
    example: {
      success: true,
      data: { user: ACCOUNT_EXAMPLE },
      request: requestMeta(REGISTER_PATH),
    },
  })
  @ApiConflictResponse({
    description: 'El email ya está registrado.',
    type: ErrorResponseDto,
    example: errorExample(
      409,
      'Email maria.gonzalez@empresa.com.mx is already registered',
      REGISTER_PATH,
    ),
  })
  @ApiBadRequestResponse({
    description: 'El cuerpo no supera la validación de entrada.',
    type: ValidationErrorResponseDto,
    example: errorExample(
      400,
      'email must be a valid address, name must be longer than or equal to 2 characters',
      REGISTER_PATH,
    ),
  })
  @ApiStandardErrors()
  async register(@Body() dto: RegisterAccountDto): Promise<RegisteredAccountResponseDto> {
    const user = await this.registerAccount.execute({
      email: dto.email,
      name: dto.name,
      password: dto.password,
    });
    return RegisteredAccountResponseDto.fromDirectory(user);
  }

  // `@Public()`: sin login público nadie puede obtener el primer token. El límite propio
  // de 10/min (sobre el global) frena la fuerza bruta contra un endpoint que, por
  // anti-enumeración, responde igual a cualquier credencial mala.
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'login',
    summary: 'Autentica un usuario y emite un JWT',
    description:
      'Verifica email y contraseña y devuelve un token de acceso firmado junto con el usuario ' +
      'autenticado. Anti-enumeración: el 401 es idéntico —mismo código, mismo mensaje y mismo ' +
      'costo de tiempo— para email inexistente, cuenta sin credencial, password incorrecto o ' +
      'cuenta inactiva. Tiene un límite de peticiones propio, más estricto que el global: 10 ' +
      'por minuto.',
  })
  @ApiBody({
    type: LoginDto,
    examples: {
      valid: {
        summary: 'Credenciales registradas',
        value: { email: 'maria.gonzalez@empresa.com.mx', password: 'Password-Segura-1' },
      },
    },
  })
  @ApiEnvelope(LoginResponseDto, {
    description: 'Token emitido.',
    example: {
      success: true,
      data: {
        accessToken:
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
          'eyJzdWIiOiI5ZDJhMWM3ZS0xZjZiLTRhMmUtOWMzZC03N2ExYjBlNWYwMTIiLCJlbWFpbCI6Im1hcmlhLmdv' +
          'bnphbGV6QGVtcHJlc2EuY29tLm14Iiwicm9sZSI6InVzZXIiLCJpYXQiOjE3NzUwMzg1MDAsImV4cCI6MTc3' +
          'NTA0MjEwMH0.3fdVXyXou3-1S4jEsRfF1sBOesDNJlSGRRzqQ8mzq0k',
        expiresInSeconds: 3600,
        user: ACCOUNT_EXAMPLE,
      },
      request: requestMeta(LOGIN_PATH),
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Credenciales inválidas.',
    type: ErrorResponseDto,
    example: errorExample(401, 'Invalid credentials', LOGIN_PATH),
  })
  // Mismo criterio que `UsersController`: el 400 se declara aquí con el mensaje real del
  // DTO, no con el ejemplo genérico de `ApiStandardErrors({ validation: true })`.
  @ApiBadRequestResponse({
    description: 'El cuerpo no supera la validación de entrada.',
    type: ValidationErrorResponseDto,
    example: errorExample(
      400,
      'email must be a valid address, password must be longer than or equal to 12 characters',
      LOGIN_PATH,
    ),
  })
  @ApiStandardErrors()
  async login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    const result = await this.loginUseCase.execute({ email: dto.email, password: dto.password });
    return LoginResponseDto.fromResult(result);
  }
}
