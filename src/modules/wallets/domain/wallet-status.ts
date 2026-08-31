/**
 * Unión y no enum: convención del repo (`type`, nunca `interface`; uniones sobre enums), la
 * misma forma que `USER_ROLES` en `users`.
 *
 * **Vive suelto en `domain/` y NO en `domain/value-objects/`**: no extiende `ValueObject`, no
 * tiene factoría y no encapsula ninguna invariante — es un vocabulario cerrado que se compara
 * con `===`. En `value-objects/` solo entra lo que extiende `ValueObject`.
 *
 * El orden ES la máquina de estados y es **monótona**: `receive-only` → `activating` → `active`,
 * y nunca retrocede. Una wallet en `receive-only` puede recibir fondos pero no enviarlos, que es
 * exactamente lo que `WalletNotActivatedError` cuenta cuando lleva este valor.
 *
 * ⚠️ **Reordenar esta lista NO es cosmético**, al revés que en `transfer-status.ts`, donde el
 * orden no significa nada. Aquí el índice ES el rango de capacidad, y la entidad `Wallet` lo
 * usará para comprobar que nunca retrocede.
 *
 * Medido HOY, invirtiendo la lista y corriendo la suite entera del módulo: cae **exactamente
 * uno**, el A1 de `wallet-status.spec.ts` — que es este archivo comparándose consigo mismo. Es
 * poca protección, y por eso está dicho: mientras `wallet.entity.ts` no exista, nada más ata este
 * orden a un comportamiento. Cuando exista, esa medición hay que rehacerla aquí.
 */
export const WALLET_STATUSES = ['receive-only', 'activating', 'active'] as const;
export type WalletStatus = (typeof WALLET_STATUSES)[number];
