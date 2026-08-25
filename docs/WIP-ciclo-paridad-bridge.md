# WIP — Ciclo «paridad con bridge + dimensiones a 10/10»

> **Banco de memoria de la sesión.** Si el contexto se limpia, este archivo es el punto de
> reentrada: dice qué se pidió, qué está hecho, qué falta y qué decisiones ya se tomaron.
> Se BORRA al cerrar el ciclo (su contenido útil se muda a `CLAUDE.md` y a `docs/backlog.md`).

Rama: `refactor/shared-kernel-and-http-base`. Commits permitidos a discreción.
Autorización del usuario: luz verde para ejecutar entero sin detenerse; ante una decisión,
elegir la opción recomendada y justificarla al final.

---

## Origen

Comparativa `crypto-amazon-clon-api/src/modules/users` vs `bridge-fital-pti-api/src/app/user`.
Resultado: 9.35 vs 3.25 ponderado. El usuario pidió tres cosas:

1. Subir a **10/10** las cinco dimensiones que quedaron por debajo.
2. Traer a este repo **lo mejor de bridge** (6 puntos).
3. Implementar las **6 mejoras propuestas** para `crypto/users`.

Hay solape entre (2) y (3); el plan de abajo ya está consolidado.

## Dimensiones a subir, y qué hueco concreto las bajaba

| #   | Dimensión               | Nota | Hueco medido                                                            | Lote  |
| --- | ----------------------- | ---- | ----------------------------------------------------------------------- | ----- |
| 2   | Contrato HTTP correcto  | 9    | ver LOTE 8                                                              | 8     |
| 3   | Pruebas                 | 9    | migraciones sin medir (backlog #17); branches E2E umbral 30, real 41.09 | 6, 7  |
| 5   | Coherencia interna      | 9    | 3 incoherencias de nomenclatura (abajo)                                 | 2     |
| 7   | Trazabilidad            | 9    | `null` es ambiguo: no distingue «sistema» de «desconocido»              | 1     |
| 9   | Ergonomía para replicar | 7    | sin generador, sin plantilla documentada                                | 9, 10 |

### Incoherencias de nomenclatura medidas (LOTE 2)

1. `users/domain/value-objects/user-role.ts` — único archivo de una carpeta `value-objects/`
   sin sufijo `.vo.ts`.
2. Filtros: `user-domain-exception.filter.ts` / `UserDomainExceptionFilter` (**singular**) vs
   `orders-domain-exception.filter.ts` / `OrdersDomainExceptionFilter` (**plural**).
3. `auth/infrastructure/users-user.directory.ts` y
   `orders/infrastructure/users-customer.directory.ts` cuelgan **sueltos** de `infrastructure/`;
   todos los demás adaptadores viven en una subcarpeta (`http/`, `persistence/`, `security/`).

## Lo mejor de bridge — estado de partida

| Ventaja de bridge                 | ¿Ya existe aquí?                                          | Lote |
| --------------------------------- | --------------------------------------------------------- | ---- |
| `Password.toString()` enmascarado | **No** — medido: `${passwordHash}` imprime el hash entero | 1    |
| Generador de módulos              | **No**                                                    | 9    |
| Soft delete (`@DeleteDateColumn`) | **No**                                                    | 4    |
| Sentry + correlationId            | correlationId **sí** (CLS + pino); APM **no**             | 5    |
| Envoltura de respuesta global     | **Sí ya** — `TransformInterceptor` en `app.module.ts:61`  | —    |
| El comentario del rol (patrón)    | parcial                                                   | 11   |

---

## LOTES

Estado: `[ ]` pendiente · `[~]` en curso · `[x]` hecho y commiteado.

- [x] **LOTE 1 — Secreto enmascarado + actor de sistema nombrado**
  - `PasswordHash.toString()` → `'***REDACTED***'`, y lo mismo para cualquier VO sensible.
  - `SystemActor`: constantes en vez de `null` suelto para seed / relay / alta pública.
- [x] **LOTE 2 — Coherencia de nomenclatura** (las 3 de arriba)
- [x] **LOTE 3 — `NamingStrategy` snake_case** (backlog; hoy cada columna necesita `name:`)
- [x] **LOTE 4 — Soft delete** — DECISIÓN TOMADA, ver abajo
- [x] **LOTE 5 — APM / reporte de errores** — DECISIÓN TOMADA, ver abajo
- [x] **LOTE 6 — Tests de migración** (backlog #17)
- [x] **LOTE 7 — Elevar branches del E2E**
- [x] **LOTE 8 — Contrato HTTP a 10**
- [ ] **LOTE 9 — Generador de módulos** (`pnpm module:new`)
- [ ] **LOTE 10 — Plantilla de módulo documentada**
- [ ] **LOTE 11 — El patrón del «comentario que nombra el fallo evitado»**

## Progreso (commits ya en la rama)

| Lote | Commit    | Qué entró                                                                                       |
| ---- | --------- | ----------------------------------------------------------------------------------------------- |
| 1    | `c2d4df5` | `SecretValueObject` (3 superficies, no 1 como bridge) + `SYSTEM_ACTORS`; seed con reloj único   |
| 2    | `7642bae` | `user-role.ts` fuera de `value-objects/`; filtro a plural; adaptadores a `gateways/`            |
| 3    | `10e576c` | `SnakeNamingStrategy` + E2E de convenciones; backlog #1 CERRADO; 20 `name:` retirados           |
| 4    | `f066bd7` | `SoftDeletableEntity` + índice parcial; getters de la traza sellados; `restoreProfile` retirado |

Estado tras el lote 4: **712 unitarios · 145 e2e · mutación 94.65 % (0 sin cobertura)**.

## Decisiones tomadas (para justificar al usuario al final)

### LOTE 4 — Soft delete: al KERNEL como opt-in, no a todas las entidades

`users` ya tiene desactivación lógica (`active`), y `DELETE /users/:id` la usa. Añadir
`deletedAt` a las tres tablas duplicaría el concepto en `users` y metería una columna que
nadie consulta en `orders`. Se implementa como capacidad del kernel
(`SoftDeletable` / `deletedAt` en `AuditTrail`) que una entidad **elige**, y se aplica al
caso donde de verdad falta: el borrado FÍSICO de `UsersProvisioning.deleteProfile`, hoy
irreversible sobre un esquema con cero foreign keys.

### LOTE 5 — Puerto `ErrorReporter`, adaptador de log; Sentry documentado pero NO instalado

Sentry envía datos fuera del proceso. Meter la dependencia en un template obliga a todo
consumidor a cargarla. Se implementa el **seam** (puerto + adaptador que loguea con el
`requestId` del CLS) y se documenta cómo enchufar Sentry en cinco líneas. Se gana el punto
de arquitectura sin imponer un proveedor ni un envío de datos a terceros.

---

## Reglas del repo que este ciclo NO puede romper

- **Nunca `git commit` sin instrucción en el turno actual.** ⚠️ EXCEPCIÓN VIGENTE: el usuario
  autorizó commits a discreción para este ciclo, en su mensaje de arranque.
- Un comentario que afirma un hecho comprobable lleva la medición al lado.
- Casos acordados antes de implementar en `domain/` o `application/`. ⚠️ El usuario dio luz
  verde para decidir solo; las tablas de casos se escriben igual, en el spec de cada lote.
- DoD: `typecheck` → `lint:check` → `format:check` → `test` → `test:e2e` → `build`.
- Mutación es gate: `break: 85`.

## Estado de la rama al arrancar

```
19cf034 docs(docs): remedir la mutacion al cerrar el ciclo
17bf9c9 refactor(database): un solo reloj — las tres tablas sellan desde el dominio
9e18b32 fix(shared): copiar los Date de la traza, que Object.freeze no protegía
```

⚠️ **3 commits sin push.** No se empujan sin instrucción explícita.
