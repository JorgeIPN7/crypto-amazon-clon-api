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
const ACTOR_ID = '5b7c2d4e-9a1f-4c3b-8e6d-0f2a4b6c8d1e';

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
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
      });

      // Act + Assert
      await expect(repository.save(user)).rejects.not.toBeInstanceOf(EmailAlreadyTakenError);
    });

    it('debería sobrescribir el usuario existente cuando se guarda con el mismo id', async () => {
      // Arrange
      const user = buildUser('renombrado@example.com');
      await repository.save(user);
      user.rename('Nombre Cambiado', new Date(), ACTOR_ID);

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
      user.promoteToAdmin(new Date('2026-07-27T10:00:00.000Z'), ACTOR_ID);

      // Act
      await repository.save(user);

      // Assert
      const rows = await dataSource.query<{ role: string }[]>(
        'SELECT role FROM users WHERE id = $1',
        [user.id.value],
      );
      expect(rows[0]?.role).toBe('admin');
    });

    /**
     * Mismo criterio que el caso del rol: contra la COLUMNA CRUDA, no contra `UserOrmEntity` ni
     * `UserMapper.toDomain`. Aquí importa el doble: es lo único que demuestra que las columnas
     * existen de verdad en PostgreSQL con el nombre que la entidad espera —`created_by` y
     * `updated_by`, snake_case como todo el esquema— y que `AddAuditActorColumns` se aplicó. Con
     * `getRepository().find()`, un nombre equivocado habría fallado igual, pero sin decir cuál.
     *
     * `createdBy` es NULL a propósito: `buildUser` reproduce el alta pública, que no tiene actor.
     */
    it('debería persistir los dos actores en sus columnas crudas', async () => {
      // Arrange
      const user = buildUser('auditado@example.com');
      user.deactivate(new Date('2026-07-27T11:00:00.000Z'), ACTOR_ID);

      // Act
      await repository.save(user);

      // Assert
      const rows = await dataSource.query<
        { created_by: string | null; updated_by: string | null }[]
      >('SELECT "created_by", "updated_by" FROM users WHERE id = $1', [user.id.value]);
      expect(rows[0]?.created_by).toBeNull();
      expect(rows[0]?.updated_by).toBe(ACTOR_ID);
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

  /**
   * El borrado lógico contra PostgreSQL real. El fake en memoria replica este filtrado, pero
   * replicarlo no lo demuestra: lo que se comprueba aquí es que el `deletedAt: IsNull()` de las
   * consultas y el índice único PARCIAL de la migración hacen de verdad lo que prometen.
   */
  describe('borrado lógico', () => {
    it('debería dejar de encontrar por id un usuario marcado como borrado', async () => {
      // Arrange
      const user = buildUser('borrado@example.com');
      await repository.save(user);
      user.softDelete(new Date(), ACTOR);

      // Act
      await repository.save(user);

      // Assert
      expect(await repository.findById(user.id)).toBeNull();
    });

    it('debería dejar de encontrarlo por email', async () => {
      // Arrange
      const user = buildUser('borrado.email@example.com');
      await repository.save(user);
      user.softDelete(new Date(), ACTOR);
      await repository.save(user);

      // Act
      const found = await repository.findByEmail(Email.from('borrado.email@example.com'));

      // Assert
      expect(found).toBeNull();
    });

    it('debería excluirlo del listado y también del total', async () => {
      // Arrange
      const alive = buildUser('vivo@example.com');
      const removed = buildUser('borrado.lista@example.com');
      await repository.save(alive);
      await repository.save(removed);
      removed.softDelete(new Date(), ACTOR);
      await repository.save(removed);

      // Act
      const page = await repository.findMany({ skip: 0, take: 10 });

      // Assert
      // El `total` importa tanto como los `items`: si el filtro se aplicara solo a la página, la
      // paginación anunciaría una siguiente que no existe. Son dos consultas dentro de
      // `findAndCount`, así que es un fallo posible y no teórico.
      expect(page.items).toHaveLength(1);
      expect(page.total).toBe(1);
      expect(page.items[0]?.email.value).toBe('vivo@example.com');
    });

    it('debería conservar la fila en la tabla, con su marca y su actor', async () => {
      // Arrange
      const user = buildUser('evidencia@example.com');
      await repository.save(user);
      user.softDelete(new Date('2026-08-25T12:00:00.000Z'), ACTOR);

      // Act
      await repository.save(user);

      // Assert
      const rows = await dataSource.getRepository(UserOrmEntity).find();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.deletedAt).toEqual(new Date('2026-08-25T12:00:00.000Z'));
      expect(rows[0]?.updatedBy).toBe(ACTOR);
    });

    it('debería dejar el email libre para un alta nueva', async () => {
      // Arrange
      const first = buildUser('reciclado@example.com');
      await repository.save(first);
      first.softDelete(new Date(), ACTOR);
      await repository.save(first);

      // Act
      const second = buildUser('reciclado@example.com');
      await repository.save(second);

      // Assert
      // Es lo que el índice único PARCIAL hace posible. Con el índice total de antes, esta línea
      // lanzaría `EmailAlreadyTakenError` y la compensación del alta quedaría inservible.
      expect(await repository.findByEmail(Email.from('reciclado@example.com'))).not.toBeNull();
      expect(await dataSource.getRepository(UserOrmEntity).count()).toBe(2);
    });
  });
});

// Helpers

/** Actor de las marcas de borrado. Un UUID cualquiera: aquí no se comprueba QUIÉN, sino que consta. */
const ACTOR = '5b7c2d4e-9a1f-4c3b-8e6d-0f2a4b6c8d1e';

const buildUser = (email: string): User =>
  User.create({
    id: UserId.generate(),
    email: Email.from(email),
    name: 'Usuario de Prueba',
    now: new Date('2026-07-27T10:00:00.000Z'),
    createdBy: null,
  });
