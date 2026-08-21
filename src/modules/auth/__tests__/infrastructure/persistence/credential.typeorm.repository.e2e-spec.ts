import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { createTestApp } from '@test/helpers/create-test-app';

import { Credential } from '../../../domain/entities/credential.entity';
import { CredentialRepository } from '../../../domain/ports/credential.repository';
import { PasswordHash } from '../../../domain/value-objects/password-hash.vo';

/**
 * El adaptador de persistencia se prueba contra PostgreSQL real, nunca con
 * `jest.mock('typeorm')`: lo que hay que verificar es precisamente el comportamiento del
 * motor —el índice único sobre `user_id`, los tipos de columna— y un doble lo sustituiría
 * por lo que uno cree que hace.
 */
describe('CredentialTypeOrmRepository (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let repository: CredentialRepository;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    dataSource = app.get(DataSource);
    repository = app.get(CredentialRepository);
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE auth_credentials');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('save()', () => {
    it('debería persistir la credencial en la columna snake_case de la tabla', async () => {
      // Arrange
      const credential = buildCredential();

      // Act
      await repository.save(credential);

      // Assert: fila cruda, no releída por el mismo mapper que la escribió.
      const rows = await dataSource.query<{ user_id: string; password_hash: string }[]>(
        'SELECT user_id, password_hash FROM auth_credentials WHERE id = $1',
        [credential.id],
      );
      expect(rows).toEqual([
        { user_id: credential.userId, password_hash: credential.passwordHash.value },
      ]);
    });

    // El índice único de la migración es lo que garantiza «una cuenta, una credencial», y
    // además es lo que hace funcionar el `ON CONFLICT (user_id)` del seed.
    it('debería rechazar una segunda credencial para el mismo usuario', async () => {
      // Arrange
      const first = buildCredential();
      await repository.save(first);

      // Act + Assert
      await expect(repository.save(buildCredential({ userId: first.userId }))).rejects.toThrow();
    });
  });

  describe('findByUserId()', () => {
    it('debería reconstruir el agregado desde la fila', async () => {
      // Arrange
      const credential = buildCredential();
      await repository.save(credential);

      // Act
      const found = await repository.findByUserId(credential.userId);

      // Assert
      expect(found?.id).toBe(credential.id);
      expect(found?.passwordHash.value).toBe(credential.passwordHash.value);
    });

    it('debería devolver null cuando el usuario no tiene credencial', async () => {
      // Act
      const found = await repository.findByUserId(randomUUID());

      // Assert
      expect(found).toBeNull();
    });
  });

  /**
   * La operación que cierra el backlog #14: la compensación del registro la llama para que no
   * quede una credencial sin perfil. Se prueba contra el motor porque lo que hay que verificar
   * es que la fila desaparece de verdad y que borrar lo que no existe no revienta — dos cosas
   * que un doble decidiría por su cuenta.
   */
  describe('deleteByUserId()', () => {
    it('debería borrar la fila de ese usuario y dejar intactas las demás', async () => {
      // Arrange
      const victim = buildCredential();
      const survivor = buildCredential();
      await repository.save(victim);
      await repository.save(survivor);

      // Act
      await repository.deleteByUserId(victim.userId);

      // Assert: fila cruda, no releída por el mismo mapper que la escribió.
      const rows = await dataSource.query<{ user_id: string }[]>(
        'SELECT user_id FROM auth_credentials',
      );
      expect(rows).toEqual([{ user_id: survivor.userId }]);
    });

    // El caso NORMAL de la compensación: el INSERT falló de verdad y no hay nada que borrar.
    // Si esto lanzara, la compensación sustituiría el error original por uno inventado.
    it('debería no lanzar cuando el usuario no tiene credencial', async () => {
      // Act + Assert
      await expect(repository.deleteByUserId(randomUUID())).resolves.toBeUndefined();
    });
  });
});

// Helpers

const buildCredential = ({ userId = randomUUID() }: { userId?: string } = {}): Credential =>
  Credential.create({
    userId,
    passwordHash: PasswordHash.from('$argon2id$fake$repository'),
    now: new Date('2026-08-07T10:00:00.000Z'),
  });
