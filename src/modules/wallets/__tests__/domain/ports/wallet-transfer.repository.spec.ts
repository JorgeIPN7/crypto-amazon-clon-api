import { readPortShape } from '../../helpers/port-shape';
import { WalletTransferRepository } from '../../../domain/ports/wallet-transfer.repository';

/**
 * El SUT es la FORMA del puerto: solo declara miembros `abstract`, así que no hay comportamiento
 * que probar. Qué caza este único caso y qué NO está en la tabla de `../../helpers/port-shape`.
 */
describe('WalletTransferRepository', () => {
  it('debería exponer WalletTransferRepository como token de inyección sin implementación ni constructor con parámetros', () => {
    // Arrange
    const port = WalletTransferRepository;

    // Act
    const shape = readPortShape(port);

    // Assert
    expect(shape).toEqual({ prototypeMembers: ['constructor'], constructorArity: 0 });
  });
});
