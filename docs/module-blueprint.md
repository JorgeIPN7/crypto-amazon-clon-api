# Blueprint de un bounded context

Qué lleva un módulo de este repo, **qué es obligatorio y qué no**, y en qué orden se construye.

`src/modules/users/` es la implementación de referencia, pero **no todo lo suyo es obligatorio**:
tiene una fachada segregada en dos tokens, paginación y traducción de errores del driver porque
los necesita. Copiarlo entero para un contexto que no los necesita es peor que no copiarlo.

`pnpm module:new <contexto> [entidad]` genera todo lo de la columna **Obligatoria** ya funcionando.

---

## 1. Qué es obligatorio y qué no

| Pieza                                                    | ¿Obligatoria? | Por qué / cuándo                                                                         |
| -------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------- |
| `domain/` sin un solo import de `@nestjs/*`              | **Sí**        | Regla 1 del gate de fronteras. Rompe el lint                                             |
| Entidad extendiendo `Entity<TId>`                        | **Sí**        | Da id, `equals()` y la traza de auditoría completa                                       |
| VO de identidad extendiendo `UuidId`                     | **Sí**        | Un `string` no puede pasar por un id. `Entity` lo exige                                  |
| Marcador `XDomainError extends DomainError`              | **Sí**        | Es lo que `@Catch()` discrimina. Sin él tu filtro captura los errores de otros contextos |
| Puerto como `abstract class` en `domain/ports/`          | **Sí**        | Tipo y token de inyección en una sola referencia                                         |
| Un caso de uso por archivo, con su `type` de entrada     | **Sí**        | La entrada es la firma del caso de uso, no una pieza aparte                              |
| ORM entity + mapper separados de la entidad              | **Sí**        | Dos modelos, nunca uno. Decorar el dominio acopla el dominio a la base                   |
| Filtro `extends DomainExceptionFilter`                   | **Sí**        | Sin él, un error de dominio sale como **500**                                            |
| Documentación OpenAPI completa de cada operación         | **Sí**        | `openapi-contract.e2e-spec.ts` **rompe el build** si falta algo                          |
| Escenario en `openapi-runtime-contract.e2e-spec.ts`      | **Sí**        | Rompe el build en cuanto el endpoint existe                                              |
| Spec 1:1 por archivo, con AAA y `it` en español          | **Sí**        | Convención del repo; la mutación es gate con umbral 85                                   |
| Fake en memoria escrito a mano para `application/`       | **Sí**        | En esa capa no se usa `jest.mock`                                                        |
| **Fachada (`abstract class` re-exportada del module)**   | **No**        | Solo si OTRO módulo tiene que consumirte. Ver §4                                         |
| **Paginación (`PaginationDto`, `PaginatedResponseDto`)** | **No**        | Solo si listas colecciones                                                               |
| **Traducción del `23505` de PostgreSQL**                 | **No**        | Solo si tu tabla tiene un índice único                                                   |
| **`SoftDeletableEntity`**                                | **No**        | Solo si de verdad borras filas. `active` es otra cosa                                    |
| **Eventos de dominio + `AggregateRoot`**                 | **No**        | Solo si algo fuera del agregado debe reaccionar                                          |
| **Outbox transaccional**                                 | **No**        | Solo con eventos que no se pueden perder                                                 |
| **`toSnapshot()`**                                       | **No**        | Cómodo para el mapper y el DTO, no estructural                                           |

---

## 2. El orden en que se construye

El repo trabaja por **casos acordados primero, TDD después**
(`docs/specs/2026-08-04-roadmap-and-collaboration-model-design.md`). Aplicado a un módulo nuevo:

1. **Acordar la tabla de casos** de lo que vaya en `domain/` y `application/`. Casos puntuales
   más filas `P` de propiedad. Sin esto, lo que se escriba después no tiene contra qué cotejarse.
2. `pnpm module:new <contexto>` — el esqueleto, ya en verde.
3. **De dentro hacia fuera**, y en cada paso el test ROJO antes que el código:
   VO de identidad → errores → entidad → puerto → caso de uso → mapper + ORM entity →
   repositorio → filtro → DTOs → controller → module.
4. `pnpm migration:generate src/database/migrations/Create<Contexto>` y `migration:run`.
5. Registrar el módulo en `app.module.ts` y su scope en `commitlint.config.cjs`.
6. Añadir el escenario a `openapi-runtime-contract.e2e-spec.ts`.
7. DoD: `typecheck` → `lint:check` → `format:check` → `test` → `test:e2e` → `build`, más
   `pnpm test:mutation`.

⚠️ **De dentro hacia fuera importa.** Empezar por el controller lleva a diseñar el dominio para
que encaje en el endpoint, que es exactamente al revés de lo que esta arquitectura persigue.

---

## 3. Los errores que el gate NO caza y hay que mirar a mano

Están todos medidos en este repo, no son hipótesis:

- **`import type` de un puerto en un archivo con decoradores.** Compila, pasa el lint, y falla
  **en runtime**: `Nest can't resolve dependencies of the …UseCase (?, …)`. `eslint.config.mjs`
  lo prohíbe explícitamente, pero solo desde un `ports/` o un `*.module` — si tu puerto vive en
  otro sitio, el gate no llega.
- **Una columna nueva `NOT NULL` sin `DEFAULT`.** «Aditiva ⇒ segura en rodado» es falso ahí: el
  código viejo no nombra la columna en su `INSERT` y el motor la exige. Ver la sección
  «Destructive migrations» de `CLAUDE.md`.
- **Un test que pasa igual con y sin el arreglo.** Antes de fiarte de un test de regresión,
  rómpelo a propósito y comprueba que se pone rojo. En este repo han aparecido varios que
  parecían cubrir un defecto y no cubrían nada.
- **Un `@ApiProperty` que miente.** El guard del contrato compara el ejemplo con el esquema y la
  respuesta real con el esquema, pero no puede saber si tu `description` describe otra cosa.

---

## 4. Cuando otro módulo tiene que consumirte

La única superficie cross-módulo legal es **tu `*.module.ts`**. Nadie importa de tu `domain/` ni
de tu `application/`.

Publica una `abstract class` por **intención**, no una fachada con todo:

```ts
// application/<contexto>.facade.ts
export abstract class InvoicesLookup {
  abstract findById(id: string): Promise<InvoiceSummary | null>;
}

// <contexto>.module.ts
providers: [
  InvoicesFacadeImpl,
  { provide: InvoicesLookup, useExisting: InvoicesFacadeImpl },
],
exports: [InvoicesLookup],
export { InvoicesLookup } from './application/invoices.facade';
```

Dos reglas que el gate de fronteras **no puede** comprobar, porque razona por ruta:

- **Nunca devuelvas tu agregado.** Primitivos o DTOs planos. Publicar la entidad acopla al
  consumidor a tus invariantes y a tus VOs.
- **Los fallos de negocio viajan como RESULTADO, no como excepción.** El consumidor no puede
  importar tus clases de error, así que `{ ok: false, reason: 'email-taken' }` y él lo traduce a
  un error de SU dominio.

Segregar por intención es lo único que impide dar de más: `orders` no puede escribir
`deleteProfile` porque el tipo que inyecta no lo declara. Lo comprueba el **compilador**.

---

## 5. Cómo se escriben los comentarios aquí

Dos reglas, y las dos vienen de defectos reales:

**1. Un comentario que afirma un hecho comprobable lleva la medición al lado, o no se escribe.**
En un solo ciclo se detectaron **nueve** afirmaciones falsas en comentarios, todas escritas con
la misma seguridad que las ciertas. Si no lo mediste, escribe que no lo mediste: es una frase
perfectamente aceptable.

**2. Un buen comentario nombra el FALLO que el código evita, no lo que el código hace.**
Lo que hace ya se lee en el código. Lo que no se lee es qué pasaría sin él. El mejor ejemplo que
encontramos no es de este repo sino de `bridge-fital-pti-api` (`user-sync.service.ts`):

```ts
// INTENTIONAL: the JWT role (input.role) is NEVER synced onto an existing
// user. Elevated roles (admin, pti_admin) are managed manually in the database
// only; Auth0 always emits 'user', so syncing here would silently degrade any
// elevated role on every login.
```

No dice «no sincronizamos el rol». Dice **qué se rompería si lo hicieras**, y por eso nadie va a
«arreglar» esa omisión. Un comentario así vale por un test que no existe.

---

## 6. Comprobación final

Un módulo está terminado cuando:

- [ ] Los seis pasos del DoD están en verde.
- [ ] `pnpm test:mutation` no baja del umbral de rotura (85).
- [ ] La tabla de casos acordados tiene un `it` por fila, y ningún `it` sin fila.
- [ ] Cada endpoint tiene su escenario en `openapi-runtime-contract.e2e-spec.ts`.
- [ ] La migración se aplicó a **las dos** bases (`migration:run` y `db:migrate:test`).
- [ ] El scope está en `commitlint.config.cjs`.
- [ ] Ningún comentario afirma algo que no comprobaste.
