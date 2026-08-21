---
title: Run on a Supported Node.js LTS
impact: CRITICAL
impactDescription: NestJS 11 dropped Node.js 16 and 18 — older runtimes will not start
tags: devops, runtime, nodejs, v11, compatibility
---

## Run on a Supported Node.js LTS

NestJS 11 requires **Node.js v20 or higher**. Node.js 16 reached EOL in September 2023 and Node.js 18 lost security support in April 2025, so neither is supported. Pin the runtime in `package.json`, your Dockerfile, and CI so dev, test, and prod cannot drift onto an unsupported version. Older Node will fail with cryptic `Symbol`/`URLPattern`/`async-hooks` errors at startup, not a clean message.

**Incorrect (no engine pin, mismatched runtimes, EOL Node):**

```dockerfile
# Dockerfile
FROM node:18-alpine     # ❌ unsupported on NestJS 11
WORKDIR /app
COPY . .
RUN npm ci && npm run build
CMD ["node", "dist/main"]
```

```jsonc
// package.json — silent on engine, anything goes
{
  "name": "api",
  "scripts": { "start": "node dist/main" }
  // no "engines" field — npm/pnpm will install on Node 16, 18, 20, 21, ...
}
```

```yaml
# .github/workflows/ci.yml
- uses: actions/setup-node@v4
  with:
    node-version: 18    # ❌ tests pass on 18, prod runs on 20 — drift
```

**Correct (pin LTS in every layer):**

```jsonc
// package.json
{
  "name": "api",
  "engines": {
    "node": ">=20.11.0",
    "pnpm": ">=9"
  },
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "start": "node dist/main"
  }
}
```

```dockerfile
# Dockerfile — match the LTS line you support
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
CMD ["node", "dist/main"]
```

```yaml
# .github/workflows/ci.yml — same Node as production
- uses: actions/setup-node@v4
  with:
    node-version-file: '.nvmrc'    # single source of truth
    cache: 'pnpm'
```

```text
# .nvmrc
20.11.0
```

```bash
# Local dev: nvm + .nvmrc keeps every contributor on the same Node
$ nvm use
Found '/path/to/repo/.nvmrc' with version <20.11.0>
Now using node v20.11.0
```

**Why this matters:**

- **Security patches** stop landing on EOL Node — staying current is the only way to get them.
- **NestJS 11's transitive deps** (path-to-regexp v8, `node:test`, `AsyncLocalStorage` improvements, native `fetch`) assume Node 20+ APIs.
- **Cryptic startup errors:** running NestJS 11 on Node 18 surfaces as `TypeError: Cannot read properties of undefined (reading 'createServer')` or weird module-resolution failures, not "you need newer Node."
- **Drift between dev and prod** is the source of "works on my machine" bugs around `URL`, `crypto.subtle`, and timing. The `engines` field + lockfile + Dockerfile + `.nvmrc` together prevent it.

Reference: [NestJS Migration Guide — Node.js](https://docs.nestjs.com/migration-guide#nodejs-v16-and-v18-no-longer-supported) · [Node.js release schedule](https://github.com/nodejs/release#release-schedule)
