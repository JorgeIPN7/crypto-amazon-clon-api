import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import type { AuthConfig } from '@config/auth.config';

import { TokenSigner, type SignedToken, type TokenClaims } from '../../domain/ports/token-signer';

/**
 * Adaptador real del puerto `TokenSigner`: firma con `@nestjs/jwt` (HS256, secret y
 * expiración de `AuthConfig`). El guard es quien verifica — este adaptador solo firma.
 */
@Injectable()
export class NestJwtTokenSigner implements TokenSigner {
  private readonly expiresInSeconds: number;

  constructor(
    private readonly jwt: JwtService,
    configService: ConfigService,
  ) {
    this.expiresInSeconds = configService.getOrThrow<AuthConfig>('auth').jwtExpiresInSeconds;
  }

  async sign(claims: TokenClaims): Promise<SignedToken> {
    const accessToken = await this.jwt.signAsync(claims);
    return { accessToken, expiresInSeconds: this.expiresInSeconds };
  }
}
