---
name: javascript-typescript-jest
description: Best practices for writing TypeScript tests with Jest in this NestJS 11 codebase. Use when writing, reviewing, or refactoring any *.spec.ts or *.e2e-spec.ts file. Covers test naming, AAA structure, mocking strategy by hexagonal layer, property-based testing, async patterns, and Supertest E2E. Source: github/awesome-copilot, adapted to this repo's conventions.
allowed-tools: Read, Grep, Glob
---

# Jest Testing for NestJS 11 + TS 6.0

Conventions for writing Jest tests in this repository. Adapted from the upstream `javascript-typescript-jest` skill (github/awesome-copilot) to match this project's `jest.config.mjs`, hexagonal layout, and the rest of the workflow skills.

## Project Jest configuration (factual baseline)

These are the rules the test runner enforces — match them or your tests won't be discovered:

| Concern            | This repo                                                                          |
| ------------------ | ---------------------------------------------------------------------------------- |
| Unit test regex    | `*.spec.ts` (anywhere under `src/`)                                                |
| E2E test regex     | `*.e2e-spec.ts` (also under `src/`, next to the module it exercises)               |
| Test location      | `__tests__/` folder at the root of each module, mirroring the module's structure   |
| Transform          | `@swc/jest` (decorators + decorator metadata enabled)                              |
| Auto reset         | `clearMocks: true`, `restoreMocks: true` (no need to reset manually)               |
| Coverage threshold | branches 50, statements/lines 85, functions 88                                     |
| Path aliases       | `@/` → `src/`, `@common/`, `@config/`, `@modules/`, `@shared/`, `@test/` → `test/` |
| Test runner        | `pnpm jest <file>` (unit), `pnpm test:e2e` (E2E)                                   |

**Naming consequence:** never name a test file `*.test.ts`. The runner won't pick it up. Always `*.spec.ts` or `*.e2e-spec.ts`.

**Why the branches threshold is lower:** SWC instruments the code it generates for `emitDecoratorMetadata` and property defaults, and those synthetic branches are unreachable from a test. Files without decorators (`src/config/**`) reach 88-100 % branches; decorator-heavy files plateau near 50 %. Don't write filler tests chasing that number.

## Test Location

**Tests live in a `__tests__/` folder at the root of their module, replicating the module's internal structure.** The point is portability: moving a module moves its tests with it, in one piece.

```
src/modules/billing/
├── domain/
│   ├── invoice.entity.ts
│   └── ports/invoice.repository.ts
├── application/handlers/
│   └── issue-invoice.handler.ts
├── infrastructure/http/
│   └── invoices.controller.ts
├── billing.module.ts
└── __tests__/                          ← mirrors the module above
    ├── domain/
    │   └── invoice.entity.spec.ts
    ├── application/handlers/
    │   └── issue-invoice.handler.spec.ts
    ├── infrastructure/http/
    │   └── invoices.controller.spec.ts
    ├── billing.module.spec.ts
    └── billing.e2e-spec.ts             ← E2E ships with its module too
```

- **One test file per code file (1:1)**, same base name: `invoice.entity.ts` ↔ `invoice.entity.spec.ts`.
- **Import the SUT with a relative path** (`../../domain/invoice.entity`), never an alias — a relative path survives the module being moved, `@modules/billing/...` does not.
- **Shared helpers stay in `test/helpers/`** and are imported via the `@test/` alias. That folder is the only test code outside `src/`.
- E2E specs use `test/helpers/create-test-app.ts` to boot the real `AppModule`.

## Test Structure

- **One `describe` per unit under test**, named with the code identifier. For classes with multiple methods, nest a `describe` per method:

```ts
describe('Invoice', () => {
  describe('issue()', () => {
    it('debería emitir InvoiceIssued y pasar el estado a "issued"', () => {
      /* ... */
    });
    it('debería lanzar un error si el estado no es "draft"', () => {
      /* ... */
    });
  });

  describe('cancel()', () => {
    it('debería marcar la factura como cancelada', () => {
      /* ... */
    });
  });
});
```

- **`describe` in code, `it` in Spanish.** The `describe` keeps the real identifier (`Invoice`, `issue()`, `PaginationDto`) so the Jest output maps straight back to the symbol. The `it` is a Spanish sentence that always starts with **`debería…`**. Prefer `it` over `test`.
- **Code stays in English** — variables, helpers, fakes, comments about implementation. Only the `it` description is Spanish.
- **Caso acordado ↔ `it`, 1:1.** Cuando la tarea del plan trae tabla «Casos acordados» (modelo
  de colaboración — spec `docs/specs/2026-08-04-roadmap-and-collaboration-model-design.md`),
  cada caso puntual produce exactamente un `it` cuyo texto es el caso, y cada fila `P` un `it`
  de propiedad con `@fast-check/jest`. Ningún `it` extra sin fila (o sin adición JIT registrada
  en el plan); ninguna fila sin `it`. La validación humana es cotejar la tabla contra
  `pnpm jest <file> --verbose` — una comparación de listas, no una lectura de código.
- **No implementar sin rojo previo.** Con tabla de casos, los tests se escriben primero y se
  ejecutan para verlos fallar; la salida en rojo es evidencia que el implementador reporta.
  Implementar antes del rojo invalida el ciclo.
- **AAA pattern is mandatory.** Every `it` includes the three comments `// Arrange`, `// Act`, `// Assert` to mark the phases:

```ts
it('debería calcular el offset a partir de page y limit', () => {
  // Arrange
  const dto = plainToInstance(PaginationDto, { page: 3, limit: 50 });

  // Act
  const skip = dto.skip;

  // Assert
  expect(skip).toBe(100);
});
```

When Act and Assert are a single statement (e.g., `expect(fn).toThrow()`), the comment `// Act + Assert` on one line is acceptable.

- **Order: documentation tests first, edge cases later.** Don't add separator comments like `// Edge cases` — the reading order alone signals the progression.
- **One precise assertion per `it` when the assertion is the SUT's contract.** Multiple assertions are fine when they describe a single observable outcome.
- **Drop-and-still-passes check.** Before approving a test, mentally remove the production line that's supposed to make it pass. If the test still passes, it wasn't testing what it claimed. Fix the test.
- **No hardcoded values in unused fields.** Anti-pattern: `const user = { name: 'Paul', birthday: '2010-02-03' }` when only `birthday` matters. Either drop the field or use an arbitrary (`g(fc.string)` for property-based, see PBT section).
- **File-local helpers go at the bottom** of the spec, below all `describe` blocks, under a `// Helpers` comment line. Reusable helpers shared across files belong in `test/helpers/` or a dedicated module.

```ts
describe('AllExceptionsFilter', () => {
  /* ... */
});

// Helpers

const buildHost = (): ArgumentsHost => ({/* ... */}) as ArgumentsHost;
const buildFilter = () => new AllExceptionsFilter(/* ... */);
```

- **Helpers follow SRP.** A helper does one thing — its name must say it. Prefer three named helpers over one helper with three optional flags (`buildHost(...)`, `buildHostInProd(...)`, `buildHostWithCorrelation(...)` is better than `buildHost({ prod, correlation })`).
- **>10 parameters/mocks to set up the SUT = code smell.** Warn the reader (and the author) — the SUT likely has too many responsibilities (SRP). Recommend splitting before adding more test scaffolding.

## Mocking strategy by hexagonal layer

This is the part that diverges most from generic Jest advice. Match the layer or the test fails review.

### Domain layer (`src/modules/<context>/domain/`)

- **No mocks at all.** Domain is pure TS — instantiate it directly.
- **Forbidden:** `Test.createTestingModule`, `jest.mock`, `jest.spyOn` on domain code.
- **Why:** if the domain needs a mock, the test is wrong or the design leaked infra into domain.

```ts
// src/modules/billing/__tests__/domain/invoice.entity.spec.ts
import { Invoice } from '../../domain/invoice.entity';
import { InvoiceId } from '../../domain/invoice-id.vo';
import { Money } from '../../domain/money.vo';

describe('Invoice', () => {
  describe('issue()', () => {
    it('debería emitir un evento al emitir una factura en borrador', () => {
      // Arrange
      const invoice = Invoice.draft(InvoiceId.from('inv_1'), Money.of(100, 'USD'));

      // Act
      invoice.issue(new Date('2026-01-01T00:00:00Z'));

      // Assert
      expect(invoice.pullEvents()).toHaveLength(1);
    });
  });
});
```

### Application layer (`src/modules/<context>/application/`)

- **Hand-written port fakes**, not `jest.mock`. The fake is a class implementing the port interface, often with an in-memory backing.
- Construct the handler with `new IssueInvoiceHandler(fakeRepo)`. Don't go through `Test.createTestingModule` for unit tests.
- `jest.spyOn` is acceptable on the fake's methods to assert calls; `jest.mock` against module paths is not.

```ts
// src/modules/billing/__tests__/application/handlers/issue-invoice.handler.spec.ts
import { IssueInvoiceHandler } from '../../../application/handlers/issue-invoice.handler';
import { IssueInvoiceCommand } from '../../../application/commands/issue-invoice.command';
import type { InvoiceRepository } from '../../../domain/ports/invoice.repository';
import { Invoice } from '../../../domain/invoice.entity';
import { InvoiceId } from '../../../domain/invoice-id.vo';
import { Money } from '../../../domain/money.vo';

describe('IssueInvoiceHandler', () => {
  describe('execute()', () => {
    it('debería emitir una factura en borrador que ya existe', async () => {
      // Arrange
      const repo = new InMemoryInvoiceRepo();
      const id = InvoiceId.from('inv_1');
      await repo.save(Invoice.draft(id, Money.of(100, 'USD')));
      const handler = new IssueInvoiceHandler(repo);

      // Act
      await handler.execute(new IssueInvoiceCommand('inv_1', new Date('2026-01-01')));

      // Assert
      const reloaded = await repo.findById(id);
      expect(reloaded).not.toBeNull();
    });
  });
});

// Helpers

class InMemoryInvoiceRepo implements InvoiceRepository {
  private store = new Map<string, Invoice>();
  async findById(id: InvoiceId) {
    return this.store.get(id.value) ?? null;
  }
  async save(invoice: Invoice) {
    this.store.set(invoice.id.value, invoice);
  }
}
```

### Infrastructure layer (`src/modules/<context>/infrastructure/`)

This is the layer where the upstream skill's advice fully applies — `jest.mock`, `jest.spyOn`, and `Test.createTestingModule` are all on the table.

- **Controllers (`infrastructure/http/`):** unit tests with `Test.createTestingModule({ controllers, providers })`, providing a fake handler. E2E tests with Supertest in `test/`.
- **Repositories (`infrastructure/persistence/`):** integration tests against a real test database (or a documented in-memory equivalent like sqlite). Don't `jest.mock('typeorm')` — the test loses its value.
- **HTTP gateways:** `nock` or `msw`-node for outbound HTTP; `jest.mock` for the SDK module is acceptable when no other option exists.
- **Messaging adapters:** test against a test broker if available; otherwise hand-written fakes for the publisher.

### Bootstrap / cross-cutting

- Filters, interceptors, guards: unit tests with `ArgumentsHost`/`ExecutionContext` test doubles, or in `Test.createTestingModule` when integration is the goal.

## Core testing guidelines

These cut across all layers and complement the mocking-by-layer rules above.

- **Stubs over mocks.** A _stub_ provides an alternate implementation; a _mock_ asserts on calls made. The number of times a function is called is usually an internal detail, not a contract. Reach for `expect(mock).toHaveBeenCalledWith(...)` only when the call itself is the observable contract (e.g., a publisher writes an event). For everything else, build a stub that captures the new state and assert on that.
- **No real network calls in tests.** Stub outbound HTTP at the adapter boundary with [`msw`](https://mswjs.io/) or `nock`. `jest.mock('axios')` is a last resort — it tests your mock, not your code.
- **Reset globals/mocks only when needed.** This repo's `jest.config.mjs` sets `clearMocks: true` and `restoreMocks: true`, so per-test cleanup is automatic. **Do not** add redundant `afterEach(() => jest.resetAllMocks())`. Add `beforeEach` resets only when a specific test mutates `process.env`, `Date.now`, or another global outside the auto-reset's reach.
- **Realistic data in documentation-style tests.** When the test reads as living documentation (e.g., `it('debería normalizar un teléfono mexicano', ...)`), use realistic input (`'+52 55 1234 5678'`), not `'aaa'` or `'test1'`. For values whose specific shape is irrelevant to the assertion, use a fast-check arbitrary (see PBT section) instead of a hardcoded placeholder.
- **Snapshots with caution.** Use only when the captured shape is stable, small, and reviewable at a glance. A 200-line snapshot hides what is being asserted; a 5-line snapshot of a public response DTO is fine. Review snapshot diffs carefully **before approving the PR** (the implementer subagent never runs `git commit` — it suggests).

## Effective mocking (reference)

When mocks are appropriate (i.e. infrastructure or cross-cutting), the operational toolkit:

- `jest.mock('module-path')` for module-level mocks of third-party libraries.
- `jest.spyOn(obj, 'method')` for surgical replacement on real objects.
- `mockImplementation()` / `mockReturnValue()` / `mockResolvedValue()` to define behavior.
- Always type your mocks: `jest.mocked(fn)` over loose casting.
- Reminder: `clearMocks` and `restoreMocks` are already on globally — see "Core testing guidelines" above.

## Testing async code

- Use `async`/`await` in `it` callbacks. Always return a promise or await it — never fire-and-forget.
- For rejection assertions: `await expect(handler.execute(cmd)).rejects.toThrow(InvoiceNotFoundError)`.
- For resolution assertions: `await expect(repo.findById(id)).resolves.toBeNull()`.
- Set timeouts only when justified: `jest.setTimeout(20_000)` for genuinely slow integration tests. Default is 15 s (unit) / 30 s (E2E).

## E2E with Supertest

- Use `test/helpers/create-test-app.ts` (already in this repo) to bootstrap a test app.
- File name: `src/modules/<context>/__tests__/<context>.e2e-spec.ts` — the E2E ships inside the module it exercises.
- Skeleton:

```ts
// src/modules/billing/__tests__/billing.e2e-spec.ts
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/create-test-app';

describe('POST /v1/invoices/:id/issue (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('returns 204 when issuing a draft invoice', async () => {
    await request(app.getHttpServer())
      .post('/v1/invoices/inv_1/issue')
      .send({ issuedAt: '2026-01-01T00:00:00Z' })
      .expect(204);
  });
});
```

## Snapshot testing

- Snapshot tests are appropriate for **stable serialized output** (e.g., a public response DTO contract). Avoid them for snapshots that change every refactor.
- Keep snapshots small — assert the specific shape, not the whole tree.
- Review snapshot diffs carefully **before approving the PR**. (The implementer subagent never runs `git commit` — they only **suggest** a commit. The user reviews snapshots before deciding.)

## Common Jest matchers (cheat sheet)

- Equality: `toBe` (Object.is), `toEqual` (deep), `toStrictEqual` (deep + type checks).
- Truthiness: `toBeTruthy`, `toBeFalsy`, `toBeNull`, `toBeDefined`.
- Numbers: `toBeGreaterThan`, `toBeLessThanOrEqual`, `toBeCloseTo` (floats).
- Strings: `toMatch(/regex/)`, `toContain('substring')`.
- Arrays: `toContain`, `toHaveLength`, `toEqual(expect.arrayContaining([...]))`.
- Objects: `toMatchObject({...})`, `toHaveProperty('a.b', value)`.
- Exceptions: `toThrow()`, `toThrow(InvoiceNotFoundError)`, `rejects.toThrow(...)`.
- Mocks: `toHaveBeenCalled`, `toHaveBeenCalledWith(arg1, arg2)`, `toHaveBeenCalledTimes(n)`.

## Property-based testing (PBT) with fast-check

> **Required packages (already installed in this repo):** `fast-check`, `@fast-check/jest`, `@faker-js/faker`.

Property-based tests express **invariants** instead of examples: "for any `n`, `Math.abs(n) >= 0`". `fast-check` generates inputs systematically and **shrinks** failing cases to the smallest counterexample. Use it alongside example-based tests, not instead of them.

### When to use it

- Tests phrased as **always** or **never** ("should always X when Y", "should never produce Z").
- **Edge case detection** without writing 50 hand-crafted examples.
- **Round-trips:** `parse(serialize(x)) === x`, `decompress(compress(x)) === x`.
- **Comparison with a simpler reference** (e.g., binary search vs. linear scan agree).
- **Race conditions** in async code that takes async functions as input — see the dedicated subsection below.
- **Don't** use PBT to replace example-based tests. They are complementary: examples document specific scenarios; properties cover the space.

### PBT by hexagonal layer

| Layer              | Value         | Typical targets                                                                                                                                                          |
| ------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Domain**         | High          | Invariants of value objects (`Money` non-negative), entity state machines (`Invoice` only issues from draft), pure functions (`sort` idempotency, `Period` containment). |
| **Application**    | Medium        | Handler idempotency (`execute` twice = once), "no event order produces an invalid aggregate state", race-prone handlers via `fc.scheduler()`.                            |
| **Infrastructure** | Rare but real | Mappers (DTO ↔ entity round-trip), parsers, serializers. **Skip** for repos and HTTP clients — real integration tests are more valuable there.                           |

### Writing a property in `@fast-check/jest`

```ts
import { fc, it as itProp } from '@fast-check/jest';

describe('Money.add', () => {
  itProp.prop([
    fc.float({ min: 0, max: 1_000_000, noNaN: true }),
    fc.float({ min: 0, max: 1_000_000, noNaN: true }),
  ])('debería producir siempre un importe no negativo cuando ambos operandos lo son', (a, b) => {
    // Arrange
    const moneyA = Money.of(a, 'USD');
    const moneyB = Money.of(b, 'USD');

    // Act
    const sum = moneyA.add(moneyB);

    // Assert
    expect(sum.amount).toBeGreaterThanOrEqual(0);
  });
});
```

- Place property tests **after** example-based tests in the same `describe`, or in a sibling `describe('… (property-based)')` when there are several.
- `it.prop` requires a `describe` parent. The library wires `it.prop([arbs])('debería …', (...values) => { … })` directly to Jest.
- Apply AAA comments inside the property body — same rule as example-based tests.

### Arbitraries guidelines

- **Don't generate inputs directly.** If you write `fc.string()` and then call the SUT, you risk re-implementing the SUT inside the test to compute the expected value. Construct inputs _around_ a known outcome:

```ts
// Bad: rebuilds substring search inside the test
it.prop([fc.string(), fc.string()])('debería detectar el substring', (text, pattern) => {
  expect(isSubstring(text, pattern)).toBe(text.includes(pattern));
});

// Good: assemble an input we know contains the pattern
it.prop([fc.string(), fc.string(), fc.string()])(
  'debería detectar un substring construido dentro del input',
  (a, b, c) => {
    // Arrange
    const text = a + b + c;
    // Act
    const result = isSubstring(text, b);
    // Assert
    expect(result).toBe(true);
  },
);
```

- **Never set `maxLength` unless the algorithm requires it.** For algorithms that get slow on large inputs, prefer `{ size: '-1' }` (smaller default size). Capping length hides real input shapes.
- **No constraints unless required.** Use defaults (`fc.integer()`, `fc.string()`) — `fast-check` already biases toward edge cases.
- **Avoid `.filter` and `fc.pre`.** They throw away generated values and slow runs. Prefer arbitrary options or `.map`:

```ts
// Bad
fc.integer().filter((n) => n >= 0);
// Good
fc.nat();

// Bad
fc.string().filter((s) => s.length >= 2);
// Good
fc.string({ minLength: 2 });

// Bad
fc.integer().filter((n) => n % 2 === 0);
// Good (map trick)
fc.nat().map((n) => n * 2);
```

- **`bigint` over `number` for arithmetic with overflow risk** (e.g., `pow`, multiplications). Predicate failures on overflow are confusing; bigint sidesteps the issue.

### Race conditions with `fc.scheduler()`

When the SUT accepts async functions and concurrent resolution order matters, `fc.scheduler()` lets fast-check explore every interleaving. Example: a queue that must resolve in call order.

```ts
import { fc, it as itProp } from '@fast-check/jest';

describe('queue', () => {
  itProp.prop([fc.scheduler()])(
    'debería resolver siempre las llamadas en el orden en que se encolaron',
    async (s) => {
      // Arrange
      const seen: number[] = [];
      const call = jest.fn((v: number) => Promise.resolve(v));
      const queued = queue(s.scheduleFunction(call));

      // Act
      await s.waitFor(
        Promise.all([queued(1).then((v) => seen.push(v)), queued(2).then((v) => seen.push(v))]),
      );

      // Assert
      expect(seen).toEqual([1, 2]);
    },
  );
});
```

`s.scheduleFunction` wraps an async function so its resolution can be interleaved by fast-check; `s.waitFor` drives the scheduler until the promises settle. Vanilla `fast-check` form (no `@fast-check/jest`) requires `fc.assert(fc.asyncProperty(fc.scheduler(), async (s) => { … }))` and `await`.

### Faker integration (active)

`@faker-js/faker` produces realistic data (`'María González'`, `'jgarcia+test@empresa.com.mx'`). Wire it into `fast-check` so you keep shrinking and seed reproducibility while gaining realistic inputs. The `FakerBuilder` class below is the canonical adapter:

Shared test helpers live under `test/helpers/` and are imported via the `@test/` alias — **not** `@/`, which maps to `src/`.

```ts
// test/helpers/faker-arb.ts (one place; share across specs)
import { Faker, type Randomizer, base } from '@faker-js/faker';
import fc from 'fast-check';

class FakerBuilder<TValue> extends fc.Arbitrary<TValue> {
  constructor(private readonly generator: (faker: Faker) => TValue) {
    super();
  }
  generate(mrng: fc.Random): fc.Value<TValue> {
    const randomizer: Randomizer = {
      next: () => mrng.nextDouble(),
      seed: () => {},
    };
    const customFaker = new Faker({ locale: base, randomizer });
    return new fc.Value(this.generator(customFaker), undefined);
  }
  canShrinkWithoutContext(_value: unknown): _value is TValue {
    return false;
  }
  shrink(_value: TValue, _context: unknown): fc.Stream<fc.Value<TValue>> {
    return fc.Stream.nil();
  }
}

export function fakerToArb<TValue>(generator: (faker: Faker) => TValue): fc.Arbitrary<TValue> {
  return new FakerBuilder(generator);
}
```

Use it inside `it.prop`:

```ts
import { fakerToArb } from '@test/helpers/faker-arb';
import { fc, it as itProp } from '@fast-check/jest';

itProp.prop([fakerToArb((f) => f.person.firstName()), fakerToArb((f) => f.person.lastName())])(
  'debería aceptar cualquier nombre completo realista',
  (firstName, lastName) => {
    // Arrange
    const fullName = `${firstName} ${lastName}`;
    // Act
    const person = Person.of(fullName);
    // Assert
    expect(person.fullName).toBe(fullName);
  },
);
```

**When Faker pulls its weight:** `Email`, `PersonName`, `Address`, `CompanyTaxId`, `PhoneNumber` — domains where input "shape" matters (accents, `+` in emails, locale-specific formats). **When it doesn't:** `Money`, `Quantity`, `Period`, `OrderTotal` — purely numeric/temporal. For those, plain `fast-check` arbitraries are enough.

### Avoid unstable values

- **Don't depend on the current date/time/locale.** Stub `Date.now` with `jest.useFakeTimers()` + `jest.setSystemTime(new Date('2026-01-01'))` for example-based tests. For property-based tests, generate the "today" value too: `g(fc.date, { min: new Date('2010-01-01'), noInvalidDate: true })`. The benefit over `setSystemTime` alone: fast-check tries new dates each run and reports the exact one that failed.
- **Don't depend on randomness.** All randomness in tests must come through fast-check (or a stubbed `Math.random`), so failures are reproducible.

### `@fast-check/jest` vs vanilla `fast-check` equivalence

Both work. Prefer `@fast-check/jest` for readability; fall back to vanilla when the test predicate doesn't fit the `it.prop` shape.

```ts
// Synchronous, with arbitraries
// @fast-check/jest
import { fc, it as itProp } from '@fast-check/jest';
itProp.prop([fc.integer(), fc.integer()])('debería ser conmutativa', (a, b) => {
  expect(add(a, b)).toBe(add(b, a));
});
// Vanilla
import fc from 'fast-check';
it('debería ser conmutativa', () => {
  fc.assert(
    fc.property(fc.integer(), fc.integer(), (a, b) => {
      expect(add(a, b)).toBe(add(b, a));
    }),
  );
});

// Async predicate
// @fast-check/jest
itProp.prop([fc.string()])('debería hashear de forma determinista', async (s) => {
  expect(await hash(s)).toBe(await hash(s));
});
// Vanilla
it('debería hashear de forma determinista', async () => {
  await fc.assert(
    fc.asyncProperty(fc.string(), async (s) => {
      expect(await hash(s)).toBe(await hash(s));
    }),
  );
});
```

## React / Frontend testing

This is a backend-only NestJS project. **There is no React Testing Library section** in this adaptation. If the codebase ever grows a frontend, restore the React guidance from the upstream skill.

## Workflow Integration

This skill is consulted by other skills in the chain:

- **`writing-plans`** — every test code block in a plan task uses these conventions: `*.spec.ts`, layer-aware mocking, project path aliases.
- **`subagent-driven-development` (implementer)** — when writing tests, the implementer follows this skill's mocking-by-layer rules. Tests that violate them fail spec compliance review.
- **`subagent-driven-development` (code quality reviewer)** — checks that domain tests are pure (no `Test.createTestingModule`), application tests use hand-written fakes (no `jest.mock`), infrastructure tests use realistic doubles or test infra.
- **`executing-plans`** — runs `pnpm jest <file>` (unit) and `pnpm test:e2e` (E2E) per task.
- **`clean-ddd-hexagonal`** — the layer rules here are the operational consequence of that skill's architectural rules.
- **Modelo «casos primero»** — la tabla «Casos acordados» de cada tarea del plan es el origen de
  los `it`; la sección «Test Structure» de este skill define el mapeo 1:1 y la regla de rojo previo.

## Git policy

This skill produces test code, never git operations. The implementer subagent and the reviewer never run `git commit`. If a green test suite feels like a good checkpoint, **suggest** a commit to the user:

> _"Te sugiero hacer un commit de los cambios por <razón, p. ej. cobertura completa de tests para Invoice domain>."_

Then stop and let the user decide.

## Source

Adapted from [github/awesome-copilot — javascript-typescript-jest](https://github.com/github/awesome-copilot). Modifications:

- NestJS conventions (`*.spec.ts` / `*.e2e-spec.ts`, `@swc/jest` baseline, project path aliases).
- Hexagonal mocking guidance (no mocks in domain, hand-written port fakes in application, realistic doubles in infrastructure).
- Supertest E2E section.
- Removal of React content.
- Integration with the rest of the skill chain (`writing-plans`, `subagent-driven-development`, `clean-ddd-hexagonal`, `nestjs-best-practices`).
- No-autocommit policy.
- AAA pattern made mandatory; `it` descriptions in Spanish starting with `debería…`; `// Helpers` block convention.
- Property-based testing section added: adapted from the user's pasted guidelines, with the `@fast-check/vitest` examples translated to `@fast-check/jest` (1:1 API parity), plus the `FakerBuilder` snippet for `@faker-js/faker` integration ([reference](https://fast-check.dev/blog/2024/07/18/integrating-faker-with-fast-check/)).
