import { Controller, Delete, Get, Param, Query, UseFilters } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import type { AuthenticatedUser } from '@common/auth/authenticated-user';
import { ApiStandardErrors } from '@common/decorators/api-standard-errors.decorator';
import { Auth } from '@common/decorators/auth.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { ApiEnvelope, ApiPaginatedEnvelope } from '@common/dto/api-envelope.dto';
import { TIMESTAMP } from '@common/dto/error-example.factory';
import { ErrorResponseDto, ValidationErrorResponseDto } from '@common/dto/error-response.dto';
import { errorExample, requestMeta } from '@common/dto/openapi-example.helpers';
import { PaginatedResponseDto } from '@common/dto/paginated-response.dto';
import { PaginationDto } from '@common/dto/pagination.dto';

import { DeactivateUserUseCase } from '../../application/use-cases/deactivate-user.use-case';
import { FindUserByIdUseCase } from '../../application/use-cases/find-user-by-id.use-case';
import { ListUsersUseCase } from '../../application/use-cases/list-users.use-case';

import { UserResponseDto } from './dto/user-response.dto';
import { UsersDomainExceptionFilter } from './users-domain-exception.filter';

/** Id de ejemplo. Es un UUID v4 válido: `UserId.from()` rechaza cualquier otra cosa con 400. */
const USER_ID_EXAMPLE = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';

const COLLECTION_PATH = '/api/v1/users';
const ITEM_PATH = `${COLLECTION_PATH}/${USER_ID_EXAMPLE}`;

const USER_EXAMPLE = {
  id: USER_ID_EXAMPLE,
  email: 'maria.gonzalez@empresa.com.mx',
  name: 'María González',
  role: 'user',
  active: true,
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
} as const;

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
@UseFilters(UsersDomainExceptionFilter)
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
  // `UsersDomainExceptionFilter` lo traduce a `BadRequestException`. El código es el mismo y la
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
  // El actor de la auditoría sale del `sub` del token y JAMÁS de la ruta ni del body — mismo
  // criterio anti-spoof que `OrdersController` con `customerId`, que es el precedente. No añade
  // nada al documento OpenAPI: `@CurrentUser()` es un `createParamDecorator` puro, sin metadatos
  // de swagger, así que la operación publicada no cambia (lo comprueba `openapi-contract`).
  //
  // El endpoint es `@Auth('admin')`, así que aquí `user.sub` nunca es `null`: el guard ya
  // rechazó a quien no trae token. El `null` del tipo es para llamantes sin HTTP delante.
  async deactivate(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    const user = await this.deactivateUser.execute({ userId: id, by: actor.sub });
    return UserResponseDto.fromDomain(user);
  }
}
