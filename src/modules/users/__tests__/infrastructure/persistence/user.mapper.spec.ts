import fc from 'fast-check';

import { Email } from '../../../domain/value-objects/email.vo';
import { User } from '../../../domain/entities/user.entity';
import { UserId } from '../../../domain/value-objects/user-id.vo';
import { UserMapper } from '../../../infrastructure/persistence/user.mapper';
import { UserOrmEntity } from '../../../infrastructure/persistence/user.orm-entity';
import { emailArb, timestampArb, userNameArb } from '../../helpers/arbitraries';

const CREATED_AT = new Date('2026-07-01T08:00:00.000Z');
const UPDATED_AT = new Date('2026-07-27T10:00:00.000Z');
const CREATED_BY = '3f1a9b2c-8d4e-4f6a-9b1c-2e5d7a0f3b48';
const UPDATED_BY = '5b7c2d4e-9a1f-4c3b-8e6d-0f2a4b6c8d1e';

describe('UserMapper', () => {
  describe('toPersistence()', () => {
    it('debería volcar el agregado a columnas primitivas', () => {
      // Arrange
      const user = buildDomainUser();

      // Act
      const row = UserMapper.toPersistence(user);

      // Assert
      expect(row).toBeInstanceOf(UserOrmEntity);
      expect(row.id).toBe(user.id.value);
      expect(row.email).toBe('maria@example.com');
      expect(row.name).toBe('María González');
      expect(row.active).toBe(true);
    });

    it('debería conservar las marcas de tiempo del agregado', () => {
      // Arrange
      const user = buildDomainUser();
      user.rename('Nombre Nuevo', UPDATED_AT, UPDATED_BY);

      // Act
      const row = UserMapper.toPersistence(user);

      // Assert
      expect(row.createdAt).toEqual(CREATED_AT);
      expect(row.updatedAt).toEqual(UPDATED_AT);
    });

    // Nombra los dos campos, que es lo que un round-trip no hace: el property-based de más abajo
    // solo diría «dos snapshots difieren». Y son DOS valores distintos a propósito — con el
    // mismo, un `toPersistence` que copiara `createdBy` en las dos columnas pasaría igual.
    it('debería escribir createdBy y updatedBy en columnas separadas', () => {
      // Arrange
      const user = buildDomainUser();
      user.rename('Nombre Nuevo', UPDATED_AT, UPDATED_BY);

      // Act
      const row = UserMapper.toPersistence(user);

      // Assert
      expect(row.createdBy).toBe(CREATED_BY);
      expect(row.updatedBy).toBe(UPDATED_BY);
    });
  });

  describe('toDomain()', () => {
    it('debería reconstruir el agregado desde la fila', () => {
      // Arrange
      const row = buildRow();

      // Act
      const user = UserMapper.toDomain(row);

      // Assert
      expect(user.id.value).toBe(row.id);
      expect(user.email.value).toBe(row.email);
      expect(user.name).toBe(row.name);
      expect(user.active).toBe(row.active);
    });

    it('debería reconstruir usuarios inactivos', () => {
      // Arrange
      const row = buildRow({ active: false });

      // Act
      const user = UserMapper.toDomain(row);

      // Assert
      expect(user.active).toBe(false);
    });

    it('debería reconstruir un nombre que hoy no pasaría las reglas de creación', () => {
      // Arrange: dato heredado, válido cuando se guardó.
      const row = buildRow({ name: 'A' });

      // Act
      const user = UserMapper.toDomain(row);

      // Assert
      expect(user.name).toBe('A');
    });

    // `toDomain` pasa por `Email.from()`, que normaliza a minúsculas. Es decir: la vuelta
    // NO es una identidad si la fila trae un email sin normalizar. El comportamiento es el
    // correcto —el dominio impone su invariante— pero conviene dejarlo fijado, porque hace
    // que `toPersistence(toDomain(row))` difiera de `row` y eso sorprende al depurar.
    it('debería normalizar un email almacenado en mayúsculas', () => {
      // Arrange
      const row = buildRow({ email: 'MAYUSCULAS@Example.COM' });

      // Act
      const user = UserMapper.toDomain(row);

      // Assert
      expect(user.email.value).toBe('mayusculas@example.com');
      expect(UserMapper.toPersistence(user).email).not.toBe(row.email);
    });

    it('debería rechazar una fila cuyo email no es válido', () => {
      // Arrange
      const row = buildRow({ email: 'sin-arroba' });

      // Act + Assert
      expect(() => UserMapper.toDomain(row)).toThrow();
    });

    // Las columnas son NULLABLE porque llegan a una tabla viva (`AddAuditActorColumns`), así que
    // toda fila anterior a la migración las trae a NULL. El mapper las pasa TAL CUAL: `null`
    // significa «el sistema / no se sabe», y coalescerlo a una cadena inventaría un actor.
    it('debería reconstruir una fila cuyos actores son null', () => {
      // Arrange
      const row = buildRow({ createdBy: null, updatedBy: null });

      // Act
      const user = UserMapper.toDomain(row);

      // Assert
      expect(user.createdBy).toBeNull();
      expect(user.updatedBy).toBeNull();
    });
  });

  describe('toDomain() ∘ toPersistence() (property-based)', () => {
    // El caso canónico del round-trip: `parse(serialize(x)) === x`. Partir del dominio y no
    // de la fila es lo que lo convierte en identidad — el agregado ya tiene el email
    // normalizado, así que `Email.from()` no cambia nada al volver.
    it('debería preservar el snapshot para cualquier usuario del dominio', () => {
      fc.assert(
        fc.property(
          fc.record({
            email: emailArb,
            name: userNameArb,
            now: timestampArb,
            active: fc.boolean(),
          }),
          ({ email, name, now, active }) => {
            // Arrange
            const original = User.create({
              id: UserId.generate(),
              email: Email.from(email),
              name,
              now,
              createdBy: CREATED_BY,
            });
            if (!active) {
              original.deactivate(now, UPDATED_BY);
            }

            // Act
            const restored = UserMapper.toDomain(UserMapper.toPersistence(original));

            // Assert
            expect(restored.toSnapshot()).toEqual(original.toSnapshot());
          },
        ),
      );

      // La propiedad de arriba nunca produce `role: 'admin'`: `User.create` siempre fija
      // `'user'` y `promoteToAdmin` no entra en el arbitrario. Sin este assert, un mutante
      // que fijara `role: 'user'` a mano dentro del mapper sobreviviría — es el único otro
      // valor de `UserRole` y ninguna otra fixture del archivo lo usa.
      // Arrange
      const adminRow = buildRow({ role: 'admin' });

      // Act + Assert
      expect(UserMapper.toDomain(adminRow).role).toBe('admin');
    });
  });
});

// Helpers

const buildDomainUser = (): User =>
  User.create({
    id: UserId.generate(),
    email: Email.from('maria@example.com'),
    name: 'María González',
    now: CREATED_AT,
    createdBy: CREATED_BY,
  });

const buildRow = (overrides: Partial<UserOrmEntity> = {}): UserOrmEntity => {
  const row = new UserOrmEntity();
  row.id = UserId.generate().value;
  row.email = 'row@example.com';
  row.name = 'Usuario Persistido';
  row.role = 'user';
  row.active = true;
  row.createdAt = CREATED_AT;
  row.updatedAt = UPDATED_AT;
  row.createdBy = CREATED_BY;
  row.updatedBy = UPDATED_BY;
  return Object.assign(row, overrides);
};
