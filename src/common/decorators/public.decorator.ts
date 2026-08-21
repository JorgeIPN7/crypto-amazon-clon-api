import { Reflector } from '@nestjs/core';

/**
 * Marca un endpoint (o controller) como público: el JwtAuthGuard global lo salta.
 * Mismo patrón Reflector.createDecorator que SkipTransform/SkipThrottle.
 */
export const Public = Reflector.createDecorator<boolean>({ transform: () => true });
