import { USER_ROLES } from '../../domain/user-role';

describe('USER_ROLES', () => {
  it('debería definir exactamente los roles admin y user', () => {
    // Arrange + Act + Assert
    expect(USER_ROLES).toEqual(['admin', 'user']);
  });
});
