import { readPortShape } from '../../helpers/port-shape';
import { OwnerDirectory } from '../../../domain/ports/owner.directory';

/**
 * El SUT es la FORMA del puerto: solo declara miembros `abstract`, así que no hay comportamiento
 * que probar. Qué caza este único caso y qué NO está en la tabla de `../../helpers/port-shape`.
 */
describe('OwnerDirectory', () => {
  it('debería exponer OwnerDirectory como token de inyección sin implementación ni constructor con parámetros', () => {
    // Arrange
    const port = OwnerDirectory;

    // Act
    const shape = readPortShape(port);

    // Assert
    expect(shape).toEqual({ prototypeMembers: ['constructor'], constructorArity: 0 });
  });
});
