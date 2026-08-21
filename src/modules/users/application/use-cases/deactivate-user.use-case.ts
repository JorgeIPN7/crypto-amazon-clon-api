import { Injectable } from '@nestjs/common';

import { UserNotFoundError } from '../../domain/errors/user.errors';
import { UserRepository } from '../../domain/ports/user.repository';
import type { User } from '../../domain/entities/user.entity';
import { UserId } from '../../domain/value-objects/user-id.vo';

export type DeactivateUserInput = {
  userId: string;
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

    user.deactivate(new Date());
    await this.users.save(user);
    return user;
  }
}
