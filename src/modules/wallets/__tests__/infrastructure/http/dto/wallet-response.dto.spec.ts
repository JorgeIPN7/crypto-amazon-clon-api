import { WalletResponseDto } from '../../../../infrastructure/http/dto/wallet-response.dto';
import { buildWallet } from '../../../helpers/wallet.factory';

const OWNER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const MASTER = '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed';
const DERIVED = '0x687422eea2cb73b5d3e242ba5456b782919afc85';

describe('WalletResponseDto', () => {
  describe('fromDomain()', () => {
    it('debería mapear la wallet custodiada campo a campo', () => {
      // Arrange
      const wallet = buildWallet({ ownerId: OWNER_ID, address: DERIVED, addressIndex: 7 });

      // Act
      const dto = WalletResponseDto.fromDomain(wallet);

      // Assert
      expect(dto).toMatchObject({
        kind: 'custodial',
        ownerId: OWNER_ID,
        address: DERIVED,
        index: 7,
        status: 'receive-only',
        activationTxId: null,
      });
      expect(dto.id).toBe(wallet.id.value);
    });

    it('debería exponer solo los campos del DTO, nunca la entidad', () => {
      // Arrange
      const wallet = buildWallet({ ownerId: OWNER_ID, address: DERIVED, addressIndex: 7 });

      // Act
      const dto = WalletResponseDto.fromDomain(wallet);

      // Assert
      expect(Object.keys(dto).sort()).toEqual([
        'activationTxId',
        'address',
        'id',
        'index',
        'kind',
        'ownerId',
        'status',
      ]);
    });

    it('debería dejar fuera la dirección de la master bajo la que se derivó', () => {
      // Arrange
      // ⚠️ `ownerAddress` es la EOA que paga TODO el gas del sistema. Publicarla en la respuesta
      // de cada usuario la repartiría a cualquiera con una cuenta, y no hay forma de retirarla
      // después. El campo existe en el agregado por `assertOwnedBy`, no para salir por la API.
      const wallet = buildWallet({ ownerId: OWNER_ID, address: DERIVED, ownerAddress: MASTER });

      // Act
      const dto = WalletResponseDto.fromDomain(wallet);

      // Assert
      expect(JSON.stringify(dto)).not.toContain(MASTER.slice(2, 14));
    });
  });

  describe('forMaster()', () => {
    it('debería publicar la master con kind master, sin id y con index nulo', () => {
      // Arrange
      const ownerId = OWNER_ID;

      // Act
      const dto = WalletResponseDto.forMaster(ownerId, MASTER);

      // Assert
      // Un 404 al admin sería mentira a medias: sí tiene dirección, y es la que sostiene todo.
      // Lo que no tiene es fila, índice ni activación, y eso es exactamente lo que dicen los
      // tres nulos.
      expect(dto).toEqual({
        kind: 'master',
        id: null,
        ownerId: OWNER_ID,
        address: MASTER,
        index: null,
        status: 'active',
        activationTxId: null,
      });
    });
  });
});
