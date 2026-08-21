import { registerAs } from '@nestjs/config';

import { envSchema } from './env.schema';

export type DocsConfig = {
  enabled: boolean;
  path: string;
  /** Basic Auth opcional. Ambas o ninguna — `env.schema.ts` rechaza el arranque a medias. */
  username?: string;
  password?: string;
};

export const docsConfig = registerAs('docs', (): DocsConfig => {
  const env = envSchema.parse(process.env);
  return {
    enabled: env.DOCS_ENABLED,
    path: env.DOCS_PATH,
    username: env.DOCS_USERNAME,
    password: env.DOCS_PASSWORD,
  };
});
