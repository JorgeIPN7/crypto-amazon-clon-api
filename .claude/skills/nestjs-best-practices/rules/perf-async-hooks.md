---
title: Use Async Lifecycle Hooks Correctly
impact: HIGH
impactDescription: Improper async handling blocks application startup
tags: performance, lifecycle, async, hooks, v11
---

## Use Async Lifecycle Hooks Correctly

NestJS lifecycle hooks (`onModuleInit`, `onApplicationBootstrap`, etc.) support async operations. However, misusing them can block application startup or cause race conditions. Understand the lifecycle order and use hooks appropriately.

> **NestJS 11 note:** termination hooks (`onModuleDestroy`, `beforeApplicationShutdown`, `onApplicationShutdown`) now run in **reverse order** of their initialization counterparts. A module that initialized first will tear down last. This makes "destroy after my consumers" guarantees explicit: a database module imported by a feature module is destroyed *after* the feature, so feature-module destroy hooks can still issue queries.

**Initialization order (still oldest → newest dependency):**
`onModuleInit` → `onApplicationBootstrap` (after every module is initialized)

**Termination order (NEW in v11 — reversed):**
`onModuleDestroy` → `beforeApplicationShutdown` → `onApplicationShutdown` (newest dependency tears down first)

Termination hooks only fire if you call `app.close()` or you've called `app.enableShutdownHooks()` and the process receives `SIGTERM`/`SIGINT`. Shutdown hooks are off by default (they consume memory).

**Incorrect (fire-and-forget async without await):**

```typescript
// Fire-and-forget async without await
@Injectable()
export class DatabaseService implements OnModuleInit {
  onModuleInit() {
    // This runs but doesn't block - app starts before DB is ready!
    this.connect();
  }

  private async connect() {
    await this.pool.connect();
    console.log('Database connected');
  }
}

// Heavy blocking operations in constructor
@Injectable()
export class ConfigService {
  private config: Config;

  constructor() {
    // BLOCKS entire module instantiation synchronously
    this.config = fs.readFileSync('config.json');
  }
}
```

**Correct (return promises from async hooks):**

```typescript
// Return promise from async hooks
@Injectable()
export class DatabaseService implements OnModuleInit {
  private pool: Pool;

  async onModuleInit(): Promise<void> {
    // NestJS waits for this to complete before continuing
    await this.pool.connect();
    console.log('Database connected');
  }

  async onModuleDestroy(): Promise<void> {
    // Clean up resources on shutdown
    await this.pool.end();
    console.log('Database disconnected');
  }
}

// Use onApplicationBootstrap for cross-module dependencies
@Injectable()
export class CacheWarmerService implements OnApplicationBootstrap {
  constructor(
    private cache: CacheService,
    private products: ProductsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // All modules are initialized, safe to warm cache
    const products = await this.products.findPopular();
    await this.cache.warmup(products);
  }
}

// Heavy init in async hooks, not constructor
@Injectable()
export class ConfigService implements OnModuleInit {
  private config: Config;

  constructor() {
    // Keep constructor synchronous and fast
  }

  async onModuleInit(): Promise<void> {
    // Async loading in lifecycle hook
    this.config = await this.loadConfig();
  }

  private async loadConfig(): Promise<Config> {
    const file = await fs.promises.readFile('config.json');
    return JSON.parse(file.toString());
  }

  get<T>(key: string): T {
    return this.config[key];
  }
}

// Enable shutdown hooks in main.ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks(); // Enable SIGTERM/SIGINT handling
  await app.listen(3000);
}
```

Reference: [NestJS Lifecycle Events](https://docs.nestjs.com/fundamentals/lifecycle-events)
