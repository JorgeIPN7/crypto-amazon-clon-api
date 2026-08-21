---
name: clean-ddd-hexagonal
description: Proactively apply when designing APIs, microservices, or scalable backend structure. Triggers on DDD, Clean Architecture, Hexagonal, ports and adapters, entities, value objects, domain events, CQRS, event sourcing, repository pattern, use cases, onion architecture, outbox pattern, aggregate root, anti-corruption layer. Use when working with domain models, aggregates, repositories, or bounded contexts. Tailored to NestJS 11 + TypeScript 6.0 in this repo; conceptual references stay language-agnostic.
allowed-tools: Read, Grep, Glob
---

# Clean Architecture + DDD + Hexagonal

Backend architecture combining DDD tactical patterns, Clean Architecture dependency rules, and Hexagonal ports/adapters for maintainable, testable systems.

## Stack-Specific Anchor

This skill is applied in a **NestJS 11 + TypeScript 6.0 + Node 22 + pnpm 11** codebase (SWC, Pino, Zod, class-validator, Jest). Whenever a section below presents a concept generically, use [`references/NESTJS-MAPPING.md`](references/NESTJS-MAPPING.md) for the concrete pattern, file layout, DI tokens, and code idioms expected in this project. The other reference files remain language-agnostic for theory; `NESTJS-MAPPING.md` is the source of truth for code shape.

**Two repo conventions that override the generic examples:**

- **`type`, never `interface`.** ESLint enforces `@typescript-eslint/consistent-type-definitions: ['error', 'type']`. The `references/*.md` files use `interface` as language-agnostic pseudocode — writing that in real code fails `pnpm lint:check`.
- **Layers live per bounded context** under `src/modules/<context>/`, never at the root of `src/`.

## When to Use (and When NOT to)

| Use When                                 | Skip When                                |
| ---------------------------------------- | ---------------------------------------- |
| Complex business domain with many rules  | Simple CRUD, few business rules          |
| Long-lived system (years of maintenance) | Prototype, MVP, throwaway code           |
| Team of 5+ developers                    | Solo developer or small team (1-2)       |
| Multiple entry points (API, CLI, events) | Single entry point, simple API           |
| Need to swap infrastructure (DB, broker) | Fixed infrastructure, unlikely to change |
| High test coverage required              | Quick scripts, internal tools            |

**Start simple. Evolve complexity only when needed.** Most systems don't need full CQRS or Event Sourcing.

## CRITICAL: The Dependency Rule

Dependencies point **inward only**. Outer layers depend on inner layers, never the reverse.

```
Infrastructure → Application → Domain
   (adapters)     (use cases)    (core)
```

**Violations to catch:**

- Domain importing database/HTTP libraries
- Controllers calling repositories directly (bypassing use cases)
- Entities depending on application services

**Design validation:** "Create your application to work without either a UI or a database" — Alistair Cockburn. If you can run your domain logic from tests with no infrastructure, your boundaries are correct.

## Quick Decision Trees

### "Where does this code go?"

```
Where does it go?
├─ Pure business logic, no I/O           → domain/
├─ Orchestrates domain + has side effects → application/
├─ Talks to external systems              → infrastructure/
├─ Defines HOW to interact (interface)    → port (domain or application)
└─ Implements a port                      → adapter (infrastructure)
```

### "Is this an Entity or Value Object?"

```
Entity or Value Object?
├─ Has unique identity that persists → Entity
├─ Defined only by its attributes    → Value Object
├─ "Is this THE same thing?"         → Entity (identity comparison)
└─ "Does this have the same value?"  → Value Object (structural equality)
```

### "Should this be its own Aggregate?"

```
Aggregate boundaries?
├─ Must be consistent together in a transaction → Same aggregate
├─ Can be eventually consistent                 → Separate aggregates
├─ Referenced by ID only                        → Separate aggregates
└─ >10 entities in aggregate                    → Split it
```

**Rule:** One aggregate per transaction. Cross-aggregate consistency via domain events (eventual consistency).

## Directory Structure

**In this repo the layers live per bounded context, never at the root of `src/`.** This is the only valid layout — it mirrors `references/NESTJS-MAPPING.md`, which is the source of truth.

```
src/
├── main.ts                              # Bootstrap (composition root)
├── app.module.ts                        # Root module
├── bootstrap/                           # Global setup (helmet, swagger, pipes…)
├── common/                              # Cross-cutting (filters, interceptors, decorators)
├── config/                              # Zod-validated config
└── modules/
    └── <bounded-context>/               # e.g. billing, identity, catalog
        ├── domain/                      # NO @nestjs/* imports
        │   ├── <aggregate>.entity.ts
        │   ├── <value-object>.vo.ts
        │   ├── events/<event-name>.event.ts
        │   ├── ports/<repo-name>.repository.ts   # driven port
        │   ├── services/<service>.domain-service.ts
        │   └── errors/<error>.error.ts
        ├── application/                 # @Injectable OK; no ORM / HTTP clients
        │   ├── ports/<port>.port.ts
        │   ├── commands/<use-case>.command.ts
        │   ├── queries/<use-case>.query.ts
        │   ├── handlers/<use-case>.handler.ts    # use case
        │   └── dto/<dto>.dto.ts
        ├── infrastructure/              # adapters — the only layer touching external libs
        │   ├── persistence/<repo>.<orm>.repository.ts
        │   ├── http/<resource>.controller.ts     # driver adapter
        │   ├── messaging/<event>.subscriber.ts
        │   └── mappers/<entity>.mapper.ts
        └── <context>.module.ts          # wires everything with tokens
```

Controllers belong in `infrastructure/http/` because they are driver adapters — never in a parallel folder.

## DDD Building Blocks

| Pattern                 | Purpose                 | Layer         | Key Rule                           |
| ----------------------- | ----------------------- | ------------- | ---------------------------------- |
| **Entity**              | Identity + behavior     | Domain        | Equality by ID                     |
| **Value Object**        | Immutable data          | Domain        | Equality by value, no setters      |
| **Aggregate**           | Consistency boundary    | Domain        | Only root is referenced externally |
| **Domain Event**        | Record of change        | Domain        | Past tense naming (`OrderPlaced`)  |
| **Repository**          | Persistence abstraction | Domain (port) | Per aggregate, not per table       |
| **Domain Service**      | Stateless logic         | Domain        | When logic doesn't fit an entity   |
| **Application Service** | Orchestration           | Application   | Coordinates domain + infra         |

## Anti-Patterns (CRITICAL)

| Anti-Pattern               | Problem                                   | Fix                                  |
| -------------------------- | ----------------------------------------- | ------------------------------------ |
| **Anemic Domain Model**    | Entities are data bags, logic in services | Move behavior INTO entities          |
| **Repository per Entity**  | Breaks aggregate boundaries               | One repository per AGGREGATE         |
| **Leaking Infrastructure** | Domain imports DB/HTTP libs               | Domain has ZERO external deps        |
| **God Aggregate**          | Too many entities, slow transactions      | Split into smaller aggregates        |
| **Skipping Ports**         | Controllers → Repositories directly       | Always go through application layer  |
| **CRUD Thinking**          | Modeling data, not behavior               | Model business operations            |
| **Premature CQRS**         | Adding complexity before needed           | Start with simple read/write, evolve |
| **Cross-Aggregate TX**     | Multiple aggregates in one transaction    | Use domain events for consistency    |

## Implementation Order

1. **Discover the Domain** — Event Storming, conversations with domain experts
2. **Model the Domain** — Entities, value objects, aggregates (no infra)
3. **Define Ports** — Repository interfaces, external service interfaces
4. **Implement Use Cases** — Application services coordinating domain
5. **Add Adapters last** — HTTP, database, messaging implementations

**DDD is collaborative.** Modeling sessions with domain experts are as important as the code patterns.

## Reference Documentation

| File                                                             | Purpose                                                                                                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **[references/NESTJS-MAPPING.md](references/NESTJS-MAPPING.md)** | **Concrete NestJS 11 + TS 6.0 patterns (folder layout, DI tokens, controller/repo idioms). Read this first when writing code.** |
| [references/LAYERS.md](references/LAYERS.md)                     | Complete layer specifications (conceptual)                                                                                      |
| [references/DDD-STRATEGIC.md](references/DDD-STRATEGIC.md)       | Bounded contexts, context mapping                                                                                               |
| [references/DDD-TACTICAL.md](references/DDD-TACTICAL.md)         | Entities, value objects, aggregates (pseudocode)                                                                                |
| [references/HEXAGONAL.md](references/HEXAGONAL.md)               | Ports, adapters, naming                                                                                                         |
| [references/CQRS-EVENTS.md](references/CQRS-EVENTS.md)           | Command/query separation, events                                                                                                |
| [references/TESTING.md](references/TESTING.md)                   | Unit, integration, architecture tests                                                                                           |
| [references/CHEATSHEET.md](references/CHEATSHEET.md)             | Quick decision guide                                                                                                            |

## Workflow Integration

This skill is consulted at two points in the standard flow:

1. **During brainstorming** — when the design touches business rules, aggregates, ports, or layer boundaries. The brainstorming skill should reference the decision trees here when proposing approaches.
2. **During writing-plans** — to lock down folder layout, ports, and the responsibility of each file before tasks are decomposed. Plans must place new code under the structure defined in `NESTJS-MAPPING.md`.

The companion skill `nestjs-best-practices` provides the rule-level checks (DI tokens, security, performance) that complement the architectural decisions made here, and `javascript-typescript-jest` provides the test naming and mocking strategy that operationalize the layer rules (no mocks in domain, hand-written port fakes in application, realistic doubles in infrastructure).

## Sources

### Primary Sources

- [The Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html) — Robert C. Martin (2012)
- [Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/) — Alistair Cockburn (2005)
- [Domain-Driven Design: The Blue Book](https://www.domainlanguage.com/ddd/blue-book/) — Eric Evans (2003)
- [Implementing Domain-Driven Design](https://openlibrary.org/works/OL17392277W) — Vaughn Vernon (2013)

### Pattern References

- [CQRS](https://martinfowler.com/bliki/CQRS.html) — Martin Fowler
- [Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html) — Martin Fowler
- [Repository Pattern](https://martinfowler.com/eaaCatalog/repository.html) — Martin Fowler (PoEAA)
- [Unit of Work](https://martinfowler.com/eaaCatalog/unitOfWork.html) — Martin Fowler (PoEAA)
- [Bounded Context](https://martinfowler.com/bliki/BoundedContext.html) — Martin Fowler
- [Transactional Outbox](https://microservices.io/patterns/data/transactional-outbox.html) — microservices.io
- [Effective Aggregate Design](https://www.dddcommunity.org/library/vernon_2011/) — Vaughn Vernon

### Implementation Guides

- [Microsoft: DDD + CQRS Microservices](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/)
- [Domain Events](https://udidahan.com/2009/06/14/domain-events-salvation/) — Udi Dahan
