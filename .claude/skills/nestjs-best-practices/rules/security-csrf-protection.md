---
title: Protect Cookie-Authenticated Endpoints from CSRF
impact: HIGH
impactDescription: CSRF lets an attacker perform state changes as the victim user
tags: security, csrf, cookies, authentication
---

## Protect Cookie-Authenticated Endpoints from CSRF

If your NestJS app authenticates browser users with **cookies** (session cookies, persistent JWT-in-cookie, OAuth refresh cookie), every state-changing endpoint is reachable from a cross-origin form unless you protect it. Use the double-submit-cookie pattern via `csrf-csrf` (Express) or `@fastify/csrf-protection` (Fastify). The deprecated `csurf` package is no longer maintained and should not be used.

CSRF protection is **not needed** for endpoints authenticated with `Authorization: Bearer ...` headers from a non-cookie source — browsers do not auto-attach those, so cross-origin requests can't impersonate the user.

**When you need CSRF protection:**

| Auth mechanism | CSRF risk | Need protection? |
|----------------|-----------|------------------|
| Session cookie | High — browser auto-sends | **Yes** |
| HTTP-only JWT cookie | High — browser auto-sends | **Yes** |
| `Authorization: Bearer` header (read from `localStorage`/memory) | Low | No |
| Pure machine-to-machine API (no browser clients) | None | No |
| `SameSite=Strict` cookie + no third-party login flows | Reduced, not zero | Yes (defense in depth) |

**Incorrect (cookie-authenticated app with no CSRF guard):**

```typescript
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(cookieParser());
  app.use(session({ secret: 'x', cookie: { httpOnly: true } }));

  // ❌ No CSRF protection — any cross-origin <form> targeting /api/* succeeds
  await app.listen(3000);
}

// Attacker page on evil.com:
// <form method="POST" action="https://yourapp.com/api/account/delete">
//   <button>Click for free coupon</button>
// </form>
// → cookie auto-sent, account deleted
```

**Correct (Express — `csrf-csrf` double-submit-cookie):**

```typescript
// npm i csrf-csrf cookie-parser
import cookieParser from 'cookie-parser';
import { doubleCsrf } from 'csrf-csrf';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(cookieParser(process.env.COOKIE_SECRET));

  const { doubleCsrfProtection, generateToken } = doubleCsrf({
    getSecret: () => process.env.CSRF_SECRET!,
    cookieName: '__Host-psifi.x-csrf-token',
    cookieOptions: {
      sameSite: 'lax',
      path: '/',
      secure: true,
      httpOnly: true,
    },
    // Only protect mutating methods — GETs are read-only
    ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
    getTokenFromRequest: (req) => req.headers['x-csrf-token'] as string,
  });

  app.use(doubleCsrfProtection);

  // Expose a public endpoint that issues a fresh token to the SPA
  app.use('/csrf-token', (req, res) => {
    res.json({ token: generateToken(req, res) });
  });

  await app.listen(3000);
}

// Frontend
// 1. fetch('/csrf-token', { credentials: 'include' }) → { token }
// 2. POST/PUT/DELETE with header: 'x-csrf-token': token
```

**Correct (Fastify — `@fastify/csrf-protection`):**

```typescript
// npm i @fastify/csrf-protection @fastify/cookie
import fastifyCookie from '@fastify/cookie';
import fastifyCsrf from '@fastify/csrf-protection';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  await app.register(fastifyCookie, {
    secret: process.env.COOKIE_SECRET,
  });
  await app.register(fastifyCsrf);

  await app.listen(3000);
}
```

**Defense in depth — also do this:**

- Set session cookies as `Secure; HttpOnly; SameSite=Lax` (or `Strict` if no third-party login redirects).
- Use the `__Host-` cookie prefix to lock cookies to the exact host with `Path=/`.
- Validate `Origin` / `Referer` on mutating endpoints as a second layer.
- Never accept a CSRF token via query string (it leaks into logs and the Referer header).

Reference: [NestJS Security — CSRF](https://docs.nestjs.com/security/csrf) · [csrf-csrf](https://github.com/Psifi-Solutions/csrf-csrf) · [OWASP CSRF Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
