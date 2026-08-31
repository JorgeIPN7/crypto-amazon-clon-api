import { readPortShape } from '../../helpers/port-shape';
import { CustodialAddressGateway } from '../../../domain/ports/custodial-address.gateway';

/**
 * El SUT es la FORMA del puerto: solo declara miembros `abstract`, así que no hay comportamiento
 * que probar. Qué caza este único caso y qué NO está en la tabla de `../../helpers/port-shape`.
 */
describe('CustodialAddressGateway', () => {
  it('debería exponer CustodialAddressGateway como token de inyección sin implementación ni constructor con parámetros', () => {
    // Arrange
    const port = CustodialAddressGateway;

    // Act
    const shape = readPortShape(port);

    // Assert
    expect(shape).toEqual({ prototypeMembers: ['constructor'], constructorArity: 0 });
  });
});
