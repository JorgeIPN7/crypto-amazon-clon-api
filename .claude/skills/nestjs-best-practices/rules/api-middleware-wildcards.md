---
title: Use Named Wildcards in Middleware Routes (Express v5)
impact: HIGH
impactDescription: Express v5 broke unnamed wildcards — silently mismatched routes are a security hazard
tags: api, middleware, routing, express, v11, fastify
---

## Use Named Wildcards in Middleware Routes (Express v5)

NestJS 11 ships with Express v5 by default, which upgraded `path-to-regexp` to v8. Unnamed wildcards (`*`, `(.*)`) are no longer valid syntax — middleware routes must use **named wildcards** (`*splat` or the more explicit `{*splat}`). NestJS auto-converts the legacy syntax in many cases, but relying on the shim is fragile: you can end up with middleware that silently doesn't run on the routes you expected, which is especially dangerous for auth/rate-limit middleware.

The same change affects `@nestjs/platform-fastify` — Fastify v5 also ships in NestJS 11, though Fastify's path matching is less affected outside of middleware.

**Incorrect (Express v4 wildcards — broken or auto-shimmed in NestJS 11):**

```typescript
@Module({})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(LoggerMiddleware)
      .forRoutes('*');           // ❌ Express v5: not a valid pattern

    consumer
      .apply(AuthMiddleware)
      .forRoutes('(.*)');        // ❌ legacy syntax — NestJS auto-converts but stop relying on this

    consumer
      .apply(TrimBodyMiddleware)
      .forRoutes({ path: '/api/*', method: RequestMethod.ALL }); // ❌ ambiguous
  }
}
```

**Correct (named wildcards — Express v5 / NestJS 11):**

```typescript
@Module({})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // {*splat} matches the root path AND every nested path — preferred for global middleware
    consumer
      .apply(LoggerMiddleware)
      .forRoutes('{*splat}');

    // *splat is sufficient when the root path is acceptable
    consumer
      .apply(AuthMiddleware)
      .forRoutes('*splat');

    // Bound wildcards still work for prefixes
    consumer
      .apply(TrimBodyMiddleware)
      .forRoutes({ path: 'api/*splat', method: RequestMethod.ALL });

    // Excluding routes follows the same syntax
    consumer
      .apply(SessionMiddleware)
      .exclude('health', 'metrics', 'api/auth/{*splat}')
      .forRoutes('{*splat}');
  }
}
```

**Pattern cheat sheet:**

| Goal | NestJS 11 / Express v5 | Old (v10 / Express v4) |
|------|------------------------|-------------------------|
| Match every path including `/` | `'{*splat}'` | `'*'` or `'(.*)'` |
| Match every path **below** a prefix | `'api/*splat'` | `'api/*'` |
| Match exactly one extra segment | `'/users/:id'` | unchanged |
| Match the literal `/` only | `'/'` | unchanged |
| Exclude a subtree | `.exclude('api/auth/{*splat}')` | `.exclude('api/auth/(.*)')` |

The token after `*` is just a name — `splat` is convention, not magic. `'{*everything}'` works too.

**Why this is a security concern, not just a syntax change:** auth, CSRF, rate limiting, and request-logging middleware are usually mounted with a wildcard. If the pattern silently mismatches, the middleware doesn't run on the routes you thought it would — but everything compiles and starts. Always add an integration test that hits an unauthenticated route and asserts the auth middleware kicked in.

Reference: [NestJS 11 Migration — middleware](https://docs.nestjs.com/migration-guide#express-v5) · [path-to-regexp v8](https://github.com/pillarjs/path-to-regexp)
