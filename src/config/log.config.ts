import { registerAs } from '@nestjs/config';

import { envSchema, splitList, type Env } from './env.schema';

export type LogConfig = {
  level: Env['LOG_LEVEL'];
  pretty: boolean;
  redact: string[];
};

export const logConfig = registerAs('log', (): LogConfig => {
  const env = envSchema.parse(process.env);
  return {
    level: env.LOG_LEVEL,
    pretty: env.LOG_PRETTY,
    redact: splitList(env.LOG_REDACT_FIELDS),
  };
});
