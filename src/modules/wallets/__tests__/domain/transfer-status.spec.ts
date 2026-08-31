import { TRANSFER_STATUSES } from '../../domain/transfer-status';

describe('TRANSFER_STATUSES', () => {
  // ⚠️ A diferencia de `WALLET_STATUSES`, aquí el orden NO significa nada: `submitting` es el
  // único estado inicial y los otros tres son terminales y excluyentes entre sí, así que no hay
  // monotonía que comprobar. Que `toEqual` compare además la secuencia es un efecto del matcher,
  // no una afirmación de este caso — y por eso ninguna propiedad de este módulo usa el índice de
  // este array como rango, al revés que con las wallets.
  it('debería declarar exactamente submitting, submitted, rejected y unknown', () => {
    // Arrange + Act + Assert
    expect(TRANSFER_STATUSES).toEqual(['submitting', 'submitted', 'rejected', 'unknown']);
  });
});
