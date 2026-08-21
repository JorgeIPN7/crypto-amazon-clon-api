import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import type { Email } from '../../domain/value-objects/email.vo';
import { EmailAlreadyTakenError } from '../../domain/errors/user.errors';
import {
  UserRepository,
  type FindUsersCriteria,
  type UserPage,
} from '../../domain/ports/user.repository';
import type { User } from '../../domain/entities/user.entity';
import type { UserId } from '../../domain/value-objects/user-id.vo';

import { UserMapper } from './user.mapper';
import { UserOrmEntity } from './user.orm-entity';

/** `unique_violation` de PostgreSQL: https://www.postgresql.org/docs/current/errcodes-appendix.html */
const PG_UNIQUE_VIOLATION = '23505';

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof QueryFailedError &&
  (error.driverError as { code?: string } | undefined)?.code === PG_UNIQUE_VIOLATION;

/**
 * Adaptador de salida: implementa el puerto del dominio con TypeORM. Es la única clase
 * del módulo que conoce el `Repository` del ORM; todo lo que sale de aquí ya es dominio.
 *
 * `implements UserRepository`, NUNCA `extends`: la conformidad con el puerto la garantiza
 * el `implements` y solo él — `ClassProvider.provide` está tipado como `any`, así que el
 * `useClass` del module NO comprueba nada. `UserRepository` es un puerto y por eso se
 * importa como VALOR aunque aquí solo aparezca en el `implements` (ver el bloque
 * `no-restricted-syntax` de `eslint.config.mjs`).
 */
@Injectable()
export class UserTypeOrmRepository implements UserRepository {
  constructor(
    @InjectRepository(UserOrmEntity)
    private readonly repository: Repository<UserOrmEntity>,
  ) {}

  async findById(id: UserId): Promise<User | null> {
    const row = await this.repository.findOne({ where: { id: id.value } });
    return row ? UserMapper.toDomain(row) : null;
  }

  async findByEmail(email: Email): Promise<User | null> {
    const row = await this.repository.findOne({ where: { email: email.value } });
    return row ? UserMapper.toDomain(row) : null;
  }

  async findMany(criteria: FindUsersCriteria): Promise<UserPage> {
    const [rows, total] = await this.repository.findAndCount({
      skip: criteria.skip,
      take: criteria.take,
      order: { createdAt: 'DESC' },
    });

    return { items: rows.map((row) => UserMapper.toDomain(row)), total };
  }

  /**
   * El pre-check de unicidad de `CreateUserUseCase` no corre en transacción, así que dos
   * peticiones concurrentes pueden pasarlo las dos y chocar aquí contra `idx_users_email`.
   * Traducir el error del driver a un error de dominio es responsabilidad del adaptador:
   * sin esto escaparía como `QueryFailedError`, `AllExceptionsFilter` lo convertiría en un
   * 500 y el endpoint incumpliría el 409 que promete su propio contrato.
   */
  async save(user: User): Promise<void> {
    try {
      await this.repository.save(UserMapper.toPersistence(user));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new EmailAlreadyTakenError(user.email.value);
      }
      throw error;
    }
  }

  async delete(id: UserId): Promise<void> {
    await this.repository.delete({ id: id.value });
  }
}
