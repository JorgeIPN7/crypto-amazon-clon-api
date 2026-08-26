# Base común de dominio y de transporte

- **Fecha:** 2026-08-22
- **Estado:** aprobado, pendiente de plan
- **Origen:** sesión de `brainstorming` sobre «una carpeta `core` para que todo tenga la misma
  base y estructura», con `bridge-fital-pti-api/src/core` como referencia.

---

## 1. Objetivo

Factorizar en `src/shared/domain/` y `src/common/` las cinco piezas que hoy están duplicadas
—o directamente ausentes— para que un bounded context nuevo herede la forma correcta sin copiar
nada de otro módulo.

---

## 2. Bounded context y ubicación

**Ninguno.** Este cambio no crea ni modifica un bounded context: reparte código transversal
entre las dos carpetas que el repo ya tiene para eso, según una línea divisoria que la matriz de
fronteras **ya impone y verifica**:

| Destino                                | Qué va ahí                                           | Por qué ahí                                                                                                                      |
| -------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/domain/` (`shared-domain`) | `DomainError`, `UuidId`, `Entity`                    | Dominio puro. La policy prohíbe a `shared-domain` importar `@nestjs/*`, `typeorm`, `pino`, `class-validator`, `axios` y `argon2` |
| `src/common/` (`common`)               | `DomainExceptionFilter`, helpers de ejemplos OpenAPI | Tocan `@nestjs/common` y `@nestjs/swagger`, que en `shared-domain` están vetados                                                 |

### Alternativa descartada: crear `src/core/`

Se evaluó replicar la forma del repo de referencia. Se descartó porque **duplicaría el element
type `shared-domain`**, que ya existe con su propia policy, su lista negra de externals y su
cobertura en la suite de fronteras. El coste medido era: +2 element types, +4 policies y ~6 casos
nuevos en `src/__tests__/eslint-boundaries.spec.ts`, a cambio de cero capacidad nueva.

También se descartó **renombrar `src/shared/` a `src/core/`**: era viable (2 patterns, el alias en
3 archivos, ~8 imports), pero `core` ya significa otra cosa dentro de `eslint.boundaries.js` —
los builtins de Node llegan al plugin como `origin: 'core'`, y esa cadena aparece en ese mismo
archivo. Dos sentidos para una palabra en un archivo de reglas es una trampa.

**Consecuencia: este spec no edita `eslint.boundaries.js` ni añade casos a su suite.** Las policies
`module-domain → shared-domain` y `module-infrastructure → common` ya cubren todo lo que aquí se
introduce. Si al ejecutar hiciera falta tocar la matriz, es señal de que algo está mal ubicado.

---

## 3. Modelo de dominio

### 3.1 `DomainError` — raíz de los errores de negocio

```
DomainError (abstract)
├── UserDomainError (abstract)  → InvalidEmailError, InvalidUserIdError, …
├── AuthDomainError (abstract)  → InvalidCredentialsError, EmailAlreadyRegisteredError, …
└── OrderDomainError (abstract) → InvalidOrderIdError, CustomerGoneError, …
```

Hoy los tres marcadores de módulo redeclaran **el mismo cuerpo, carácter por carácter**:
`extends Error`, `protected constructor`, `this.name = new.target.name`. Pasan a heredar de
`DomainError`.

**Invariante que se conserva:** `this.name` sigue siendo el nombre de la clase **concreta**, no
el de ninguna base. `new.target` es la función invocada con `new`, y no cambia por añadir un
nivel a la cadena.

**Invariante que hay que probar explícitamente:** los tres marcadores siguen siendo clases
distintas, así que `@Catch(UserDomainError)` **no** captura un `AuthDomainError`. Compartir
abuelo no ensancha el `instanceof`.

### 3.2 `UuidId` — identidad

```
ValueObject<string>
└── UuidId (abstract)
    ├── UserId
    ├── OrderId
    └── CredentialId  ← nuevo
```

`UUID_V4` está hoy duplicado byte a byte en `user-id.vo.ts` y `order-id.vo.ts`. Sube al kernel.

`UuidId` expone `protected static assertUuid(value, invalid)`: valida el formato y **delega el
error** en un callback, porque el kernel no puede conocer `InvalidUserIdError` — vive en un
módulo, y `shared-domain` no importa de `modules/`.

Se descartó validar dentro del constructor de `UuidId`: obligaría a ejecutar sentencias antes de
`super()`, legal en TypeScript solo bajo condiciones sutiles. La factoría estática obtiene el
mismo resultado sin depender de esa regla.

**`CredentialId` es nuevo.** Hoy `Credential.id` es un `string` crudo. `Entity` exige un id
comparable, y la uniformidad es el objetivo declarado del ciclo. **No cambia el esquema**: la
columna sigue siendo `uuid` y `CredentialSnapshot.id` sigue siendo `string`.

### 3.3 `Entity` — identidad, vigencia e igualdad

```
Entity<TId extends UuidId>
├── User               extends Entity<UserId>
├── Credential         extends Entity<CredentialId>
└── AggregateRoot<TId, TEvent> extends Entity<TId>
    └── Order          extends AggregateRoot<OrderId, OrderPlaced>
```

Aporta `readonly id`, `readonly createdAt`, `updatedAt` (privado con getter), `touch(now)` y
`equals(other)`.

**`TId extends UuidId`, no `ValueObject<unknown>`.** Todos los ids del repo son UUID; el bound
estrecho evita depender de la bivarianza de métodos de TypeScript para que la asignación
compile. Se generaliza el día que exista un id que no sea UUID — no antes.

**`AggregateRoot` pasa de uno a dos parámetros de tipo.** Es la única forma de que `Order` tenga
identidad y eventos a la vez: TypeScript da una sola ranura de herencia. `record()` y
`pullEvents()` no cambian.

#### Tres divergencias deliberadas con el repo de referencia

Las tres se decidieron sobre defectos **medidos** en `bridge-fital-pti-api`, no supuestos:

| Allí                                  | Aquí                                   | Motivo                                                                                                                                           |
| ------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `touch()` llama a `new Date()`        | `touch(now: Date)` recibe el reloj     | Este repo ya inyecta `now` en todo el dominio (`rename(name, now)`, `place({…, now})`). Copiar aquel patrón obligaría a fake timers para testear |
| `Entity.equals` compara solo el id    | Compara `constructor` **antes** del id | Allí `wallet.equals(purchase)` da `true` si comparten UUID. Aquí se alinea con `ValueObject.equals`, que ya lo hace bien                         |
| `Id.fromString()` lanza `Error` plano | Los VOs lanzan error de dominio        | Allí un UUID inválido del cliente sale como **500 con el texto interno filtrado**; aquí sale como 400 por el filtro del módulo                   |

#### `Order` y sus timestamps — decisión con consecuencia

`Order` tiene `placedAt` y **no** tiene `createdAt` ni `updatedAt`: la tabla `orders` nunca las
tuvo, y `order.orm-entity.ts` documenta hoy por qué.

**Decisión: `orders` gana `created_at` y `updated_at` junto a `placed_at`, que se conserva.**

- ⚠️ **`created_at == placed_at` en toda fila.** Redundancia aceptada a cambio de que toda tabla
  del esquema responda «cuándo se creó» sin excepciones.
- ⚠️ **El comentario de `order.orm-entity.ts` queda desmentido** y se reescribe, no se borra:
  debe explicar por qué `placed_at` sobrevive — es el hecho de negocio que viaja en `OrderPlaced`,
  no el timestamp de la fila.
- ✅ **No rompe el contrato publicado.** `OrderResponseDto` sigue exponiendo solo `placedAt`.

Alternativas descartadas: renombrar `placed_at` a `created_at` (rompía el contrato de
`POST /orders`), y partir la base en `Entity` + `TimestampedEntity` (era la opción técnicamente
más limpia, descartada por decisión del usuario a favor de la uniformidad del esquema).

---

## 4. Puertos

**Ninguno nuevo.** No se crean ni se modifican puertos: este cambio no introduce ninguna
dependencia invertida. Las bases son clases de dominio y una clase abstracta de infraestructura
HTTP, no contratos inyectables.

Los puertos existentes (`UserRepository`, `CredentialRepository`, `OrderRepository`,
`CustomerDirectory`, `UserDirectory`, `PasswordHasher`, `TokenSigner`, `UsersLookup`,
`UsersProvisioning`) siguen siendo `abstract class` y no cambian de firma.

⚠️ `CredentialRepository.findByUserId(userId: string)` **no cambia**: `userId` es el id de un
usuario de otro contexto, no la identidad de la credencial. `CredentialId` solo afecta a la
identidad propia del agregado.

---

## 5. Casos de uso

**Ninguno nuevo, y ninguno cambia de firma.** `CreateUserUseCase`, `RegisterAccountUseCase`,
`LoginUseCase`, `PlaceOrderUseCase`, `FindUserByIdUseCase`, `ListUsersUseCase` y
`DeactivateUserUseCase` conservan su `execute()` y su tipo de entrada.

Cambia solo lo que construyen por dentro: `Credential.create()` pasa a acuñar un `CredentialId`
en vez de llamar a `randomUUID()`, y `Order.place()` sella `createdAt`/`updatedAt` con el mismo
`now` que ya recibe.

---

## 6. Adaptadores

### 6.1 `DomainExceptionFilter` — base de los tres filtros HTTP

Hoy hay tres clases con el mismo esqueleto: `@Catch(XDomainError)`, cadena de `instanceof`, y
`throw new BadRequestException(exception.message)` como fallback. 164 LOC entre las tres.

La base aporta el recorrido; cada módulo declara solo su mapa `[ErrorClass, → HttpException]`:

| Filtro   | Mapa                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| `users`  | `UserNotFoundError`→404, `EmailAlreadyTakenError`→409                                                        |
| `auth`   | `InvalidCredentialsError`→401, `EmailAlreadyRegisteredError`→409, `InvalidPasswordHashError`→500 con `cause` |
| `orders` | `CustomerGoneError`→403 con el mensaje canónico `Forbidden`                                                  |

⚠️ **El orden del array es significativo:** gana el primer `instanceof` que matchea. Va en el
JSDoc y en la tabla de casos.

**Tres razones documentadas que un refactor descuidado borraría, y que se preservan íntegras:**

1. Las excepciones se construyen **con string**, nunca con objeto, para que Nest rellene
   `body.error` con el nombre canónico (`Not Found`, `Conflict`) y no con el de la clase de
   dominio. Es lo que `buildErrorExample` deriva del status.
2. El 403 de `orders` lleva mensaje fijo: no revela si el usuario fue borrado o desactivado.
3. El fallback 400 es deliberado — un error de dominio nuevo sin mapear es entrada inválida, no
   fallo del servidor.

Los tres filtros siguen **re-lanzando**, no escribiendo la respuesta: quien la formatea es
`AllExceptionsFilter`, que no se toca.

### 6.2 Helpers de ejemplos OpenAPI

`requestMeta(path)` y `errorExample(status, message, path)` están duplicados literalmente en los
tres controllers, y el literal del `requestId` de ejemplo aparece **18 veces** en `src/`. Todo
pasa a `src/common/dto/openapi-example.helpers.ts`, alimentado por las constantes de
`error-example.factory.ts`, que hoy son privadas y se exportan.

### 6.3 Persistencia

`order.orm-entity.ts` gana dos columnas. Una migración **aditiva** las añade y las rellena desde
`placed_at`:

```sql
ALTER TABLE "orders" ADD "created_at" TIMESTAMP WITH TIME ZONE;
ALTER TABLE "orders" ADD "updated_at" TIMESTAMP WITH TIME ZONE;
UPDATE "orders" SET "created_at" = "placed_at", "updated_at" = "placed_at";
ALTER TABLE "orders" ALTER COLUMN "created_at" SET NOT NULL;
ALTER TABLE "orders" ALTER COLUMN "updated_at" SET NOT NULL;
```

**No requiere expand/contract.** La regla de `CLAUDE.md` aplica a lo que suelta o renombra; el
código viejo ignora columnas que no conoce. El relleno desde `placed_at` en vez de `now()` es lo
que hace la migración honesta: para una fila existente, el momento de creación **es** el de
colocación.

Los tres mappers se adaptan. `user.mapper.ts` y `credential.mapper.ts` solo cambian el tipo del
id; `order.mapper.ts` lee y escribe las dos columnas nuevas.

---

## 7. Transversales

| Aspecto                                    | Decisión                                                                                                                                               | Rule code                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Traducción de error de dominio a HTTP      | Una base en `common/`, un mapa por módulo. El dominio nunca conoce códigos HTTP                                                                        | `error-use-exception-filters`, `error-throw-http-exceptions` |
| Una responsabilidad por base               | `DomainError` (identidad del error), `UuidId` (formato), `Entity` (identidad y vigencia), `DomainExceptionFilter` (traducción). Ninguna hace dos cosas | `arch-single-responsibility`                                 |
| Compartir entre módulos                    | Solo por `shared/domain` y `common`. Ningún módulo importa de otro salvo por su `*.module.ts`                                                          | `arch-module-sharing`                                        |
| Sin ciclos                                 | `shared-domain` y `common` no importan de `modules/`. `UuidId` delega el error por callback justo para no invertir esa flecha                          | `arch-avoid-circular-deps`                                   |
| Sustituibilidad                            | Toda subclase de `Entity` debe valer donde vale `Entity`. `AggregateRoot` la extiende sin debilitar `equals()` ni redefinir `touch()`                  | `di-liskov-substitution`                                     |
| El mapa del filtro es la superficie mínima | Cada filtro declara solo los errores que traduce; no hereda ramas que no le tocan                                                                      | `di-interface-segregation`                                   |
| Salida saneada                             | El 403 de `orders` conserva el mensaje canónico: no distingue «borrado» de «desactivado»                                                               | `security-sanitize-output`                                   |
| Validación                                 | Sigue en los DTO de HTTP. Las bases no validan transporte; `UuidId` valida una invariante de dominio, que es otra cosa                                 | `security-validate-all-input`                                |
| Logging                                    | Sin cambios. `AllExceptionsFilter` sigue decidiendo severidad y `DEFAULT_REDACT_PATHS` no se toca                                                      | —                                                            |
| Caché / throttling                         | Sin cambios                                                                                                                                            | —                                                            |

---

## 8. Estrategia de pruebas

Por capa, según el skill `javascript-typescript-jest` y las convenciones del repo (`describe` con
el identificador real, `it` en español empezando por «debería», AAA obligatorio, 1:1 spec↔archivo).

| Pieza                   | Suite                                                              | Cómo                                                                                                                                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DomainError`           | unitaria — `src/shared/__tests__/domain/domain-error.base.spec.ts` | Sin mocks. Subclase sintética; comprueba `name`, `message`, `instanceof` y que dos marcadores hermanos no se capturan entre sí                                                                                                                                                               |
| `UuidId`                | unitaria + `fast-check`                                            | Arbitrario **construido** de UUID v4, nunca `fc.string().filter()`. Propiedad: `from(generate().value)` siempre reconstruye                                                                                                                                                                  |
| `Entity`                | unitaria                                                           | Entidad sintética. `equals` con: mismo id, id distinto, `null`, `undefined`, y **otra clase con el mismo id** (el caso que en el repo de referencia falla)                                                                                                                                   |
| `AggregateRoot`         | unitaria — spec existente **reescrito**                            | La firma pasa a dos parámetros de tipo; `pullEvents()` debe seguir drenando                                                                                                                                                                                                                  |
| `User`                  | unitaria — spec existente                                          | Verde **sin tocar una sola línea**. `touch(now)` debe comportarse igual que la asignación directa que sustituye                                                                                                                                                                              |
| `Credential`            | unitaria — spec existente **con 4 aserciones corregidas**          | `id` pasa de `string` a objeto. Tres aserciones fallan y se arreglan comparando `.value`; **una cuarta pasaría sin probar nada** (`expect(a.id).not.toBe(b.id)` se cumple siempre entre objetos distintos) y por eso se corrige aunque esté verde                                            |
| `Order`                 | unitaria — spec existente + 3 casos nuevos                         | `place()` sella tres instantes y `toSnapshot()` publica dos campos más: eso es comportamiento nuevo y lleva su propia tabla de casos en el plan                                                                                                                                              |
| `DomainExceptionFilter` | unitaria — `src/common/__tests__/http/`                            | Sin `Test.createTestingModule`: se instancia directo. Casos: match del primer mapeo, orden significativo, fallback 400, mapa vacío                                                                                                                                                           |
| Los 3 filtros de módulo | unitaria — specs existentes                                        | Verdes sin tocar. Son la red que detecta si la base cambió una traducción                                                                                                                                                                                                                    |
| Migración de `orders`   | E2E sobre **base desechable**                                      | `up` → `revert` → `up` con filas dentro; `created_at` debe quedar igual a `placed_at`. La base propia la exige el backlog #17 del template: si una aserción falla a mitad de un `undoLastMigration()`, la base compartida se queda sin las columnas y arrastra a todas las suites siguientes |
| Contrato OpenAPI        | E2E — `openapi-contract.e2e-spec.ts`                               | Verde sin cambios: la respuesta de `POST /orders` no se altera                                                                                                                                                                                                                               |

**Mocking por capa:** cero mocks en `domain/`; fakes escritos a mano en `application/`; los
repositorios contra PostgreSQL real en E2E. `test-use-testing-module` solo donde ya se usaba;
`test-e2e-supertest` para lo que cruza HTTP.

**Auditoría de mutación:** `src/shared/domain/**` ya está en el `mutate` de `stryker.config.mjs`,
así que las tres bases de dominio entran al auditor **sin editar la config**. El umbral
`break: 85` sigue vigente. `src/common/**` queda fuera del scope, como toda la infraestructura.

**Modelo de colaboración:** `DomainError`, `UuidId` y `Entity` son `domain/` → llevan tabla de
«Casos acordados» pactada en el plan antes de escribir código. `DomainExceptionFilter`, los
helpers de OpenAPI, la migración y el wiring quedan exentos.

**Prueba de humo del objetivo real:** escribir a mano el esqueleto de un `billing` sintético
(entidad + id + error + filtro) usando solo las bases, sin copiar de `users`, y comprobar que
compila y que el gate de fronteras lo acepta. No se commitea — es la verificación de que el ciclo
consiguió lo que perseguía.

---

## 9. Fuera de alcance

- **No se crea `src/core/`** ni se renombra `src/shared/`.
- **No se crea `TimestampedEntity`.** Era la alternativa que evitaba tocar el esquema de `orders`;
  el usuario eligió la uniformidad del esquema por encima de la del modelo. Queda anotado aquí por
  si el criterio cambia.
- **No se tocan** `eslint.boundaries.js`, `eslint.config.mjs`, `stryker.config.mjs`,
  `jest.config.mjs` ni los alias de `tsconfig.json` / `.swcrc`.
- **No se abstraen** mappers, repositorios TypeORM, fakes en memoria ni puertos: repiten
  estructura pero no texto, y el retorno no compensa el acoplamiento.
- **No se toca ningún contrato publicado**, `OrderResponseDto` incluido.
- **No se arregla el hueco de `shared/` sin acceso a `shared/domain/`** (backlog #19a del
  template): la decisión escrita dice que se arregla con el primer archivo de `src/shared/` fuera
  de `domain/`, y este ciclo no añade ninguno.
- **No entra `timestampArb`**, duplicado en dos `arbitraries.ts`: vive en `test/helpers/`, fuera
  del grafo de fronteras. Ciclo aparte de dos líneas.
- **No se arreglan los defectos de `bridge-fital-pti-api`** detectados durante el análisis
  (`DB_SYNC=true` en producción con `z.coerce.boolean()` que impide apagarlo, `synchronize: true`
  en su `data-source.ts`, `ValueObject.equals` con `JSON.stringify`). Es otro repositorio.
