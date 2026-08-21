import { registerAs } from '@nestjs/config';

import { envSchema, type Env } from './env.schema';

/**
 * Parámetros de argon2id, explícitos para que un cambio de defaults del paquete no
 * cambie el costo en silencio. Una sola fuente: los consume `Argon2PasswordHasher`
 * (infrastructure de users) y el seed del primer admin (src/database/seeds/).
 * OWASP: argon2id, 64 MB de memoria, 3 iteraciones.
 */
export const ARGON2_PARAMS = {
  type: 2, // argon2.argon2id — el paquete exporta el enum, pero config no importa argon2
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
} as const;

/**
 * Default SOLO para development/test — mismo criterio que `resolveSynchronize()`:
 * fuera de esos entornos el refine de env.schema ya impidió arrancar sin secret,
 * así que aquí el fallback nunca se alcanza en staging/production.
 */
const DEV_ONLY_SECRET = 'insecure-dev-secret-change-me-32chars!';

// NODE_ENV va en la firma para documentar la precondición (el refine de env.schema ya vetó
// staging/production sin secret) — aquí no se ramifica por entorno.
export const resolveJwtSecret = (env: Pick<Env, 'NODE_ENV' | 'JWT_SECRET'>): string => {
  if (env.JWT_SECRET !== undefined) {
    return env.JWT_SECRET;
  }
  // El refine garantiza que solo development/test llegan aquí sin secret.
  console.warn(
    '[auth] JWT_SECRET no definido: usando el default inseguro de desarrollo. ' +
      'No sirve para staging/production (el arranque fallaría).',
  );
  return DEV_ONLY_SECRET;
};

export type AuthConfig = {
  jwtSecret: string;
  jwtExpiresInSeconds: number;
};

export const authConfig = registerAs('auth', (): AuthConfig => {
  const env = envSchema.parse(process.env);
  return {
    jwtSecret: resolveJwtSecret(env),
    jwtExpiresInSeconds: env.JWT_EXPIRES_IN_S,
  };
});
