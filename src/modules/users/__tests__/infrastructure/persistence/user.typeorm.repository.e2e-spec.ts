import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { createTestApp } from '@test/helpers/create-test-app';

import { Email } from '../../../domain/value-objects/email.vo';
import { EmailAlreadyTakenError } from '../../../domain/errors/user.errors';
import { UserRepository } from '../../../domain/ports/user.repository';
import { User } from '../../../domain/entities/user.entity';
import { UserId } from '../../../domain/value-objects/user-id.vo';
import { UserOrmEntity } from '../../../infrastructure/persistence/user.orm-entity';

/**
 * El adaptador de persistencia se prueba contra PostgreSQL real, nunca con
 * `jest.mock('typeorm')`: lo que hay que verificar es precisamente el comportamiento del
 * motor —el índice único, los tipos de columna, el código de error del driver—, y un doble
 * lo sustituiría por lo que uno cree que hace.
 */
describe('UserTypeOrmRepository (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let repository: UserRepository;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    dataSource = app.get(DataSource);
    repository = app.get(UserRepository);
  });

  beforeEach(async () => {
    await dataSource.getRepository(UserOrmEntity).clear();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('save()', () => {
    /**
     * La prueba determinista de la traducción del `23505`. Va por el repositorio y no por
     * HTTP a propósito: el pre-check de `CreateUserUseCase` atrapa el duplicado antes de
     * llegar al INSERT, así que dos POST concurrentes casi nunca alcanzan esta rama —
     * bastaba con desactivar la traducción para comprobar que el test HTTP seguía en verde.
     *
     * Aquí se salta ese pre-check y se choca contra `idx_users_email` directamente, que es
     * lo que ocurre en producción cuando dos peticiones se cruzan de verdad. Sin la
     * traducción, el `QueryFailedError` escaparía como 500 pese al 409 del contrato.
     */
    it('debería traducir la violación del índice único a EmailAlreadyTakenError', async () => {
      // Arrange
      const email = 'colision@example.com';
      await repository.save(buildUser(email));

      // Act + Assert
      await expect(repository.save(buildUser(email))).rejects.toBeInstanceOf(
        EmailAlreadyTakenError,
      );
    });

    it('debería dejar una sola fila tras el intento fallido', async () => {
      // Arrange
      const email = 'unica@example.com';
      await repository.save(buildUser(email));

      // Act
      await repository.save(buildUser(email)).catch(() => undefined);

      // Assert
      const rows = await dataSource.getRepository(UserOrmEntity).find();
      expect(rows).toHaveLength(1);
    });

    // Solo el 23505 se traduce: cualquier otro fallo del motor debe seguir subiendo tal
    // cual, o se estarían ocultando errores de infraestructura como si fueran de negocio.
    it('debería propagar sin traducir los errores que no son de unicidad', async () => {
      // Arrange: 121 caracteres desbordan `varchar(120)` (error 22001, no 23505).
      const user = User.rehydrate({
        id: UserId.generate(),
        email: Email.from('desbordado@example.com'),
        name: 'a'.repeat(121),
        role: 'user',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Act + Assert
      await expect(repository.save(user)).rejects.not.toBeInstanceOf(EmailAlreadyTakenError);
    });

    it('debería sobrescribir el usuario existente cuando se guarda con el mismo id', async () => {
      // Arrange
      const user = buildUser('renombrado@example.com');
      await repository.save(user);
      user.rename('Nombre Cambiado', new Date());

      // Act
      await repository.save(user);

      // Assert
      const rows = await dataSource.getRepository(UserOrmEntity).find();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.name).toBe('Nombre Cambiado');
    });

    /**
     * Va contra la columna cruda con `dataSource.query`, no contra `UserOrmEntity` ni
     * `UserMapper.toDomain`: leer de vuelta por el mismo mapper que escribe no detectaría
     * un `toPersistence` que dejara de trasladar `role` —el valor por defecto de la
     * columna es `'user'`, así que un mapeo roto y uno correcto solo se distinguen mirando
     * la fila tal cual quedó en PostgreSQL.
     */
    it('debería persistir el rol admin en la columna cruda tras promover al usuario', async () => {
      // Arrange
      const user = buildUser('promovido@example.com');
      user.promoteToAdmin(new Date('2026-07-27T10:00:00.000Z'));

      // Act
      await repository.save(user);

      // Assert
      const rows = await dataSource.query<{ role: string }[]>(
        'SELECT role FROM users WHERE id = $1',
        [user.id.value],
      );
      expect(rows[0]?.role).toBe('admin');
    });
  });

  describe('findByEmail()', () => {
    it('debería encontrar al usuario por su email normalizado', async () => {
      // Arrange
      await repository.save(buildUser('buscado@example.com'));

      // Act
      const found = await repository.findByEmail(Email.from('BUSCADO@Example.COM'));

      // Assert
      expect(found?.email.value).toBe('buscado@example.com');
    });

    it('debería devolver null cuando no existe', async () => {
      // Act
      const found = await repository.findByEmail(Email.from('inexistente@example.com'));

      // Assert
      expect(found).toBeNull();
    });
  });

  describe('findMany()', () => {
    it('debería devolver la página junto al total sin paginar', async () => {
      // Arrange
      await repository.save(buildUser('a@example.com'));
      await repository.save(buildUser('b@example.com'));
      await repository.save(buildUser('c@example.com'));

      // Act
      const page = await repository.findMany({ skip: 1, take: 2 });

      // Assert
      expect(page.items).toHaveLength(2);
      expect(page.total).toBe(3);
    });
  });
});

// Helpers

const buildUser = (email: string): User =>
  User.create({
    id: UserId.generate(),
    email: Email.from(email),
    name: 'Usuario de Prueba',
    now: new Date('2026-07-27T10:00:00.000Z'),
  });
