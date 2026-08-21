---
title: Implement Rate Limiting
impact: HIGH
impactDescription: Protects against abuse and ensures fair resource usage
tags: security, rate-limiting, throttler, protection, v11
---

## Implement Rate Limiting

Use `@nestjs/throttler` to limit request rates per client. Apply different limits for different endpoints — stricter for auth endpoints, more relaxed for read operations. Consider using Redis for distributed rate limiting in clustered deployments.

> **NestJS 11 + reverse proxy note:** when running behind a load balancer (k8s ingress, ALB, Cloudflare), `req.ip` resolves to the proxy's IP — every request looks like it comes from one client and rate limits are useless. Either configure `app.set('trust proxy', ...)` on Express **and** override `getTracker()` to read `req.ips[0]`, or run the throttler on the proxy. `getTracker()` returns `Promise<string>` in v11 — make it `async`.

**Incorrect (no rate limiting on sensitive endpoints):**

```typescript
// No rate limiting on sensitive endpoints
@Controller('auth')
export class AuthController {
  @Post('login')
  async login(@Body() dto: LoginDto): Promise<TokenResponse> {
    // Attackers can brute-force credentials
    return this.authService.login(dto);
  }

  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    // Can be abused to spam users with emails
    return this.authService.sendResetEmail(dto.email);
  }
}

// Same limits for all endpoints
@UseGuards(ThrottlerGuard)
@Controller('api')
export class ApiController {
  @Get('public-data')
  async getPublic() {} // Should allow more requests

  @Post('process-payment')
  async payment() {} // Should be more restrictive
}
```

**Correct (configured throttler with endpoint-specific limits):**

```typescript
// Configure throttler globally with multiple limits
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000, // 1 second
        limit: 3, // 3 requests per second
      },
      {
        name: 'medium',
        ttl: 10000, // 10 seconds
        limit: 20, // 20 requests per 10 seconds
      },
      {
        name: 'long',
        ttl: 60000, // 1 minute
        limit: 100, // 100 requests per minute
      },
    ]),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}

// Override limits per endpoint
@Controller('auth')
export class AuthController {
  @Post('login')
  @Throttle({ short: { limit: 5, ttl: 60000 } }) // 5 attempts per minute
  async login(@Body() dto: LoginDto): Promise<TokenResponse> {
    return this.authService.login(dto);
  }

  @Post('forgot-password')
  @Throttle({ short: { limit: 3, ttl: 3600000 } }) // 3 per hour
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    return this.authService.sendResetEmail(dto.email);
  }
}

// Skip throttling for certain routes
@Controller('health')
export class HealthController {
  @Get()
  @SkipThrottle()
  check(): string {
    return 'OK';
  }
}

// Custom throttle per user type — getTracker() is async in v11
@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    // Authenticated user → user ID; otherwise client IP behind proxy
    if (req.user?.id) return `user:${req.user.id}`;
    // req.ips is populated when 'trust proxy' is set; fall back to req.ip
    return req.ips?.[0] ?? req.ip;
  }

  protected async getLimit(context: ExecutionContext): Promise<number> {
    const request = context.switchToHttp().getRequest();

    // Higher limits for authenticated users
    if (request.user) {
      return request.user.isPremium ? 1000 : 200;
    }

    return 50; // Anonymous users
  }
}

// Trust the load balancer so req.ip / req.ips report the real client
import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // 'loopback' for local dev, a CIDR for production, or `1` to trust one hop.
  // NEVER set this to `true` in production — IP-spoofing trivializes the throttler.
  app.set('trust proxy', process.env.TRUSTED_PROXIES ?? 'loopback');
  await app.listen(3000);
}
```

Reference: [NestJS Throttler](https://docs.nestjs.com/security/rate-limiting)
