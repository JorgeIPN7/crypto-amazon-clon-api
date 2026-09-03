import { WalletTransferResponseDto } from '../../../../infrastructure/http/dto/wallet-transfer-response.dto';
import { buildTransfer } from '../../../helpers/wallet-transfer.factory';

const OWNER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const FROM = '0x687422eea2cb73b5d3e242ba5456b782919afc85';
const RECIPIENT = '0xe242ba5456b782919afc85687422eea2cb73b5d3';

describe('WalletTransferResponseDto', () => {
  describe('fromDomain()', () => {
    it('debería mapear la transferencia campo a campo, con reasonCode saliendo como reason', () => {
      // Arrange
      const transfer = buildTransfer({
        ownerId: OWNER_ID,
        from: FROM,
        recipient: RECIPIENT,
        assetKind: 'native',
        amount: '100000',
      });

      // Act
      const dto = WalletTransferResponseDto.fromDomain(transfer);

      // Assert
      expect(dto).toMatchObject({
        ownerId: OWNER_ID,
        from: FROM,
        recipient: RECIPIENT,
        kind: 'native',
        tokenAddress: null,
        amount: '100000',
        tokenId: null,
        status: 'submitting',
        txId: null,
        reason: null,
      });
      expect(dto.id).toBe(transfer.id.value);
    });

    it('debería publicar el código de motivo de un rechazo del proveedor', () => {
      // Arrange
      // `reasonCode` sale de `PROVIDER_FAILURE_REASONS`, la lista cerrada que comparten el
      // adaptador y el libro. Es lo que hace que publicarlo sea seguro: nunca es el `message`
      // del proveedor, cuyo 401 interpola la API key.
      const transfer = buildTransfer({
        ownerId: OWNER_ID,
        from: FROM,
        recipient: RECIPIENT,
        status: 'rejected',
        reasonCode: 'body-rejected',
      });

      // Act
      const dto = WalletTransferResponseDto.fromDomain(transfer);

      // Assert
      expect(dto).toMatchObject({ status: 'rejected', reason: 'body-rejected', txId: null });
    });

    it('debería exponer solo los campos del DTO, nunca la entidad', () => {
      // Arrange
      const transfer = buildTransfer({ ownerId: OWNER_ID, from: FROM, recipient: RECIPIENT });

      // Act
      const dto = WalletTransferResponseDto.fromDomain(transfer);

      // Assert
      expect(Object.keys(dto).sort()).toEqual([
        'amount',
        'createdAt',
        'from',
        'id',
        'kind',
        'ownerId',
        'reason',
        'recipient',
        'status',
        'tokenAddress',
        'tokenId',
        'txId',
      ]);
    });
  });
});
