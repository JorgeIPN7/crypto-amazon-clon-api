import { randomUUID } from 'node:crypto';

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, type ThrottlerModuleOptions } from '@nestjs/throttler';
import { ClsModule } from 'nestjs-cls';

import { AllExceptionsFilter } from '@common/filters/all-exceptions.filter';
import { TimeoutInterceptor } from '@common/interceptors/timeout.interceptor';
import { TransformInterceptor } from '@common/interceptors/transform.interceptor';
import { LoggerModule } from '@common/logger/logger.module';
import { configurations } from '@config/configurations';
import type { ThrottlerConfigValues } from '@config/throttler.config';
import { validateEnv } from '@config/validate-env';
import { DatabaseModule } from '@database/database.module';
import { AuthModule } from '@modules/auth/auth.module';
import { HealthModule } from '@modules/health/health.module';
import { OrdersModule } from '@modules/orders/orders.module';
import { UsersModule } from '@modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      load: configurations,
      validate: validateEnv,
      envFilePath: ['.env.local', '.env'],
    }),
    LoggerModule,
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: (req: { id?: string }) => req.id ?? randomUUID(),
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService): ThrottlerModuleOptions => {
        const cfg = configService.getOrThrow<ThrottlerConfigValues>('throttler');
        return {
          throttlers: [{ name: 'default', ttl: cfg.ttlMs, limit: cfg.limit }],
        };
      },
    }),
    DatabaseModule,
    HealthModule,
    UsersModule,
    // `AuthModule` registra el `APP_GUARD` global: sin él en esta lista, TODA la API queda
    // abierta. Va después de `UsersModule` porque lo importa (auth → users, una sola vía).
    AuthModule,
    OrdersModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TimeoutInterceptor },
  ],
})
export class AppModule {}
