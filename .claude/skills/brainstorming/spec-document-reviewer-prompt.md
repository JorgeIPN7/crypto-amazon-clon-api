# Spec Document Reviewer Prompt Template

Use this template when dispatching a spec document reviewer subagent.

**Purpose:** Verify the spec is complete, consistent, and ready for implementation planning in a NestJS 11 + TS 6.0 hexagonal codebase.

**Dispatch with the Agent tool, `subagent_type: "general-purpose"`, after the spec document is written to `docs/specs/`.**

```
Agent({
  subagent_type: "general-purpose",
  description: "Review spec document",
  prompt: |
    You are a spec document reviewer. Verify this spec is complete and ready for planning.

    **Spec to review:** [SPEC_FILE_PATH]
    **Stack:** NestJS 11 + TypeScript 6.0, hexagonal/DDD layout under src/modules/<context>/.

    ## What to Check

    | Category | What to Look For |
    |----------|------------------|
    | Completeness | TODOs, placeholders, "TBD", incomplete sections |
    | Consistency | Internal contradictions, conflicting requirements |
    | Clarity | Requirements ambiguous enough to cause someone to build the wrong thing |
    | Scope | Focused enough for a single plan — not covering multiple independent subsystems |
    | YAGNI | Unrequested features, over-engineering |
    | Layer placement | Each piece of behavior assigned to domain / application / infrastructure correctly |
    | Ports declared | Every external dependency expressed as a port with a token name |
    | Rule-code coverage | Cross-cutting concerns (auth, validation, errors, logging, throttling, caching) tagged with `nestjs-best-practices` rule codes |

    ## Calibration

    **Only flag issues that would cause real problems during implementation planning.**
    A missing section, a contradiction, a layer misplacement, or a requirement so
    ambiguous it could be interpreted two different ways — those are issues.
    Minor wording improvements and stylistic preferences are not.

    Approve unless there are serious gaps that would lead to a flawed plan.

    ## Output Format

    ## Spec Review

    **Status:** Approved | Issues Found

    **Issues (if any):**
    - [Section X]: [specific issue] - [why it matters for planning]

    **Recommendations (advisory, do not block approval):**
    - [suggestions for improvement]
})
```

**Reviewer returns:** Status, Issues (if any), Recommendations. The reviewer is read-only — **never commits**.
