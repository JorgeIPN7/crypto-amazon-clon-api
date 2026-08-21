---
title: Use Durable Providers for Multi-Tenant Request Scope
impact: HIGH
impactDescription: Avoids the multiplicative cost of REQUEST scope in multi-tenant apps
tags: dependency-injection, scopes, multi-tenancy, performance, request-scope
---

## Use Durable Providers for Multi-Tenant Request Scope

`Scope.REQUEST` providers create a fresh instance per HTTP request — and the cost cascades: every singleton that *injects* a request-scoped provider becomes request-scoped too. In a multi-tenant API where you only really care about a per-tenant context (not per-request), this is wasteful: hundreds of providers get re-instantiated on every request even though there are only N tenants.

**Durable providers** are NestJS's solution: mark the provider as `durable: true`, register a `ContextIdStrategy`, and NestJS will cache the dependency sub-tree per **context key** (e.g., tenant ID) instead of per request. Two requests from the same tenant share the same instance — but tenant isolation is preserved.

Use durable providers when:
- You need request-scoped state (active tenant, DB connection, feature flags), AND
- The state varies on a *bounded* dimension (tenant, region, plan), AND
- You're seeing measurable overhead from a `Scope.REQUEST` tree.

For "I just need the current request's user ID," prefer `nestjs-cls` instead — it gives you AsyncLocalStorage without making any provider request-scoped.

**Incorrect (REQUEST scope cascading across the whole tenant tree):**

```typescript
// Every dependent of TenantContext becomes REQUEST-scoped → re-instantiated per request
@Injectable({ scope: Scope.REQUEST })
export class TenantContext {
  constructor(@Inject(REQUEST) private req: Request) {}

  getTenantId(): string {
    return this.req.headers['x-tenant-id'] as string;
  }
}

@Injectable() // looks singleton, but isn't anymore
export class TenantConfigService {
  constructor(private ctx: TenantContext) {}     // 🔥 cascades to REQUEST scope

  getConfig() {
    return this.loadConfigFor(this.ctx.getTenantId());
  }
}

@Injectable()
export class ReportsService {
  constructor(private config: TenantConfigService) {}  // 🔥 also REQUEST-scoped now
  // ... 50 more services in this tree, all rebuilt every request
}
```

**Correct (durable providers + tenant-keyed context):**

```typescript
// 1. Strategy: tell NestJS how to derive a context key from each request
import { ContextIdFactory, ContextIdResolverFn, ContextIdStrategy, HostComponentInfo } from '@nestjs/core';
import { Request } from 'express';

const tenants = new Map<string, ContextId>();

export class AggregateByTenantContextIdStrategy implements ContextIdStrategy {
  attach(contextId: ContextId, request: Request): ContextIdResolverFn {
    const tenantId = (request.headers['x-tenant-id'] as string) ?? 'public';

    let tenantSubTreeId = tenants.get(tenantId);
    if (!tenantSubTreeId) {
      tenantSubTreeId = ContextIdFactory.create();
      tenants.set(tenantId, tenantSubTreeId);
    }

    // Return the cache key for durable providers; non-durable providers
    // still get a fresh instance per request.
    return (info: HostComponentInfo) =>
      info.isTreeDurable ? tenantSubTreeId! : contextId;
  }
}

// 2. Bootstrap: register the strategy ONCE before app.listen
async function bootstrap() {
  ContextIdFactory.apply(new AggregateByTenantContextIdStrategy());
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}

// 3. Mark the tenant-scoped tree as durable
@Injectable({ scope: Scope.REQUEST, durable: true })
export class TenantContext {
  constructor(@Inject(REQUEST) private req: Request) {}

  getTenantId(): string {
    return this.req.headers['x-tenant-id'] as string;
  }
}

@Injectable({ scope: Scope.REQUEST, durable: true })
export class TenantConfigService {
  constructor(private ctx: TenantContext) {}

  getConfig() {
    return this.loadConfigFor(this.ctx.getTenantId());
  }
}

// Now: one TenantContext + TenantConfigService instance per *tenant*,
// reused across all requests for that tenant. Switch tenants → fresh instance.
```

**Two important constraints:**

1. **The whole sub-tree must be marked `durable: true`** — a non-durable provider in the middle of the chain breaks caching back to per-request.
2. **The cache grows unbounded** unless you evict. For a small fixed set of tenants this is fine; for a long tail you need an LRU eviction policy in your strategy. Don't ship the naive `Map` above to a SaaS with 100k tenants without bounding it.

**When NOT to use this:**

- For per-user data (user ID, locale) prefer `nestjs-cls` (AsyncLocalStorage) — it keeps your providers as singletons and propagates context through async calls automatically.
- For audit logging, request IDs, or correlation IDs, also use `nestjs-cls`. Durable scope is overkill.
- If your "tenant" is really just a database name, inject a factory and pick the connection at call time instead of scoping the whole tree.

Reference: [NestJS Injection Scopes — Durable providers](https://docs.nestjs.com/fundamentals/injection-scopes#durable-providers)
