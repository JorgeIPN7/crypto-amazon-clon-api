import { Injectable } from '@nestjs/common';

import { UserNotFoundError } from '../../domain/errors/user.errors';
import { UserRepository } from '../../domain/ports/user.repository';
import type { User } from '../../domain/entities/user.entity';
import { UserId } from '../../domain/value-objects/user-id.vo';

export type FindUserByIdInput = {
  userId: string;
};

@Injectable()
export class FindUserByIdUseCase {
  constructor(private readonly users: UserRepository) {}

  async execute(input: FindUserByIdInput): Promise<User> {
    const user = await this.users.findById(UserId.from(input.userId));

    if (!user) {
      throw new UserNotFoundError(input.userId);
    }

    return user;
  }
}
