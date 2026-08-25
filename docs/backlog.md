# Backlog de Amazon clon | Crypto

Trabajo **pospuesto con una decisión ya tomada**, no olvidado. Cada entrada registra qué pasa,
qué enfoque se eligió y cómo se sabrá que está cerrada — para no reabrir la discusión desde cero.
También se anota lo que se cerró al verificar que no era un problema, para que nadie lo
reinvestigue.

El backlog del template, con las decisiones que ya vienen tomadas en esta base de código, está
archivado en [`docs/template-history/backlog.md`](./template-history/backlog.md). Su numeración
está congelada y `stryker.config.mjs` la referencia, así que **este backlog empieza otra vez en 1**.

---

## 1. La convención snake_case del esquema depende de que cada `@Column` no se olvide — CERRADA (2026-08-25)

**Qué pasa.** No hay `NamingStrategy` configurada en `src/database/typeorm-options.ts`. TypeORM usa
el nombre de la propiedad tal cual, así que una columna solo acaba en snake_case si su decorador lo
pide con `name:` explícito. Olvidarlo no rompe nada visible: la columna nace `createdAt`, la
migración se genera con ese nombre y todo pasa en verde.

Ya ocurrió. Hasta el 2026-08-24 el esquema mezclaba las dos convenciones y `auth_credentials`
llegaba a mezclarlas **dentro de la misma tabla**: `user_id` y `password_hash` en snake conviviendo
con `"createdAt"` y `"updatedAt"` en camel, porque las marcas de tiempo se heredaron de `users` al
mudar allí el hash mientras que las otras dos se escribieron nuevas. Se unificó reescribiendo las
migraciones, algo que **solo fue barato porque no había datos ni despliegue** — con datos, cada
columna habría necesitado su pareja expand/contract.

**Criterio que estaba decidido, y por qué dejó de valer.** La entrada decía: no se configura
`SnakeNamingStrategy` porque (a) `typeorm-naming-strategies` no está instalada, así que entraría una
dependencia nueva, y (b) esa estrategia reescribe el mapeo de **columnas, tablas, índices y claves
foráneas de golpe** — mucha más superficie de la que el problema necesita.

**Las dos objeciones eran contra ESA librería, no contra la idea**, y las dos se resuelven
escribiendo la estrategia en casa: `src/database/snake-naming.strategy.ts` son ~40 líneas que
extienden `DefaultNamingStrategy` (de `typeorm`, ya instalada: **cero dependencias nuevas**) y
sobreescriben **exactamente dos métodos**, `tableName` y `columnName`. Índices y claves foráneas
siguen con el comportamiento por defecto, intactos.

**Cerrada el 2026-08-25 haciendo LAS DOS cosas**, no eligiendo una:

- La estrategia, registrada en `buildTypeOrmOptions` —el único punto que comparten la CLI de
  TypeORM y el runtime de Nest, para que no puedan divergir—. Un `name:` explícito sigue ganando y
  no se convierte, que es lo que permitió adoptarla sin tocar nada. Verificado antes y después:
  `migration:generate` responde «No changes in database schema were found», y luego se quitaron
  los **20** `name:` que habían quedado redundantes y volvió a responder lo mismo.
- El test que la entrada llamaba «salida preferida»:
  `src/database/__tests__/schema-conventions.e2e-spec.ts` lee `information_schema.columns` y
  afirma que ninguna columna ni tabla lleva mayúsculas ni separadores raros. **Verificado que
  falla**: con un `ALTER TABLE users ADD COLUMN "testCamelCase"` inyectado a mano, dos casos se
  ponen rojos y nombran la columna.

Hacen falta **las dos y no una**, y esto se midió: el E2E lee el esquema, así que quitar la
estrategia no lo pone rojo —el esquema ya está en snake y ninguna columna cambia—; el defecto
aparecería en la siguiente columna que alguien añadiera sin `name:`. Por eso hay además un caso
unitario en `typeorm-options.spec.ts` que afirma que la `namingStrategy` sigue registrada. Uno caza
la causa, el otro el efecto.

**Cómo se sabrá que está hecho.** Añadir un `@Column` sin su `name` en snake_case pone roja la
suite E2E, nombrando la columna infractora.

---

## 2. Ninguna migración tiene prueba, y ahora tampoco la que sí la tenía

**Qué pasa.** `src/database/migrations/**` está fuera del `collectCoverageFrom` de las dos suites,
a propósito y con su motivo escrito: son DDL de un solo uso que ejecuta la CLI. La deuda venía
heredada del template (backlog archivado #17), donde el criterio ya está decidido: **«la que mueve
datos o suelta algo lleva prueba; la que solo añade, no»**.

Durante el ciclo del 2026-08-22 llegó a existir esa prueba —260 líneas, 6 casos, sobre base
desechable— para la pareja expand/contract que daba a `orders` sus marcas de tiempo. Era el
**único** test del repo que ejercitaba un `up()`/`down()`. Se borró al colapsar esa pareja dentro
de `CreateOrdersAndOutbox`, por decisión del usuario: sin datos ni despliegue, la tabla podía nacer
ya con sus columnas.

El borrado **cumple** el criterio de la #17 en vez de violarlo —tras el colapso, esa migración ni
mueve datos ni suelta nada—, pero deja la cobertura de migraciones otra vez en cero. Y la que sí
mueve datos sigue sin prueba: `MoveCredentialsToAuth{Expand,Contract}`, que copia hashes entre
tablas y suelta una columna.

**Criterio ya decidido.** El E2E va sobre una base **desechable**, creada y destruida por el propio
spec, nunca sobre `crypto_amazon_clon_api_test`. El motivo es concreto y se comprobó al escribir el
que luego se borró: probar una migración exige `undoLastMigration()`, y si una aserción falla a
mitad, la base compartida se queda con el esquema roto para todas las suites siguientes. El patrón
completo, con la comprobación del nombre de la última migración antes de revertir, está en el
historial de esta rama.

**Cómo se sabrá que está hecho.** Un `it` recorre `up → down → up` de
`MoveCredentialsToAuthExpand` con filas dentro, y comprueba que los hashes sobreviven al viaje.

---

## 3. `domain-error.base.ts` no tiene auditoría de mutación efectiva

**Qué pasa.** Stryker genera **un solo mutante** para ese archivo —vaciar el cuerpo del
constructor— y revienta con `ReferenceError: Must call super constructor in derived class before
accessing 'this'`. Se clasifica como `error` y queda **fuera del denominador**, así que el archivo
reporta score `n/a`: ni un mutante matado ni uno superviviente.

No es una laguna de cobertura. Medido: 100 % de líneas, ramas y funciones, con los 5 casos de la
Tabla A. Es que tres líneas de reenvío puro no dan superficie al catálogo de mutadores.

⚠️ **El dato que sí conviene tener presente**: un scope sin mutantes válidos **pasa el gate**. No
porque Stryker dé el `NaN` por bueno, sino porque su comprobación es `if (mutationScore < breaking)`
y `NaN < 85` es `false` en JavaScript, así que la rama de fallo nunca se ejecuta. Medido:
`pnpm test:mutation --mutate "src/shared/domain/domain-error.base.ts"` sale con **exit 0**. Stryker
no ofrece ninguna opción de mínimo de mutantes — buscada en su schema y en sus tipos. Con los 319
mutantes reales del scope es inalcanzable en CI; el riesgo es de **interpretación**, y está
documentado en la cabecera de `stryker.config.mjs`.

**Criterio ya decidido.** Se acepta y no se excluye el archivo del scope. Excluirlo lo sacaría del
informe, y el día que gane lógica de verdad —un código de error, una normalización de mensaje—
seguiría sin auditarse y sin que nadie se enterase. Que aparezca con su `error` visible es
información.

Lo que sí se cerró: el caso **A6** verifica que `DomainError` no declare un `Symbol.hasInstance`
propio. Es el único agujero conocido que **ni los tests ni Stryker** pueden atrapar —los mutadores
mutan código existente y no pueden **añadir** un miembro estático—, y tumbaría A4 en silencio.

**Cómo se sabrá que está hecho.** Cuando el archivo tenga lógica propia, aparecerá con mutantes
reales en el informe. Hasta entonces, esta entrada existe para que nadie lo reinvestigue.

---
