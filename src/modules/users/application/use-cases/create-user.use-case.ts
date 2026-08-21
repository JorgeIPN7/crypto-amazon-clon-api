import { Injectable } from '@nestjs/common';

import { Email } from '../../domain/value-objects/email.vo';
import { EmailAlreadyTakenError } from '../../domain/errors/user.errors';
import { UserRepository } from '../../domain/ports/user.repository';
import { User } from '../../domain/entities/user.entity';
import { UserId } from '../../domain/value-objects/user-id.vo';

/**
 * La entrada vive en el MISMO archivo que su caso de uso: es su firma, no una pieza
 * reutilizable. Es un `type` plano y NUNCA una clase con `class-validator` — la validación
 * de transporte es del DTO HTTP, y la regla 2 del gate de boundaries prohíbe esa librería
 * en `application/`.
 *
 * **Sin `password` desde el ciclo 4.** Crear un usuario es crear un PERFIL; la credencial es
 * del bounded context `auth`, que la escribe en su propia tabla tras llamar a la fachada.
 */
export type CreateUserInput = {
  email: string;
  name: string;
};

/**
 * Caso de uso: una sola operación pública (`execute`). Orquesta el dominio y el puerto,
 * sin conocer HTTP ni el ORM. La unicidad del email se comprueba aquí porque cruza el
 * agregado: una entidad sola no puede saber qué hay en el resto de la tabla.
 *
 * Ya no tiene endpoint propio: `POST /users` desapareció con el alta pública y su único
 * consumidor es `UsersFacadeImpl.createProfile`, la puerta que `auth` atraviesa.
 */
@Injectable()
export class CreateUserUseCase {
  constructor(private readonly users: UserRepository) {}

  async execute(input: CreateUserInput): Promise<User> {
    const email = Email.from(input.email);

    const existing = await this.users.findByEmail(email);
    if (existing) {
      throw new EmailAlreadyTakenError(email.value);
    }

    const user = User.create({
      id: UserId.generate(),
      email,
      name: input.name,
      now: new Date(),
    });

    await this.users.save(user);
    return user;
  }
}
