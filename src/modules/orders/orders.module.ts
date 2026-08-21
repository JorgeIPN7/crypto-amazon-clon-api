import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsersModule } from '../users/users.module';

import { PlaceOrderUseCase } from './application/use-cases/place-order.use-case';
import { CustomerDirectory } from './domain/ports/customer.directory';
import { OrderRepository } from './domain/ports/order.repository';
import { OrdersController } from './infrastructure/http/orders.controller';
import { OrderOrmEntity } from './infrastructure/persistence/order.orm-entity';
import { OrderTypeOrmRepository } from './infrastructure/persistence/order.typeorm.repository';
import { OutboxMessageOrmEntity } from './infrastructure/persistence/outbox-message.orm-entity';
import { UsersCustomerDirectory } from './infrastructure/users-customer.directory';

/**
 * Composition root del contexto. `UsersModule` se importa por su module file — la única
 * puerta cross-módulo (regla 3 + enmienda G1) — y de él solo se consume `UsersFacade`,
 * inyectada en el adapter del directorio. El guard JWT global lo registra `auth.module.ts`
 * desde el ciclo 4 (antes era users): `APP_GUARD` es multi-provider, así que declararlo en
 * CUALQUIER módulo que `AppModule` importe lo hace global para toda la app. Por eso `@Auth()`
 * protege este controller sin que `orders` importe `AuthModule` — y no debe importarlo: de
 * auth no se consume aquí ni un símbolo.
 */
@Module({
  imports: [TypeOrmModule.forFeature([OrderOrmEntity, OutboxMessageOrmEntity]), UsersModule],
  controllers: [OrdersController],
  providers: [
    // El token es la propia `abstract class` del puerto (ver `users.module.ts`).
    { provide: OrderRepository, useClass: OrderTypeOrmRepository },
    { provide: CustomerDirectory, useClass: UsersCustomerDirectory },
    PlaceOrderUseCase,
  ],
})
export class OrdersModule {}
