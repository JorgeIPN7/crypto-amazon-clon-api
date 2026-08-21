# Implementer Subagent Prompt Template

Use this template when dispatching an implementer subagent.

**Tool:** `Agent`
**`subagent_type`:** `general-purpose`

```
Agent({
  subagent_type: "general-purpose",
  description: "Implement Task N: [task name]",
  prompt: |
    You are implementing Task N: [task name]

    ## Stack

    NestJS 11, TypeScript 6.0, Node 22, pnpm 11, Jest, Supertest, Pino, Zod, class-validator.

    Companion skills (read for context, do not invoke as steps):
    - clean-ddd-hexagonal — for layer rules. Read `clean-ddd-hexagonal/references/NESTJS-MAPPING.md`.
    - nestjs-best-practices — for the rule codes attached to this task.
    - javascript-typescript-jest — for test naming (`*.spec.ts` / `*.e2e-spec.ts`),
      layer-aware mocking (no mocks in domain, hand-written port fakes in application,
      realistic doubles in infrastructure), and Supertest E2E patterns.

    ## Task Description

    [FULL TEXT of task from plan — paste it here, don't make subagent read the file]

    ## Context

    [Scene-setting: which bounded context, dependencies on prior tasks, port tokens already defined, architectural context]

    ## Layer of this Task

    [domain | application | infrastructure | bootstrap | common]

    ## Rule codes to honor

    [List of nestjs-best-practices codes copied from the plan task]

    ## Before You Begin

    If you have questions about:
    - Requirements or acceptance criteria
    - Approach or implementation strategy
    - Dependencies or assumptions (port tokens, neighbouring modules)
    - Anything unclear in the task description

    **Ask them now.** Raise any concerns before starting work.

    ## JIT: confirm the case table (domain/application tasks)

    If the task carries a "Casos acordados" table, ask the controller ONE question before
    starting: «¿Surgió algo que cambie estos casos?». If cases changed, wait for the updated
    table before writing any test. Never add or reword a case silently — a new case discovered
    mid-implementation goes back to the controller and gets registered in the plan first.

    ## Your Job

    Once you're clear on requirements:
    1. Implement exactly what the task specifies, layer-respectful.
    2. TDD driven by the case table when present: write ALL the tests from «Casos acordados»
       first (1:1 — the `it` text IS the case; `P` rows become property tests with
       `@fast-check/jest`), run them and CAPTURE the red output, then implement to green,
       then refactor. Without a case table, classic TDD (failing test → minimal
       implementation → passing test).
    3. Verify the implementation works with `pnpm jest <file>` (or `pnpm test:e2e` for E2E).
    4. Self-review (see below).
    5. Report back.

    Work from: [absolute project directory]

    **While you work:** if you hit something unexpected or unclear, ask. Don't guess.

    ## Layer purity rules (HARD)

    - Domain (`src/modules/<context>/domain/`):
      - Zero imports from `@nestjs/*`, `typeorm`, `prisma`, `axios`, `class-validator` decorators, or `pino`.
      - No decorators. Plain TS classes / functions / types.
      - Tests are pure Jest, NO `Test.createTestingModule`.
    - Application (`src/modules/<context>/application/`):
      - May use `@nestjs/common` decorators. Must NOT import ORMs or HTTP clients.
      - Inject ports by token via `@Inject(<TOKEN>)`.
      - Tests use hand-written port fakes — NO `jest.mock`.
    - Infrastructure (`src/modules/<context>/infrastructure/`):
      - The only layer that imports ORMs, HTTP libs, message brokers.
      - Controllers under `infrastructure/http/`. Repos under `infrastructure/persistence/`.
      - Tests are integration / E2E with real (or test-container) infrastructure.

    Run a quick `grep` after writing to confirm no forbidden imports leaked into the
    wrong layer; report it as a concern if any did.

    ## Code Organization

    - Follow the file structure defined in the plan.
    - Each file has one clear responsibility with a well-defined interface.
    - If a file you're creating is growing beyond the plan's intent, stop and report
      it as DONE_WITH_CONCERNS — do not split files on your own without plan guidance.
    - In existing codebases, follow established patterns. Improve code you're touching
      the way a good developer would, but don't restructure things outside your task.

    ## When You're in Over Your Head

    It is always OK to stop and say "this is too hard for me." Bad work is worse than
    no work. You will not be penalized for escalating.

    **STOP and escalate when:**
    - The task requires architectural decisions with multiple valid approaches.
    - You need to understand code beyond what was provided and can't find clarity.
    - You feel uncertain about whether your approach is correct.
    - The task involves restructuring existing code in ways the plan didn't anticipate.
    - You've been reading file after file trying to understand the system without progress.

    **How to escalate:** report back with status BLOCKED or NEEDS_CONTEXT. Describe
    specifically what you're stuck on, what you've tried, and what kind of help you need.

    ## Git policy (NON-NEGOTIABLE)

    **Do NOT run `git commit`, `git add` for commit purposes, `git push`, `git tag`,
    `git rebase`, or any other git command that mutates history or remotes.**

    The user controls all git operations. If you think a commit is appropriate, include
    a commit suggestion in your final report using this exact format:

    > *Suggested commit:* "Te sugiero hacer un commit de los cambios por <razón>"

    Then stop. The controller relays your suggestion to the user, who decides.

    Read-only git commands (`git status`, `git diff`, `git log --oneline -n 5`) are fine
    when they help you understand the current state.

    ## Before Reporting Back: Self-Review

    Review your work with fresh eyes:

    **Completeness:**
    - Did I implement everything in the spec?
    - Did I miss any requirements? Edge cases?

    **Quality:**
    - Is this my best work?
    - Are names clear (match what things do, not how they work)?
    - Is the code clean and maintainable?

    **Discipline (YAGNI):**
    - Did I avoid overbuilding?
    - Did I only build what was requested?
    - Did I follow existing patterns in the codebase?

    **Layer purity:**
    - No forbidden imports (verify by grep)?
    - Right artifact in the right folder?

    **Rule codes:**
    - Each listed rule code visibly applied (e.g. token present, validator on DTO, guard registered)?

    **Testing (per javascript-typescript-jest):**
    - Test files end in `.spec.ts` (unit) or `.e2e-spec.ts` (E2E) — never `.test.ts`?
    - Every `it` is a Spanish sentence starting with `debería…`?
    - Every `it` body has explicit `// Arrange / // Act / // Assert` comments separating the three phases?
    - File-local helpers live at the bottom under a `// Helpers` comment, not at the top?
    - Domain tests are pure (no `Test.createTestingModule`, no `jest.mock`)?
    - Application tests use hand-written port fakes (no `jest.mock` against module paths)?
    - Infrastructure tests use realistic doubles or test infra (not `jest.mock('typeorm')`)?
    - For requirements phrased as "always" or "never", did I add a property-based test
      with `it.prop` from `@fast-check/jest`? (advisory — see PBT section of
      `javascript-typescript-jest`)
    - Async assertions use `resolves` / `rejects` or `await`?
    - Tests verify behavior, not just mock interactions?
    - Drop-and-still-passes check: if I remove the production line that makes the test
      pass, does the test fail? If not, the test isn't testing what it claims.
    - I followed TDD (failing test first)?
    - Case-table tasks: does every row have its `it` with identical text, and no extra `it`
      without a row or a JIT-registered addition?
    - Case-table tasks: did I capture the initial RED run output for the report?
    - Domain/application tasks: did I run
      `pnpm test:mutation --mutate "src/modules/<context>/domain/**/*.ts,src/modules/<context>/application/**/*.ts"`
      and record the mutation score?

    **Git:**
    - Did I avoid running any committing/pushing git command?

    If you find issues during self-review, fix them now before reporting.

    ## Report Format

    When done, report:

    - **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
    - **Implemented:** what you built (or attempted)
    - **Tests:** which suites you ran and the result lines (`Tests: X passed, …`)
    - **Casos ↔ suite** (case-table tasks): 1:1 mapping confirmed, plus the initial RED output
      and the final green output.
    - **Mutación** (domain/application tasks): mutation score of the touched module.
    - **Files changed:** grouped by layer
    - **Layer purity check:** result of grep for forbidden imports
    - **Rule-code compliance:** one-line confirmation per rule code
    - **Self-review findings:** anything you fixed during self-review
    - **Concerns or open questions** (if any)
    - **Suggested commit** (optional): the exact phrase from the Git policy section

    Use DONE_WITH_CONCERNS if you completed the work but have doubts. Use BLOCKED if
    you cannot complete. Use NEEDS_CONTEXT if information is missing. Never silently
    produce work you're unsure about, and never run a committing git command.
})
```
