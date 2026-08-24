# Base común de dominio y de transporte — Implementation Plan

> **For agentic workers:** Use the `subagent-driven-development` skill (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Never run `git commit` or `git push` without explicit user instruction** — at most, suggest a commit and wait.

**Goal:** Factorizar en `src/shared/domain/` y `src/common/` las cinco piezas hoy duplicadas o ausentes (`DomainError`, `UuidId`, `Entity`, `DomainExceptionFilter`, helpers de ejemplos OpenAPI), de modo que un bounded context nuevo herede la forma correcta sin copiar nada.

**Bounded context:** ninguno nuevo. Toca los tres existentes (`users`, `auth`, `orders`) más las carpetas transversales `shared/domain` y `common`.

**Architecture:** Se introducen tres clases base de dominio puro —`DomainError` (raíz de los errores de negocio), `UuidId` (identidad UUID v4 sobre `ValueObject<string>`) y `Entity<TId extends UuidId>` (identidad, `createdAt`/`updatedAt`, `touch(now)` e igualdad con comprobación de clase)—, y `AggregateRoot` pasa a extender `Entity`, ganando un segundo parámetro de tipo. En infraestructura HTTP se añade `DomainExceptionFilter`, base abstracta que recorre un mapa `[ErrorClass, → HttpException]` que cada módulo declara. No se crean ni modifican puertos ni casos de uso.

**Tech stack:** NestJS 11, TypeScript 6.0, Node 24, pnpm 11, SWC, Jest 30, Supertest, TypeORM, PostgreSQL 18, fast-check 4.

**Rule codes touched:** `arch-single-responsibility`, `arch-module-sharing`, `arch-avoid-circular-deps`, `di-liskov-substitution`, `di-interface-segregation`, `error-use-exception-filters`, `error-throw-http-exceptions`, `security-sanitize-output`, `security-validate-all-input`.

**Spec:** [`docs/specs/2026-08-22-shared-kernel-and-http-base-design.md`](../specs/2026-08-22-shared-kernel-and-http-base-design.md)

---

## Estructura de archivos

### Se crean

| Archivo                                                     | Capa           | Responsabilidad                                             |
| ----------------------------------------------------------- | -------------- | ----------------------------------------------------------- |
| `src/shared/domain/domain-error.base.ts`                    | domain         | Raíz de todo error de negocio                               |
| `src/shared/domain/uuid-id.base.ts`                         | domain         | Identidad UUID v4; valida y delega el error                 |
| `src/shared/domain/entity.base.ts`                          | domain         | Identidad, vigencia e igualdad de una entidad               |
| `src/modules/auth/domain/value-objects/credential-id.vo.ts` | domain         | Identidad de `Credential`                                   |
| `src/common/http/domain-exception.filter.ts`                | common         | Recorre el mapa error de dominio → `HttpException`          |
| `src/common/dto/openapi-example.helpers.ts`                 | common         | `requestMeta` y `errorExample` para los ejemplos de OpenAPI |
| `src/database/migrations/<ts>-add-timestamps-to-orders.ts`  | infrastructure | Añade `created_at` / `updated_at` a `orders`                |

### Tests que se crean

| Archivo                                                                    |
| -------------------------------------------------------------------------- |
| `src/shared/__tests__/domain/domain-error.base.spec.ts`                    |
| `src/shared/__tests__/domain/uuid-id.base.spec.ts`                         |
| `src/shared/__tests__/domain/entity.base.spec.ts`                          |
| `src/modules/auth/__tests__/domain/value-objects/credential-id.vo.spec.ts` |
| `src/common/__tests__/http/domain-exception.filter.spec.ts`                |
| `src/database/__tests__/add-timestamps-to-orders.e2e-spec.ts`              |

### Se modifican

| Archivo                                                                            | Capa           | Cambio                                                         |
| ---------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------- |
| `src/shared/domain/aggregate-root.ts`                                              | domain         | `extends Entity<TId>`, pasa a dos parámetros de tipo           |
| `src/shared/__tests__/domain/aggregate-root.spec.ts`                               | test           | Doble sintético adaptado a la firma nueva                      |
| `src/modules/{users,auth,orders}/domain/errors/*.errors.ts`                        | domain         | El marcador hereda de `DomainError`                            |
| `src/modules/users/domain/value-objects/user-id.vo.ts`                             | domain         | `extends UuidId`; borra su `UUID_V4`                           |
| `src/modules/orders/domain/value-objects/order-id.vo.ts`                           | domain         | Idem                                                           |
| `src/modules/users/domain/entities/user.entity.ts`                                 | domain         | `extends Entity<UserId>`; mutadores usan `touch(now)`          |
| `src/modules/auth/domain/entities/credential.entity.ts`                            | domain         | `extends Entity<CredentialId>`                                 |
| `src/modules/orders/domain/entities/order.entity.ts`                               | domain         | `extends AggregateRoot<OrderId, OrderPlaced>`; gana timestamps |
| `src/modules/auth/infrastructure/persistence/credential.mapper.ts`                 | infrastructure | `CredentialId.from(row.id)`                                    |
| `src/modules/orders/infrastructure/persistence/order.mapper.ts`                    | infrastructure | Mapea las dos columnas nuevas                                  |
| `src/modules/orders/infrastructure/persistence/order.orm-entity.ts`                | infrastructure | Dos columnas + comentario reescrito                            |
| `src/modules/{users,auth,orders}/infrastructure/http/*-domain-exception.filter.ts` | infrastructure | Solo declaran su mapa                                          |
| `src/modules/{users,auth,orders}/infrastructure/http/*.controller.ts`              | infrastructure | Importan los helpers; borran las copias locales                |
| `src/common/dto/error-example.factory.ts`                                          | common         | Exporta `TIMESTAMP` y `REQUEST_ID`                             |
| `src/common/dto/api-envelope.dto.ts`, `error-response.dto.ts`                      | common         | Usan las constantes exportadas                                 |
| `src/modules/health/health.controller.ts`                                          | infrastructure | Idem                                                           |

### Regla de dependencias — verificada contra la matriz vigente

- `shared/domain/*` no importa `@nestjs/*`, `typeorm`, `pino`, `class-validator`, `axios` ni `argon2`. `UuidId` **delega el error por callback** justo para no importar de `modules/`.
- `common/*` importa `@nestjs/common` y `@nestjs/swagger` — permitido; su única prohibición de externals es `typeorm`.
- `module-domain → shared-domain` y `module-infrastructure → common`: ya permitidas. **Cero ediciones a `eslint.boundaries.js`.**

---

## Task 1: `DomainError` base

**Layer:** domain
**Rule codes to honor:** `arch-single-responsibility`, `arch-avoid-circular-deps`

**Casos acordados** (Tabla A):

| #   | Caso (se vuelve el `it`)                                                     | Entrada / estado inicial      | Resultado esperado                    |
| --- | ---------------------------------------------------------------------------- | ----------------------------- | ------------------------------------- |
| A1  | debería exponer como `name` el nombre de la clase concreta, no el de la base | `new ConcreteError('x')`      | `name === 'ConcreteError'`            |
| A2  | debería conservar el mensaje recibido                                        | `new ConcreteError('texto')`  | `message === 'texto'`                 |
| A3  | debería ser instancia de su marcador de módulo y de `DomainError`            | `new ConcreteError('x')`      | ambos `instanceof` en `true`          |
| A4  | debería no ser capturado por el marcador de otro módulo                      | `new OtherConcreteError('x')` | `instanceof MarkerA` en `false`       |
| A5  | debería seguir siendo un `Error` nativo con `stack`                          | `new ConcreteError('x')`      | `instanceof Error` y `stack` definido |

**Files:**

- Create: `src/shared/domain/domain-error.base.ts`
- Test: `src/shared/__tests__/domain/domain-error.base.spec.ts`

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/shared/__tests__/domain/domain-error.base.spec.ts
import { DomainError } from '../../domain/domain-error.base';

describe('DomainError', () => {
  describe('name', () => {
    it('debería exponer como name el nombre de la clase concreta, no el de la base', () => {
      // Arrange + Act
      const error = new ConcreteError('cualquier cosa');

      // Assert
      expect(error.name).toBe('ConcreteError');
    });
  });

  describe('message', () => {
    it('debería conservar el mensaje recibido', () => {
      // Arrange + Act
      const error = new ConcreteError('texto exacto');

      // Assert
      expect(error.message).toBe('texto exacto');
    });
  });

  describe('instanceof', () => {
    it('debería ser instancia de su marcador de módulo y de DomainError', () => {
      // Arrange + Act
      const error = new ConcreteError('x');

      // Assert
      expect(error).toBeInstanceOf(MarkerA);
      expect(error).toBeInstanceOf(DomainError);
    });

    it('debería no ser capturado por el marcador de otro módulo', () => {
      // Arrange + Act
      const error = new OtherConcreteError('x');

      // Assert
      expect(error).toBeInstanceOf(MarkerB);
      expect(error).not.toBeInstanceOf(MarkerA);
    });

    it('debería seguir siendo un Error nativo con stack', () => {
      // Arrange + Act
      const error = new ConcreteError('x');

      // Assert
      expect(error).toBeInstanceOf(Error);
      expect(error.stack).toBeDefined();
    });
  });
});

// Helpers
//
// Dos marcadores sintéticos, no los reales de `users` y `auth`, porque lo que A4 afirma —que
// compartir abuelo NO ensancha el `instanceof`— es una propiedad de la jerarquía y no de
// ningún módulo concreto: con los errores reales, el test se rompería el día que `users`
// reorganice los suyos por razones que nada tienen que ver con el kernel.
//
// El motivo NO es el gate de fronteras: `eslint.boundaries.js` lleva
// `'boundaries/ignore': ['src/**/__tests__/**', …]`, así que este archivo podría importar de
// `modules/` sin violar ninguna regla. La restricción real vive en el CÓDIGO de producción
// del kernel, no en su spec.

abstract class MarkerA extends DomainError {}
abstract class MarkerB extends DomainError {}

class ConcreteError extends MarkerA {
  constructor(message: string) {
    super(message);
  }
}

class OtherConcreteError extends MarkerB {
  constructor(message: string) {
    super(message);
  }
}
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/shared/__tests__/domain/domain-error.base.spec.ts`
Expected: FAIL — `Cannot find module '../../domain/domain-error.base'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/shared/domain/domain-error.base.ts
/**
 * Raíz de los errores de negocio de TODOS los contextos. Son de dominio, no de transporte:
 * no heredan de `HttpException` ni conocen códigos HTTP — traducirlos es tarea del filtro
 * del módulo, en `infrastructure/http/`.
 *
 * Cada contexto declara su propio marcador abstracto (`UserDomainError`,
 * `AuthDomainError`, `OrderDomainError`) que hereda de aquí. Compartir abuelo NO ensancha
 * el `instanceof`: `@Catch(UserDomainError)` sigue sin ver un error de `auth`, porque los
 * marcadores siguen siendo clases distintas. Es el caso A4 de la tabla, y está probado.
 *
 * `new.target.name` y no `this.constructor.name`: es la clase invocada con `new`, así que
 * devuelve el nombre CONCRETO por muchos niveles que tenga la cadena. `name` viaja a los
 * logs, y ahí lo útil es `EmailAlreadyTakenError`, no `DomainError`.
 */
export abstract class DomainError extends Error {
  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/shared/__tests__/domain/domain-error.base.spec.ts`
Expected: PASS — 5 passed

---

## Task 2: Los tres marcadores de módulo heredan de `DomainError`

**Layer:** domain
**Rule codes to honor:** `arch-module-sharing`, `di-liskov-substitution`

**Casos acordados:** ninguna tabla propia. Es un refactor sin lógica nueva: A3 y A4 de la Tabla A fijan el contrato de la jerarquía, y los specs existentes de los tres módulos son la red que detecta cualquier cambio de comportamiento. Si alguno se pone rojo, el refactor alteró algo y hay que consultar antes de tocar su aserción.

**Files:**

- Modify: `src/modules/users/domain/errors/user.errors.ts`
- Modify: `src/modules/auth/domain/errors/auth.errors.ts`
- Modify: `src/modules/orders/domain/errors/order.errors.ts`

- [ ] **Step 1: Sustituye el cuerpo del marcador de `users`**

Reemplaza **solo** el bloque del marcador; las clases concretas de debajo no se tocan.

```ts
// src/modules/users/domain/errors/user.errors.ts  (cabecera del archivo)
import { DomainError } from '@shared/domain/domain-error.base';

/**
 * Errores de dominio: son de negocio, no de transporte. No heredan de `HttpException`
 * ni conocen códigos HTTP — traducirlos a una respuesta es tarea del adaptador HTTP.
 *
 * El cuerpo (constructor + `new.target.name`) vive en `DomainError`, en el kernel: estaba
 * duplicado carácter por carácter en los tres contextos. Lo que este marcador aporta es la
 * IDENTIDAD del contexto, que es lo que `@Catch(UserDomainError)` discrimina.
 */
export abstract class UserDomainError extends DomainError {}
```

- [ ] **Step 2: Haz lo mismo en `auth`**

```ts
// src/modules/auth/domain/errors/auth.errors.ts  (cabecera del archivo)
import { DomainError } from '@shared/domain/domain-error.base';

/**
 * Errores de dominio de `auth`: de negocio, no de transporte. Traducirlos es tarea de
 * `infrastructure/http/auth-domain-exception.filter.ts`. Mismo contrato que `user.errors.ts`
 * y `order.errors.ts` — el cuerpo compartido está en `DomainError`.
 *
 * `InvalidCredentialsError` e `InvalidPasswordHashError` VIVÍAN en `users`: se mudaron aquí
 * con la credencial. `users` ya no sabe qué es una contraseña, así que tampoco puede tener
 * los errores que hablan de ella.
 */
export abstract class AuthDomainError extends DomainError {}
```

- [ ] **Step 3: Haz lo mismo en `orders`**

```ts
// src/modules/orders/domain/errors/order.errors.ts  (cabecera del archivo)
import { DomainError } from '@shared/domain/domain-error.base';

/**
 * Errores de dominio de orders: de negocio, no de transporte. Traducirlos a HTTP es tarea
 * de `infrastructure/http/orders-domain-exception.filter.ts` — mismo contrato que
 * `user.errors.ts`. El cuerpo compartido está en `DomainError`.
 */
export abstract class OrderDomainError extends DomainError {}
```

- [ ] **Step 4: Ejecuta las suites de los tres módulos**

Run: `pnpm test src/modules src/shared`
Expected: PASS — todo verde **sin haber tocado ninguna aserción**. Presta atención especial a `user-domain-exception.filter.spec.ts`, `auth-domain-exception.filter.spec.ts` y `orders-domain-exception.filter.spec.ts`: son los que romperían si el `instanceof` se hubiera ensanchado.

- [ ] **Step 5: Verifica que la duplicación desapareció**

Run: `grep -rn "extends Error" src/modules/*/domain/errors/*.ts`
Expected: sin resultados — los tres marcadores heredan ahora de `DomainError`.

---

## Task 3: `UuidId` base

**Layer:** domain
**Rule codes to honor:** `arch-single-responsibility`, `arch-avoid-circular-deps`, `security-validate-all-input`

**Casos acordados** (Tabla B, filas del kernel):

| #      | Caso (se vuelve el `it`)                                          | Entrada / estado inicial                  | Resultado esperado            |
| ------ | ----------------------------------------------------------------- | ----------------------------------------- | ----------------------------- |
| B1     | debería aceptar un UUID v4 bien formado y conservar el valor      | uuid v4 válido                            | `id.value === value`          |
| B2     | debería lanzar el error que le pasa el llamante, no uno genérico  | `'no-soy-uuid'` + fábrica de error propia | lanza esa instancia concreta  |
| B3     | debería rechazar un UUID de otra versión                          | uuid v1                                   | lanza el error del llamante   |
| B4     | debería aceptar indistintamente mayúsculas y minúsculas           | uuid v4 en mayúsculas                     | no lanza                      |
| B5     | debería distinguir ids de clases distintas con el mismo valor     | dos subclases sintéticas, mismo uuid      | `equals` → `false`            |
| **B6** | debería rechazar un valor que solo CONTIENE un UUID válido        | `'x' + uuid` y `uuid + 'x'`               | lanza el error del llamante   |
| P1     | debería aceptar cualquier UUID v4 _(propiedad)_                   | `fc.uuid({ version: 4 })`                 | nunca lanza; `value` idéntico |
| P2     | debería rechazar cualquier cadena sin forma de UUID _(propiedad)_ | `fc.string()` filtrado                    | lanza el error del llamante   |

⚠️ **B6 se añadió por confirmación JIT durante el Lote 2, no estaba en la tabla original.** El
implementer detectó que Stryker dejaba **dos mutantes vivos** en `uuid-id.base.ts` —quitar el
`^` y quitar el `$` del regex— y, correctamente, lo consultó en vez de añadir el caso en
silencio. Medido antes de decidir: sin `^`, `'DROP TABLE users;<uuid>'` pasa la validación;
sin `$`, `'<uuid>-mas-cosas'` pasa. El regex actual está bien anclado, pero **nada lo
probaba**, y por ahí entran los ids que llegan por HTTP a `UserId.from()`.

⚠️ **B6 nace VERDE, no rojo**, porque el anclaje ya existe. Su ciclo TDD es el inverso: se
verifica **rompiendo el anclaje** y comprobando que el test cae. Sin esa comprobación, B6 no
sería más que decoración.

**Files:**

- Create: `src/shared/domain/uuid-id.base.ts`
- Test: `src/shared/__tests__/domain/uuid-id.base.spec.ts`

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/shared/__tests__/domain/uuid-id.base.spec.ts
import fc from 'fast-check';

import { UuidId } from '../../domain/uuid-id.base';

describe('UuidId', () => {
  describe('assertUuid()', () => {
    it('debería aceptar un UUID v4 bien formado y conservar el valor', () => {
      // Arrange
      const value = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';

      // Act
      const id = SampleId.from(value);

      // Assert
      expect(id.value).toBe(value);
    });

    it('debería lanzar el error que le pasa el llamante, no uno genérico', () => {
      // Arrange
      const value = 'no-soy-uuid';

      // Act + Assert
      expect(() => SampleId.from(value)).toThrow(SampleIdError);
    });

    it('debería rechazar un UUID de otra versión', () => {
      // Arrange — UUID v1: el dígito de versión es `1`, no `4`.
      const value = '2c5ea4c0-4067-11e9-8bad-9b1deb4d3b7d';

      // Act + Assert
      expect(() => SampleId.from(value)).toThrow(SampleIdError);
    });

    it('debería aceptar indistintamente mayúsculas y minúsculas', () => {
      // Arrange
      const value = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012'.toUpperCase();

      // Act + Assert
      expect(() => SampleId.from(value)).not.toThrow();
    });
  });

  describe('equals()', () => {
    it('debería distinguir ids de clases distintas con el mismo valor', () => {
      // Arrange
      const value = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
      const one = SampleId.from(value);
      const another = OtherSampleId.from(value);

      // Act
      const result = one.equals(another);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('assertUuid() (property-based)', () => {
    it('debería aceptar cualquier UUID v4 bien formado', () => {
      fc.assert(
        fc.property(fc.uuid({ version: 4 }), (value) => {
          // Act
          const id = SampleId.from(value);

          // Assert
          expect(id.value).toBe(value);
        }),
      );
    });

    it('debería rechazar cualquier cadena que no tenga la forma de un UUID', () => {
      fc.assert(
        fc.property(
          fc.string().filter((value) => !/^[0-9a-f-]{36}$/i.test(value)),
          (value) => {
            // Act + Assert
            expect(() => SampleId.from(value)).toThrow(SampleIdError);
          },
        ),
      );
    });
  });
});

// Helpers
//
// Subclases sintéticas y un error propio: el CÓDIGO del kernel no conoce
// `InvalidUserIdError` —vive en un módulo— y por eso `assertUuid` recibe la fábrica del
// error. Usar aquí `UserId` real probaría la composición de `users`, no el contrato del
// kernel, y ataría este spec a decisiones de otro contexto.
//
// El gate de fronteras no entra en esto: `boundaries/ignore` excluye `src/**/__tests__/**`,
// así que importar de `modules/` desde un spec es legal. La razón es de diseño del test.

class SampleIdError extends Error {}

class SampleId extends UuidId {
  static from(value: string): SampleId {
    return new SampleId(UuidId.assertUuid(value, () => new SampleIdError()));
  }
}

class OtherSampleId extends UuidId {
  static from(value: string): OtherSampleId {
    return new OtherSampleId(UuidId.assertUuid(value, () => new SampleIdError()));
  }
}
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/shared/__tests__/domain/uuid-id.base.spec.ts`
Expected: FAIL — `Cannot find module '../../domain/uuid-id.base'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/shared/domain/uuid-id.base.ts
import { ValueObject } from './value-object.base';

/**
 * UUID v4 estricto: exige el dígito de versión `4` y la variante RFC 4122 (`8`, `9`, `a` o
 * `b`). Es la misma expresión que vivía DUPLICADA byte a byte en `user-id.vo.ts` y
 * `order-id.vo.ts`.
 */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Base de los identificadores de agregado. Aporta el formato; NO aporta el error, porque el
 * kernel no puede conocer `InvalidUserIdError` ni `InvalidOrderIdError` —viven en un módulo
 * y `shared-domain` no importa de `modules/`—. Por eso `assertUuid` recibe una FÁBRICA de
 * error: quien llama decide qué se lanza, y así el id inválido de un cliente sigue siendo un
 * 400 de su contexto y no un 500 genérico.
 *
 * Es una fábrica y no la clase del error (`assertUuid(value, InvalidUserIdError)`) porque eso
 * NO compila: una clase como valor tiene firma de construcción, no de llamada, y tiparla como
 * `new (value: string) => Error` fijaría la forma del constructor a exactamente ese parámetro.
 * Hay contraejemplos vivos en `auth.errors.ts`: `InvalidCredentialsError` no recibe ninguno e
 * `InvalidProfileError` recibe un mensaje, no el valor. La arrow es necesaria, no ceremonia.
 *
 * La validación va en una factoría estática y no en el constructor por dos razones, y ninguna
 * es la que decía la primera versión de este comentario —«habría que ejecutar sentencias antes
 * de `super()`, legal solo bajo condiciones sutiles»—, que es **falsa**: medido compilando con
 * el `tsc` del proyecto en seis variantes (con y sin parameter properties, con fields
 * inicializados, con private identifiers, bajo ES2017 y ES2023), TypeScript acepta cualquier
 * sentencia antes de `super()`. Lo único que prohíbe es tocar `this` o `super` antes de la
 * llamada (TS17009), y eso sería un error en cualquier caso. Las razones reales:
 *   1. El constructor tendría que aceptar la fábrica como parámetro, y `generate()` —que no
 *      puede fallar, porque acuña el UUID él mismo— quedaría obligado a inventarse una
 *      fábrica de error que no se dispara nunca.
 *   2. Un estático se invoca desde donde convenga sin arrastrar la cadena de `super()`.
 *
 * `equals()` y `toString()` los pone `ValueObject`, con su comprobación de clase incluida:
 * dos ids de agregados distintos con el mismo UUID no son iguales.
 */
export abstract class UuidId extends ValueObject<string> {
  protected static assertUuid(value: string, invalid: (value: string) => Error): string {
    if (!UUID_V4.test(value)) {
      throw invalid(value);
    }
    return value;
  }
}
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/shared/__tests__/domain/uuid-id.base.spec.ts`
Expected: PASS — 7 passed

---

## Task 4: `UserId` y `OrderId` heredan de `UuidId`

**Layer:** domain
**Rule codes to honor:** `arch-module-sharing`, `di-liskov-substitution`

**Casos acordados:** ninguna tabla propia. Refactor sin lógica nueva; `user-id.vo.spec.ts` y `order-id.vo.spec.ts` ya cubren generación, validación e igualdad, y deben seguir verdes sin tocar aserciones.

**Files:**

- Modify: `src/modules/users/domain/value-objects/user-id.vo.ts`
- Modify: `src/modules/orders/domain/value-objects/order-id.vo.ts`

- [ ] **Step 1: Reescribe `user-id.vo.ts` completo**

```ts
// src/modules/users/domain/value-objects/user-id.vo.ts
import { randomUUID } from 'node:crypto';

import { UuidId } from '@shared/domain/uuid-id.base';

import { InvalidUserIdError } from '../errors/user.errors';

/**
 * Identidad del agregado. Es un value object para que un `string` cualquiera no pueda pasar
 * por un id de usuario: el tipo obliga a construirlo por `from()` o `generate()`.
 *
 * El formato lo valida `UuidId`; el ERROR lo pone este archivo. Esa división es el motivo
 * de que `assertUuid` reciba una fábrica: el kernel no puede importar `InvalidUserIdError`.
 */
export class UserId extends UuidId {
  static generate(): UserId {
    return new UserId(randomUUID());
  }

  static from(value: string): UserId {
    return new UserId(UuidId.assertUuid(value, (invalid) => new InvalidUserIdError(invalid)));
  }
}
```

- [ ] **Step 2: Reescribe `order-id.vo.ts` completo**

```ts
// src/modules/orders/domain/value-objects/order-id.vo.ts
import { randomUUID } from 'node:crypto';

import { UuidId } from '@shared/domain/uuid-id.base';

import { InvalidOrderIdError } from '../errors/order.errors';

/**
 * Identidad del agregado, patrón de `user-id.vo.ts`. `equals()` y `toString()` vienen de
 * `ValueObject`; el formato, de `UuidId`. Aquí solo queda lo que de verdad es de este
 * contexto: qué error se lanza cuando el id no vale.
 */
export class OrderId extends UuidId {
  static generate(): OrderId {
    return new OrderId(randomUUID());
  }

  static from(value: string): OrderId {
    return new OrderId(UuidId.assertUuid(value, (invalid) => new InvalidOrderIdError(invalid)));
  }
}
```

- [ ] **Step 3: Ejecuta los specs de ambos VOs**

Run: `pnpm test user-id.vo order-id.vo`
Expected: PASS — verdes **sin cambios en las aserciones**. El bloque property-based de `user-id.vo.spec.ts` sigue comprobando la especificación del UUID v4 contra `fc.uuid({ version: 4 })`, que es una fuente de verdad independiente de la regex.

- [ ] **Step 4: Verifica que el regex duplicado desapareció**

Run: `grep -rn "const UUID_V4" src/`
Expected: **exactamente una** línea, en `src/shared/domain/uuid-id.base.ts`.

---

## Task 5: `CredentialId`

**Layer:** domain
**Rule codes to honor:** `arch-single-responsibility`, `security-validate-all-input`

**Casos acordados** (Tabla B aplicada a `auth`):

| #   | Caso (se vuelve el `it`)                                   | Entrada / estado inicial  | Resultado esperado                      |
| --- | ---------------------------------------------------------- | ------------------------- | --------------------------------------- |
| 1   | debería producir un UUID de versión 4 y variante RFC 4122  | `CredentialId.generate()` | dígito 15 es `4`; dígito 20 en `[89ab]` |
| 2   | debería producir un identificador distinto en cada llamada | dos `generate()`          | valores distintos                       |
| 3   | debería aceptar un UUID v4 bien formado                    | uuid v4 válido            | `value` idéntico al de entrada          |
| 4   | debería rechazar una cadena que no es un UUID              | `'no-soy-uuid'`           | lanza `InvalidCredentialIdError`        |
| P1  | debería aceptar cualquier UUID v4 _(propiedad)_            | `fc.uuid({ version: 4 })` | nunca lanza; round-trip estable         |

**Files:**

- Create: `src/modules/auth/domain/value-objects/credential-id.vo.ts`
- Modify: `src/modules/auth/domain/errors/auth.errors.ts` (añade `InvalidCredentialIdError`)
- Test: `src/modules/auth/__tests__/domain/value-objects/credential-id.vo.spec.ts`

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/modules/auth/__tests__/domain/value-objects/credential-id.vo.spec.ts
import fc from 'fast-check';

import { CredentialId } from '../../../domain/value-objects/credential-id.vo';
import { InvalidCredentialIdError } from '../../../domain/errors/auth.errors';

describe('CredentialId', () => {
  describe('generate()', () => {
    // La aserción va contra la especificación del UUID v4, no contra `from()`: comprobarlo
    // con la misma regex que usa el kernel sería probar la regex contra sí misma.
    it('debería producir un UUID de versión 4 y variante RFC 4122', () => {
      // Arrange + Act
      const id = CredentialId.generate();

      // Assert
      expect(id.value[14]).toBe('4');
      expect('89ab').toContain(id.value[19]);
    });

    it('debería producir un identificador distinto en cada llamada', () => {
      // Arrange + Act
      const one = CredentialId.generate();
      const another = CredentialId.generate();

      // Assert
      expect(one.value).not.toBe(another.value);
    });
  });

  describe('from()', () => {
    it('debería aceptar un UUID v4 bien formado', () => {
      // Arrange
      const value = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

      // Act
      const id = CredentialId.from(value);

      // Assert
      expect(id.value).toBe(value);
    });

    it('debería rechazar una cadena que no es un UUID', () => {
      // Arrange
      const value = 'no-soy-uuid';

      // Act + Assert
      expect(() => CredentialId.from(value)).toThrow(InvalidCredentialIdError);
    });
  });

  describe('from() (property-based)', () => {
    it('debería aceptar cualquier UUID v4 bien formado', () => {
      fc.assert(
        fc.property(fc.uuid({ version: 4 }), (value) => {
          // Act
          const id = CredentialId.from(value);

          // Assert
          expect(id.value).toBe(value);
        }),
      );
    });
  });
});
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test credential-id.vo`
Expected: FAIL — `Cannot find module '../../../domain/value-objects/credential-id.vo'`

- [ ] **Step 3: Añade el error de dominio**

Añade al final de `src/modules/auth/domain/errors/auth.errors.ts`:

```ts
/**
 * El id de una credencial no tiene forma de UUID. A diferencia de los demás errores de este
 * archivo, no lo puede provocar un cliente: la credencial acuña su id y la única otra vía es
 * `CredentialMapper.toDomain`, es decir una fila manipulada a mano. Cae en el fallback 400
 * del filtro sin rama propia, y eso es correcto: no hay contrato publicado que lo mencione.
 */
export class InvalidCredentialIdError extends AuthDomainError {
  constructor(readonly value: string) {
    super(`"${value}" is not a valid credential id`);
  }
}
```

- [ ] **Step 4: Escribe la implementación mínima**

```ts
// src/modules/auth/domain/value-objects/credential-id.vo.ts
import { randomUUID } from 'node:crypto';

import { UuidId } from '@shared/domain/uuid-id.base';

import { InvalidCredentialIdError } from '../errors/auth.errors';

/**
 * Identidad del agregado `Credential`. Hasta este ciclo era un `string` crudo; pasa a value
 * object porque `Entity` exige un id comparable, y porque la uniformidad entre contextos era
 * el objetivo del cambio.
 *
 * NO cambia el esquema: la columna sigue siendo `uuid` y `CredentialSnapshot.id` sigue
 * siendo `string`. Lo que gana un tipo es el dominio, no la tabla.
 *
 * Ojo con no confundirlo con `userId`, que sigue siendo un `string` a propósito: pertenece a
 * `users` y copiar aquí su `UserId` duplicaría una invariante ajena.
 */
export class CredentialId extends UuidId {
  static generate(): CredentialId {
    return new CredentialId(randomUUID());
  }

  static from(value: string): CredentialId {
    return new CredentialId(
      UuidId.assertUuid(value, (invalid) => new InvalidCredentialIdError(invalid)),
    );
  }
}
```

- [ ] **Step 5: Ejecuta el test para verificar que pasa**

Run: `pnpm test credential-id.vo`
Expected: PASS — 5 passed

---

## Task 6: `Entity` base

**Layer:** domain
**Rule codes to honor:** `arch-single-responsibility`, `di-liskov-substitution`

**Casos acordados** (Tabla C):

| #       | Caso (se vuelve el `it`)                                                       | Entrada / estado inicial                                      | Resultado esperado                   |
| ------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------ |
| C1      | debería exponer el id, createdAt y updatedAt recibidos                         | entidad sintética                                             | los tres coinciden                   |
| C2      | debería considerar iguales dos instancias de la misma clase con el mismo id    | mismo id, contenido distinto                                  | `equals` → `true`                    |
| C3      | debería considerar distintas dos instancias con ids distintos                  | dos entidades                                                 | `equals` → `false`                   |
| C4      | debería considerar distintas dos entidades de clases distintas con el mismo id | entidad `A` y entidad `B`, mismo id                           | `equals` → `false`                   |
| C5      | debería devolver false ante null                                               | `equals(null)`                                                | `false`                              |
| C6      | debería devolver false ante undefined                                          | `equals(undefined)`                                           | `false`                              |
| C7      | debería considerar igual a una entidad consigo misma                           | `e.equals(e)`                                                 | `true`                               |
| C8      | debería fijar updatedAt al instante que recibe touch                           | `touch(fecha)`                                                | `updatedAt === fecha`                |
| C9      | debería dejar createdAt intacto tras un touch                                  | `touch(otraFecha)`                                            | `createdAt` sin cambiar              |
| **C10** | debería aceptar un touch con una fecha anterior sin lanzar ni ignorarlo        | `touch(2020-01-01)` sobre una entidad con `updatedAt` en 2026 | no lanza; `updatedAt === 2020-01-01` |
| P1      | debería reflejar exactamente el now inyectado _(propiedad)_                    | `fc.date()` acotada                                           | `updatedAt === now` en toda fecha    |

⚠️ **C10 se añadió por confirmación JIT durante el Lote 3.** El revisor de calidad detectó que el
JSDoc afirma «`touch` no rechaza un `now` anterior» —que es exactamente la decisión que el
usuario tomó en la fase de contrato, descartando validar el retroceso del reloj— y que **ningún
caso determinista lo probaba**: C8 y C9 solo usan fechas posteriores a `createdAt`.

⚠️ **P1 no sirve como sustituto, y el motivo importa.** Su arbitrario cubre 2000-2100, así que de
facto genera fechas anteriores en casi toda corrida — pero no lo garantiza ni lo nombra. Si
alguien añadiera la validación, **P1 fallaría de forma intermitente**: verde cuando el muestreo da
una fecha posterior, rojo cuando da una anterior. Un test que falla a ratos se diagnostica como
_flaky_ y se silencia; uno que falla siempre se arregla.

⚠️ **C10 nace VERDE**, igual que B6. Se valida al revés: añadiendo la validación que el usuario
rechazó y comprobando que el test cae.

**Files:**

- Create: `src/shared/domain/entity.base.ts`
- Test: `src/shared/__tests__/domain/entity.base.spec.ts`

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/shared/__tests__/domain/entity.base.spec.ts
import fc from 'fast-check';

import { Entity } from '../../domain/entity.base';
import { UuidId } from '../../domain/uuid-id.base';

const ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const OTHER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const CREATED_AT = new Date('2026-08-01T10:15:00.000Z');
const UPDATED_AT = new Date('2026-08-02T11:30:00.000Z');

describe('Entity', () => {
  describe('propiedades', () => {
    it('debería exponer el id, createdAt y updatedAt recibidos', () => {
      // Arrange
      const id = SampleId.from(ID);

      // Act
      const entity = new SampleEntity(id, CREATED_AT, UPDATED_AT);

      // Assert
      expect(entity.id).toBe(id);
      expect(entity.createdAt).toBe(CREATED_AT);
      expect(entity.updatedAt).toBe(UPDATED_AT);
    });
  });

  describe('equals()', () => {
    it('debería considerar iguales dos instancias de la misma clase con el mismo id', () => {
      // Arrange — fechas distintas a propósito: la identidad NO depende del contenido.
      const one = new SampleEntity(SampleId.from(ID), CREATED_AT, CREATED_AT);
      const another = new SampleEntity(SampleId.from(ID), UPDATED_AT, UPDATED_AT);

      // Act
      const result = one.equals(another);

      // Assert
      expect(result).toBe(true);
    });

    it('debería considerar distintas dos instancias con ids distintos', () => {
      // Arrange
      const one = new SampleEntity(SampleId.from(ID), CREATED_AT, UPDATED_AT);
      const another = new SampleEntity(SampleId.from(OTHER_ID), CREATED_AT, UPDATED_AT);

      // Act
      const result = one.equals(another);

      // Assert
      expect(result).toBe(false);
    });

    it('debería considerar distintas dos entidades de clases distintas con el mismo id', () => {
      // Arrange
      const one = new SampleEntity(SampleId.from(ID), CREATED_AT, UPDATED_AT);
      const another = new OtherSampleEntity(SampleId.from(ID), CREATED_AT, UPDATED_AT);

      // Act
      const result = one.equals(another);

      // Assert
      expect(result).toBe(false);
    });

    it('debería devolver false ante null', () => {
      // Arrange
      const entity = new SampleEntity(SampleId.from(ID), CREATED_AT, UPDATED_AT);

      // Act
      const result = entity.equals(null);

      // Assert
      expect(result).toBe(false);
    });

    it('debería devolver false ante undefined', () => {
      // Arrange
      const entity = new SampleEntity(SampleId.from(ID), CREATED_AT, UPDATED_AT);

      // Act
      const result = entity.equals(undefined);

      // Assert
      expect(result).toBe(false);
    });

    it('debería considerar igual a una entidad consigo misma', () => {
      // Arrange
      const entity = new SampleEntity(SampleId.from(ID), CREATED_AT, UPDATED_AT);

      // Act
      const result = entity.equals(entity);

      // Assert
      expect(result).toBe(true);
    });
  });

  describe('touch()', () => {
    it('debería fijar updatedAt al instante que recibe touch', () => {
      // Arrange
      const entity = new SampleEntity(SampleId.from(ID), CREATED_AT, CREATED_AT);
      const now = new Date('2026-09-09T09:09:09.000Z');

      // Act
      entity.mutate(now);

      // Assert
      expect(entity.updatedAt).toBe(now);
    });

    it('debería dejar createdAt intacto tras un touch', () => {
      // Arrange
      const entity = new SampleEntity(SampleId.from(ID), CREATED_AT, CREATED_AT);

      // Act
      entity.mutate(new Date('2026-09-09T09:09:09.000Z'));

      // Assert
      expect(entity.createdAt).toBe(CREATED_AT);
    });
  });

  describe('touch() (property-based)', () => {
    it('debería reflejar exactamente el now inyectado', () => {
      fc.assert(
        fc.property(
          fc.date({
            min: new Date('2000-01-01T00:00:00.000Z'),
            max: new Date('2100-01-01T00:00:00.000Z'),
            noInvalidDate: true,
          }),
          (now) => {
            // Arrange
            const entity = new SampleEntity(SampleId.from(ID), CREATED_AT, CREATED_AT);

            // Act
            entity.mutate(now);

            // Assert
            expect(entity.updatedAt).toBe(now);
          },
        ),
      );
    });
  });
});

// Helpers
//
// `touch()` es `protected` —solo el propio agregado decide cuándo se toca—, así que el doble
// expone `mutate()` para poder ejercitarlo. Dos clases distintas con el MISMO tipo de id son
// necesarias para C4: es el caso que el kernel del repo de referencia falla, porque allí
// `equals` compara solo el id y da `true` entre agregados de tipos distintos.

class SampleIdError extends Error {}

class SampleId extends UuidId {
  static from(value: string): SampleId {
    return new SampleId(UuidId.assertUuid(value, () => new SampleIdError()));
  }
}

class SampleEntity extends Entity<SampleId> {
  constructor(id: SampleId, createdAt: Date, updatedAt: Date) {
    super(id, createdAt, updatedAt);
  }

  mutate(now: Date): void {
    this.touch(now);
  }
}

class OtherSampleEntity extends Entity<SampleId> {
  constructor(id: SampleId, createdAt: Date, updatedAt: Date) {
    super(id, createdAt, updatedAt);
  }
}
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/shared/__tests__/domain/entity.base.spec.ts`
Expected: FAIL — `Cannot find module '../../domain/entity.base'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/shared/domain/entity.base.ts
import type { UuidId } from './uuid-id.base';

/**
/**
 * Base de las entidades: identidad, marcas de tiempo e igualdad. Sin `props`, sin factorías
 * genéricas, sin eventos — eso lo añade `AggregateRoot`, que extiende de aquí.
 *
 * Conviene distinguir qué es extracción y qué es capacidad nueva, porque no es lo mismo:
 *   - `id`, `createdAt`, `updatedAt` y el patrón de mutación SÍ estaban duplicados en las tres
 *     entidades. Aquí se consolidan.
 *   - `equals()` es **nuevo**. Ninguna de las tres lo tenía. Se añade por paridad con
 *     `ValueObject.equals` y porque la igualdad por identidad es parte de la definición del
 *     patrón Entity, no un extra; y de paso fija por test el defecto medido en el kernel que
 *     sirvió de referencia, donde `equals` compara solo el id y dos agregados de tipos
 *     distintos con el mismo UUID salen «iguales».
 *
 * `id` y `createdAt` son parameter properties públicas y de solo lectura: ninguna cambia en la
 * vida de la entidad. `updatedAt` es la excepción —el único de los tres que un mutador
 * reescribe— y por eso es el único con campo privado (`_updatedAt`) más getter: la mutación
 * vive detrás de `touch()`, nunca de una asignación directa desde fuera.
 *
 * `TId extends UuidId` y no `ValueObject<unknown>`: todos los ids del repo son UUID, y el
 * bound estrecho evita depender de la bivarianza de métodos de TypeScript para que la
 * asignación compile. Se generaliza el día que exista un id que no sea UUID, no antes.
 *
 * `touch(now)` RECIBE el instante, nunca llama a `new Date()`. Es divergencia deliberada con
 * el kernel que sirvió de referencia: aquí el dominio no lee el reloj —lo inyecta el caso de
 * uso—, y un `touch()` que lo leyera obligaría a fake timers para testear cualquier mutador.
 * El kernel tampoco legisla sobre el valor: `touch` no rechaza un `now` anterior, porque el
 * reloj lo controla quien lo inyecta (decisión de la fase de contrato, Tabla C).
 *
 * `equals()` compara la CLASE antes que el id. Sin esa comprobación, dos agregados distintos
 * que compartieran UUID serían «iguales» — el defecto exacto que tiene el kernel de
 * referencia. El criterio (`constructor !==`, no `instanceof`) es el mismo que ya usa
 * `ValueObject.equals`: coherencia dentro del kernel.
  * Base de las entidades: identidad, marcas de tiempo e igualdad. Sin `props`, sin factorías
 * genéricas, sin eventos — eso lo añade `AggregateRoot`, que extiende de aquí.
 *
 * Conviene distinguir qué es extracción y qué es capacidad nueva:
 *   - `id`, `createdAt`, `updatedAt` y el patrón de mutación SÍ estaban duplicados en las tres
 *     entidades. Aquí se consolidan.
 *   - `equals()` es NUEVO. Ninguna de las tres lo tenía.
 *
 * `TId extends UuidId` y no `ValueObject<unknown>`: todos los ids del repo son UUID, y el
 * bound estrecho evita depender de la bivarianza de métodos de TypeScript para que la
 * asignación compile. Se generaliza el día que exista un id que no sea UUID, no antes.
 *
 * `touch(now)` RECIBE el instante, nunca llama a `new Date()`. Es divergencia deliberada con
 * el kernel que sirvió de referencia: aquí el dominio no lee el reloj —lo inyecta el caso de
 * uso—, y un `touch()` que lo leyera obligaría a fake timers para testear cualquier mutador.
 * El kernel tampoco legisla sobre el valor: `touch` no rechaza un `now` anterior, porque el
 * reloj lo controla quien lo inyecta (decisión de la fase de contrato, Tabla C).
 *
 * `equals()` compara la CLASE antes que el id. Sin esa comprobación, dos agregados distintos
 * que compartieran UUID serían «iguales» — el defecto exacto que tiene el kernel de
 * referencia. El criterio (`constructor !==`, no `instanceof`) es el mismo que ya usa
 * `ValueObject.equals`: coherencia dentro del kernel.
 */
export abstract class Entity<TId extends UuidId> {
  protected constructor(
    readonly id: TId,
    readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  get updatedAt(): Date {
    return this._updatedAt;
  }

  protected touch(now: Date): void {
    this._updatedAt = now;
  }

  equals(other: Entity<TId> | null | undefined): boolean {
    if (other === null || other === undefined) {
      return false;
    }
    if (other.constructor !== this.constructor) {
      return false;
    }
    return this.id.equals(other.id);
  }
}
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/shared/__tests__/domain/entity.base.spec.ts`
Expected: PASS — 10 passed

---

## Task 7: `AggregateRoot` extiende `Entity`

**Layer:** domain
**Rule codes to honor:** `di-liskov-substitution`, `arch-use-events`

**Casos acordados** (Tabla D — los 4 `it` de `pullEvents()` existentes se conservan **con sus aserciones intactas**; se añade D1):

| #   | Caso (se vuelve el `it`)                        | Entrada / estado inicial | Resultado esperado                                     |
| --- | ----------------------------------------------- | ------------------------ | ------------------------------------------------------ |
| D1  | debería exponer la identidad heredada de Entity | agregado sintético       | `id`, `createdAt` y `updatedAt` accesibles y correctos |

**Files:**

- Modify: `src/shared/domain/aggregate-root.ts`
- Modify: `src/shared/__tests__/domain/aggregate-root.spec.ts`

- [ ] **Step 1: Reescribe `aggregate-root.ts` completo**

```ts
// src/shared/domain/aggregate-root.ts
import { Entity } from './entity.base';
import type { UuidId } from './uuid-id.base';

/**
 * Base de los agregados que emiten eventos de dominio: recolecta y drena, encima de la
 * identidad que aporta `Entity`.
 *
 * Extiende `Entity` en vez de vivir al lado porque TypeScript da UNA sola ranura de
 * herencia: `Order` necesita identidad y eventos a la vez, y sin esto tendría que elegir.
 * De ahí el segundo parámetro de tipo — antes solo estaba `TEvent`.
 *
 * `TEvent` queda sin acotar porque el kernel no conoce ningún evento concreto: cada agregado
 * fija su propio tipo al extender (`extends AggregateRoot<OrderId, OrderPlaced>`), y es ahí
 * donde el compilador vuelve a ser estricto.
 *
 * `splice(0, length)` porque hace de una vez las dos mitades del drenaje: DEVUELVE un array
 * nuevo con los eventos y DEJA vacío el interno, sin que la referencia privada salga jamás
 * del agregado. Las alternativas no son incorrectas, solo peores: `return this.domainEvents`
 * entregaría al llamante la lista VIVA —que el siguiente `record()` mutaría bajo sus pies— y
 * `[...events]` + `length = 0` son dos pasos para exactamente el mismo resultado.
 */
export abstract class AggregateRoot<TId extends UuidId, TEvent> extends Entity<TId> {
  private readonly domainEvents: TEvent[] = [];

  protected record(event: TEvent): void {
    this.domainEvents.push(event);
  }

  pullEvents(): TEvent[] {
    return this.domainEvents.splice(0, this.domainEvents.length);
  }
}
```

- [ ] **Step 2: Ejecuta el spec existente para verificar que falla**

Run: **`pnpm typecheck`** (no `pnpm test`)
Expected: FAIL — `src/shared/__tests__/domain/aggregate-root.spec.ts(56,34): error TS2314: Generic type 'AggregateRoot<TId, TEvent>' requires 2 type argument(s).`

⚠️ **Aquí el rojo se captura con `typecheck`, no con `test`, y esto vale para todo cambio de
tipos del plan.** `jest.config.mjs` transforma con `@swc/jest` **puro**: no hay comprobación de
tipos. Un error de aridad de genéricos es invisible para Jest porque los genéricos se borran en
runtime, así que `pnpm test` seguiría **verde** mientras el código no compila. Medido en el
Lote 3, no supuesto.

⚠️ **Consecuencia inmediata, y es peor de lo que parece:** al cambiar esta firma, `Order` —que
todavía llama `super()` sin argumentos— pasa a construirse con `createdAt` y `updatedAt` a
`undefined`, porque `AggregateRoot` ya no declara constructor propio y el implícito reenvía
`(undefined, undefined, undefined)` a `Entity`. Sus parameter properties (`id`, `placedAt`) se
asignan **después** de `super()` y sobreviven; los dos campos nuevos no. **La suite sigue en
verde (615/615) porque ningún test de `orders` mira esos campos todavía.** Verificado
instrumentando un `Order` real:

```
id        = 6287f1d4-…   ← bien
placedAt  = 2026-08-01…  ← bien
createdAt = undefined    ← roto
updatedAt = undefined    ← roto
```

**Entre este lote y la Tarea 11 el repo está en un estado que no se puede commitear como
funcional.** El único gate que lo delata es `typecheck`. No confíes en el verde de la suite.

- [ ] **Step 3: Adapta el doble y añade el caso D1**

Sustituye el bloque `// Helpers` del final por este, y añade el `describe` nuevo **antes** del de `pullEvents()`. Los cuatro `it` de `pullEvents()` **no se tocan**.

```ts
// src/shared/__tests__/domain/aggregate-root.spec.ts  (añadir tras el `describe('AggregateRoot', …)` de apertura)
describe('identidad', () => {
  it('debería exponer la identidad heredada de Entity', () => {
    // Arrange
    const id = SampleId.from('9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012');
    const createdAt = new Date('2026-08-01T10:15:00.000Z');

    // Act
    const aggregate = new RecordingAggregate(id, createdAt);

    // Assert
    expect(aggregate.id).toBe(id);
    expect(aggregate.createdAt).toBe(createdAt);
    expect(aggregate.updatedAt).toBe(createdAt);
  });
});
```

```ts
// src/shared/__tests__/domain/aggregate-root.spec.ts  (bloque Helpers del final, reemplazo completo)
// Helpers
//
// `record()` es `protected` a propósito —solo el propio agregado decide qué emite—, así que
// el doble expone un `emit()` público que lo delega. Los eventos son strings y no clases de
// evento reales: la base es genérica en `TEvent` y no toca su contenido.
//
// Desde que `AggregateRoot` extiende `Entity`, el doble necesita además un id y sus marcas
// de tiempo. El id por defecto evita repetirlo en los cuatro casos de `pullEvents()`, que
// solo hablan de eventos y no de identidad.

const DEFAULT_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const DEFAULT_NOW = new Date('2026-08-01T10:15:00.000Z');

class SampleIdError extends Error {}

class SampleId extends UuidId {
  static from(value: string): SampleId {
    return new SampleId(UuidId.assertUuid(value, () => new SampleIdError()));
  }
}

class RecordingAggregate extends AggregateRoot<SampleId, string> {
  constructor(id: SampleId = SampleId.from(DEFAULT_ID), now: Date = DEFAULT_NOW) {
    super(id, now, now);
  }

  emit(event: string): void {
    this.record(event);
  }
}
```

Y ajusta los imports de la cabecera del spec:

```ts
// src/shared/__tests__/domain/aggregate-root.spec.ts  (cabecera)
import { AggregateRoot } from '../../domain/aggregate-root';
import { UuidId } from '../../domain/uuid-id.base';
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/shared/__tests__/domain/aggregate-root.spec.ts`
Expected: PASS — 5 passed (los 4 de `pullEvents()` sin cambios + D1)

---

## Task 8: `User extends Entity<UserId>`

**Layer:** domain
**Rule codes to honor:** `di-liskov-substitution`, `arch-single-responsibility`

**Casos acordados:** ninguna tabla propia. Refactor sin lógica nueva; `user.entity.spec.ts` (361 LOC) es la red. Debe seguir verde **sin tocar aserciones**: si alguna cambia, el refactor alteró comportamiento y hay que consultar antes de seguir.

**Files:**

- Modify: `src/modules/users/domain/entities/user.entity.ts`

- [ ] **Step 1: Cambia la declaración y el constructor**

```ts
// src/modules/users/domain/entities/user.entity.ts  (cabecera + constructor)
import { Entity } from '@shared/domain/entity.base';

import type { Email } from '../value-objects/email.vo';
import { InvalidUserNameError } from '../errors/user.errors';
import type { UserId } from '../value-objects/user-id.vo';
import type { UserRole } from '../value-objects/user-role';

// … NAME_MIN_LENGTH, NAME_MAX_LENGTH y UserSnapshot no cambian …

/**
 * Raíz del agregado. Sin decoradores, sin ORM y sin dependencias de framework: sus
 * invariantes se garantizan en el constructor y en los métodos, no en un validador externo.
 *
 * `id`, `createdAt` y `updatedAt` los pone `Entity`, junto con `equals()` y `touch()`.
 * Estaban escritos a mano aquí y en los otros dos agregados.
 *
 * **Sin `passwordHash` desde el ciclo 4.** El usuario es un PERFIL: identidad, nombre, rol y
 * vigencia. La credencial es el agregado `Credential` del bounded context `auth`, con su
 * propia tabla.
 */
export class User extends Entity<UserId> {
  private constructor(
    id: UserId,
    private _email: Email,
    private _name: string,
    private _role: UserRole,
    private _active: boolean,
    createdAt: Date,
    updatedAt: Date,
  ) {
    super(id, createdAt, updatedAt);
  }
```

⚠️ `id` y `createdAt` **pierden el `readonly`** en la lista de parámetros: ya no son parameter properties, los declara la base. Dejarlos redeclararía el campo y romperían el `super()`.

- [ ] **Step 2: Sustituye las cinco asignaciones a `_updatedAt` por `touch(now)`**

`rename`, `changeEmail`, `deactivate`, `activate` y `promoteToAdmin` pasan de `this._updatedAt = now;` a `this.touch(now);`. Ejemplo de los dos primeros; los otros tres siguen el mismo patrón sin más cambios:

```ts
  rename(name: string, now: Date): void {
    this._name = User.assertName(name);
    this.touch(now);
  }

  changeEmail(email: Email, now: Date): void {
    if (this._email.equals(email)) {
      return;
    }
    this._email = email;
    this.touch(now);
  }
```

- [ ] **Step 3: Borra el getter `updatedAt` propio y ajusta `toSnapshot()`**

El getter `get updatedAt()` de esta clase **se elimina**: lo aporta `Entity`. Y `toSnapshot()` pasa a leerlo por el getter heredado:

```ts
  toSnapshot(): UserSnapshot {
    return {
      id: this.id.value,
      email: this._email.value,
      name: this._name,
      role: this._role,
      active: this._active,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
```

- [ ] **Step 4: Ejecuta la suite de `users`**

Run: `pnpm test src/modules/users`
Expected: PASS — todo verde sin cambios en las aserciones. `user.entity.spec.ts` cubre los cinco mutadores y el round-trip del snapshot; es lo que confirma que `touch()` se comporta como la asignación directa que sustituye.

---

## Task 9: `Credential extends Entity<CredentialId>`

**Layer:** domain (+ un ajuste en infrastructure)
**Rule codes to honor:** `di-liskov-substitution`, `arch-use-repository-pattern`

**Casos acordados:** ninguna tabla propia. Refactor sin lógica nueva; `credential.entity.spec.ts` y `credential.mapper.spec.ts` son la red.

⚠️ **Esta es la única tarea del plan que cambia ASERCIONES de un spec existente, y una de ellas es una trampa.** `Credential.id` pasa de `string` a objeto, así que cuatro líneas dejan de decir lo que decían. Las cuatro están localizadas y se arreglan en el Step 3:

| Archivo:línea                          | Hoy                                              | Qué pasa con `CredentialId`                                                                                                                      |
| -------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `credential.entity.spec.ts:44`         | `expect(first.id).toEqual(expect.any(String))`   | **Falla** — `id` ya no es un string                                                                                                              |
| `credential.entity.spec.ts:45`         | `expect(first.id).not.toBe(second.id)`           | **Pasa, pero deja de probar nada**: dos objetos distintos NUNCA son `toBe`, así que la aserción se satisface aunque los dos ids fueran idénticos |
| `credential.entity.spec.ts:80`         | `id: credential.id` dentro del snapshot esperado | **Falla** — `snapshot.id` es `string`                                                                                                            |
| `credential.mapper.spec.ts:23` y `:39` | `expect(row.id).toBe(credential.id)`             | **Falla** — compara `string` con objeto                                                                                                          |

La línea 45 es la importante: es exactamente el perfil de defecto contra el que avisa `CLAUDE.md` («un test que parecía cubrir algo y pasaba de todos modos»). Se arregla comparando `.value`, no dejándola en verde.

**Files:**

- Modify: `src/modules/auth/domain/entities/credential.entity.ts`
- Modify: `src/modules/auth/infrastructure/persistence/credential.mapper.ts`
- Modify: `src/modules/auth/__tests__/domain/entities/credential.entity.spec.ts`
- Modify: `src/modules/auth/__tests__/infrastructure/persistence/credential.mapper.spec.ts`

- [ ] **Step 1: Reescribe `credential.entity.ts` completo**

```ts
// src/modules/auth/domain/entities/credential.entity.ts
import { Entity } from '@shared/domain/entity.base';

import { CredentialId } from '../value-objects/credential-id.vo';
import type { PasswordHash } from '../value-objects/password-hash.vo';

export type CredentialSnapshot = {
  id: string;
  userId: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Raíz del agregado de `auth`: la credencial de acceso de una cuenta. Sin decoradores, sin
 * ORM y sin framework — el adaptador de persistencia la traduce desde y hacia la fila de
 * `auth_credentials`.
 *
 * `id` es un `CredentialId` desde este ciclo (antes, un `string` crudo): lo exige `Entity`,
 * que necesita un id comparable. `userId` en cambio SIGUE siendo `string` a propósito: el
 * identificador del usuario pertenece a `users`, y copiar aquí su `UserId` duplicaría una
 * invariante ajena que este contexto no puede mantener sincronizada. Mismo criterio que
 * `Order.customerId` en `orders`.
 *
 * La única invariante real del agregado la lleva `PasswordHash` (forma PHC de argon2id), y
 * por eso vive en el VO y no aquí: lo que hay que impedir es persistir un password en claro,
 * no que la credencial cambie de estado — hoy no tiene transiciones (no hay caso de uso de
 * cambio de contraseña). Cuando lo haya, `changePassword(hash, now)` es su sitio, y ahí es
 * donde entrará el `touch(now)` que `Entity` ya le da hecho.
 */
export class Credential extends Entity<CredentialId> {
  private constructor(
    id: CredentialId,
    readonly userId: string,
    readonly passwordHash: PasswordHash,
    createdAt: Date,
    updatedAt: Date,
  ) {
    super(id, createdAt, updatedAt);
  }

  /** Alta de la credencial. El id lo acuña el propio agregado. */
  static create(params: { userId: string; passwordHash: PasswordHash; now: Date }): Credential {
    return new Credential(
      CredentialId.generate(),
      params.userId,
      params.passwordHash,
      params.now,
      params.now,
    );
  }

  /** Reconstituye el agregado desde persistencia sin volver a aplicar reglas de creación. */
  static rehydrate(params: {
    id: CredentialId;
    userId: string;
    passwordHash: PasswordHash;
    createdAt: Date;
    updatedAt: Date;
  }): Credential {
    return new Credential(
      params.id,
      params.userId,
      params.passwordHash,
      params.createdAt,
      params.updatedAt,
    );
  }

  toSnapshot(): CredentialSnapshot {
    return {
      id: this.id.value,
      userId: this.userId,
      passwordHash: this.passwordHash.value,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
```

- [ ] **Step 2: Ajusta el mapper**

```ts
// src/modules/auth/infrastructure/persistence/credential.mapper.ts  (solo el toDomain)
  toDomain(row: CredentialOrmEntity): Credential {
    return Credential.rehydrate({
      id: CredentialId.from(row.id),
      userId: row.userId,
      passwordHash: PasswordHash.from(row.passwordHash),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  },
```

Y añade el import: `import { CredentialId } from '../../domain/value-objects/credential-id.vo';`

⚠️ **Import como VALOR, nunca `import type`.** `CredentialId` se usa en una llamada (`CredentialId.from`), así que la elisión no aplicaría aquí — pero la regla del repo es que un tipo del dominio usado en tiempo de ejecución va como valor, y `no-restricted-syntax` de `eslint.config.mjs` vigila la familia de fallos que esto provoca.

- [ ] **Step 3: Arregla las cuatro aserciones y el arrange del round-trip**

Añade `import { CredentialId } from '../../../domain/value-objects/credential-id.vo';` a `credential.entity.spec.ts` y aplica estos cambios exactos:

```ts
// credential.entity.spec.ts:44-45 — dentro de
// it('debería acuñar un identificador propio y distinto en cada alta')
// ANTES:
//   expect(first.id).toEqual(expect.any(String));
//   expect(first.id).not.toBe(second.id);
// DESPUÉS:
expect(first.id).toBeInstanceOf(CredentialId);
expect(first.id.value).not.toBe(second.id.value);
```

⚠️ `.value` en la segunda línea no es cosmética: sin ella la aserción compara referencias de objeto y se cumple siempre, incluso si `generate()` devolviera dos veces el mismo UUID. Comprueba que el arreglo funciona haciendo que `CredentialId.generate()` devuelva un valor fijo temporalmente — el test debe ponerse **rojo**. Si no lo hace, la aserción sigue sin probar nada.

```ts
// credential.entity.spec.ts:80 — dentro del snapshot esperado
// ANTES:  id: credential.id,
// DESPUÉS:
id: credential.id.value,
```

```ts
// credential.entity.spec.ts:93 — arrange del round-trip snapshot→rehydrate
// ANTES:  id: snapshot.id,
// DESPUÉS:
id: CredentialId.from(snapshot.id),
```

```ts
// credential.mapper.spec.ts:23 y :39
// ANTES:  expect(row.id).toBe(credential.id);
//         expect(credential.id).toBe(row.id);
// DESPUÉS:
expect(row.id).toBe(credential.id.value);
expect(credential.id.value).toBe(row.id);
```

Si aparece cualquier otra línea que trate `credential.id` como string, aplica el mismo criterio: **compara `.value`, nunca el objeto**.

- [ ] **Step 4: Ejecuta la suite de `auth`**

Run: `pnpm test src/modules/auth`
Expected: PASS — todo verde. `register-account.use-case.spec.ts` no debería necesitar cambio alguno: `Credential.create()` conserva su firma y el `userId` sigue siendo string.

---

## Task 10: Migración — `orders` gana `created_at` y `updated_at`

> ## ⚠️ TAREA SUPERADA — no la ejecutes como está escrita
>
> **Se ejecutó, se descubrió un defecto, se partió en expand/contract y finalmente se colapsó**
> dentro de `1786076763455-create-orders-and-outbox.ts`, por decisión del usuario del 2026-08-22:
> el proyecto no tenía datos reales ni despliegue, así que la tabla `orders` nace ya con sus tres
> instantes. Las migraciones `1787000000000-…-expand.ts`, `1787000060000-…-contract.ts` y su E2E
> **ya no existen**; todo lo que esta tarea menciona de ellas es historia.
>
> **El JSDoc de más abajo contiene una afirmación FALSA**, y es la que originó todo el episodio:
> dice que la migración «solo añade columnas, así que NO necesita expand/contract» y que «puede
> correr en el primer pod nuevo sin tumbar a las réplicas viejas». Medido contra la base real:
>
> ```
> INSERT INTO orders (id, customer_id, concept, amount_cents, placed_at) VALUES (...);
> -- ERROR: null value in column "created_at" of relation "orders" violates not-null constraint
> ```
>
> Una columna sin `DEFAULT` **no puede nacer `NOT NULL`** si alguna versión desplegada inserta en
> esa tabla sin nombrarla. La regla completa vive ahora en `CLAUDE.md`, sección «Destructive
> migrations: expand/contract». **No copies el bloque de abajo a ningún sitio.**

**Layer:** infrastructure
**Rule codes to honor:** `perf-optimize-database`

**Casos acordados:** ninguna. Es una migración; infra queda exenta de la tabla por el modelo de colaboración. Su verificación es el E2E de ida y vuelta del Step 4.

**Files:**

- Create: `src/database/migrations/1787000000000-add-timestamps-to-orders.ts`
- Modify: `src/modules/orders/infrastructure/persistence/order.orm-entity.ts`
- Test: `src/database/__tests__/add-timestamps-to-orders.e2e-spec.ts`

- [ ] **Step 1: Escribe la migración**

```ts
// src/database/migrations/1787000000000-add-timestamps-to-orders.ts
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ADITIVA: solo añade columnas, así que NO necesita el patrón expand/contract de
 * `CLAUDE.md`. Esa regla existe para lo que SUELTA o RENOMBRA — el código viejo ignora sin
 * problema una columna que no conoce, y TypeORM enumera columnas en cada `SELECT`, no
 * `SELECT *`. Con `DB_MIGRATIONS_RUN=true` puede correr en el primer pod nuevo sin tumbar a
 * las réplicas viejas.
 *
 * El relleno sale de `placed_at` y NO de `now()`: para una orden ya existente, el momento de
 * creación de la fila ES el momento en que se colocó. Rellenar con la hora de la migración
 * escribiría un dato falso en todas las filas históricas.
 *
 * `placed_at` sobrevive a propósito. Es el hecho de negocio que viaja en `OrderPlaced` y en
 * el contrato publicado de `POST /orders`; `created_at` es el timestamp de la fila. Que hoy
 * coincidan siempre es una consecuencia de que la orden sea inmutable, no una redundancia
 * que haya que resolver colapsándolos.
 */
export class AddTimestampsToOrders1787000000000 implements MigrationInterface {
  name = 'AddTimestampsToOrders1787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" ADD "created_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "orders" ADD "updated_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(
      `UPDATE "orders" SET "created_at" = "placed_at", "updated_at" = "placed_at"`,
    );
    await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "created_at" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "updated_at" SET NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Sin cualificar el schema, como todas las migraciones del repo: ambos sentidos heredan
    // el `search_path` de la conexión (lección de `create-users-table`).
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "updated_at"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "created_at"`);
  }
}
```

- [ ] **Step 2: Añade las columnas a la ORM entity y reescribe su comentario**

```ts
// src/modules/orders/infrastructure/persistence/order.orm-entity.ts
import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Modelo de persistencia, deliberadamente distinto del agregado `Order` — dos modelos, un
 * mapper (convención del repo).
 *
 * `placed_at`, `created_at` y `updated_at` conviven y NO son lo mismo, aunque hoy siempre
 * coincidan: `placed_at` es el HECHO DE NEGOCIO —lo sella el dominio en `Order.place()` y
 * viaja en `OrderPlaced` y en el contrato publicado— mientras que los otros dos son las
 * marcas de fila que `Entity` da a todos los agregados. Coinciden porque la orden mínima es
 * inmutable; el día que tenga transiciones, `updated_at` se separará y `placed_at` no.
 *
 * Siguen sin ser `CreateDateColumn`/`UpdateDateColumn`: los tres instantes los decide el
 * dominio con el `now` que le inyecta el caso de uso, no la base de datos. Dejar que la base
 * los escribiera metería un segundo reloj en el sistema.
 */
@Entity({ name: 'orders' })
export class OrderOrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ type: 'varchar', length: 140 })
  concept!: string;

  @Column({ name: 'amount_cents', type: 'int' })
  amountCents!: number;

  @Column({ name: 'placed_at', type: 'timestamptz' })
  placedAt!: Date;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
```

- [ ] **Step 3: Escribe el E2E de ida y vuelta**

```ts
// src/database/__tests__/add-timestamps-to-orders.e2e-spec.ts
import { randomUUID } from 'node:crypto';

import { DataSource, type DataSourceOptions } from 'typeorm';

import { dataSourceOptions } from '../data-source';

/**
 * La migración mueve datos, así que lleva prueba: es la regla decidida en el backlog #17 del
 * template —«la que mueve datos o suelta algo lleva prueba; la que solo añade, no»—, y esta
 * hace las dos cosas (añade Y rellena desde `placed_at`).
 *
 * Corre sobre una base DESECHABLE, no sobre `crypto_amazon_clon_api_test`, y esa parte
 * tampoco es opinión: la fija la misma entrada del backlog. El motivo es concreto — probar
 * una migración exige `undoLastMigration()`, y si una aserción falla a mitad la base se
 * queda SIN las columnas. La suite corre con `maxWorkers: 1`, así que no hay carrera, pero
 * sí quedaría un esquema roto para `orders.e2e-spec.ts` y todo lo que venga detrás. Sobre
 * una base propia, un fallo no puede contaminar a nadie.
 */
const SCRATCH_DATABASE = 'crypto_amazon_clon_api_migrations_test';
const MIGRATION_NAME = 'AddTimestampsToOrders1787000000000';

describe('AddTimestampsToOrders', () => {
  let admin: DataSource;
  let scratch: DataSource;

  beforeAll(async () => {
    // `CREATE DATABASE` no puede ejecutarse desde la base que crea: hace falta una conexión
    // administrativa aparte, y `postgres` es la que siempre existe.
    admin = await new DataSource({
      ...dataSourceOptions,
      database: 'postgres',
    } as DataSourceOptions).initialize();
    await admin.query(`DROP DATABASE IF EXISTS "${SCRATCH_DATABASE}"`);
    await admin.query(`CREATE DATABASE "${SCRATCH_DATABASE}"`);

    scratch = await new DataSource({
      ...dataSourceOptions,
      database: SCRATCH_DATABASE,
    } as DataSourceOptions).initialize();
    await scratch.runMigrations();
  });

  afterAll(async () => {
    await scratch?.destroy();
    await admin.query(`DROP DATABASE IF EXISTS "${SCRATCH_DATABASE}"`);
    await admin.destroy();
  });

  it('debería rellenar created_at y updated_at desde placed_at al aplicarse', async () => {
    // Arrange — se retrocede la migración, se inserta una fila "vieja" sin las columnas
    // nuevas y se vuelve a aplicar. Es el único orden que ejercita el UPDATE de relleno:
    // con la migración ya aplicada, las columnas existen y ese camino no se recorre.
    //
    // La comprobación previa del nombre NO es ceremonia: `undoLastMigration()` revierte la
    // ÚLTIMA, sea cual sea. El día que alguien añada una migración detrás de esta, sin este
    // `expect` el test revertiría la equivocada y seguiría en verde probando otra cosa.
    const [last] = await scratch.query<{ name: string }[]>(
      `SELECT "name" FROM "migrations" ORDER BY "timestamp" DESC LIMIT 1`,
    );
    expect(last.name).toBe(MIGRATION_NAME);
    await scratch.undoLastMigration();

    const id = randomUUID();
    const placedAt = new Date('2026-08-01T10:15:00.000Z');
    await scratch.query(
      `INSERT INTO "orders" ("id", "customer_id", "concept", "amount_cents", "placed_at")
       VALUES ($1, $2, $3, $4, $5)`,
      [id, randomUUID(), 'Suscripción anual plan Pro', 149_900, placedAt],
    );

    // Act
    await scratch.runMigrations();

    // Assert
    const [row] = await scratch.query<{ created_at: Date; updated_at: Date }[]>(
      `SELECT "created_at", "updated_at" FROM "orders" WHERE "id" = $1`,
      [id],
    );
    expect(row.created_at).toEqual(placedAt);
    expect(row.updated_at).toEqual(placedAt);
  });

  it('debería dejar la tabla sin las dos columnas al revertirse', async () => {
    // Arrange + Act
    await scratch.undoLastMigration();

    // Assert
    const columns = await scratch.query<{ column_name: string }[]>(
      `SELECT "column_name" FROM information_schema.columns WHERE "table_name" = 'orders'`,
    );
    const names = columns.map((column) => column.column_name);
    expect(names).not.toContain('created_at');
    expect(names).not.toContain('updated_at');
    expect(names).toContain('placed_at');

    // Deja la base en el estado que la encontró: los `it` de este archivo comparten esquema.
    await scratch.runMigrations();
  });
});
```

⚠️ **Ojo con el `testTimeout: 30_000` de la suite E2E.** El `beforeAll` crea una base y corre todas las migraciones desde cero. Si en tu máquina se queda corto, súbelo **solo para este archivo** con `jest.setTimeout()` en la cabecera — no toques el valor global, que está ajustado para el arranque del `AppModule`.

- [ ] **Step 4: Aplica y verifica**

Run:

```bash
pnpm db:up
pnpm migration:run
pnpm db:migrate:test
pnpm test:e2e -- add-timestamps-to-orders
```

Expected: la migración aplica en ambas bases y los 2 `it` pasan.

---

## Task 11: `Order extends AggregateRoot<OrderId, OrderPlaced>`

**Layer:** domain (+ el mapper en infrastructure)
**Rule codes to honor:** `di-liskov-substitution`, `arch-use-events`

**Casos acordados** (Tabla E). A diferencia de las tareas 8 y 9, esta **sí** introduce comportamiento nuevo: `Order.place()` pasa a sellar tres instantes y `toSnapshot()` publica dos campos más. Eso son casos, y llevan tabla:

| #   | Caso (se vuelve el `it`)                                                                 | Entrada / estado inicial              | Resultado esperado                     |
| --- | ---------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------- |
| E1  | debería sellar placedAt, createdAt y updatedAt con el mismo instante al colocar la orden | `Order.place({ …, now })`             | los tres iguales a `now`               |
| E2  | debería conservar los tres instantes por separado al reconstituir                        | `rehydrate` con tres fechas distintas | cada campo con la suya                 |
| E3  | debería exponer createdAt y updatedAt en el snapshot                                     | `toSnapshot()` de una orden colocada  | ambos presentes e iguales a `placedAt` |

⚠️ E2 usa **tres fechas distintas** a propósito, aunque el sistema real nunca las produzca: es lo único que demuestra que `rehydrate` no las está colapsando. Con las tres iguales, un `rehydrate` que ignorase dos parámetros pasaría igual.

⚠️ Además, `order.entity.spec.ts:40`, `order.mapper.spec.ts:64` y `:85` y `in-memory-order.repository.ts` llaman a `rehydrate` y necesitan los dos campos nuevos en su **arrange**; sus aserciones actuales no cambian.

**Files:**

- Modify: `src/modules/orders/domain/entities/order.entity.ts`
- Modify: `src/modules/orders/infrastructure/persistence/order.mapper.ts`

- [ ] **Step 1: Reescribe `order.entity.ts` completo**

```ts
// src/modules/orders/domain/entities/order.entity.ts
import { AggregateRoot } from '@shared/domain/aggregate-root';

import { OrderPlaced } from '../events/order-placed.event';
import type { OrderAmount } from '../value-objects/order-amount.vo';
import type { OrderConcept } from '../value-objects/order-concept.vo';
import type { OrderId } from '../value-objects/order-id.vo';

export type OrderSnapshot = {
  id: string;
  customerId: string;
  concept: string;
  amountCents: number;
  placedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Raíz del agregado. El agregado RECOLECTA sus eventos y `pullEvents()` los drena; quien
 * publica es la aplicación. La recolección, el drenaje y ahora también la identidad y las
 * marcas de tiempo los pone `AggregateRoot`, que extiende `Entity`; este agregado solo
 * decide QUÉ emite y cuándo.
 *
 * `placedAt` NO es `createdAt` aunque hoy valgan siempre lo mismo: es el hecho de negocio que
 * viaja en `OrderPlaced` y en el contrato publicado, mientras que `createdAt`/`updatedAt` son
 * las marcas de fila comunes a todo agregado. Coinciden porque la orden es inmutable — no
 * tiene un solo mutador. El día que lo tenga, `updatedAt` se moverá y `placedAt` no.
 *
 * `customerId` es un string y no un VO propio: llega del `sub` de un token ya verificado y el
 * directorio de clientes lo re-valida ANTES de construir la orden (Tabla E, caso E5).
 */
export class Order extends AggregateRoot<OrderId, OrderPlaced> {
  private constructor(
    id: OrderId,
    readonly customerId: string,
    readonly concept: OrderConcept,
    readonly amount: OrderAmount,
    readonly placedAt: Date,
    createdAt: Date,
    updatedAt: Date,
  ) {
    super(id, createdAt, updatedAt);
  }

  static place(params: {
    id: OrderId;
    customerId: string;
    concept: OrderConcept;
    amount: OrderAmount;
    now: Date;
  }): Order {
    // Un solo `now` para los tres instantes: colocar la orden ES crearla.
    const order = new Order(
      params.id,
      params.customerId,
      params.concept,
      params.amount,
      params.now,
      params.now,
      params.now,
    );
    order.record(
      new OrderPlaced(params.id.value, params.customerId, params.amount.value, params.now),
    );
    return order;
  }

  /** Reconstituye desde persistencia sin re-emitir eventos: ya se publicaron en su día. */
  static rehydrate(params: {
    id: OrderId;
    customerId: string;
    concept: OrderConcept;
    amount: OrderAmount;
    placedAt: Date;
    createdAt: Date;
    updatedAt: Date;
  }): Order {
    return new Order(
      params.id,
      params.customerId,
      params.concept,
      params.amount,
      params.placedAt,
      params.createdAt,
      params.updatedAt,
    );
  }

  toSnapshot(): OrderSnapshot {
    return {
      id: this.id.value,
      customerId: this.customerId,
      concept: this.concept.value,
      amountCents: this.amount.value,
      placedAt: this.placedAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
```

- [ ] **Step 2: Ajusta el mapper**

```ts
// src/modules/orders/infrastructure/persistence/order.mapper.ts
import { Order } from '../../domain/entities/order.entity';
import { OrderAmount } from '../../domain/value-objects/order-amount.vo';
import { OrderConcept } from '../../domain/value-objects/order-concept.vo';
import { OrderId } from '../../domain/value-objects/order-id.vo';

import { OrderOrmEntity } from './order.orm-entity';

/**
 * Única frontera entre la fila y el agregado. Al reconstituir usa `rehydrate`, no `place`:
 * los datos persistidos ya eran válidos al guardarse y reconstruir no re-emite eventos.
 */
export const OrderMapper = {
  toDomain(row: OrderOrmEntity): Order {
    return Order.rehydrate({
      id: OrderId.from(row.id),
      customerId: row.customerId,
      concept: OrderConcept.from(row.concept),
      amount: OrderAmount.from(row.amountCents),
      placedAt: row.placedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  },

  toPersistence(order: Order): OrderOrmEntity {
    const snapshot = order.toSnapshot();
    const row = new OrderOrmEntity();
    row.id = snapshot.id;
    row.customerId = snapshot.customerId;
    row.concept = snapshot.concept;
    row.amountCents = snapshot.amountCents;
    row.placedAt = snapshot.placedAt;
    row.createdAt = snapshot.createdAt;
    row.updatedAt = snapshot.updatedAt;
    return row;
  },
};
```

- [ ] **Step 3: Ajusta el arrange de los specs de `orders`**

Toda llamada a `Order.rehydrate({...})` en `order.entity.spec.ts:40`, `order.mapper.spec.ts:64` y `:85` y en `in-memory-order.repository.ts` necesita los dos campos nuevos. Usa el mismo valor que `placedAt` — es lo que produciría el sistema real.

⚠️ `OrderResponseDto.fromDomain` **no se toca**: lee del snapshot solo los campos que publica, e ignorar dos campos nuevos es exactamente lo que debe hacer.

- [ ] **Step 3b: Añade los tres `it` de la Tabla E**

```ts
// src/modules/orders/__tests__/domain/entities/order.entity.spec.ts
// Añadir dentro del describe('place()') existente:
it('debería sellar placedAt, createdAt y updatedAt con el mismo instante al colocar la orden', () => {
  // Arrange
  const now = new Date('2026-08-01T10:15:00.000Z');

  // Act
  const order = Order.place({
    id: OrderId.generate(),
    customerId: '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012',
    concept: OrderConcept.from('Suscripción anual plan Pro'),
    amount: OrderAmount.from(149_900),
    now,
  });

  // Assert
  expect(order.placedAt).toBe(now);
  expect(order.createdAt).toBe(now);
  expect(order.updatedAt).toBe(now);
});
```

```ts
// Añadir dentro del describe('rehydrate()') existente:
it('debería conservar los tres instantes por separado al reconstituir', () => {
  // Arrange — tres fechas DISTINTAS aunque el sistema real nunca las produzca: es lo
  // único que demuestra que `rehydrate` no las colapsa. Con las tres iguales, una
  // implementación que ignorase dos parámetros pasaría igual.
  const placedAt = new Date('2026-08-01T10:15:00.000Z');
  const createdAt = new Date('2026-08-02T11:30:00.000Z');
  const updatedAt = new Date('2026-08-03T12:45:00.000Z');

  // Act
  const order = Order.rehydrate({
    id: OrderId.generate(),
    customerId: '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012',
    concept: OrderConcept.from('Suscripción anual plan Pro'),
    amount: OrderAmount.from(149_900),
    placedAt,
    createdAt,
    updatedAt,
  });

  // Assert
  expect(order.placedAt).toBe(placedAt);
  expect(order.createdAt).toBe(createdAt);
  expect(order.updatedAt).toBe(updatedAt);
});
```

```ts
// Añadir dentro del describe('toSnapshot()') existente:
it('debería exponer createdAt y updatedAt en el snapshot', () => {
  // Arrange
  const now = new Date('2026-08-01T10:15:00.000Z');
  const order = Order.place({
    id: OrderId.generate(),
    customerId: '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012',
    concept: OrderConcept.from('Suscripción anual plan Pro'),
    amount: OrderAmount.from(149_900),
    now,
  });

  // Act
  const snapshot = order.toSnapshot();

  // Assert
  expect(snapshot.createdAt).toBe(now);
  expect(snapshot.updatedAt).toBe(now);
  expect(snapshot.placedAt).toBe(now);
});
```

- [ ] **Step 4: Ejecuta la suite de `orders`**

Run: `pnpm test src/modules/orders`
Expected: PASS — verde. `place-order.use-case.spec.ts` no debería necesitar cambios: `Order.place()` conserva su firma.

- [ ] **Step 5: Confirma que el contrato publicado no se movió**

Run: `pnpm test:e2e -- orders`
Expected: PASS — la respuesta de `POST /orders` sigue teniendo exactamente `id`, `customerId`, `concept`, `amountCents` y `placedAt`.

---

## Task 12: `DomainExceptionFilter` base

**Layer:** common
**Rule codes to honor:** `error-use-exception-filters`, `error-throw-http-exceptions`, `di-interface-segregation`

**Casos acordados:** ninguna tabla. La tarea vive en `common/` (infraestructura transversal), exenta por el modelo de colaboración. Sus casos van igualmente escritos abajo como `it`, porque el filtro tiene lógica de recorrido que hay que fijar.

**Files:**

- Create: `src/common/http/domain-exception.filter.ts`
- Test: `src/common/__tests__/http/domain-exception.filter.spec.ts`

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/common/__tests__/http/domain-exception.filter.spec.ts
import {
  BadRequestException,
  Catch,
  ConflictException,
  NotFoundException,
  type ExceptionFilter,
} from '@nestjs/common';

import { DomainExceptionFilter, type DomainErrorMapping } from '../../http/domain-exception.filter';

describe('DomainExceptionFilter', () => {
  describe('catch()', () => {
    it('debería traducir con el primer mapeo que coincide', () => {
      // Arrange
      const filter = new SampleFilter();

      // Act + Assert
      expect(() => filter.catch(new NotFoundSampleError())).toThrow(NotFoundException);
    });

    it('debería traducir cada error a la excepción que le corresponde', () => {
      // Arrange
      const filter = new SampleFilter();

      // Act + Assert
      expect(() => filter.catch(new ConflictSampleError())).toThrow(ConflictException);
    });

    it('debería propagar el mensaje del error de dominio', () => {
      // Arrange
      const filter = new SampleFilter();

      // Act + Assert
      expect(() => filter.catch(new NotFoundSampleError())).toThrow('no encontrado');
    });

    it('debería usar el fallback 400 cuando ningún mapeo coincide', () => {
      // Arrange
      const filter = new SampleFilter();

      // Act + Assert
      expect(() => filter.catch(new UnmappedSampleError())).toThrow(BadRequestException);
    });

    it('debería usar el fallback 400 cuando el mapa está vacío', () => {
      // Arrange
      const filter = new EmptyFilter();

      // Act + Assert
      expect(() => filter.catch(new NotFoundSampleError())).toThrow(BadRequestException);
    });

    it('debería respetar el orden del mapa cuando dos entradas podrían coincidir', () => {
      // Arrange — `SpecificError` extiende `NotFoundSampleError`, así que las DOS entradas
      // le encajan por `instanceof`. Gana la primera declarada, que aquí es la específica.
      const filter = new OrderedFilter();

      // Act + Assert
      expect(() => filter.catch(new SpecificError())).toThrow(ConflictException);
    });
  });
});

// Helpers
//
// Errores sintéticos, no los reales de un módulo: el contrato que se prueba aquí es el
// RECORRIDO del mapa —primer match gana, fallback 400—, no la tabla de traducción de ningún
// contexto concreto. Con los errores de `users` este spec se pondría rojo cada vez que ese
// módulo añadiera un error, sin que la base hubiera cambiado.
//
// Que el CÓDIGO de `common/` no pueda importar de `modules/` es cierto y es otra cosa: el
// gate ignora `src/**/__tests__/**`, así que a este archivo no le aplica.

abstract class SampleDomainError extends Error {}

class NotFoundSampleError extends SampleDomainError {
  constructor() {
    super('no encontrado');
  }
}

class ConflictSampleError extends SampleDomainError {
  constructor() {
    super('en conflicto');
  }
}

class UnmappedSampleError extends SampleDomainError {
  constructor() {
    super('sin mapear');
  }
}

class SpecificError extends NotFoundSampleError {}

@Catch(SampleDomainError)
class SampleFilter extends DomainExceptionFilter<SampleDomainError> implements ExceptionFilter {
  protected readonly mappings: DomainErrorMapping<SampleDomainError> = [
    [NotFoundSampleError, (error) => new NotFoundException(error.message)],
    [ConflictSampleError, (error) => new ConflictException(error.message)],
  ];
}

@Catch(SampleDomainError)
class EmptyFilter extends DomainExceptionFilter<SampleDomainError> implements ExceptionFilter {
  protected readonly mappings: DomainErrorMapping<SampleDomainError> = [];
}

@Catch(SampleDomainError)
class OrderedFilter extends DomainExceptionFilter<SampleDomainError> implements ExceptionFilter {
  protected readonly mappings: DomainErrorMapping<SampleDomainError> = [
    [SpecificError, (error) => new ConflictException(error.message)],
    [NotFoundSampleError, (error) => new NotFoundException(error.message)],
  ];
}
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/common/__tests__/http/domain-exception.filter.spec.ts`
Expected: FAIL — `Cannot find module '../../http/domain-exception.filter'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/common/http/domain-exception.filter.ts
import { BadRequestException, type ExceptionFilter, type HttpException } from '@nestjs/common';

/**
 * Un mapeo es un par «clase de error de dominio → cómo se convierte en HttpException».
 *
 * `abstract new (...args: never[]) => E` acepta cualquier constructor, abstracto o concreto:
 * lo único que se le pide es tener `prototype`, que es lo que `instanceof` mira. Los
 * constructores de los errores de dominio tienen firmas dispares (`constructor()`,
 * `constructor(readonly value: string)`) y `never[]` las cubre todas por contravarianza.
 *
 * El callback recibe `E` —el marcador del contexto—, no la subclase concreta. Es deliberado:
 * ninguno de los seis mapeos del repo necesita una propiedad propia de la subclase; todos
 * usan `.message` o una constante. Estrechar el tipo pediría un helper genérico con un cast
 * dentro, y sería API sin consumidor.
 */
export type DomainErrorMapping<E extends Error> = ReadonlyArray<
  readonly [abstract new (...args: never[]) => E, (error: E) => HttpException]
>;

/**
 * Base de los filtros que traducen errores de dominio al protocolo HTTP. Vive en `common/`
 * —y no en `shared/domain/`— porque importa `@nestjs/common`, que la policy de
 * `shared-domain` prohíbe expresamente. La regla la impone el gate, no el gusto.
 *
 * Cada módulo declara SOLO su mapa; el recorrido está aquí. Antes eran tres clases con la
 * misma cadena de `instanceof` escrita a mano.
 *
 * ⚠️ **El orden del mapa importa**: gana el PRIMER `instanceof` que coincide. Si un error
 * extiende a otro, el específico va antes. Está fijado por un caso del spec.
 *
 * El filtro RE-LANZA, no escribe la respuesta: quien la formatea es `AllExceptionsFilter`,
 * que es global. Y las excepciones se construyen con STRING, nunca con objeto, para que Nest
 * rellene `body.error` con el nombre canónico (`Not Found`, `Conflict`) — que es lo que
 * `buildErrorExample` deriva del status— en vez del nombre de la clase de dominio.
 *
 * El fallback 400 es deliberado y no un descuido: un error de dominio nuevo sin mapear
 * significa que el cliente pidió algo que el dominio rechaza, y eso es entrada inválida,
 * no un fallo del servidor.
 */
export abstract class DomainExceptionFilter<E extends Error> implements ExceptionFilter {
  protected abstract readonly mappings: DomainErrorMapping<E>;

  catch(exception: E): never {
    for (const [ErrorClass, toHttpException] of this.mappings) {
      if (exception instanceof ErrorClass) {
        throw toHttpException(exception);
      }
    }
    throw new BadRequestException(exception.message);
  }
}
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/common/__tests__/http/domain-exception.filter.spec.ts`
Expected: PASS — 6 passed

---

## Task 13: Los tres filtros de módulo usan la base

**Layer:** infrastructure
**Rule codes to honor:** `error-use-exception-filters`, `security-sanitize-output`

**Casos acordados:** ninguna tabla. Infra, y sin lógica nueva: los tres specs existentes (82 + 147 + 57 LOC) son la red y deben quedar verdes **sin tocar aserciones**.

**Files:**

- Modify: `src/modules/users/infrastructure/http/user-domain-exception.filter.ts`
- Modify: `src/modules/auth/infrastructure/http/auth-domain-exception.filter.ts`
- Modify: `src/modules/orders/infrastructure/http/orders-domain-exception.filter.ts`

- [ ] **Step 1: Reescribe el de `users`**

```ts
// src/modules/users/infrastructure/http/user-domain-exception.filter.ts
import { Catch, ConflictException, NotFoundException } from '@nestjs/common';

import {
  DomainExceptionFilter,
  type DomainErrorMapping,
} from '@common/http/domain-exception.filter';

import {
  EmailAlreadyTakenError,
  UserDomainError,
  UserNotFoundError,
} from '../../domain/errors/user.errors';

/**
 * Traduce los errores del dominio al protocolo HTTP. Vive en `infrastructure/http/`
 * justamente para que el dominio no tenga que saber qué es un 404: el dominio lanza
 * `UserNotFoundError` y es el adaptador quien decide el código de estado.
 *
 * Las excepciones se construyen con STRING a propósito: así Nest rellena `body.error` con el
 * nombre canónico —que es lo que `buildErrorExample` deriva del status— en vez del nombre de
 * la clase de dominio.
 *
 * `InvalidEmailError`, `InvalidUserIdError` e `InvalidUserNameError` NO están en el mapa: el
 * fallback de la base ya las convierte en 400, que es exactamente lo que hacían sus tres
 * ramas explícitas. La rama de credenciales se fue con el hash al filtro de `auth` (ciclo 4).
 */
@Catch(UserDomainError)
export class UserDomainExceptionFilter extends DomainExceptionFilter<UserDomainError> {
  protected readonly mappings: DomainErrorMapping<UserDomainError> = [
    [UserNotFoundError, (error) => new NotFoundException(error.message)],
    [EmailAlreadyTakenError, (error) => new ConflictException(error.message)],
  ];
}
```

- [ ] **Step 2: Reescribe el de `auth`**

```ts
// src/modules/auth/infrastructure/http/auth-domain-exception.filter.ts
import {
  Catch,
  ConflictException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';

import {
  DomainExceptionFilter,
  type DomainErrorMapping,
} from '@common/http/domain-exception.filter';

import {
  AuthDomainError,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  InvalidPasswordHashError,
} from '../../domain/errors/auth.errors';

/**
 * Traduce los errores de dominio de `auth` al protocolo HTTP, patrón del filtro de users.
 *
 * `InvalidPasswordHashError` es el único de los tres contextos que NO cae en el fallback 400:
 * no es entrada inválida del cliente sino CORRUPCIÓN de un dato ya persistido (una fila
 * escrita a mano con un password en claro). El mensaje que sale es genérico y el original
 * viaja en `cause`, para el log y no para el cliente.
 *
 * `InvalidProfileError` y `InvalidCredentialIdError` no están en el mapa: el fallback 400 de
 * la base es la traducción correcta para ambos.
 */
@Catch(AuthDomainError)
export class AuthDomainExceptionFilter extends DomainExceptionFilter<AuthDomainError> {
  protected readonly mappings: DomainErrorMapping<AuthDomainError> = [
    [InvalidCredentialsError, (error) => new UnauthorizedException(error.message)],
    [EmailAlreadyRegisteredError, (error) => new ConflictException(error.message)],
    [
      InvalidPasswordHashError,
      (error) =>
        new InternalServerErrorException('Internal server error', {
          description: 'InternalServerError',
          cause: error,
        }),
    ],
  ];
}
```

- [ ] **Step 3: Reescribe el de `orders`**

```ts
// src/modules/orders/infrastructure/http/orders-domain-exception.filter.ts
import { Catch, ForbiddenException } from '@nestjs/common';

import {
  DomainExceptionFilter,
  type DomainErrorMapping,
} from '@common/http/domain-exception.filter';

import { CustomerGoneError, OrderDomainError } from '../../domain/errors/order.errors';

/**
 * Traduce los errores del dominio de orders al protocolo HTTP, patrón del filtro de users.
 *
 * El 403 se construye con STRING y con el mensaje canónico FIJO (lección del ciclo auth):
 * `new ForbiddenException('Forbidden')` hace que Nest rellene `body.error` con el nombre
 * canónico y no filtra si el usuario fue borrado o desactivado — para el caller es lo mismo,
 * «este token ya no compra».
 *
 * El `@Catch` es ancho (`OrderDomainError`) y no solo `CustomerGoneError` a propósito:
 * `@Length(1, 140)` del DTO NO recorta espacios, así que un concepto de solo espacios pasa el
 * transporte y muere en `OrderConcept.from()` — entrada inválida, 400 por el fallback de la
 * base, no un 500.
 */
@Catch(OrderDomainError)
export class OrdersDomainExceptionFilter extends DomainExceptionFilter<OrderDomainError> {
  protected readonly mappings: DomainErrorMapping<OrderDomainError> = [
    [CustomerGoneError, () => new ForbiddenException('Forbidden')],
  ];
}
```

- [ ] **Step 4: Ejecuta los tres specs**

Run: `pnpm test domain-exception.filter`
Expected: PASS — los 4 archivos (base + 3 módulos) verdes, y los tres de módulo **sin una sola aserción tocada**.

- [ ] **Step 5: Comprueba de extremo a extremo**

Run: `pnpm test:e2e -- users auth orders`
Expected: PASS — los códigos y cuerpos publicados no se movieron.

---

## Task 14: Helpers de ejemplos OpenAPI

**Layer:** common (+ los tres controllers y `health` en infrastructure)
**Rule codes to honor:** `arch-single-responsibility`

**Casos acordados:** ninguna tabla. Infra y documentación; su red es `openapi-contract.e2e-spec.ts`.

**Files:**

- Modify: `src/common/dto/error-example.factory.ts`
- Create: `src/common/dto/openapi-example.helpers.ts`
- Modify: `src/modules/{users,orders,auth}/infrastructure/http/*.controller.ts`
- Modify: `src/common/dto/api-envelope.dto.ts`, `src/common/dto/error-response.dto.ts`
- Modify: `src/modules/health/health.controller.ts`

- [ ] **Step 1: Exporta las dos constantes de la factoría**

En `src/common/dto/error-example.factory.ts`, cambia `const TIMESTAMP` y `const REQUEST_ID` a `export const`, y documenta por qué:

```ts
/**
 * Instante y request-id de TODOS los ejemplos publicados. Se exportan porque el mismo par
 * aparece en los ejemplos de éxito de los controllers, y tenerlo escrito a mano en cada
 * sitio era la vía por la que el literal acabó repetido 18 veces en `src/`.
 */
export const TIMESTAMP = '2026-08-01T10:15:00.000Z';
export const REQUEST_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
```

- [ ] **Step 2: Crea los helpers**

```ts
// src/common/dto/openapi-example.helpers.ts
import { buildErrorExample, REQUEST_ID, TIMESTAMP } from './error-example.factory';

/**
 * Lo que `TransformInterceptor` añade a toda respuesta de éxito. Estaba duplicado literalmente
 * en los tres controllers.
 */
export const requestMeta = (
  path: string,
): { timestamp: string; path: string; requestId: string } => ({
  timestamp: TIMESTAMP,
  path,
  requestId: REQUEST_ID,
});

/**
 * Los ejemplos de error salen SIEMPRE de la factoría, que deriva `error` del status en vez de
 * recibirlo. Escribirlo a mano fue el origen de dos ficciones en la primera versión de
 * `users.controller.ts`: anunciaba `EmailAlreadyTakenError` y `UserNotFoundError`, cuando el
 * filtro publica los nombres canónicos `Conflict` y `Not Found`.
 */
export const errorExample = (statusCode: number, message: string, path: string) =>
  buildErrorExample(statusCode, { path, message });
```

- [ ] **Step 3: Borra las copias locales de los tres controllers**

En `users.controller.ts`, `orders.controller.ts` y `auth.controller.ts`: elimina las declaraciones locales de `requestMeta` y `errorExample` (con sus comentarios, que se han trasladado al helper) y añade el import:

```ts
import { errorExample, requestMeta } from '@common/dto/openapi-example.helpers';
```

⚠️ El import de `buildErrorExample` deja de hacer falta en los tres si no se usa en ningún otro sitio del archivo. Deja que `lint:check` te lo diga en vez de adivinar.

- [ ] **Step 4: Unifica el resto de literales**

Sustituye el literal del request-id y el del timestamp por `REQUEST_ID` y `TIMESTAMP` importados de `@common/dto/error-example.factory` en: `api-envelope.dto.ts`, `error-response.dto.ts` y `health.controller.ts`. Además de los ejemplos de éxito que hayan quedado en los tres controllers.

- [ ] **Step 5: Verifica que el literal quedó en un solo sitio**

Run: `grep -rn "3f2504e0-4f89-41d3-9a0c-0305e82c3301" src/ | grep -v "__tests__"`
Expected: **exactamente una** línea, en `src/common/dto/error-example.factory.ts`.

Run: `grep -rn "const requestMeta\|const errorExample" src/`
Expected: **exactamente dos** líneas, ambas en `src/common/dto/openapi-example.helpers.ts`.

- [ ] **Step 6: El guardián del contrato debe seguir verde**

Run: `pnpm test:e2e -- openapi-contract`
Expected: PASS. Es lo que detectaría si algún `example:` dejara de resolverse en tiempo de decorador al pasar de literal a constante importada.

---

## Task 15: Verificación integral

**Layer:** —
**Rule codes to honor:** —

**Casos acordados:** ninguna. Es la verificación del ciclo.

- [ ] **Step 1: Definition of Done completa**

Run:

```bash
pnpm typecheck && pnpm lint:check && pnpm format:check && pnpm test
```

Expected: los cuatro en verde.

- [ ] **Step 2: Suite E2E con base de datos**

Run:

```bash
pnpm db:up
pnpm db:migrate:test
pnpm test:e2e
pnpm build
```

Expected: todo verde.

- [ ] **Step 3: Las fronteras siguen intactas sin haber tocado la matriz**

Run: `pnpm test src/__tests__/eslint-boundaries.spec.ts`
Expected: PASS — y `git diff --stat eslint.boundaries.js` debe estar **vacío**. Si esa suite pide una regla nueva, algo quedó mal ubicado: consúltalo antes de editar la matriz.

- [ ] **Step 4: El auditor de mutación acepta el kernel nuevo**

Run: `pnpm test:mutation --mutate "src/shared/domain/**/*.ts"`
Expected: score por encima de `break: 85`. Las tres bases nuevas entran al censo sin editar `stryker.config.mjs`, porque `src/shared/domain/**/*.ts` ya está en su `mutate`.

- [ ] **Step 5: La duplicación desapareció de verdad**

Run:

```bash
grep -rn "extends Error" src/modules/*/domain/errors/*.ts
grep -rn "const UUID_V4" src/
grep -rn "const requestMeta\|const errorExample" src/
```

Expected: el primero **sin resultados**; el segundo, **una** línea en `uuid-id.base.ts`; el tercero, **dos** líneas en `openapi-example.helpers.ts`.

- [ ] **Step 6: Prueba de humo del objetivo real**

Escribe **a mano y sin copiar de `users`** el esqueleto de un contexto sintético `billing`, usando solo las bases:

```ts
// src/modules/billing/domain/errors/billing.errors.ts
import { DomainError } from '@shared/domain/domain-error.base';

export abstract class BillingDomainError extends DomainError {}

export class InvalidInvoiceIdError extends BillingDomainError {
  constructor(readonly value: string) {
    super(`"${value}" is not a valid invoice id`);
  }
}

export class InvoiceNotFoundError extends BillingDomainError {
  constructor(readonly invoiceId: string) {
    super(`Invoice ${invoiceId} was not found`);
  }
}
```

```ts
// src/modules/billing/domain/value-objects/invoice-id.vo.ts
import { randomUUID } from 'node:crypto';

import { UuidId } from '@shared/domain/uuid-id.base';

import { InvalidInvoiceIdError } from '../errors/billing.errors';

export class InvoiceId extends UuidId {
  static generate(): InvoiceId {
    return new InvoiceId(randomUUID());
  }

  static from(value: string): InvoiceId {
    return new InvoiceId(UuidId.assertUuid(value, (invalid) => new InvalidInvoiceIdError(invalid)));
  }
}
```

```ts
// src/modules/billing/domain/entities/invoice.entity.ts
import { Entity } from '@shared/domain/entity.base';

import type { InvoiceId } from '../value-objects/invoice-id.vo';

export class Invoice extends Entity<InvoiceId> {
  private constructor(
    id: InvoiceId,
    private _amountCents: number,
    createdAt: Date,
    updatedAt: Date,
  ) {
    super(id, createdAt, updatedAt);
  }

  static issue(params: { id: InvoiceId; amountCents: number; now: Date }): Invoice {
    return new Invoice(params.id, params.amountCents, params.now, params.now);
  }

  get amountCents(): number {
    return this._amountCents;
  }

  correctAmount(amountCents: number, now: Date): void {
    this._amountCents = amountCents;
    this.touch(now);
  }
}
```

```ts
// src/modules/billing/infrastructure/http/billing-domain-exception.filter.ts
import { Catch, NotFoundException } from '@nestjs/common';

import {
  DomainExceptionFilter,
  type DomainErrorMapping,
} from '@common/http/domain-exception.filter';

import { BillingDomainError, InvoiceNotFoundError } from '../../domain/errors/billing.errors';

@Catch(BillingDomainError)
export class BillingDomainExceptionFilter extends DomainExceptionFilter<BillingDomainError> {
  protected readonly mappings: DomainErrorMapping<BillingDomainError> = [
    [InvoiceNotFoundError, (error) => new NotFoundException(error.message)],
  ];
}
```

Run: `pnpm typecheck && pnpm lint:check`
Expected: ambos en verde — el contexto nuevo compila y **no viola ninguna frontera** sin haber editado la matriz.

- [ ] **Step 7: Borra el contexto sintético**

Run: `rm -rf src/modules/billing`
Expected: `pnpm typecheck` sigue verde. **`billing` no se commitea** — era la verificación, no el entregable.

- [ ] **Step 8: Sugiere el commit**

No ejecutes `git commit`. Traslada al usuario:

> _"Te sugiero hacer un commit de los cambios por haber completado el ciclo de la base común de dominio y de transporte, con el DoD y el gate de mutación en verde."_

Y espera su instrucción explícita.

---

## Notas para quien ejecute

- **`pnpm test` no comprueba tipos.** `jest.config.mjs` usa `@swc/jest` puro. Para cualquier
  tarea que cambie una firma, un genérico o un tipo, **el rojo se captura con `pnpm typecheck`**;
  la suite puede seguir verde sobre código que no compila. Lo aprendimos midiéndolo en la
  Tarea 7. Y al revés: un `typecheck` verde tampoco garantiza comportamiento — para eso están
  los casos acordados.

- **`import type` está prohibido para los puertos** en archivos con decoradores (`application/`, `infrastructure/`): la referencia se borra del emit y Nest falla **en runtime** con `lint:check` y `typecheck` en verde. Ninguna tarea de este plan introduce un puerto nuevo, pero el import de `CredentialId` en el mapper (Task 9) va como valor por la misma familia de razones.
- **Nada de barrels.** No crees ningún `index.ts` bajo `src/`: la regla 5 del gate lo prohíbe y `existir` es el error. Cada import apunta al archivo concreto.
- **Si un spec existente se pone rojo y la tentación es tocar su aserción, para y consulta.** Salvo los ajustes de _arrange_ que este plan nombra explícitamente (Task 9 Step 3, Task 11 Step 3), una aserción que cambia significa que el refactor alteró comportamiento.
- **Ningún caso nuevo se añade en silencio.** Si al implementar aparece un caso que no está en las Tablas A-D, se consulta y se registra la fila en este plan antes de escribir su test.
