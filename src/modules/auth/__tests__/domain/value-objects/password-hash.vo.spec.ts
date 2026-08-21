import { InvalidPasswordHashError } from '../../../domain/errors/auth.errors';
import { PasswordHash } from '../../../domain/value-objects/password-hash.vo';

const VALID_PHC =
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$aBcDeFgHiJkLmNoPqRsTuVwXyZ012345678901234567';

describe('PasswordHash', () => {
  it('debería aceptar un hash argon2id válido', () => {
    // Arrange + Act
    const hash = PasswordHash.from(VALID_PHC);
    // Assert
    expect(hash.value).toBe(VALID_PHC);
  });

  it('debería rechazar una cadena sin formato argon2id', () => {
    // Act + Assert
    expect(() => PasswordHash.from('hunter2-en-claro')).toThrow(InvalidPasswordHashError);
  });

  it('debería rechazar una cadena vacía', () => {
    // Act + Assert
    expect(() => PasswordHash.from('')).toThrow(InvalidPasswordHashError);
  });

  it('debería excluir el valor rechazado del mensaje del error', () => {
    // Arrange
    let caught: unknown;
    // Act
    try {
      PasswordHash.from('mi-password-plano');
    } catch (error) {
      caught = error;
    }
    // Assert
    expect(caught).toBeInstanceOf(InvalidPasswordHashError);
    expect((caught as Error).message).not.toContain('mi-password-plano');
    // Igualdad exacta y no solo el `not.toContain`: ese, por sí solo, se satisface también
    // con un mensaje VACÍO — el auditor de mutación lo demostró vaciándolo y quedándose en
    // verde. El mensaje viaja al cliente en el 400 que publica el filtro de auth, así que es
    // contrato, no decoración.
    expect((caught as Error).message).toBe('Value is not a valid argon2id hash');
  });
});
