---
title: Use Caching Strategically
impact: HIGH
impactDescription: Dramatically reduces database load and response times
tags: performance, caching, redis, keyv, optimization, v11
---

## Use Caching Strategically

Implement caching for expensive operations, frequently accessed data, and external API calls. Use NestJS `CacheModule` with appropriate TTLs and cache invalidation strategies. Don't cache everything — focus on high-impact areas.

> **NestJS 11 note:** `@nestjs/cache-manager` migrated to `cache-manager` v6, which is built on top of **Keyv**. The legacy `redisStore` shape (`{ store: redisStore(...) }`) is no longer supported. Configure adapters via the `stores: [...]` array using `KeyvRedis`, `KeyvCacheableMemory`, etc. Cache values are now wrapped in `{ value, expires }` internally — important if you read/write the cache directly or migrate from a v10 deployment that produced the old shape.

**Incorrect (no caching, caching everything, or legacy redisStore):**

```typescript
// No caching for expensive, repeated queries
@Injectable()
export class ProductsService {
  async getPopular(): Promise<Product[]> {
    // Runs complex aggregation query EVERY request
    return this.productsRepo
      .createQueryBuilder('p')
      .leftJoin('p.orders', 'o')
      .select('p.*, COUNT(o.id) as orderCount')
      .groupBy('p.id')
      .orderBy('orderCount', 'DESC')
      .limit(20)
      .getMany();
  }
}

// ❌ Legacy v10 shape — no longer works in NestJS 11
CacheModule.registerAsync({
  useFactory: async () => {
    const store = await redisStore({ socket: { host: 'localhost', port: 6379 } });
    return { store };
  },
});

// Cache everything without thought
@Injectable()
export class UsersService {
  @CacheKey('users')
  @CacheTTL(3600)
  @UseInterceptors(CacheInterceptor)
  async findAll(): Promise<User[]> {
    // Caching a constantly-changing list for 1 hour is the wrong tradeoff
    return this.usersRepo.find();
  }
}
```

**Correct (Keyv-based stores with strategic invalidation):**

```typescript
// Setup: install peers — npm i @nestjs/cache-manager cache-manager keyv @keyv/redis cacheable
import { CacheModule } from '@nestjs/cache-manager';
import { Keyv } from 'keyv';
import KeyvRedis from '@keyv/redis';
import { KeyvCacheableMemory } from 'cacheable';

@Module({
  imports: [
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // Two-tier cache: memory (fast) + Redis (shared across instances).
        // The first store is primary; later stores are fallbacks.
        stores: [
          new Keyv({
            store: new KeyvCacheableMemory({ ttl: 60_000, lruSize: 5_000 }),
          }),
          new KeyvRedis(config.getOrThrow<string>('REDIS_URL')),
        ],
        ttl: 60_000, // default 60s — TTLs are in MILLISECONDS
      }),
    }),
  ],
})
export class AppModule {}

// Manual caching for granular control
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

@Injectable()
export class ProductsService {
  constructor(
    @Inject(CACHE_MANAGER) private cache: Cache,
    private productsRepo: ProductRepository,
  ) {}

  async getPopular(): Promise<Product[]> {
    const cacheKey = 'products:popular';

    const cached = await this.cache.get<Product[]>(cacheKey);
    if (cached) return cached;

    const products = await this.fetchPopularProducts();
    await this.cache.set(cacheKey, products, 5 * 60_000); // 5 min in ms
    return products;
  }

  // Invalidate cache on writes
  async updateProduct(id: string, dto: UpdateProductDto): Promise<Product> {
    const product = await this.productsRepo.save({ id, ...dto });
    await Promise.all([
      this.cache.del('products:popular'),
      this.cache.del(`product:${id}`),
    ]);
    return product;
  }
}

// Decorator-based caching with the auto-interceptor
@Controller('categories')
@UseInterceptors(CacheInterceptor)
export class CategoriesController {
  @Get()
  @CacheTTL(30 * 60_000) // 30 minutes — categories rarely change
  findAll(): Promise<Category[]> {
    return this.categoriesService.findAll();
  }

  @Get(':id')
  @CacheTTL(60_000)
  @CacheKey('category')
  findOne(@Param('id') id: string): Promise<Category> {
    return this.categoriesService.findOne(id);
  }
}

// Event-based cache invalidation
@Injectable()
export class CacheInvalidationService {
  constructor(@Inject(CACHE_MANAGER) private cache: Cache) {}

  @OnEvent('product.created')
  @OnEvent('product.updated')
  @OnEvent('product.deleted')
  async invalidateProductCaches(event: ProductEvent) {
    await Promise.all([
      this.cache.del('products:popular'),
      this.cache.del(`product:${event.productId}`),
    ]);
  }
}
```

**Decide what (and what NOT) to cache:**

| Good caching candidates | Avoid caching |
|--------------------------|---------------|
| Aggregations / reports recomputed often | Per-user PII you can't safely partition by key |
| Read-mostly reference data (categories, plans) | Mutating-write hot paths (you'll fight invalidation) |
| External API responses (rate-limited / paid) | Strongly time-sensitive data (auth tokens, balances) |
| Pure functions with bounded input space | Anything where staleness is a correctness bug |

Reference: [NestJS Caching](https://docs.nestjs.com/techniques/caching) · [Migration to cache-manager v6 / Keyv](https://docs.nestjs.com/migration-guide#cache-module)
