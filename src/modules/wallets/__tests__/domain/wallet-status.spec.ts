import { WALLET_STATUSES } from '../../domain/wallet-status';

describe('WALLET_STATUSES', () => {
  // El orden ES la máquina de estados: `receive-only` → `activating` → `active`, monótona. Un
  // reordenado silencioso convertiría la lista en un conjunto y perdería esa lectura.
  it('debería definir exactamente los tres estados de una wallet, en orden', () => {
    // Arrange + Act + Assert
    expect(WALLET_STATUSES).toEqual(['receive-only', 'activating', 'active']);
  });
});
