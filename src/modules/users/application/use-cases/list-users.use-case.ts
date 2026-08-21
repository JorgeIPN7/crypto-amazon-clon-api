import { Injectable } from '@nestjs/common';

import { UserRepository, type UserPage } from '../../domain/ports/user.repository';

export type ListUsersInput = {
  skip: number;
  take: number;
};

@Injectable()
export class ListUsersUseCase {
  constructor(private readonly users: UserRepository) {}

  async execute(input: ListUsersInput): Promise<UserPage> {
    return this.users.findMany({ skip: input.skip, take: input.take });
  }
}
