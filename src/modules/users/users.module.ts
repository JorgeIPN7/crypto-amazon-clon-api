import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsersFacadeImpl, UsersLookup, UsersProvisioning } from './application/users.facade';
import { CreateUserUseCase } from './application/use-cases/create-user.use-case';
import { DeactivateUserUseCase } from './application/use-cases/deactivate-user.use-case';
import { FindUserByIdUseCase } from './application/use-cases/find-user-by-id.use-case';
import { ListUsersUseCase } from './application/use-cases/list-users.use-case';
import { UserRepository } from './domain/ports/user.repository';
import { UsersController } from './infrastructure/http/users.controller';
import { UserOrmEntity } from './infrastructure/persistence/user.orm-entity';
import { UserTypeOrmRepository } from './infrastructure/persistence/user.typeorm.repository';

/**
 * Composition root del bounded context: aquí, y solo aquí, se une cada puerto del dominio
 * con su adaptador de infraestructura. Cambiar TypeORM por otra cosa se reduce a cambiar la
 * clase del `useClass` — ni el dominio ni la aplicación se enteran.
 *
 * Desde el ciclo 4 este módulo NO sabe nada de autenticación: `JwtModule`, `AuthController`,
 * `TokenSigner`, `PasswordHasher`, `LoginUseCase` y el `APP_GUARD` se fueron a
 * `auth.module.ts`. La dirección de la dependencia es `auth → users` y solo esa: si users
 * importara `auth.module` nacería el único ciclo módulo↔módulo posible del repo.
 */
@Module({
  imports: [TypeOrmModule.forFeature([UserOrmEntity])],
  controllers: [UsersController],
  providers: [
    // El token es la propia `abstract class` del puerto: `useClass` la ata a su adaptador,
    // y quien la declare como tipo de un parámetro de constructor la recibe sin `@Inject`.
    // Ojo: `ClassProvider.provide` está tipado como `any` — que el adaptador cumpla el
    // puerto lo garantiza su `implements`, no esta línea.
    { provide: UserRepository, useClass: UserTypeOrmRepository },
    // Puertas públicas del contexto: lo único de users que otro módulo puede inyectar.
    // `UserRepository` NO se exporta (ver `exports` más abajo) — si se exportara, un
    // consumidor cross-módulo podría inyectarlo directo y saltárselas.
    //
    // DOS tokens por intención desde el backlog #13, no uno: consultar el directorio y
    // aprovisionar perfiles son permisos distintos, y `orders` solo necesita el primero.
    // La implementación es una sola, registrada aquí por su clase y aliada con
    // `useExisting`: dos `useClass` darían dos instancias de la misma cosa.
    UsersFacadeImpl,
    { provide: UsersLookup, useExisting: UsersFacadeImpl },
    { provide: UsersProvisioning, useExisting: UsersFacadeImpl },
    // Sin endpoint propio desde que `POST /users` desapareció: lo consume la fachada, que
    // es por donde `auth` da de alta el perfil de una cuenta nueva.
    CreateUserUseCase,
    FindUserByIdUseCase,
    ListUsersUseCase,
    DeactivateUserUseCase,
  ],
  // `UsersFacadeImpl` NO se exporta: publicarla anularía la segregación, porque su tipo
  // declara los cuatro métodos. Solo salen los dos tokens.
  exports: [UsersLookup, UsersProvisioning],
})
export class UsersModule {}

// El module file ES la superficie pública del contexto (regla 3 de boundaries): quien
// necesite una de las dos puertas la importa DESDE AQUÍ, nunca desde
// `application/users.facade.ts`. Siendo `abstract class`, token y tipo son la MISMA
// referencia: el `exports` de arriba publica los providers al contenedor de Nest y este
// re-export publica esas referencias al compilador. Los `type` que viajan con ellas se
// re-exportan igual: son datos del contrato, no algo inyectable.
export { UsersLookup, UsersProvisioning } from './application/users.facade';
export type { CreateProfileResult, UserSummary } from './application/users.facade';
