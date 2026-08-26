import { Injectable } from '@nestjs/common';

import { UserNotFoundError } from '../../domain/errors/user.errors';
import { UserRepository } from '../../domain/ports/user.repository';
import type { User } from '../../domain/entities/user.entity';
import { UserId } from '../../domain/value-objects/user-id.vo';

/**
 * `by` es el ACTOR de la desactivación, no la víctima: `userId` dice a quién se desactiva y `by`
 * quién lo hizo. El controller lo saca del `sub` del token (`@CurrentUser()`), nunca del body ni
 * de la ruta — mismo criterio anti-spoof que `OrdersController` con `customerId`.
 *
 * Es `string | null` y obligatorio: un llamante sin actor —una CLI, un job— tiene que escribir
 * `null` a mano y verse haciéndolo. Opcional, olvidarse compilaría.
 */
export type DeactivateUserInput = {
  userId: string;
  by: string | null;
};

@Injectable()
export class DeactivateUserUseCase {
  constructor(private readonly users: UserRepository) {}

  async execute(input: DeactivateUserInput): Promise<User> {
    const id = UserId.from(input.userId);
    const user = await this.users.findById(id);

    if (!user) {
      throw new UserNotFoundError(input.userId);
    }

    user.deactivate(new Date(), input.by);
    await this.users.save(user);
    return user;
  }
}
