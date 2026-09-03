import { readPortShape } from '../../helpers/port-shape';
import { WalletRepository } from '../../../domain/ports/wallet.repository';

/**
 * El SUT es la FORMA del puerto, no su comportamiento: `WalletRepository` solo declara miembros
 * `abstract` y no hay nada que ejecutar en él — es el mismo criterio con el que
 * `auth/__tests__/domain/ports/password-hasher.spec.ts` toma la constante y no el puerto como SUT.
 * Qué caza este único caso y qué NO está en la tabla de `../../helpers/port-shape`.
 */
describe('WalletRepository', () => {
  it('debería exponer WalletRepository como token de inyección sin implementación ni constructor con parámetros', () => {
    // Arrange
    const port = WalletRepository;

    // Act
    const shape = readPortShape(port);

    // Assert
    expect(shape).toEqual({ prototypeMembers: ['constructor'], constructorArity: 0 });
  });
});
