import { registerAs } from '@nestjs/config';

import { envSchema } from './env.schema';

export type ThrottlerConfigValues = {
  ttlMs: number;
  limit: number;
};

export const throttlerConfig = registerAs('throttler', (): ThrottlerConfigValues => {
  const env = envSchema.parse(process.env);
  return {
    ttlMs: env.THROTTLER_TTL_MS,
    limit: env.THROTTLER_LIMIT,
  };
});
