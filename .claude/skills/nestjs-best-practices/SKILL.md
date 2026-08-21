---
name: nestjs-best-practices
description: NestJS best practices and architecture patterns for building production-ready applications, aligned with NestJS 11 (Express v5 / Fastify v5, Node.js 20+, cache-manager v6 / Keyv, BullMQ WorkerHost, reverse-order termination hooks). This skill should be used when writing, reviewing, or refactoring NestJS code to ensure proper patterns for modules, dependency injection, security, and performance.
allowed-tools: Read, Grep, Glob
---

# NestJS Best Practices

Comprehensive best practices guide for NestJS applications. Contains **45 rules across 10 categories**, prioritized by impact to guide automated refactoring and code generation. Updated for **NestJS 11**.

## When to Apply

Reference these guidelines when:

- Writing new NestJS modules, controllers, or services
- Implementing authentication and authorization
- Reviewing code for architecture and security issues
- Refactoring existing NestJS codebases
- Optimizing performance or database queries
- Building microservices architectures
- **Migrating from NestJS 10 → 11** (see "NestJS 11 changes" below)

## NestJS 11 changes worth knowing

These cross-cutting v11 changes are referenced by individual rules where relevant:

- **Node.js 20+ required** — v16 and v18 dropped (`devops-node-version`).
- **Express v5 by default** — middleware wildcards changed: `*` / `(.*)` → `*splat` / `{*splat}` (`api-middleware-wildcards`).
- **Fastify v5 supported** in `@nestjs/platform-fastify`.
- **Cache module migrated to Keyv** (`cache-manager` v6) — `redisStore` removed; use `stores: [new KeyvRedis(...)]` (`perf-use-caching`).
- **BullMQ uses `WorkerHost`** — the legacy `@Process('name')` decorator is not supported in `@nestjs/bullmq` (`micro-use-queues`).
- **Termination lifecycle hooks run in reverse order** vs initialization (`perf-async-hooks`, `devops-graceful-shutdown`).
- **Reflector type inference improved** — `getAllAndOverride<T>` now returns `T | undefined`; `getAllAndMerge` returns an object (not array) for a single object entry (`security-use-guards`).
- **Logger gained a `fatal` level**, and `ConsoleLogger` natively supports JSON output (`devops-use-logging`).

## Rule Categories by Priority

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Architecture | CRITICAL | `arch-` |
| 2 | Dependency Injection | CRITICAL | `di-` |
| 3 | Error Handling | HIGH | `error-` |
| 4 | Security | HIGH | `security-` |
| 5 | Performance | HIGH | `perf-` |
| 6 | Testing | MEDIUM-HIGH | `test-` |
| 7 | Database & ORM | MEDIUM-HIGH | `db-` |
| 8 | API Design | MEDIUM | `api-` |
| 9 | Microservices | MEDIUM | `micro-` |
| 10 | DevOps & Deployment | LOW-MEDIUM | `devops-` |

## Quick Reference

### 1. Architecture (CRITICAL)

- `arch-avoid-circular-deps` - Avoid circular module dependencies
- `arch-feature-modules` - Organize by feature, not technical layer
- `arch-module-sharing` - Proper module exports/imports, avoid duplicate providers
- `arch-single-responsibility` - Focused services over "god services"
- `arch-use-repository-pattern` - Abstract database logic for testability
- `arch-use-events` - Event-driven architecture for decoupling

### 2. Dependency Injection (CRITICAL)

- `di-avoid-service-locator` - Avoid service locator anti-pattern
- `di-durable-providers` - Use durable providers for multi-tenant request scope
- `di-interface-segregation` - Interface Segregation Principle (ISP)
- `di-liskov-substitution` - Liskov Substitution Principle (LSP)
- `di-prefer-constructor-injection` - Constructor over property injection
- `di-scope-awareness` - Understand singleton/request/transient scopes
- `di-use-interfaces-tokens` - Use injection tokens for interfaces

### 3. Error Handling (HIGH)

- `error-use-exception-filters` - Centralized exception handling
- `error-throw-http-exceptions` - Use NestJS HTTP exceptions
- `error-handle-async-errors` - Handle async errors properly

### 4. Security (HIGH)

- `security-auth-jwt` - Secure JWT authentication
- `security-csrf-protection` - Protect cookie-authenticated endpoints from CSRF
- `security-rate-limiting` - Implement rate limiting (incl. trust-proxy in v11)
- `security-sanitize-output` - Prevent XSS attacks
- `security-use-guards` - Authentication and authorization guards
- `security-use-helmet` - Apply Helmet for default security headers
- `security-validate-all-input` - Validate with class-validator

### 5. Performance (HIGH)

- `perf-async-hooks` - Proper async lifecycle hooks
- `perf-use-caching` - Implement caching strategies
- `perf-optimize-database` - Optimize database queries
- `perf-lazy-loading` - Lazy load modules for faster startup

### 6. Testing (MEDIUM-HIGH)

- `test-use-testing-module` - Use NestJS testing utilities
- `test-e2e-supertest` - E2E testing with Supertest
- `test-mock-external-services` - Mock external dependencies

### 7. Database & ORM (MEDIUM-HIGH)

- `db-use-transactions` - Transaction management
- `db-avoid-n-plus-one` - Avoid N+1 query problems
- `db-use-migrations` - Use migrations for schema changes

### 8. API Design (MEDIUM)

- `api-middleware-wildcards` - Use named wildcards in middleware routes (Express v5)
- `api-use-dto-serialization` - DTO and response serialization
- `api-use-interceptors` - Cross-cutting concerns
- `api-use-pipes` - Input transformation with pipes
- `api-versioning` - API versioning strategies

### 9. Microservices (MEDIUM)

- `micro-use-patterns` - Message and event patterns
- `micro-use-health-checks` - Health checks for orchestration
- `micro-use-queues` - Background job processing

### 10. DevOps & Deployment (LOW-MEDIUM)

- `devops-graceful-shutdown` - Zero-downtime deployments (v11 reverse-order hooks)
- `devops-node-version` - Run on a supported Node.js LTS (v20+ required by v11)
- `devops-use-config-module` - Environment configuration
- `devops-use-logging` - Structured logging (incl. v11 `fatal` level + JSON ConsoleLogger)

## How to Use

Read individual rule files for detailed explanations and code examples:

```
rules/arch-avoid-circular-deps.md
rules/security-validate-all-input.md
rules/_sections.md
```

Each rule file contains:
- Brief explanation of why it matters
- Incorrect code example with explanation
- Correct code example with explanation
- Additional context and references

## Full Compiled Document

For the complete guide with all rules expanded: `AGENTS.md`

## Integration with Hexagonal / DDD layers

This skill provides **rule-level checks** (DI, security, performance, API). The companion skill `clean-ddd-hexagonal` provides the **architectural layout** (domain / application / infrastructure). Both apply at the same time. Use this mapping when deciding which rule belongs to which layer:

| Layer | Rules that apply | Rules that do NOT apply |
|-------|------------------|--------------------------|
| `domain/` | None of these (domain has zero NestJS dependencies) | All — domain is pure TS, no `@Injectable()`, no `class-validator` decorators, no HTTP/DB |
| `application/` | `arch-single-responsibility`, `arch-use-events`, `di-*` (all), `error-throw-http-exceptions` only via filter, `test-use-testing-module` | `api-*`, `db-*`, `security-rate-limiting`, `security-csrf-protection` (those are adapter concerns) |
| `infrastructure/http/` | `api-*` (all), `security-*` (all), `error-use-exception-filters`, `perf-use-caching` for read endpoints | `arch-use-repository-pattern` (already abstracted by domain port) |
| `infrastructure/persistence/` | `arch-use-repository-pattern`, `db-*` (all), `perf-optimize-database`, `test-mock-external-services` | `api-*`, `security-validate-all-input` |
| `infrastructure/messaging/` | `micro-*` (all), `arch-use-events`, `error-handle-async-errors` | `api-versioning`, `security-csrf-protection` |
| `bootstrap/` & `main.ts` | `devops-*` (all), `security-use-helmet`, `security-rate-limiting`, `perf-async-hooks` | Domain/application rules |

**Rule of thumb:**
- DI tokens (`di-use-interfaces-tokens`) are mandatory for every port/adapter pair — see `${CLAUDE_SKILL_DIR}/../clean-ddd-hexagonal/references/NESTJS-MAPPING.md`.
- **Declare contracts as `type`, not `interface`.** The `rules/*.md` examples use `interface` (they are framework-generic), but this repo's ESLint enforces `@typescript-eslint/consistent-type-definitions: ['error', 'type']`. Translate every `export interface X { … }` example into `export type X = { … };` before writing it. The injection-token pattern itself is unchanged — a `type` is erased at compile time exactly like an `interface`, which is precisely why the `Symbol` token is required.
- Validation (`security-validate-all-input`) lives in HTTP DTOs, never in domain entities. The domain enforces invariants via constructor logic and value objects.
- `arch-use-repository-pattern`: the **interface lives in `domain/ports/`**, the **implementation in `infrastructure/persistence/`**. Wire them with a Symbol token in the module.

## Workflow Integration

This skill is consulted at three points:

1. **brainstorming** — when the design touches a NestJS-specific concern (auth, caching, queues, validation, throttling), cite the relevant rule code (e.g. `security-auth-jwt`) when proposing tradeoffs.
2. **writing-plans** — every task that creates Nest artifacts (controllers, providers, modules, filters) lists the applicable rule codes inline so the implementer can verify against them.
3. **execution (executing-plans / subagent-driven-development)** — code-quality review checks the changed files against the rule codes the plan attached to each task.

Pair this skill with `clean-ddd-hexagonal` — they are designed to be used together in this repo.
