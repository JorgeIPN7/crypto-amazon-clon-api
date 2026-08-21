import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import type { AuthConfig } from '@config/auth.config';

import { NestJwtTokenSigner } from '../../../infrastructure/security/nest-jwt-token-signer';

const SECRET = 's'.repeat(32);

/**
 * Hand-wired: un `JwtService` real (sin él no hay nada que firmar de verdad) y un stub
 * mínimo de `ConfigService` que solo implementa `getOrThrow` — es el único método que
 * el adaptador consume.
 */
describe('NestJwtTokenSigner', () => {
  it('debería devolver el expiresInSeconds configurado', async () => {
    // Arrange
    const jwt = new JwtService({ secret: SECRET });
    const signer = new NestJwtTokenSigner(
      jwt,
      buildConfigService({ jwtSecret: SECRET, jwtExpiresInSeconds: 900 }),
    );

    // Act
    const result = await signer.sign({ sub: 'user-1', email: 'maria@example.com', role: 'user' });

    // Assert
    expect(result.expiresInSeconds).toBe(900);
  });

  it('debería firmar un JWT verificable que porta los claims', async () => {
    // Arrange
    const jwt = new JwtService({ secret: SECRET });
    const signer = new NestJwtTokenSigner(
      jwt,
      buildConfigService({ jwtSecret: SECRET, jwtExpiresInSeconds: 3600 }),
    );
    const claims = { sub: 'user-2', email: 'admin@example.com', role: 'admin' as const };

    // Act
    const result = await signer.sign(claims);
    const decoded = await jwt.verifyAsync(result.accessToken);

    // Assert
    expect(decoded).toMatchObject(claims);
  });
});

// Helpers

const buildConfigService = (auth: AuthConfig): ConfigService =>
  ({
    getOrThrow: () => auth,
  }) as unknown as ConfigService;
