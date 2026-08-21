import type { SignedToken, TokenClaims, TokenSigner } from '../../domain/ports/token-signer';

export class FakeTokenSigner implements TokenSigner {
  readonly signCalls: TokenClaims[] = [];

  sign(claims: TokenClaims): Promise<SignedToken> {
    this.signCalls.push(claims);
    return Promise.resolve({ accessToken: `fake.jwt.${claims.sub}`, expiresInSeconds: 3600 });
  }
}
