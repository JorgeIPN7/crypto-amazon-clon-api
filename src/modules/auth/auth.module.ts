import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import type { AuthConfig } from '@config/auth.config';

import { UsersModule } from '../users/users.module';

import { LoginUseCase } from './application/use-cases/login.use-case';
import { RegisterAccountUseCase } from './application/use-cases/register-account.use-case';
import { CredentialRepository } from './domain/ports/credential.repository';
import { PasswordHasher } from './domain/ports/password-hasher';
import { TokenSigner } from './domain/ports/token-signer';
import { UserDirectory } from './domain/ports/user-directory';
import { AuthController } from './infrastructure/http/auth.controller';
import { JwtAuthGuard } from './infrastructure/http/jwt-auth.guard';
import { CredentialOrmEntity } from './infrastructure/persistence/credential.orm-entity';
import { CredentialTypeOrmRepository } from './infrastructure/persistence/credential.typeorm.repository';
import { Argon2PasswordHasher } from './infrastructure/security/argon2-password-hasher';
import { NestJwtTokenSigner } from './infrastructure/security/nest-jwt-token-signer';
import { UsersUserDirectory } from './infrastructure/users-user.directory';

/**
 * Composition root del bounded context. `UsersModule` se importa por su module file —la única
 * puerta cross-módulo (regla 3 + enmienda G1)— y de él solo se consume `UsersFacade`,
 * inyectada en el adapter del directorio.
 *
 * La dirección es de una sola vía y así debe quedarse: `auth → users`, nunca al revés. Si
 * `users` importara `auth.module` (por ejemplo para el guard) nacería el único ciclo
 * módulo↔módulo posible del repo — y por eso `@Public`, `@Auth`, `@CurrentUser` y
 * `AuthenticatedUser` se quedan en `common/`, donde ambos pueden verlos.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([CredentialOrmEntity]),
    // El secret y la expiración salen de `AuthConfig`, la MISMA fuente que lee
    // `NestJwtTokenSigner` para responder `expiresInSeconds`: firma y respuesta no
    // pueden divergir sin que cambie la config de ambos a la vez.
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const auth = config.getOrThrow<AuthConfig>('auth');
        return { secret: auth.jwtSecret, signOptions: { expiresIn: auth.jwtExpiresInSeconds } };
      },
    }),
    UsersModule,
  ],
  controllers: [AuthController],
  providers: [
    // El token es la propia `abstract class` del puerto: `useClass` la ata a su adaptador,
    // y quien la declare como tipo de un parámetro de constructor la recibe sin `@Inject`.
    { provide: CredentialRepository, useClass: CredentialTypeOrmRepository },
    { provide: PasswordHasher, useClass: Argon2PasswordHasher },
    { provide: TokenSigner, useClass: NestJwtTokenSigner },
    { provide: UserDirectory, useClass: UsersUserDirectory },
    // Guard GLOBAL registrado aquí y no en `app.module`: la regla 3 de la matriz de
    // boundaries impide a app-root importar internals de un módulo (solo `*.module.ts` es
    // puerta legal), y `JwtAuthGuard` vive en `infrastructure/http/` de ESTE módulo desde el
    // ciclo 4 — verificar un token es de auth, no de users. `APP_GUARD` es un multi-provider:
    // registrarlo en cualquier módulo lo hace global.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    LoginUseCase,
    RegisterAccountUseCase,
  ],
})
export class AuthModule {}
