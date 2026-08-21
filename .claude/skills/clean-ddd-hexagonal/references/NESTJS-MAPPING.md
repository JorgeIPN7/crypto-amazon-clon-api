# Mapeo Hexagonal/DDD → NestJS 11 + TS 6.0

Concreción de los conceptos genéricos del skill al stack del proyecto: **NestJS 11, TypeScript 6.0, Node 22, pnpm 11, SWC, Pino, Zod, class-validator, Jest**.

> Esta referencia complementa `LAYERS.md`, `DDD-TACTICAL.md` y `HEXAGONAL.md`. Cuando el `SKILL.md` u otra referencia describa un concepto en pseudocódigo, este archivo es la fuente de verdad para cómo escribirlo en este repo.

> **Convención obligatoria — `type`, nunca `interface`.** El ESLint del repo aplica `@typescript-eslint/consistent-type-definitions: ['error', 'type']`. Los demás archivos de `references/` usan `interface` porque son teoría agnóstica del lenguaje; **en código real de este repo eso rompe `pnpm lint:check`**. Declara siempre puertos, comandos, queries y DTOs como `export type X = { … };`.

## 1. Estructura de carpetas (obligatoria)

Cada bounded context vive bajo `src/modules/<context>/` y respeta la regla de dependencia hacia adentro.

```
src/
├── main.ts                              # Bootstrap (composition root)
├── app.module.ts                        # Módulo raíz
├── bootstrap/                           # Setup global (helmet, swagger, pipes…)
├── common/                              # Cross-cutting (filters, interceptors, decorators)
├── config/                              # Zod-validated config
└── modules/
    └── <bounded-context>/               # p. ej. billing, identity, catalog
        ├── domain/                      # ❌ sin imports de @nestjs/*
        │   ├── <aggregate>.entity.ts
        │   ├── <value-object>.vo.ts
        │   ├── events/<event-name>.event.ts
        │   ├── ports/<repo-name>.repository.ts   # interface (driven port)
        │   ├── services/<service>.domain-service.ts
        │   └── errors/<error>.error.ts
        ├── application/                 # ✅ @Injectable, sin TypeORM/HTTP
        │   ├── ports/<port>.port.ts             # driver/driven ports adicionales
        │   ├── commands/<use-case>.command.ts
        │   ├── queries/<use-case>.query.ts
        │   ├── handlers/<use-case>.handler.ts   # caso de uso
        │   └── dto/<dto>.dto.ts
        ├── infrastructure/              # ✅ adapters
        │   ├── persistence/<repo>.<orm>.repository.ts
        │   ├── http/<resource>.controller.ts    # driver adapter
        │   ├── messaging/<event>.subscriber.ts
        │   └── mappers/<entity>.mapper.ts
        └── <context>.module.ts          # cablea todo con tokens
```

**Reglas:**

- `domain/` no importa nada de `@nestjs/*`, `typeorm`, `prisma`, `axios`, `class-validator` decorators, ni `pino`. Solo TS estándar y otros archivos de `domain/`.
- `application/` puede usar `@nestjs/common` (decoradores DI), pero **no** ORMs ni clientes HTTP.
- `infrastructure/` es la única capa que toca librerías externas.
- Controllers viven en `infrastructure/http/` (son driver adapters), no en una carpeta paralela.

## 2. Tokens de inyección para puertos (obligatorio)

NestJS no puede inyectar interfaces TS (se borran en compilación). Cada puerto declara una constante `Symbol` exportada y los providers se cablean por token.

```ts
// src/modules/billing/domain/ports/invoice.repository.ts
import type { Invoice } from '../invoice.entity';
import type { InvoiceId } from '../invoice-id.vo';

export const INVOICE_REPOSITORY = Symbol('INVOICE_REPOSITORY');

export type InvoiceRepository = {
  findById(id: InvoiceId): Promise<Invoice | null>;
  save(invoice: Invoice): Promise<void>;
};
```

```ts
// src/modules/billing/application/handlers/issue-invoice.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { INVOICE_REPOSITORY, type InvoiceRepository } from '../../domain/ports/invoice.repository';

@Injectable()
export class IssueInvoiceHandler {
  constructor(
    @Inject(INVOICE_REPOSITORY)
    private readonly invoices: InvoiceRepository,
  ) {}
  // ...
}
```

```ts
// src/modules/billing/billing.module.ts
import { Module } from '@nestjs/common';
import { INVOICE_REPOSITORY } from './domain/ports/invoice.repository';
import { TypeOrmInvoiceRepository } from './infrastructure/persistence/invoice.typeorm.repository';
import { IssueInvoiceHandler } from './application/handlers/issue-invoice.handler';
import { InvoicesController } from './infrastructure/http/invoices.controller';

@Module({
  controllers: [InvoicesController],
  providers: [
    IssueInvoiceHandler,
    { provide: INVOICE_REPOSITORY, useClass: TypeOrmInvoiceRepository },
  ],
  exports: [IssueInvoiceHandler],
})
export class BillingModule {}
```

**Convención de nombres:**

- Token: `SCREAMING_SNAKE_CASE` con sufijo `_REPOSITORY`, `_PORT`, `_GATEWAY`.
- Archivo: `<name>.repository.ts` o `<name>.port.ts` con la interface y el token juntos.
- Adapter: `<adapter>.<technology>.repository.ts` (ej. `invoice.typeorm.repository.ts`).

## 3. Entidades y Value Objects en TS 6.0

Aprovecha `readonly` en propiedades, `private` constructors con factory, y narrowing por `branded types` cuando aporte. **Sin decoradores Nest dentro del dominio.**

```ts
// src/modules/billing/domain/money.vo.ts
export class Money {
  private constructor(
    readonly amount: number,
    readonly currency: 'USD' | 'EUR' | 'MXN',
  ) {}

  static of(amount: number, currency: Money['currency']): Money {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error('Money.amount must be a non-negative finite number');
    }
    return new Money(Math.round(amount * 100) / 100, currency);
  }

  add(other: Money): Money {
    if (other.currency !== this.currency) {
      throw new Error('Cannot add Money with different currencies');
    }
    return Money.of(this.amount + other.amount, this.currency);
  }

  equals(other: Money): boolean {
    return this.amount === other.amount && this.currency === other.currency;
  }
}
```

**Aggregate root** mantiene la lista de eventos pendientes y se mutan por métodos de dominio:

```ts
// src/modules/billing/domain/invoice.entity.ts
import { InvoiceIssued } from './events/invoice-issued.event';
import type { Money } from './money.vo';
import type { InvoiceId } from './invoice-id.vo';

export class Invoice {
  private readonly events: unknown[] = [];

  private constructor(
    readonly id: InvoiceId,
    private status: 'draft' | 'issued' | 'paid',
    private readonly total: Money,
  ) {}

  static draft(id: InvoiceId, total: Money): Invoice {
    return new Invoice(id, 'draft', total);
  }

  issue(now: Date): void {
    if (this.status !== 'draft') {
      throw new Error(`Invoice ${this.id.value} is not draft`);
    }
    this.status = 'issued';
    this.events.push(new InvoiceIssued(this.id, this.total, now));
  }

  pullEvents(): readonly unknown[] {
    return this.events.splice(0);
  }
}
```

## 4. Casos de uso (application layer)

Un caso de uso = un `@Injectable()` con un único método público (`execute` o `handle`). Recibe un Command/Query DTO y devuelve un Result tipado.

```ts
// src/modules/billing/application/commands/issue-invoice.command.ts
export class IssueInvoiceCommand {
  constructor(
    readonly invoiceId: string,
    readonly issuedAt: Date,
  ) {}
}
```

```ts
// src/modules/billing/application/handlers/issue-invoice.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { IssueInvoiceCommand } from '../commands/issue-invoice.command';
import { INVOICE_REPOSITORY, type InvoiceRepository } from '../../domain/ports/invoice.repository';
import { InvoiceId } from '../../domain/invoice-id.vo';
import { InvoiceNotFoundError } from '../../domain/errors/invoice-not-found.error';

@Injectable()
export class IssueInvoiceHandler {
  constructor(
    @Inject(INVOICE_REPOSITORY)
    private readonly invoices: InvoiceRepository,
  ) {}

  async execute(command: IssueInvoiceCommand): Promise<void> {
    const id = InvoiceId.from(command.invoiceId);
    const invoice = await this.invoices.findById(id);
    if (!invoice) throw new InvoiceNotFoundError(id);
    invoice.issue(command.issuedAt);
    await this.invoices.save(invoice);
  }
}
```

## 5. Driver adapters (HTTP)

Controllers son adapters. Validan entrada con `class-validator`/Zod, mapean al Command, llaman al handler, **nunca** tocan repositorios o entidades del dominio directamente.

```ts
// src/modules/billing/infrastructure/http/invoices.controller.ts
import { Body, Controller, Param, Post } from '@nestjs/common';
import { IssueInvoiceHandler } from '../../application/handlers/issue-invoice.handler';
import { IssueInvoiceCommand } from '../../application/commands/issue-invoice.command';
import { IssueInvoiceDto } from './dto/issue-invoice.dto';

@Controller({ path: 'invoices', version: '1' })
export class InvoicesController {
  constructor(private readonly issueInvoice: IssueInvoiceHandler) {}

  @Post(':id/issue')
  async issue(@Param('id') id: string, @Body() body: IssueInvoiceDto): Promise<void> {
    await this.issueInvoice.execute(new IssueInvoiceCommand(id, new Date(body.issuedAt)));
  }
}
```

## 6. Driven adapters (persistencia)

Implementa la interface del puerto. Mapper traduce entre la entidad de dominio y el modelo del ORM. **El dominio nunca conoce al ORM.**

```ts
// src/modules/billing/infrastructure/persistence/invoice.typeorm.repository.ts
import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import type { InvoiceRepository } from '../../domain/ports/invoice.repository';
import { InvoiceOrmEntity } from './invoice.orm-entity';
import { InvoiceMapper } from '../mappers/invoice.mapper';
import type { Invoice } from '../../domain/invoice.entity';
import type { InvoiceId } from '../../domain/invoice-id.vo';

@Injectable()
export class TypeOrmInvoiceRepository implements InvoiceRepository {
  constructor(
    @InjectRepository(InvoiceOrmEntity)
    private readonly repo: Repository<InvoiceOrmEntity>,
  ) {}

  async findById(id: InvoiceId): Promise<Invoice | null> {
    const row = await this.repo.findOne({ where: { id: id.value } });
    return row ? InvoiceMapper.toDomain(row) : null;
  }

  async save(invoice: Invoice): Promise<void> {
    await this.repo.save(InvoiceMapper.toPersistence(invoice));
  }
}
```

## 7. Eventos de dominio

Eventos viven en `domain/events/` como clases puras. Se publican desde un caso de uso usando `@nestjs/event-emitter` o un outbox; el dominio nunca dispara el bus directamente.

```ts
// src/modules/billing/domain/events/invoice-issued.event.ts
import type { InvoiceId } from '../invoice-id.vo';
import type { Money } from '../money.vo';

export class InvoiceIssued {
  static readonly NAME = 'billing.invoice.issued';
  constructor(
    readonly invoiceId: InvoiceId,
    readonly total: Money,
    readonly occurredAt: Date,
  ) {}
}
```

```ts
// dentro del handler, después de save:
const events = invoice.pullEvents();
for (const event of events) {
  await this.eventBus.publish(event); // EventBus es un puerto inyectado
}
```

## 8. Errores de dominio

Errores tipados en `domain/errors/`. La capa HTTP los traduce a `HttpException` mediante un `ExceptionFilter` global (no en el handler).

```ts
// src/modules/billing/domain/errors/invoice-not-found.error.ts
import type { InvoiceId } from '../invoice-id.vo';

export class InvoiceNotFoundError extends Error {
  static readonly CODE = 'INVOICE_NOT_FOUND';
  constructor(readonly id: InvoiceId) {
    super(`Invoice ${id.value} not found`);
    this.name = 'InvoiceNotFoundError';
  }
}
```

```ts
// src/common/filters/domain-exception.filter.ts (registrado global)
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    if (error instanceof InvoiceNotFoundError) {
      throw new NotFoundException({ code: InvoiceNotFoundError.CODE, message: error.message });
    }
    throw error;
  }
}
```

## 9. Tests por capa

| Capa           | Tipo               | Herramienta            | Qué prueba                                 |
| -------------- | ------------------ | ---------------------- | ------------------------------------------ |
| Domain         | Unitario puro      | Jest, sin mocks        | Invariantes de entidades y VOs             |
| Application    | Unitario con fakes | Jest + fakes in-memory | Casos de uso con repositorios fake         |
| Infrastructure | Integración        | Jest + DB efímera      | Adapters reales contra Postgres/Redis test |
| HTTP           | E2E                | Jest + Supertest       | Endpoint completo con módulo Nest          |

**Importante:** los tests de dominio no levantan `Test.createTestingModule`. Son `new Invoice(...)` puro.

**Convenciones de archivo y mocking** se rigen por el skill `javascript-typescript-jest`:

- Unit: `*.spec.ts` junto al SUT.
- E2E: `src/modules/<context>/__tests__/<context>.e2e-spec.ts` con `@test/helpers/create-test-app`.
- Domain: cero mocks. Si el test parece necesitar uno, el diseño leakea infra al dominio.
- Application: fakes hand-written de los puertos (no `jest.mock` contra rutas de módulo).
- Infrastructure: dobles realistas (DB efímera, `nock`/`msw-node`); no `jest.mock('typeorm')`.
- AAA explícito (`// Arrange / // Act / // Assert`) y nombres `debería…` son obligatorios.

**Property-based testing (PBT) con `fast-check` + `@fast-check/jest`** — los invariantes de dominio (Money no negativo, Invoice solo issue desde draft, sort idempotente) son el caso ideal: agregar `it.prop([arbs])('debería siempre …')` junto a los tests example-based. Ver subsección "Property-based testing" del skill `javascript-typescript-jest` para sintaxis, arbitraries guidelines y `fc.scheduler()` en handlers race-prone.

## 10. Composición y multi-tenant

- Cada bounded context exporta su `Module` y los handlers que otros contextos consumen.
- Para multi-tenant request-scoped, usar `Scope.REQUEST` con **durable providers** (regla `di-durable-providers` del skill nestjs-best-practices).
- El root `AppModule` solo importa los módulos de contexto y la configuración global; no contiene lógica.

## 11. Checklist al diseñar un nuevo módulo

- [ ] Defino el aggregate root y sus VOs antes de pensar en endpoints
- [ ] Cada puerto tiene token (Symbol) + interface en `domain/ports/`
- [ ] El caso de uso es `@Injectable()` con un único método público y un Command/Query
- [ ] El controller solo construye Command y llama al handler
- [ ] El repository adapter implementa la interface y vive en `infrastructure/persistence/`
- [ ] Errores de dominio son clases tipadas, traducidas por filtro global
- [ ] Tests de dominio son puros (sin TestingModule)
- [ ] Ningún archivo de `domain/` importa de `@nestjs/*` ni de `infrastructure/`
