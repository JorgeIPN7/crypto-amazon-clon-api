import { registerAs } from '@nestjs/config';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

import { envSchema, splitList } from './env.schema';

export type CorsConfig = {
  enabled: boolean;
  options: CorsOptions;
};

export const corsConfig = registerAs('cors', (): CorsConfig => {
  const env = envSchema.parse(process.env);
  const origins = splitList(env.CORS_ORIGINS);
  const allowAll = origins.length === 0 || origins.includes('*');

  if (allowAll && env.CORS_CREDENTIALS) {
    throw new Error(
      'CORS misconfiguration: CORS_ORIGINS=* is incompatible with CORS_CREDENTIALS=true. ' +
        'Provide an explicit origin list when credentials are enabled.',
    );
  }

  return {
    enabled: env.CORS_ENABLED,
    options: {
      origin: allowAll ? true : origins,
      credentials: env.CORS_CREDENTIALS,
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id', 'x-correlation-id'],
      exposedHeaders: ['x-request-id'],
      maxAge: 86_400,
    },
  };
});
