import { Injectable } from '@nestjs/common';

import type { User } from '../domain/entities/user.entity';
import {
  EmailAlreadyTakenError,
  InvalidEmailError,
  InvalidUserIdError,
  UserDomainError,
} from '../domain/errors/user.errors';
import { UserRepository } from '../domain/ports/user.repository';
import { Email } from '../domain/value-objects/email.vo';
import { UserId } from '../domain/value-objects/user-id.vo';

import { CreateUserUseCase } from './use-cases/create-user.use-case';

/**
 * El perfil en primitivos. NUNCA sale `User` de la fachada: el agregado es del contexto y
 * publicarlo dejaría a cualquier consumidor acoplado a sus invariantes y a sus VOs.
 *
 * `role` viaja como `string` y no como el union `UserRole` por el mismo criterio que
 * `AuthenticatedUser` en `common/`: el contexto dueño garantiza el contenido, el consumidor
 * publica la forma. Y NO hay `passwordHash` — desde el ciclo 4 `users` no sabe qué es una
 * contraseña.
 */
export type UserSummary = {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Resultado del alta de perfil. Es un RESULTADO y no una excepción a propósito: los errores
 * de este contexto (`EmailAlreadyTakenError`, `InvalidEmailError`…) son suyos y un módulo
 * ajeno no puede importarlos —regla 3 del gate de boundaries—, así que el fallo viaja como
 * dato y el consumidor lo traduce a un error de SU dominio.
 *
 * `invalid-profile` no estaba en el diseño y se añadió al implementarlo, con motivo medido:
 * `@IsEmail` de class-validator acepta cadenas que `Email.from()` rechaza (un local part
 * entrecomillado con espacios), y `@MinLength(2)` mide el nombre SIN recortar mientras que
 * `User.assertName()` recorta primero. Es decir, hay entradas que pasan el DTO y mueren en el
 * dominio. Con la unión estricta de dos casos, esas entradas —que hoy son un 400— habrían
 * pasado a ser un 500 en cuanto el alta se mudó a `auth`, porque el filtro de users ya no
 * está en ese camino. El `message` viaja para que el 400 publicado siga diciendo lo mismo.
 */
export type CreateProfileResult =
  | { ok: true; user: UserSummary }
  | { ok: false; reason: 'email-taken' }
  | { ok: false; reason: 'invalid-profile'; message: string };

/**
 * Puerta pública del contexto, PARTIDA EN DOS por intención (backlog #13). Otros módulos NO
 * importan este archivo: consumen las clases re-exportadas por `users.module.ts`, que es la
 * única superficie cross-módulo que la matriz de boundaries permite.
 *
 * **Por qué dos tokens y no una fachada.** Hasta este cambio había una sola `UsersFacade` con
 * los cuatro métodos, y quien la inyectaba los recibía todos. `UsersCustomerDirectory` de
 * `orders` solo llama a `userExists` y recibía de regalo `deleteProfile`, que es un DELETE
 * FÍSICO (`UserRepository.delete()`) sin equivalente en la API pública —`DELETE /users/:id` es
 * desactivación lógica— y sobre un esquema que no tiene una sola FOREIGN KEY: un borrado de
 * más deja las órdenes y la credencial apuntando al vacío sin que el motor diga nada. La
 * matriz de boundaries no puede verlo porque razona por ruta, no por lo que trae dentro el
 * archivo importado. Segregar por intención es la única capa que sí lo ve, y la ve al
 * COMPILAR: `orders` ya no puede escribir `this.users.deleteProfile(...)` porque el tipo que
 * inyecta no lo declara.
 *
 * `abstract class` con solo miembros `abstract` públicos: cada una es a la vez el tipo del
 * contrato y su token de inyección (ver `domain/ports/user.repository.ts` para el
 * razonamiento). Los nombres van en PLURAL —`Users…`— porque son la puerta del contexto;
 * el singular (`UserRepository`, y los `UserDirectory`/`CustomerDirectory` que definen los
 * consumidores) queda para los puertos que hablan de un usuario.
 *
 * Viven SUELTAS en `application/`, no en `use-cases/`: no son casos de uso. Un caso de uso es
 * una intención del usuario del sistema (`CreateUserUseCase`), con su propia entrada y su
 * `execute()`. Contrato de crecimiento: cualquier método futuro devuelve primitivos o DTOs
 * planos, nunca `User` ni el repositorio, y entra en la clase cuya INTENCIÓN comparte —una
 * consulta nueva no puede colarse en la de aprovisionamiento para ahorrarse un token.
 */
export abstract class UsersLookup {
  /** `true` solo si el usuario existe Y está activo. */
  abstract userExists(id: string): Promise<boolean>;
  /** Normaliza el email con el MISMO value object que el alta: `null` si es inválido. */
  abstract findByEmail(email: string): Promise<UserSummary | null>;
}

/**
 * La otra mitad: alta y baja del perfil. Hoy la inyecta solo `auth`, que es quien da de alta
 * una cuenta y quien compensa si la credencial no puede escribirse.
 *
 * Quien inyecte esto tiene en la mano el borrado físico. Es deliberado que sea un token
 * aparte y no un método más del de consulta: pedirlo es una decisión visible en el
 * constructor del consumidor y en el `useExisting` de `users.module.ts`.
 */
export abstract class UsersProvisioning {
  /** Resultado, no excepción: el consumidor no puede importar los errores de users. */
  abstract createProfile(input: { email: string; name: string }): Promise<CreateProfileResult>;
  /** Compensación del registro: borra el perfil si la credencial no pudo escribirse. */
  abstract deleteProfile(id: string): Promise<void>;
}

/**
 * Una sola implementación detrás de los dos tokens. Partir también la clase habría duplicado
 * `parseUserId` y el acceso al repositorio sin ganar nada: lo que el ticket pedía es que la
 * superficie PUBLICADA se segregue, no que el contexto se parta por dentro. `users.module.ts`
 * la registra una vez y alía ambos tokens con `useExisting` — con `useClass` en cada uno Nest
 * construiría dos instancias.
 */
@Injectable()
export class UsersFacadeImpl implements UsersLookup, UsersProvisioning {
  constructor(
    private readonly users: UserRepository,
    private readonly createUser: CreateUserUseCase,
  ) {}

  async userExists(id: string): Promise<boolean> {
    const userId = this.parseUserId(id);
    if (!userId) {
      // Un sub malformado en un token firmado responde `false`, no 500 (Tabla F, F4).
      return false;
    }
    const user = await this.users.findById(userId);
    return user?.active ?? false;
  }

  /**
   * Delega en `CreateUserUseCase` en vez de tocar el repositorio: la normalización del email
   * y el pre-check de unicidad viven ahí, y duplicarlos aquí es la vía directa a que el alta
   * por fachada y el alta por caso de uso diverjan.
   */
  async createProfile(input: { email: string; name: string }): Promise<CreateProfileResult> {
    try {
      const user = await this.createUser.execute(input);
      return { ok: true, user: toSummary(user) };
    } catch (error) {
      // El orden importa: `EmailAlreadyTakenError` TAMBIÉN es un `UserDomainError`, así que
      // el caso concreto se comprueba antes que el genérico.
      if (error instanceof EmailAlreadyTakenError) {
        return { ok: false, reason: 'email-taken' };
      }
      if (error instanceof UserDomainError) {
        return { ok: false, reason: 'invalid-profile', message: error.message };
      }
      // Un fallo de infraestructura (la base caída) NO es un rechazo de negocio: sube.
      throw error;
    }
  }

  async findByEmail(email: string): Promise<UserSummary | null> {
    let value: Email;
    try {
      value = Email.from(email);
    } catch (error) {
      // Un email malformado no existe, no es un 500: mismo criterio que `userExists` con un
      // id corrupto. Para el login eso significa 401 (vía dummy hash), no 400 — que es lo
      // correcto: un 400 distinguiría «email mal escrito» de «email desconocido».
      if (error instanceof InvalidEmailError) {
        return null;
      }
      throw error;
    }
    const user = await this.users.findByEmail(value);
    return user ? toSummary(user) : null;
  }

  async deleteProfile(id: string): Promise<void> {
    const userId = this.parseUserId(id);
    if (!userId) {
      return;
    }
    await this.users.delete(userId);
  }

  /** `null` cuando el id no tiene forma de `UserId`; el resto de errores suben. */
  private parseUserId(id: string): UserId | null {
    try {
      return UserId.from(id);
    } catch (error) {
      if (error instanceof InvalidUserIdError) {
        return null;
      }
      // Inalcanzable con el `UserId.from()` actual (solo lanza InvalidUserIdError): se
      // mantiene por defensa ante un error de otro tipo que `from()` pueda lanzar en el
      // futuro. El auditor de mutación la firmará como equivalente — no es cobertura
      // perdida, es un caso sin generador hoy.
      throw error;
    }
  }
}

/** Campo a campo, nunca spread: un campo nuevo del agregado no cruza la frontera solo. */
const toSummary = (user: User): UserSummary => {
  const snapshot = user.toSnapshot();
  return {
    id: snapshot.id,
    email: snapshot.email,
    name: snapshot.name,
    role: snapshot.role,
    active: snapshot.active,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  };
};
