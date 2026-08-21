---
name: writing-plans
description: Use when you have a spec or requirements for a multi-step task, before touching code
---

# Writing Plans

## Overview

Write comprehensive implementation plans assuming the engineer has zero context for our codebase and questionable taste. Document everything they need to know: which files to touch for each task, code, testing, docs they might need to check, how to test it. Give them the whole plan as bite-sized tasks. DRY. YAGNI. TDD.

Assume they are a skilled developer, but know almost nothing about our toolset or problem domain. Assume they don't know good test design very well.

**Announce at start:** "I'm using the writing-plans skill to create the implementation plan."

**Stack assumed:** NestJS 11, TypeScript 6.0, Node 22, pnpm 11, SWC, Jest, Supertest, Pino, Zod, class-validator. Plans must use this stack — no Python, no other test runners.

**Save plans to:** `docs/plans/YYYY-MM-DD-<feature-name>.md`

- (User preferences for plan location override this default)

## Companion skills (consult, don't invoke)

Before writing tasks, **read** these three skills as planning references — do not call them as workflow steps:

- **`clean-ddd-hexagonal`** — locks the file layout. Every new file must fall under `src/modules/<context>/{domain,application,infrastructure}/...` per `${CLAUDE_SKILL_DIR}/../clean-ddd-hexagonal/references/NESTJS-MAPPING.md`. Tasks that mix layers fail review.
- **`nestjs-best-practices`** — supplies rule codes. Each task that creates/modifies a Nest artifact (controller, provider, module, filter, interceptor, guard) must list the applicable rule codes (e.g. `arch-feature-modules`, `di-use-interfaces-tokens`, `security-validate-all-input`) under the task's **"Rule codes to honor"** subsection.
- **`javascript-typescript-jest`** — locks Jest conventions. Every test code block in a task uses `*.spec.ts` (unit) or `*.e2e-spec.ts` (E2E), layer-aware mocking (no mocks in domain, hand-written fakes in application, realistic doubles in infrastructure), and the project's path aliases (`@/`, `@modules/`, …). Don't restate these rules in the task — link the skill name and give the layer-correct snippet.

## Scope Check

If the spec covers multiple independent subsystems, it should have been broken into sub-project specs during brainstorming. If it wasn't, suggest breaking this into separate plans — one per subsystem. Each plan should produce working, testable software on its own.

## File Structure

Before defining tasks, map out which files will be created or modified and what each one is responsible for. This is where decomposition decisions get locked in.

- Map every file to its **layer** (`domain` / `application` / `infrastructure` / `bootstrap` / `common`) and check the dependency rule: outer → inner only. No `domain/` file imports `@nestjs/*`, `typeorm`, `prisma`, `axios`, `class-validator` decorators, or `pino`.
- Each file has one responsibility (a single aggregate, a single use case, a single adapter, etc.).
- For each port: declare the **token name** (e.g. `INVOICE_REPOSITORY`) and the file containing the interface.
- Files that change together live together. Split by responsibility, not by technical layer alone.
- In existing codebases, follow established patterns from `src/modules/`. If a file you're modifying has grown unwieldy, including a split in the plan is reasonable.

This structure informs the task decomposition. Each task should produce self-contained changes that make sense independently.

## Bite-Sized Task Granularity

**Each step is one action (2-5 minutes):**

- "Write the failing test" — step
- "Run it to make sure it fails" — step
- "Implement the minimal code to make the test pass" — step
- "Run the tests and make sure they pass" — step

## Casos acordados (contrato de comportamiento)

Antes de redactar las tareas, el plan pasa por la **fase de contrato** del modelo de colaboración
(spec `docs/specs/2026-08-04-roadmap-and-collaboration-model-design.md`): una ronda de preguntas
y respuestas con el usuario fija los casos de prueba de cada tarea con lógica de negocio. La
tabla resultante vive en la tarea del plan — artefacto versionado, no conversación perdida.

- **Aplica a tareas que tocan `domain/` o `application/`.** Infra, config, wiring y docs quedan
  exentas.
- **Dos tipos de fila:** caso puntual (un ejemplo concreto) y propiedad (prefijo `P`, un
  invariante sobre un dominio de entradas, implementado con `@fast-check/jest`):

| #   | Caso (se vuelve el `it`)                                 | Entrada / estado inicial  | Resultado esperado              |
| --- | -------------------------------------------------------- | ------------------------- | ------------------------------- |
| 1   | debería rechazar un email sin arroba                     | `Email.create('foo')`     | lanza `InvalidEmailError`       |
| P1  | debería aceptar cualquier email RFC-válido _(propiedad)_ | arbitrario `validEmail()` | nunca lanza; round-trip estable |

- **Trazabilidad 1:1:** cada caso puntual produce exactamente un `it` cuyo texto es el caso;
  cada fila `P`, un `it` de propiedad. Ningún `it` sin fila; ninguna fila sin `it`.
- **Casos descubiertos al implementar** no se añaden en silencio: el implementador consulta
  (confirmación JIT) y la fila nueva se registra en el plan antes de escribir su test.

## Plan Document Header

**Every plan MUST start with this header:**

```markdown
# [Feature Name] Implementation Plan

> **For agentic workers:** Use the `subagent-driven-development` skill (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Never run `git commit` or `git push` without explicit user instruction** — at most, suggest a commit and wait.

**Goal:** [One sentence describing what this builds]

**Bounded context:** [src/modules/<context>/ — new or existing]

**Architecture:** [2-3 sentences explaining the aggregates / ports / adapters introduced]

**Tech stack:** NestJS 11, TypeScript 6.0, Jest, Supertest, [+ any extra: TypeORM/Prisma, Redis, BullMQ, etc.]

**Rule codes touched:** [comma-separated list of nestjs-best-practices codes the plan exercises]

---
```

## Task Structure

````markdown
### Task N: [Component Name]

**Layer:** domain | application | infrastructure | bootstrap | common
**Rule codes to honor:** `arch-feature-modules`, `di-use-interfaces-tokens`, `security-validate-all-input`

**Casos acordados** (obligatoria si la tarea toca `domain/` o `application/`; omitir en el resto):

| #   | Caso (se vuelve el `it`) | Entrada / estado inicial | Resultado esperado |
| --- | ------------------------ | ------------------------ | ------------------ |
| 1   | debería …                | …                        | …                  |

**Files:**

- Create: `src/modules/billing/domain/invoice.entity.ts`
- Create: `src/modules/billing/domain/ports/invoice.repository.ts`
- Test: `src/modules/billing/__tests__/domain/invoice.entity.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/billing/domain/invoice.entity.spec.ts
import { Invoice } from './invoice.entity';
import { InvoiceId } from './invoice-id.vo';
import { Money } from './money.vo';

describe('Invoice', () => {
  it('issues a draft invoice', () => {
    const invoice = Invoice.draft(InvoiceId.from('inv_1'), Money.of(100, 'USD'));
    invoice.issue(new Date('2026-01-01T00:00:00Z'));
    const events = invoice.pullEvents();
    expect(events).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm jest src/modules/billing/domain/invoice.entity.spec.ts`
Expected: FAIL — `Cannot find module './invoice.entity'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/billing/domain/invoice.entity.ts
import { InvoiceIssued } from './events/invoice-issued.event';
import type { InvoiceId } from './invoice-id.vo';
import type { Money } from './money.vo';

export class Invoice {
  private readonly events: unknown[] = [];

  private constructor(
    readonly id: InvoiceId,
    private status: 'draft' | 'issued',
    private readonly total: Money,
  ) {}

  static draft(id: InvoiceId, total: Money): Invoice {
    return new Invoice(id, 'draft', total);
  }

  issue(now: Date): void {
    if (this.status !== 'draft') throw new Error('not draft');
    this.status = 'issued';
    this.events.push(new InvoiceIssued(this.id, this.total, now));
  }

  pullEvents(): readonly unknown[] {
    return this.events.splice(0);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm jest src/modules/billing/domain/invoice.entity.spec.ts`
Expected: PASS — 1 passed
````

## Task Templates by Layer

Use these as starting points; adapt to the spec. Test conventions are governed by `javascript-typescript-jest` — match them exactly.

### Domain task (pure TS)

- Test file: `__tests__/domain/<name>.spec.ts` at the module root, mirroring the layer path. Import the SUT relatively (`../../domain/<name>`).
- `Test.createTestingModule` is **forbidden** — instantiate directly with `new`.
- No mocks at all. No `jest.mock`, no `jest.spyOn` on domain code. If the test "needs" a mock, the design leaked.
- No `@nestjs/*` imports in the SUT or in the test.
- Write the failing test first, then the entity / VO / domain service.
- **AAA + `debería…` mandatory** (per `javascript-typescript-jest`): every `it` is a Spanish sentence starting with `debería…`, body separated by `// Arrange / // Act / // Assert` comments, file-local helpers under `// Helpers` block at the bottom.
- The task's «Casos acordados» table is the source of the `it` list — 1:1 mapping, see the «Casos acordados» section above.
- **Consider PBT for invariants.** When the requirement has an "always" or "never" shape (e.g., "Money.add never produces a negative amount", "Invoice.issue is idempotent on a draft"), include an `it.prop([...])` from `@fast-check/jest` alongside the example-based tests.

### Application task (use case / handler)

- Test file: `__tests__/application/handlers/<handler-name>.spec.ts` at the module root, mirroring the layer path.
- Use **hand-written port fakes** (small classes implementing the port interface, often in-memory). **Forbidden:** `jest.mock` against module paths.
- `jest.spyOn` on the fake's methods is acceptable when asserting calls.
- Construct the handler directly: `new IssueInvoiceHandler(fakeRepo, fakeEventBus)` — no `Test.createTestingModule`.
- Handler is `@Injectable()` with one public method (`execute`).
- Inject ports by token via `@Inject(<TOKEN>)`.
- Rule codes: `di-prefer-constructor-injection`, `di-use-interfaces-tokens`, `arch-single-responsibility`.
- **AAA + `debería…` mandatory.** Same rules as the domain task.
- The task's «Casos acordados» table is the source of the `it` list — 1:1 mapping, see the «Casos acordados» section above.
- **Consider PBT for handler invariants** — e.g., idempotency (`execute` twice = once), "no event order produces an invalid state". For race-prone handlers, use `fc.scheduler()` (see `javascript-typescript-jest` PBT section).

### Infrastructure task (controller / repo / messaging)

- **Controllers:** unit tests with `Test.createTestingModule({ controllers, providers })` providing a fake handler **and** an E2E spec under `src/modules/<context>/__tests__/<context>.e2e-spec.ts` using Supertest + `@test/helpers/create-test-app`.
- **Repositories:** integration tests against a real test database (or a documented in-memory equivalent like sqlite). Never `jest.mock('typeorm')` — the test loses its value.
- **HTTP gateways:** `nock`/`msw-node` for outbound HTTP; `jest.mock` for the SDK module is acceptable only when no other option exists.
- Rule codes: `api-use-dto-serialization`, `security-validate-all-input`, `arch-use-repository-pattern`, `db-use-transactions` (when writes span multiple rows).

### Module wiring task

- One task per `*.module.ts`: imports, providers (with token bindings), controllers, exports.
- The wiring task is the **last** task that introduces a new bounded context — it brings everything together.
- A short integration test (`<context>.module.spec.ts`) instantiates the module with `Test.createTestingModule` and resolves each provider token to confirm wiring.

## No Placeholders

Every step must contain the actual content an engineer needs. These are **plan failures** — never write them:

- "TBD", "TODO", "implement later", "fill in details"
- "Add appropriate error handling" / "add validation" / "handle edge cases"
- "Write tests for the above" (without actual test code)
- "Similar to Task N" (repeat the code — the engineer may be reading tasks out of order)
- Steps that describe what to do without showing how (code blocks required for code steps)
- References to types, functions, tokens, or methods not defined in any task
- Bare `git commit` instructions — see "No autocommit" below

## No autocommit

The plan **never instructs the implementer to run `git commit` or `git push`**. The user controls all commits.

If a logical checkpoint deserves a commit, end the task with a **suggestion** the implementer surfaces to the user, e.g.:

> _"Te sugiero hacer un commit de los cambios por <razón>"_

…and stop. Do not embed `git commit` commands.

## Remember

- Exact file paths always (under `src/modules/<context>/...`)
- Complete code in every step — if a step changes code, show the code
- Exact `pnpm` / `nest` commands with expected output
- DRY, YAGNI, TDD
- Layer purity is non-negotiable

## Self-Review

After writing the complete plan, look at the spec with fresh eyes and check the plan against it. By default this is a checklist you run yourself.

1. **Spec coverage:** Skim each section/requirement in the spec. Can you point to a task that implements it? List any gaps.
2. **Placeholder scan:** Search your plan for red flags — any of the patterns from "No Placeholders". Fix them.
3. **Type consistency:** Do types, method signatures, port interfaces, and token names match across tasks? `INVOICE_REPOSITORY` in Task 3 must equal `INVOICE_REPOSITORY` in Task 7.
4. **Layer purity:** Every file in `domain/` is free of `@nestjs/*` and ORM imports. Every controller lives under `infrastructure/http/`.
5. **Rule-code coverage:** Every Nest artifact lists at least one rule code; cross-cutting concerns (auth, validation, logging, errors) are tagged.
6. **No commits:** No task contains `git commit` or `git push`.
7. **Casos acordados coverage:** Does every task touching `domain/` or `application/` carry a filled «Casos acordados» table, and no task outside those layers carry one needlessly?

If you find issues, fix them inline. No need to re-review — just fix and move on. If you find a spec requirement with no task, add the task.

**Escalate to a reviewer subagent when the plan is large.** For plans above ~8 tasks, plans touching more than one bounded context, or whenever you are unsure the decomposition holds, dispatch an independent reviewer instead of relying on the self-review: use the template at `${CLAUDE_SKILL_DIR}/plan-document-reviewer-prompt.md` (Agent tool, `subagent_type: "general-purpose"`, read-only). Address every blocking issue before the execution handoff below.

## Execution Handoff

After saving the plan, offer the execution choice:

> "Plan complete and saved to `docs/plans/<filename>.md`. Two execution options:
>
> **1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Uses the `subagent-driven-development` skill.
>
> **2. Inline Execution** — Execute tasks in this session sequentially with checkpoints. Uses the `executing-plans` skill.
>
> Which approach?"

After the user picks, invoke the corresponding skill. **Do not commit the plan file** — if it feels like a good checkpoint, suggest: _"Te sugiero hacer un commit del plan por <razón>"_.
