import { Controller, Delete, Get, Param, Query, UseFilters } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { ApiStandardErrors } from '@common/decorators/api-standard-errors.decorator';
import { Auth } from '@common/decorators/auth.decorator';
import { ApiEnvelope, ApiPaginatedEnvelope } from '@common/dto/api-envelope.dto';
import { buildErrorExample } from '@common/dto/error-example.factory';
import { ErrorResponseDto, ValidationErrorResponseDto } from '@common/dto/error-response.dto';
import { PaginatedResponseDto } from '@common/dto/paginated-response.dto';
import { PaginationDto } from '@common/dto/pagination.dto';

import { DeactivateUserUseCase } from '../../application/use-cases/deactivate-user.use-case';
import { FindUserByIdUseCase } from '../../application/use-cases/find-user-by-id.use-case';
import { ListUsersUseCase } from '../../application/use-cases/list-users.use-case';

import { UserResponseDto } from './dto/user-response.dto';
import { UserDomainExceptionFilter } from './user-domain-exception.filter';

/** Id de ejemplo. Es un UUID v4 válido: `UserId.from()` rechaza cualquier otra cosa con 400. */
const USER_ID_EXAMPLE = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';

const COLLECTION_PATH = '/api/v1/users';
const ITEM_PATH = `${COLLECTION_PATH}/${USER_ID_EXAMPLE}`;

/** Lo que `TransformInterceptor` añade a toda respuesta de éxito. */
const requestMeta = (path: string) => ({
  timestamp: '2026-08-01T10:15:00.000Z',
  path,
  requestId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
});

const USER_EXAMPLE = {
  id: USER_ID_EXAMPLE,
  email: 'maria.gonzalez@empresa.com.mx',
  name: 'María González',
  role: 'user',
  active: true,
  createdAt: '2026-08-01T10:15:00.000Z',
  updatedAt: '2026-08-01T10:15:00.000Z',
} as const;

/**
 * Cuerpo de error tal y como lo emite `AllExceptionsFilter`, no como lo lanza el dominio.
 *
 * `error` sale de `body.error ?? exception.name`, y `UserDomainExceptionFilter` traduce el error
 * de dominio a una excepción de Nest **construida con un string**: `new NotFoundException(msg)`
 * produce `{ statusCode, message: msg, error: 'Not Found' }`. Es decir, el nombre de la clase de
 * dominio nunca llega al cliente — medido, no supuesto. Documentar `error: 'UserNotFoundError'`
 * habría publicado un discriminante que ningún cliente puede observar.
 */
/**
 * Los ejemplos de error salen de la factoria comun, que deriva `error` del status en vez de
 * recibirlo. Escribirlo a mano fue el origen de dos ficciones en la primera version de este
 * archivo: anunciaba `EmailAlreadyTakenError` y `UserNotFoundError`, cuando el filtro publica
 * los nombres canonicos `Conflict` y `Not Found`.
 */
const errorExample = (statusCode: number, message: string, path: string) =>
  buildErrorExample(statusCode, { path, message });

/**
 * Adaptador de entrada (driver). No contiene reglas de negocio: valida el transporte,
 * delega en el caso de uso y traduce el resultado a DTO. Nunca toca el repositorio.
 *
 * **Sin `POST /users` desde el ciclo 4.** El alta pública se fue a `POST /auth/register`:
 * quien nace en un alta es una CUENTA —perfil + credencial— y la credencial es de `auth`.
 * `CreateUserUseCase` sigue vivo, pero su único consumidor es ahora `UsersFacade`.
 */
@ApiTags('Users')
@Controller('users')
@UseFilters(UserDomainExceptionFilter)
export class UsersController {
  constructor(
    private readonly findUserById: FindUserByIdUseCase,
    private readonly listUsers: ListUsersUseCase,
    private readonly deactivateUser: DeactivateUserUseCase,
  ) {}

  // `@Auth` ya adjunta bearer + 401 (+403 con roles): duplicar aquí un
  // `@ApiUnauthorizedResponse` concatenaría descripciones en el documento.
  @Auth('admin')
  @Get()
  @ApiOperation({
    operationId: 'listUsers',
    summary: 'Lista usuarios paginados',
    description:
      'Devuelve una página de usuarios junto con metadatos de paginación. `hasNextPage` depende ' +
      'del total real, así que pedir una página más allá del final devuelve una lista vacía, no 404.',
  })
  @ApiPaginatedEnvelope(UserResponseDto, {
    description: 'Página de usuarios.',
    example: {
      success: true,
      data: {
        items: [USER_EXAMPLE],
        meta: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      },
      request: requestMeta(COLLECTION_PATH),
    },
  })
  @ApiBadRequestResponse({
    description: 'La paginación no supera la validación de entrada.',
    type: ValidationErrorResponseDto,
    example: errorExample(
      400,
      'page must not be less than 1, limit must not be greater than 100',
      `${COLLECTION_PATH}?page=0&limit=101`,
    ),
  })
  @ApiStandardErrors()
  async list(@Query() pagination: PaginationDto): Promise<PaginatedResponseDto<UserResponseDto>> {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;

    const result = await this.listUsers.execute({ skip: pagination.skip, take: limit });

    return PaginatedResponseDto.of(
      result.items.map((user) => UserResponseDto.fromDomain(user)),
      result.total,
      page,
      limit,
    );
  }

  @Auth()
  @Get(':id')
  @ApiOperation({
    operationId: 'findUserById',
    summary: 'Obtiene un usuario por su id',
    description: 'Devuelve el usuario completo. Si no existe devuelve 404, nunca un cuerpo vacío.',
  })
  @ApiParam({
    name: 'id',
    description: 'Identificador del usuario, en formato UUID v4.',
    format: 'uuid',
    example: USER_ID_EXAMPLE,
  })
  @ApiEnvelope(UserResponseDto, {
    description: 'Usuario encontrado.',
    example: {
      success: true,
      data: USER_EXAMPLE,
      request: requestMeta(ITEM_PATH),
    },
  })
  @ApiNotFoundResponse({
    description: 'El usuario no existe.',
    type: ErrorResponseDto,
    example: errorExample(404, `User ${USER_ID_EXAMPLE} was not found`, ITEM_PATH),
  })
  // El 400 aquí no lo produce `ValidationPipe` —`@Param('id')` llega como `string` y no lleva
  // `ParseUUIDPipe`— sino el value object: `UserId.from()` lanza `InvalidUserIdError` y
  // `UserDomainExceptionFilter` lo traduce a `BadRequestException`. El código es el mismo y la
  // forma del cuerpo también; el mensaje no, de ahí este ejemplo propio.
  @ApiBadRequestResponse({
    description: 'El id no es un UUID v4.',
    type: ValidationErrorResponseDto,
    example: errorExample(
      400,
      '"no-es-uuid" is not a valid user id',
      `${COLLECTION_PATH}/no-es-uuid`,
    ),
  })
  @ApiStandardErrors()
  async findOne(@Param('id') id: string): Promise<UserResponseDto> {
    const user = await this.findUserById.execute({ userId: id });
    return UserResponseDto.fromDomain(user);
  }

  @Auth('admin')
  @Delete(':id')
  @ApiOperation({
    operationId: 'deactivateUser',
    summary: 'Desactiva un usuario sin borrarlo',
    description:
      'Marca al usuario como inactivo conservando la fila y sus datos. Es idempotente: ' +
      'desactivar un usuario ya inactivo no falla, devuelve 200 con `active: false`. ' +
      'Responde 200 con el usuario resultante, no 204.',
  })
  @ApiParam({
    name: 'id',
    description: 'Identificador del usuario, en formato UUID v4.',
    format: 'uuid',
    example: USER_ID_EXAMPLE,
  })
  @ApiEnvelope(UserResponseDto, {
    description: 'Usuario desactivado.',
    example: {
      success: true,
      // `updatedAt` avanza: `User.deactivate()` lo sella con el instante del cambio. Dejarlo
      // igual a `createdAt` describiría una desactivación que no tocó la fila.
      data: { ...USER_EXAMPLE, active: false, updatedAt: '2026-08-01T12:30:00.000Z' },
      request: requestMeta(ITEM_PATH),
    },
  })
  @ApiNotFoundResponse({
    description: 'El usuario no existe.',
    type: ErrorResponseDto,
    example: errorExample(404, `User ${USER_ID_EXAMPLE} was not found`, ITEM_PATH),
  })
  @ApiBadRequestResponse({
    description: 'El id no es un UUID v4.',
    type: ValidationErrorResponseDto,
    example: errorExample(
      400,
      '"no-es-uuid" is not a valid user id',
      `${COLLECTION_PATH}/no-es-uuid`,
    ),
  })
  @ApiStandardErrors()
  async deactivate(@Param('id') id: string): Promise<UserResponseDto> {
    const user = await this.deactivateUser.execute({ userId: id });
    return UserResponseDto.fromDomain(user);
  }
}
