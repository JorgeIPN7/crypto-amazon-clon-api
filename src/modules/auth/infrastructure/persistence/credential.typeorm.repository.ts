import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { Credential } from '../../domain/entities/credential.entity';
import { CredentialRepository } from '../../domain/ports/credential.repository';

import { CredentialMapper } from './credential.mapper';
import { CredentialOrmEntity } from './credential.orm-entity';

/**
 * Adaptador de salida: implementa el puerto del dominio con TypeORM. Es la única clase de
 * `auth` que conoce el `Repository` del ORM; todo lo que sale de aquí ya es dominio.
 *
 * `implements CredentialRepository`, NUNCA `extends`: la conformidad con el puerto la
 * garantiza el `implements` y solo él — `ClassProvider.provide` está tipado como `any`, así
 * que el `useClass` del module NO comprueba nada.
 *
 * Sin traducción de errores del driver, a diferencia de `UserTypeOrmRepository`: aquí el
 * único choque posible contra `idx_auth_credentials_user_id` es una segunda credencial para
 * el mismo usuario, que ningún caso de uso puede provocar (el registro acaba de acuñar ese
 * id). Si ocurriera sería un fallo de infraestructura de verdad, y convertirlo en un error
 * de negocio lo escondería; además `RegisterAccountUseCase` ya compensa el perfil antes de
 * propagarlo.
 */
@Injectable()
export class CredentialTypeOrmRepository implements CredentialRepository {
  constructor(
    @InjectRepository(CredentialOrmEntity)
    private readonly repository: Repository<CredentialOrmEntity>,
  ) {}

  async findByUserId(userId: string): Promise<Credential | null> {
    const row = await this.repository.findOne({ where: { userId } });
    return row ? CredentialMapper.toDomain(row) : null;
  }

  async save(credential: Credential): Promise<void> {
    await this.repository.save(CredentialMapper.toPersistence(credential));
  }

  /**
   * `delete` y no `remove`: no hace falta cargar la fila antes para borrarla, y el índice
   * único sobre `user_id` garantiza que como mucho hay una. Sin fila afectada devuelve
   * `affected: 0` sin lanzar — la idempotencia que el puerto promete.
   */
  async deleteByUserId(userId: string): Promise<void> {
    await this.repository.delete({ userId });
  }
}
