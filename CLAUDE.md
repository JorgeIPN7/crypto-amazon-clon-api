# _nest-base-template

Production-ready NestJS 11 base template. Hexagonal/DDD layout, SWC builds, Pino logging with request-id via CLS, Zod-validated config, self-hosted Scalar API reference over OpenAPI, Terminus health checks.

## Stack

NestJS 11 · TypeScript 6.0 · Node 24.19.0+ · pnpm 11 · SWC · Jest 30 · Supertest · Pino 10 · Zod 4 · class-validator 0.15 · TypeORM 1 · PostgreSQL 18 · Scalar 1.65

**OpenAPI: dos piezas distintas que el nombre «Swagger» confunde.** `@nestjs/swagger` sigue siendo el **generador** del documento a partir de decoradores; Scalar es solo el **renderizador** que lo consume. Por eso los imports de `@nestjs/swagger` se quedan —es el nombre del paquete upstream— mientras que el vocabulario propio del repo (config, variables de entorno, nombres de archivo) dice `docs`/`openapi`.

El bundle de Scalar se sirve desde el propio origen, nunca desde su CDN: el paquete no permite adjuntar un hash `integrity`, así que auto-hospedarlo es la única forma de saber qué JavaScript se ejecuta.

Package manager is **pnpm** — never `npm install` or `yarn`.

The exact version is pinned in `packageManager`. If your global `pnpm` is older, run commands through `corepack pnpm …`, or once `corepack enable` so the pinned version is used automatically. pnpm settings (`overrides`, `allowBuilds`) live in `pnpm-workspace.yaml` — since pnpm 11 the `pnpm` key in `package.json` is ignored **silently**.

**The `js-yaml` CVE override is gone (2026-08-19).** It patched GHSA-pm4m-ph32-ghv5, and it was retired because upstream met its stated exit condition: `@nestjs/swagger@11.4.7` now pins `js-yaml@5.3.0`, fix included. Two things worth carrying forward, both in the file's tombstone comment and in backlog #6: an override **replaces upstream's rule entirely**, so while it stood the tree sat on 5.2.3 and never saw the 5.3.0 swagger asks for; and retiring it is only safe **because `pnpm audit --prod --audit-level=high` runs in CI** — that gate is what caught this CVE in the first place.

**The `typescript` override is scoped to `'@nestjs/cli>typescript'`, and that scope is load-bearing.** `renovate.json` has `pnpm-workspace.yaml` `enabled: false`, so nothing bumps the literal automatically; a _global_ override would win resolution over the `typescript` devDependency in `package.json` and make every future TypeScript PR silently inert. Scoping alone would swap that for two diverging compilers (`nest-cli.json` sets `typeCheck: true`), so `src/__tests__/toolchain-pins.spec.ts` asserts exactly one `typescript` resolves and that it matches the manifest. **Bumping TypeScript means editing both lines.**

**Zod 4 gotcha:** `.default()` takes the schema's **output** type and short-circuits parsing. When a schema ends in `.transform()`, use `.prefault()` instead — it substitutes an **input** value and still runs the pipeline. See `src/config/env.schema.ts`.

## Commands

```bash
pnpm typecheck      # tsc --noEmit
pnpm lint:check     # eslint, no --fix
pnpm lint           # eslint --fix
pnpm format:check   # prettier --check
pnpm test           # jest (unit, *.spec.ts under src/)
pnpm test:e2e       # jest --config ./test/jest-e2e.config.mjs (*.e2e-spec.ts, needs the DB up)
pnpm build          # nest build (SWC)
pnpm start:dev      # watch mode

pnpm db:up          # docker compose up -d --wait postgres (blocks until healthy)
pnpm db:down        # stop it
pnpm db:reset       # drop the volume, start clean and migrate BOTH databases
pnpm db:migrate:test     # migrate nest_base_template_test — the E2E suite needs it
pnpm migration:run       # apply pending migrations
pnpm migration:revert    # roll back the last one
pnpm migration:generate src/database/migrations/<Name>   # diff entities vs schema
```

**Definition of Done** for any change: `typecheck` → `lint:check` → `format:check` → `test` → `test:e2e` → `build`, all green. The E2E suite needs PostgreSQL running (`pnpm db:up`) and runs against the separate `nest_base_template_test` database, created by `docker/initdb/`.

**`docker/initdb/` creates that database but never migrates it** — the TypeORM CLI reads `DB_DATABASE` from the `.env`, which points at the dev database, and `test/setup-env.ts` redirects only inside the Jest process. So the first `pnpm test:e2e` on a fresh clone needs `pnpm db:migrate:test` first, or it dies with `relation "auth_credentials" does not exist` — measured against a freshly created database: `auth.e2e-spec.ts` runs first and its `beforeEach` truncates that table before any other. It reads like a bug in the code and it is a schema nobody migrated. `pnpm db:reset` does both databases and needs nothing extra. Closed as backlog #18 on 2026-08-20; the entry records why the script is a `.mjs` and not a `VAR=value` prefix (Windows, and no `cross-env` in the tree).

## Git policy — never commit on the user's behalf

Never run `git commit`, `git add` for commit purposes, `git push`, `git tag`, or `git rebase` without an explicit instruction **in the user's current turn**. A previous authorization is never reused.

When a commit seems appropriate, suggest it and stop:

> _"Te sugiero hacer un commit de los cambios por &lt;razón&gt;. Avísame y lo redacto."_

This applies to subagents too.

## Formato de respuesta — cómo el usuario quiere que se le responda

Aplica a **todas** las respuestas al usuario en este repo. No aplica al código, a los
comentarios ni a los mensajes de commit, que siguen las convenciones de sus propias secciones.

### Formato

1. **Secciones numeradas con TÍTULO EN MAYÚSCULAS.** Un tema por sección. Nunca prosa continua
   mezclando asuntos distintos.
2. **Empieza por la respuesta directa.** Si la respuesta es «no», que la primera palabra sea
   «no». El contexto va después.
3. **Tablas** para comparar opciones, listar estados o inventariar cosas. Se leen más rápido que
   un párrafo.
4. **⚠️ marca lo que tiene consecuencia para el usuario**: una decisión que le toca, un riesgo,
   un cambio incompatible, algo que debe ejecutar. En una frase, sin rodeos.
5. **Cerrar SIEMPRE con una sección de estado** que responda tres cosas: ¿estás bloqueado?,
   ¿necesitas algo de mí?, ¿necesitas algo de un tercero? El usuario no debería tener que
   preguntarlo. _Si solo sobreviviera una regla de esta lista, es esta._

### Verificación

6. **Verifica antes de afirmar.** Si dices que algo funciona, que un archivo contiene X o que un
   comando devuelve Y, compruébalo y enseña la salida. Nunca responder de memoria sobre hechos
   comprobables.
7. **Si no lo verificaste, dilo.** «No lo he comprobado» es aceptable; afirmarlo como cierto no.
8. **Distingue «hecho» de «desplegado» / «en efecto».** Terminar de construir algo no es que
   esté funcionando donde el usuario lo va a usar.

### Honestidad

9. **Di lo que NO funciona y lo que decidiste no hacer, con el motivo.** Un reporte que solo
   cuenta los aciertos obliga al usuario a descubrir el resto por su cuenta, normalmente tarde.
10. **Si te equivocaste, corrígelo en una o dos frases y sigue.** Sin disculpas largas ni
    autocrítica: el dato correcto, no el arrepentimiento.
11. **Si lo que se pide está mal planteado, dilo ANTES de construirlo.** Una objeción antes
    cuesta un mensaje; después cuesta rehacerlo.
12. **No adornes.** Si algo es un parche, llámalo parche. Si tiene un límite, nómbralo.

### Decisiones

13. **Con varias opciones, recomienda una** y explica por qué en una frase. Nunca un menú sin
    criterio.
14. **Separa lo que decides tú de lo que decide el usuario.** Negocio, coste y riesgo son suyos;
    las técnicas rutinarias son tuyas — tómalas y avisa, no preguntes cada una.
15. **No des por hecho la aprobación.** Si algo es difícil de revertir o sale hacia fuera,
    confírmalo antes.

### Longitud

16. **Completo, no extenso.** Cabe todo lo que importa; no cabe el relleno.
17. **No repitas lo ya dicho.** Ve a lo nuevo.

### Respuestas para terceros (cuando aplique)

Cuando la respuesta sea para otro equipo, envuélvela entre `====RESPUESTA PARA <EQUIPO>===` y
`===FIN RESPUESTA PARA <EQUIPO>===`, y deja fuera de esos marcadores lo que sea solo para el
usuario.

## Skills

Seven skills live in `.claude/skills/`. Four form a workflow chain; three are references you **read**, never invoke as workflow steps.

**Chain — follow it in order for any non-trivial change:**

```
brainstorming  →  writing-plans  →  subagent-driven-development  (recommended)
   (spec)           (plan)      └→  executing-plans              (inline alternative)
```

| Skill                         | When                                                                                                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brainstorming`               | Before any creative work. Produces a spec in `docs/specs/`. Terminal state is invoking `writing-plans`.                                                                                |
| `writing-plans`               | Turns a spec into a task-by-task plan in `docs/plans/`.                                                                                                                                |
| `subagent-driven-development` | Executes a plan by dispatching a fresh subagent per task, with spec-compliance then code-quality review. Preferred.                                                                    |
| `executing-plans`             | Executes the same plan inline in your own context. Both run in the current session — the difference is subagents vs inline, not which session. Use for small or tightly coupled plans. |

**Reference skills (consult, don't invoke):**

| Skill                        | Authority over                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `clean-ddd-hexagonal`        | Folder layout, layer boundaries, ports/adapters, aggregates. `references/NESTJS-MAPPING.md` is the source of truth for code shape. |
| `nestjs-best-practices`      | 45 rule codes (`arch-`, `di-`, `security-`, `perf-`, …). Plans cite them per task; reviews check against them.                     |
| `javascript-typescript-jest` | Test naming, AAA structure, layer-aware mocking, property-based testing, Supertest E2E.                                            |

## Modelo de colaboración — casos primero, TDD después, mutación como auditor

Definido en `docs/specs/2026-08-04-roadmap-and-collaboration-model-design.md`. Tres fases:

1. **Contrato:** al escribir el plan, humano e IA acuerdan por preguntas/respuestas la tabla
   «Casos acordados» de cada tarea con lógica en `domain/` o `application/` (casos puntuales +
   filas `P` de propiedad con `fast-check`).
2. **Ejecución (IA):** confirmación JIT → tests en ROJO 1:1 con la tabla (el texto del `it` es
   el caso) → implementar a verde → refactor. Prohibido implementar sin rojo previo; un caso
   nuevo se consulta, nunca se añade en silencio.
3. **Validación (humano):** cotejar tabla ↔ suite verde, score de mutación
   (`pnpm test:mutation --mutate "src/modules/<context>/…"` — el scope al módulo lo da el
   flag; a secas muta todos los módulos) y DoD — sin leer el diff línea a línea.

**La mutación es gate, no sugerencia** (desde 2026-08-06, backlog #9): `thresholds.break: 85`
en `stryker.config.mjs` y job `mutation` propio en `ci.yml`. El 85 sale del baseline medido
—90.14 % global— y el margen está dominado por el peso de cada módulo en mutantes, no por su
score: el racional completo, con la aritmética, vive en el comentario de cabecera de la config.
Bajar el score por debajo del umbral rompe la CI: un módulo nuevo sin casos no entra en
silencio.

Infra, config, wiring y docs quedan exentas de la tabla. El resto de convenciones de testing
(AAA, 1:1 spec↔archivo, mocking por capa) no cambia: el modelo añade el origen de los casos y
el auditor, no cómo se escribe un test.

## Architecture rules

Every bounded context lives under `src/modules/<context>/` with layers **inside** it — never at the root of `src/`. **`src/modules/users/` is the reference implementation**: copy its shape for any new context. There are three: `users` (profiles), `auth` (credentials and tokens) and `orders`, plus the flat `health`.

```
src/modules/<context>/
├── domain/           # zero @nestjs/* imports; entities, VOs, events, ports/, errors/
├── application/      # @Injectable OK; no ORM or HTTP clients; use-cases/ + the context's facade
├── infrastructure/   # the only layer touching external libs; http/, persistence/, messaging/
├── __tests__/        # mirrors the structure above
└── <context>.module.ts
```

- **Dependency rule:** outer → inner only. `domain/` imports nothing from `@nestjs/*`, ORMs, `axios`, `class-validator` decorators, or `pino`.
- **Controllers are driver adapters** → they live in `infrastructure/http/`.
- **Ports are `abstract class`, never `type` + `Symbol` token.** A class survives compilation, so one single reference is both the contract's type and its injection token — Nest accepts `Abstract<T>` as an `InjectionToken` and SWC emits it into `design:paramtypes`. The module wires `{ provide: UserRepository, useClass: UserTypeOrmRepository }` and **no consumer needs `@Inject`**. No `Port` suffix: `UserRepository` doesn't collide, TypeORM's `Repository` only shows up inside the adapter with its own import. Three consequences, all load-bearing:
  - **A port declares only public `abstract` members** — no fields, no `protected`/`private`, no constructor. Two bans, two different causes, both measured with `tsc 6.0.3 --noEmit --strict`. A **field** (public, `protected` or `private`) or a **parameter property** makes the object-literal fakes stop compiling (`TS2741`; there is a real fake in `orders/__tests__/infrastructure/users-customer.directory.spec.ts`). An **empty `protected constructor()` compiles fine** — it is banned for another reason: adapters `implements` and never `extends`, so the port never enters their prototype chain and that constructor never runs. It is dead code promising an initialisation nobody executes, and the doorway parameter properties come in through.
  - **Adapters `implements`, never `extends`.** `extends` would burn the single inheritance slot and demand an empty `super()` for nothing, and `useClass` works identically either way. `implements` is also the _only_ thing that checks conformity: `ClassProvider.provide` is typed `any`, so the module file verifies nothing.
  - **Never `import type` a port in a file that has decorators** (use cases, adapters, modules). The reference is elided, the metadata is never emitted, and it fails **at runtime** — `Nest can't resolve dependencies of the CreateUserUseCase (?, PasswordHasher)` — with `lint:check` **and** `typecheck` green. That's why `eslint.config.mjs` bans it under `src/modules/*/{application,infrastructure}/**` in **both** shapes the erasure takes — the `import type { … }` declaration _and_ the mixed `import { VALUE, type Port }` specifier, whose declaration `importKind` is `"value"` and so needs its own selector — from any `ports/` file **or** a foreign `*.module` (which is where `UsersLookup` and `UsersProvisioning`, the only cross-module ports, live). In the test fakes it is the reverse: no decorators means `consistent-type-imports` _demands_ `import type`. The asymmetry is real; the discriminator is "does this file contain a decorator" — with `emitDecoratorMetadata` on, `consistent-type-imports` skips such files entirely.
- **Inline `type` stays legal for the data that travels with a port** — `UserPage`, `FindUsersCriteria`, `SignedToken`, `TokenClaims`, `DirectoryUser`, `CreateProfileResult`, `UserSummary` are not injectable, so `import { UserRepository, type UserPage } from '…'` is the correct shape. Those seven names are a **closed list inside the lint rule**, because nothing in the import site distinguishes a port from its data: the specifier selector fails closed, so a port marked `type` by accident goes red on its own and a genuinely new data type costs one reviewed line in `eslint.config.mjs`. Three files import _only_ such data from a `ports/` file and can't use the inline form (`no-import-type-side-effects` rejects it): `jwt-auth.guard.ts`, `authenticated-user.dto.ts` and `registered-account-response.dto.ts`. All three carry a justified `eslint-disable-next-line` saying so. The discriminator is real, not a loophole: none of them injects a port.
- **One use case per file, input included.** `application/use-cases/create-user.use-case.ts` holds `CreateUserUseCase` **and** its `export type CreateUserInput`. There is no `commands/`, no `queries/`, no `handlers/`: a command class whose only job was to carry three positionals into `execute()` bought a file, an import and a `new` per call site, and no invariant — the input is the use case's signature, not a reusable piece. Inputs are plain `type`s, **never** classes with `class-validator`: boundaries rule 2 bans that library from `application/`, and transport validation is the HTTP DTO's job. The controller calls `execute({ email: dto.email, … })`, which also kills the positional-argument bug class.
  - **The method stays `execute()`** — one public operation, same name in every use case.
  - **`users.facade.ts` stays loose in `application/`**, outside `use-cases/`: it is the context's public gate for other modules, not an intention of a user of the system. Its surface grows by method, not by file.
- **Validation** lives in HTTP DTOs, never in domain entities. The domain enforces invariants through constructors and value objects.
- **Two models, never one.** The domain entity (`user.entity.ts`) is a plain class with invariants; the ORM entity (`user.orm-entity.ts`) carries the TypeORM decorators. A mapper is the only bridge. Don't decorate the domain entity with `@Entity` to save a file — that couples the domain to the database.
- **Domain errors are not HTTP errors.** The domain throws `UserNotFoundError`; `infrastructure/http/user-domain-exception.filter.ts` decides it's a 404. Never import `HttpException` into `domain/` or `application/`.

## Auth

**Its own bounded context** (`src/modules/auth/`) since the cycle-4 refactor, and it **owns the credential**: the password hash lives in `auth_credentials`, its own table, and `users` no longer knows what a password is. HS256 JWT via `@nestjs/jwt`, argon2id via `argon2` with explicit cost params (`ARGON2_PARAMS` in `src/config/auth.config.ts`, one source shared by the hasher and the admin seed).

The split is what makes the two-context seam real: `users` owns the **profile** (identity, name, role, whether it is active), `auth` owns the **credential** and the token. The dependency runs `auth → users` and only that way — `auth` consumes `UsersLookup` and `UsersProvisioning` through `users.module.ts` like any other module. If `users` ever imported `auth.module` the repo would get its only possible module↔module cycle, which is exactly why `@Public`, `@Auth`, `@CurrentUser` and `AuthenticatedUser` stay in `common/`, where both can see them.

- **Registration is `POST /auth/register`, not `POST /users`.** What is born in a sign-up is an **account** — profile _and_ credential — so the endpoint belongs to the context that owns the credential. `POST /users` no longer exists; `CreateUserUseCase` survives with `{ email, name }` and its only consumer is the facade.
- **Two writes, no distributed transaction: compensation.** `RegisterAccountUseCase` hashes the password, creates the profile through `UsersProvisioning`, then writes the credential. If the credential write fails it deletes **both** rows — `deleteProfile` first, then `credentials.deleteByUserId` — and re-throws. The profile goes first because it is the priority guarantee: an orphan profile could never log in _and_ would block its own email through the unique index, while an orphan credential is silent garbage that collides with nothing. Deleting the credential too is backlog #14: before cycle 4 the hash was a column of `users` and left with the row; with a separate table and **zero foreign keys in the whole schema** (not reintroduced on purpose — the two contexts may stop sharing a database), a credential whose INSERT committed while the response was lost stayed forever. That path needs a commit the caller never sees, so **no E2E can reach it** without an out-of-band commit (`dblink`): a `RAISE` in any trigger aborts the transaction and takes the row with it. It is covered by R10 in `register-account.use-case.spec.ts` with the fake, which can separate "wrote" from "answered". `auth.e2e-spec.ts` still forces the second write to fail with a `BEFORE INSERT` trigger that raises, and asserts both tables end empty.
- **`POST /auth/register` reveals whether an email is taken — and that is a written decision** (backlog #15, closed 2026-08-08). The 409 **stays**: without it whoever already has an account cannot tell why the sign-up fails. What was closed is the **timing** leak, which was indefensible because it betrayed the account even to a client ignoring the status code. The password is now hashed **before** the uniqueness check, so both paths pay argon2id: measured over HTTP against real PostgreSQL, 409 vs 201 medians went from 7.52 ms / 91.47 ms (disjoint ranges, 12.2×) to 79.61 ms / 90.82 ms (overlapping, 1.14×). The residual ~11 ms is the extra INSERTs of the success path, not the hash. Row R11 pins it structurally — `hash()` exactly once on both paths — the same way L9 pins `verify()` for login, and the two comments reference each other.
- **The provisioning gate returns results, never exceptions, for business rejections.** `createProfile` answers `{ ok: false, reason: 'email-taken' | 'invalid-profile' }` because `auth` cannot import `users`' error classes. `invalid-profile` carries the domain message: `@IsEmail` accepts strings `Email.from()` rejects, and `@MinLength(2)` measures the untrimmed name — without that branch those inputs, a 400 today, would have become a 500 the moment the sign-up left `users`.
- **Global guard, secure by default.** `JwtAuthGuard` (`src/modules/auth/infrastructure/http/jwt-auth.guard.ts`) is registered as `APP_GUARD` from `auth.module`, not `app.module`: boundaries rule 3 forbids the app root from importing a module's internals, and `APP_GUARD` is a multi-provider — registering it from any module makes it global. A new endpoint without `@Public()` requires a valid JWT with no action from its author.
- **`@Public()`** (`src/common/decorators/public.decorator.ts`) bypasses the guard entirely — used on health, `POST /auth/register` and `POST /auth/login`, none of which can require a token they have no way to obtain yet. Both auth endpoints carry the same 10/min `@Throttle` (declared on the class); `ThrottlerGuard` keys by class **and handler**, so they have separate counters.
- **`@Auth(...roles)`** (`src/common/decorators/auth.decorator.ts`) is the single roles decorator: `@Auth()` means any authenticated user, `@Auth('admin')` means that role only (403 otherwise). It also attaches the OpenAPI docs the contract guard requires on protected endpoints — bearer + 401, plus 403 when roles are given — so the protection and its documentation can't drift apart.
- **`@CurrentUser()`** (`src/common/decorators/current-user.decorator.ts`) injects the claims `JwtAuthGuard` attached to `request.user`, typed as `AuthenticatedUser` (`src/common/auth/authenticated-user.ts`) — a loose type shareable across modules without breaching the boundaries matrix; it throws if the route is `@Public()`.
- **`JWT_SECRET` has no default outside `development`/`test`.** A `refine()` in `env.schema.ts` blocks staging/production from booting without it, so a token can never be signed with the public dev default in a real deployment.
- **First admin: `pnpm seed:admin`** (`src/database/seeds/seed-admin.ts`). Idempotent — creates the admin if `ADMIN_EMAIL` doesn't exist yet, and if it does, leaves it **operational**: role `admin`, `active = true` and a fresh hash. Reactivating is not a nicety: this seed is the documented rescue when the only admin account gets deactivated by mistake, and `LoginUseCase` rejects an inactive user with the same `InvalidCredentialsError` as a wrong password — so without it the seed would print `promoted` and login would keep answering 401, indistinguishably. It writes **both tables inside one `dataSource.transaction`**, with `ON CONFLICT (user_id) DO UPDATE` on the credential so promoting a pre-existing profile gives it one. Needs `ADMIN_EMAIL` and `ADMIN_PASSWORD` both-or-none, enforced by another `refine()`.
- **Anti-enumeration login.** `LoginUseCase` throws the same `InvalidCredentialsError` for a missing email, a **profile without a credential**, a wrong password and an inactive user, and always calls `hasher.verify()` exactly once — against a pregenerated dummy hash when there's no real credential to check — so the four paths cost the same time. The fourth path is new: with two owners, a profile with no credential is a reachable state. It is a **measured** requirement: a property row in `login.use-case.spec.ts` asserts indistinguishable error _and_ exactly one `verify` across all four.
- **Normalisation lives in `users`, once.** `findByEmail` runs the email through the same `Email.from` the sign-up uses, and returns `null` (never throws) for a malformed one — so a typo is a 401, not a 400 that would distinguish "badly written" from "unknown". `auth` passes the raw string through.
- **`AuthenticatedUserDto` is a deliberate twin of `UserResponseDto`.** Neither context can import the other's DTO, and the published contract must not change because login moved module. `authenticated-user.dto.spec.ts` seals the parity by comparing both classes' real `@ApiProperty` metadata, including the `role` enum values that `users` derives from `USER_ROLES` and `auth` writes by hand.

## Orders

Second bounded context (`src/modules/orders/`), one use case: place an order
(`POST /orders`, `@Auth()` — the first real consumer of `@CurrentUser()`: `customerId` comes
from the token's `sub`, never from the body). It exercises the three seams a single context
cannot:

- **Cross-module via the public gate — segregated by intention.** `orders` defines the
  `CustomerDirectory` port; its adapter injects `UsersLookup`, which `users.module.ts`
  registers, exports to the DI container and **re-exports as a TS symbol** — the module file
  is the only legal cross-module surface, and since the gate is an `abstract class` that one
  re-export publishes token and type at once. There are **two** such gates since backlog #13:
  `UsersLookup` (`userExists`, `findByEmail`) and `UsersProvisioning` (`createProfile`,
  `deleteProfile`), one `UsersFacadeImpl` behind both via `useExisting`. The single four-method
  `UsersFacade` handed `orders` a physical `DELETE` it never asked for, over a schema with zero
  foreign keys. The boundaries matrix cannot see that — it reasons by path, and this import is
  exactly the one amendment G2 legalised — so the type is the only control that does, and it
  does it at compile time: `orders` cannot write `deleteProfile` because what it injects does
  not declare it. The matrix allows `module-infrastructure`/module-root → foreign
  `*.module.ts` since the orders amendment (cases G1-G4 in the gate suite); `auth` became the
  second consumer of that same gate in cycle 4 with `UserDirectory`, and needed **zero** new
  rules — the wildcards already covered it, verified by re-running the gate suite unchanged.
  The #13 split needed zero new rules either, for the same reason: it changes the published
  surface, not the boundaries.
  A deactivated user keeps a valid JWT until it expires: `orders` re-checks the directory on
  every order and translates `CustomerGoneError` to 403 in its own filter (string-constructed,
  canonical message).
- **Domain events.** `Order.place()` emits `OrderPlaced` and collects it; `pullEvents()`
  drains, and the use case hands the events to the repository **in the same
  `save(order, events)` call** — the port's signature carries them so atomicity is the
  adapter's job.
- **Transactional outbox.** `OrderTypeOrmRepository.save` writes the order and its
  `orders_outbox` rows inside one `dataSource.transaction`. The relay is a CLI
  (`pnpm outbox:relay`, `src/database/outbox/` — a module cannot import `database`, same
  reason the seed lives there): publishes pending rows (today: a structured log) and marks
  them, at-least-once. When BullMQ lands (Tier 2), only the publisher changes.

## Endpoint documentation — mandatory and verified

**Every new endpoint must be documented in full.** This is not a style preference:
`src/bootstrap/__tests__/openapi-contract.e2e-spec.ts` walks every operation in the generated
OpenAPI document and **breaks the build** if anything is missing. It lives in the E2E suite
because building the document compiles `AppModule`, which needs PostgreSQL — so it runs under
`pnpm test:e2e`, which CI enforces on every PR. `UsersController` is the reference implementation.

Each operation declares:

| Element           | Requirement                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| `@ApiOperation`   | Unique `operationId`, non-empty `summary` **and** `description`                                    |
| Success responses | `@ApiEnvelope` / `@ApiPaginatedEnvelope` with an `example` of the full body, envelope included     |
| Standard errors   | `@ApiStandardErrors({ throttled })` — declares 429 and 500                                         |
| Endpoint errors   | `@ApiConflictResponse`, `@ApiNotFoundResponse`, `@ApiBadRequestResponse`… typed and with `example` |
| Parameters        | `@ApiParam` / `@ApiQuery` with `description` **and** `example`                                     |
| Request body      | `@ApiBody` with at least one named example; two when there are interesting edge cases              |

### Document what the endpoint really does, not what would be symmetric

The guard is bidirectional on purpose, because a declared-but-impossible response is the same
defect as an undeclared one: _the published contract describes something the server does not do._

- **400 only if the operation takes `path`, `query` or `cookie` parameters, or a body.** With no
  input there is nothing to reject. Documented headers don't count.
- **`throttled: false` on controllers with `@SkipThrottle()`.** `HealthController` never returns 429.
- **Bodyless responses** (204, 304) need no example.
- **Error examples come from `buildErrorExample()`**, never hand-written. It derives `error` from
  the status, which is where every divergence appeared during the migration: the published
  examples claimed `UserNotFoundError` while the server sends `Not Found`.

### Three checks, and none replaces another

Verified by measurement — deleting one because "another covers it" leaves a hole:

1. **example ↔ factory** (`openapi-contract.e2e-spec.ts`) catches hand-written examples that drift
   from the factory. It is _tautological_ for the factory itself.
2. **factory ↔ filter** (`error-example.factory.spec.ts`) runs real exceptions through
   `AllExceptionsFilter`. This is what would catch the factory being wrong.
3. **example ↔ schema** (Ajv, in the contract guard) is the only one that would have caught the
   `array of arrays` that made `GET /users` unsatisfiable.

### Maintaining the Scalar bundle

The UI is served from our own origin (`scripts/copy-scalar-asset.mjs` → `public/`), which trades
the CDN's continuous updates for knowing exactly what JavaScript runs. **Review
`@scalar/api-reference` quarterly.** Bumping the version regenerates the content hash
automatically; nothing is edited by hand.

**Bumping the bundle is the only moment a new CSP violation can appear**, since the JavaScript
only changes then. Run this list against `DOCS_ENABLED=true pnpm start:dev` after every bump,
with a forced reload and cache disabled — `immutable` plus a year of `max-age` means the second
visit never touches the network:

| #   | Interaction                                     | What it exercises                                                            |
| --- | ----------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | Initial load, both `/api/docs` and `/api/docs/` | Mount order; the no-slash form is the one people type                        |
| 2   | Light/dark toggle                               | `style-src` — a broken layout with no JS errors is the tell                  |
| 3   | Download the document                           | With `documentDownloadType: 'direct'` it must link to `/json`, never `blob:` |
| 4   | Expand an endpoint, view code samples           | The syntax highlighter, sole candidate for `WebAssembly`                     |
| 5   | Open the API client and send a request          | `connect-src`, and that `proxyUrl` really is empty                           |

In the console look for `Refused to` (how Chrome prefixes CSP violations); in the network tab
filter to anything that is **not** localhost. Do not add `'wasm-unsafe-eval'` pre-emptively —
only if step 4 actually breaks.

## Database

PostgreSQL through TypeORM. Config lives in `src/config/database.config.ts`, wiring in `src/database/`.

- **`synchronize` is resolved in code, not taken from the env.** `DB_SYNCHRONIZE` can only ever turn it _off_; turning it _on_ also requires `NODE_ENV=development`. Outside development it is forced to `false` regardless of the `.env`, because `synchronize` can drop columns and data. See `resolveSynchronize()`.
- **Schema changes go through migrations.** `pnpm migration:generate src/database/migrations/<Name>` after changing an ORM entity, then `pnpm migration:run`. In production `DB_MIGRATIONS_RUN=true` applies them on boot — read the next section before writing one that **drops or renames** anything.
- **ORM entities are discovered by glob** (`*.orm-entity.ts` anywhere under `src/modules/`), so a new module registers itself with no central list to edit.
- **TLS:** `DB_SSL=false` locally, `true` against RDS. `DB_SSL_REJECT_UNAUTHORIZED=false` encrypts but does **not** verify the server's identity — prefer pointing `DB_SSL_CA` at the AWS bundle.
- **Driver errors are translated in the adapter.** `UserTypeOrmRepository.save()` turns PostgreSQL's `23505` into `EmailAlreadyTakenError`, so a concurrent insert surfaces as 409 and not 500. The handler's pre-check is a nicety, not the defence.

## Destructive migrations: expand/contract

**Any migration that drops or renames a column or a table is split in two — expand and
contract — with the code deploy in between. Never in the same release.** Additive migrations
(`CREATE TABLE`, `ADD COLUMN`) need none of this: old code ignores what it doesn't know.

| Step         | Contains                                                                                                          | Safe while old replicas serve traffic |
| ------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **Expand**   | `CREATE TABLE` / `ADD COLUMN`, indexes, the data copy, and `DROP NOT NULL` on whatever the new code stops writing | Yes — that is the entire point        |
| _(deploy)_   | The new version rolls out until **no** replica of the old one is left                                             | —                                     |
| **Contract** | The destructive statement alone: `DROP COLUMN`, `DROP TABLE`, the second half of a rename                         | **No**                                |

**Worked example, two real files.** Moving the password hash out of `users` (cycle 4) is
`src/database/migrations/1786210289581-move-credentials-to-auth-expand.ts` — creates
`auth_credentials`, its unique index, copies every hash **with the profile's `createdAt`/
`updatedAt`**, and drops the `NOT NULL` — and
`src/database/migrations/1786210349581-move-credentials-to-auth-contract.ts`, whose whole `up()`
is one `ALTER TABLE "users" DROP COLUMN "password_hash"`. It was **one** migration until
2026-08-08 and was split retroactively (backlog #12): a template cannot publish a rule its only
example breaks, and the split was free because it had never been deployed anywhere.

- **The `DROP NOT NULL` in the expand is part of the pattern, not tidying up.** During the
  window the new code inserts profiles without ever naming `password_hash`, so the column takes
  no value and `NOT NULL` rejects the row. Verified by measurement, not reasoning: with the
  constraint put back by hand on the expand-state schema, `POST /auth/register` answers 500 with
  `null value in column "password_hash" of relation "users" violates not-null constraint`; with
  it dropped, the 23 tests of `auth.e2e-spec.ts` pass against that same schema. Symmetrically,
  the old code keeps reading and writing the column, which still holds its data. **A column the
  new code stops writing must lose its `NOT NULL` in the expand, or the expand is not survivable
  either.**
- **The `down()` pair mirrors the split.** Contract's `down()` re-adds the column **nullable**
  and refills it from the new table; expand's `down()` refills what is still missing, restores
  the `NOT NULL` and drops the new table. The precondition check that names unrestorable
  profiles instead of letting PostgreSQL say `contains null values` lives in **expand's**
  `down()` — because the only one of the two that restores a `NOT NULL` is that one. In
  contract's `down()` a profile without a credential is simply NULL, which is legal there.
- **What the pattern does not fix here, said plainly.** During the window an account created by
  the new code has no `users.password_hash`, so the old code cannot authenticate it (and the
  reverse for accounts created by old replicas). Closing that needs a dual-write trigger, which
  is what you add when the window cannot afford lost sign-ups. Here the window is one rollout and
  the cost is a retry.

**⚠️ `DB_MIGRATIONS_RUN=true` runs pending migrations when the process boots — that is the first
new pod, with every old replica still serving.** An expand is fine there; a contract in that mode
drops the column at the worst possible instant and takes the old replicas down. Pick one, and
write which one you picked in the migration's header:

1. **Ship the contract in a later release** (recommended). Nothing to operate, no human in the
   loop, and the rollout of the expand release is provably finished before the next one starts.
2. **Same release with `DB_MIGRATIONS_RUN=false`**, then `pnpm migration:run` by hand once the
   rollout completes. Cheaper in calendar time, needs somebody at the keyboard at the right
   moment. A scheduled maintenance window is the same option with the traffic turned off.

**Why a `DROP COLUMN` is worse than it looks: TypeORM enumerates every mapped column in every
`SELECT` — it never emits `SELECT *`.** Measured here with `DB_LOGGING=true`:
`SELECT "UserOrmEntity"."id" …, "UserOrmEntity"."updatedAt" … FROM "public"."users"`. So from the
instant the column disappears, **every read of that table** fails in the old code, not only the
paths that used it — for `users` that is `POST /auth/login`, `GET /users`, `GET /users/:id`,
`DELETE /users/:id` and `POST /orders`, which hits the customer directory on every order.
`INSERT` enumerates too, which is the same fact seen from the other side and the reason the
expand's `DROP NOT NULL` is mandatory.

## Config gotcha worth knowing

Every `registerAs` factory re-parses `process.env`, and `@nestjs/config` only writes back validated values that are `string | number | boolean` — arrays and objects are dropped silently. So **`env.schema.ts` must emit scalars only**; list-shaped variables stay strings and are split in the factory via `splitList()`. A test in `env.schema.spec.ts` guards this. Getting it wrong is invisible: the `.env` value is ignored and the default applies.

Related: Zod's `.default()` only fires on `undefined`, so a variable that is present but empty is **not** the same as an absent one. Numeric fields use `rejectEmpty()` so `PORT=` fails loudly instead of coercing to `0`.

## Code conventions

- **Code in English, prose in Spanish.** Identifiers, object keys, file and folder names, env variables, config keys, SQL columns, `operationId` and form ids are English; comments, documentation, OpenAPI `summary`/`description`, ESLint rule messages and operator-facing messages are Spanish. `src/__tests__/language-convention.spec.ts` enforces it by asserting on **identifiers, never on strings** — which is why the Spanish `it` titles need no exemption. One written exception: the error messages in `env.schema.ts` and `validate-env.ts` are English because they share a string with Zod's untranslatable defaults.
- **`type`, never `interface`.** ESLint enforces `@typescript-eslint/consistent-type-definitions: ['error', 'type']`. Skill reference files use `interface` as language-agnostic pseudocode — translate it before writing real code. Ports are the one place that is neither: they're `abstract class`, because they must survive compilation to act as their own DI token (see Architecture rules).
- **Path aliases:** `@/` → `src/`, plus `@common/`, `@config/`, `@database/`, `@modules/`, `@shared/`, and `@test/` → `test/`. Shared test helpers are imported via `@test/`, not `@/`. Declared in three places that must stay in sync: `tsconfig.json`, `.swcrc` and `jest.config.mjs` — `test/jest-e2e.config.mjs` inherits from the latter instead of keeping its own copy.
- **Inside a module, import relatively.** `../../domain/user.entity`, not `@modules/users/domain/user.entity` — a relative path survives the module being moved.
- **No barrels in `src/` — the lint verifies it.** No `index.ts` anywhere: every import targets
  the concrete file, and across modules only the `*.module.ts` is importable. The 5 boundary
  rules live in `eslint.boundaries.js` (shared with its suite,
  `src/__tests__/eslint-boundaries.spec.ts`) — spec `docs/specs/2026-08-04-module-boundaries-design.md`.
- **Type-only imports are explicit** — `consistent-type-imports` with inline style: `import { ValidationPipe, type INestApplication }`.
- **Tests live in a `__tests__/` folder at the root of each module**, replicating the module's internal structure, so moving a module moves its tests with it. Unit specs are `*.spec.ts`, E2E are `*.e2e-spec.ts`, and both ship inside the module. Only shared helpers live outside `src/`, in `test/helpers/` (imported via `@test/`).
- **`describe` in code, `it` in Spanish.** The root `describe` keeps the real identifier; nested `describe`s group cases and are Spanish, like every `it` — a Spanish sentence starting with `debería…`. Code, variables and helpers stay in English. AAA comments (`// Arrange`, `// Act`, `// Assert`) are mandatory.
- **One spec per source file (1:1)**, same base name and same relative path inside `__tests__/`. Don't group several SUTs in one file.
- **Mocking by layer:** no mocks in `domain/`; hand-written port fakes in `application/` (see `__tests__/helpers/in-memory-user.repository.ts`), never `jest.mock`; repositories are tested against real PostgreSQL in the E2E suite. Modules, TypeORM repositories, `data-source.ts`, seeds, the outbox CLI and migrations are excluded from _unit_ coverage on purpose, and `test/jest-e2e.config.mjs` measures them with its own threshold — **except `src/database/migrations/**`, which no suite measures**. That exception is deliberate and now written down: they are one-shot DDL run by the CLI, and the fact that nothing exercises them directly is open debt with its own entry (`docs/backlog.md` #17), not something the E2E config quietly covers. Until 2026-08-19 this sentence claimed the E2E suite measured "exactly those files" while its list held two of the six patterns, so four groups were measured by neither.
- **Shared fixtures:** module-wide helpers go in `<module>/__tests__/helpers/` (e.g. `user.factory.ts`, `arbitraries.ts`); cross-cutting ones in `test/helpers/` (e.g. `config.factory.ts`), imported via `@test/`. Never copy a builder into several specs.
- **Property-based testing with `fast-check`** for value objects, pure functions and mapping round-trips. Arbitraries are **constructed**, never `.filter()`-ed out of `fc.string()`.
- **The E2E suite runs against `nest_base_template_test`**, not the dev database — `test/setup-env.ts` forces `NODE_ENV=test` and the database name before the `AppModule` boots. The `TRUNCATE` in each `beforeEach` is required for the suite to be repeatable.
- **A test must fail without the fix.** Before trusting a regression test, verify it: several tests here looked like they covered a defect and passed either way (`isHealthPath`'s substring case picked the one URL that dodged the bug; the concurrent-POST test was caught by the pre-check, never reaching the `23505` translation).
- Commit messages follow Conventional Commits with a **closed scope list** — see `commitlint.config.cjs` before inventing a scope. Adding a bounded context means adding its scope there.
- **Pre-commit scans secrets.** lint-staged runs `secretlint` (preset recommend, `enableIDScanRule: true`) over **every** staged file via the catch-all `"*": "secretlint --maskSecrets"` entry — a detected secret blocks the commit before it enters history. Config is `.secretlintrc.json`; its contract lives in `src/__tests__/secretlint.spec.ts` (Tabla S, backlog #6).

## Deferred work

`docs/backlog.md` holds work that was postponed **with a decision attached**, not forgotten. That
file is the issue tracker — a role it keeps now that the repo has a remote (`origin`, since August
2026), because the entries carry reasoning that a GitHub issue title doesn't. Each entry records
what happens, the approach already chosen, and how you'll know it's done — read the entry before
reopening the discussion.

It also records what was closed by verifying it, so nobody re-investigates a non-problem.
