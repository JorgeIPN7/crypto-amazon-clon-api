// stryker.config.mjs
/**
 * Mutation testing — el auditor del modelo «casos primero» (ver
 * docs/specs/2026-08-04-roadmap-and-collaboration-model-design.md, §4.5).
 *
 * `mutate` apunta solo a domain/ y application/ —de los módulos y del shared
 * kernel—: es donde viven los casos de negocio. Infra, config y wiring quedan
 * fuera a propósito — mutarlos mediría ruido, no contratos.
 *
 * `thresholds.break` YA no es null: el baseline existe y el umbral se fijó con
 * él (backlog #9). Medición del 2026-08-06 sobre el scope completo de `mutate`,
 * copiada de la salida de Stryker: **90.14 %** global — 192 killed, 0 timeout,
 * 19 survived, 2 sin cobertura, 5 error (el score es detectados/válidos =
 * 192/213; los `error` quedan fuera del denominador). Por módulo: `users`
 * 92.11 % (140/152) y `orders` 85.25 % (52/61).
 *
 * `break: 85` — el margen NO se reparte como sugiere la lista de scores por
 * módulo, porque cada uno pesa según su número de mutantes válidos, no según su
 * porcentaje. `users` aporta 152 de 213 (71 %) y `orders` 61 (29 %), así que:
 * `orders` tendría que desplomarse a ~67 % para tumbar el global él solo,
 * mientras que a `users` le bastaría con caer a ~84.9 % — 7 puntos. La amenaza
 * más cercana al umbral es una regresión en el módulo GRANDE, no en el que hoy
 * tiene el score más bajo. Ese es el margen real, y por eso 85 y no 88.
 *
 * Los 19 supervivientes conocidos están documentados con sus casos PROPUESTOS en
 * los planes de auth y orders: al aprobarse esas filas el score sube y el margen
 * crece — entonces, y solo entonces, tiene sentido subir el umbral.
 *
 * Remedición del 2026-08-07 (ciclo 1 del refactor de arquitectura, al entrar
 * `src/shared/domain/` en el scope): **91.48 %** — 204 killed, 0 timeout, 19
 * survived, 0 sin cobertura, 5 error (204/223). Los MISMOS 19 supervivientes: el
 * ciclo no tocó ningún caso de negocio. El kernel entra al 100 % (22/22:
 * `value-object.base.ts` 19, `aggregate-root.ts` 3), y por eso el global sube
 * pese a que `modules` baja de 192 a 182 mutantes matados — los ~10 que faltan no
 * se perdieron, se mudaron con `equals()`/`toString()` de `Email` y `UserId` a la
 * base. El umbral se queda en 85: la aritmética del margen no cambia, y subirlo a
 * cuenta de una capa nueva sería premiar una mudanza, no una mejora de casos.
 *
 * Remedición del 2026-08-07 (ciclo 2, puertos a `abstract class`): **91.48 %**, censo
 * de mutantes IDÉNTICO al de arriba (204 killed, 0 timeout, 19 survived, 0 sin
 * cobertura, 5 error). Se esperaba una subida —los 6 `Symbol('X')` salían del scope y
 * su literal parecía mutable— y NO la hubo. Motivo, medido y no supuesto: Stryker no
 * muta el argumento string de `Symbol(...)`. Comprobado reintroduciendo
 * `Symbol('PASSWORD_HASHER')` en `password-hasher.ts` y corriendo con `--mutate` sobre
 * ese único archivo: sigue dando 1 mutante (el de `DUMMY_PASSWORD_HASH`), no 2. Esos
 * seis tokens nunca estuvieron en el censo, así que quitarlos no podía mover el score.
 * Lo que sí cambia es la forma del scope: los cuatro puertos que hoy son `abstract
 * class` pura ya no aparecen en el informe — cero mutantes, nada que auditar en ellos.
 *
 * Remedición del 2026-08-22 (base común: `DomainError`, `UuidId`, `Entity` y `AggregateRoot`
 * extendiendo `Entity`, más la traza de auditoría y el arreglo del code-review): **94.69 %** —
 * 303 killed, 0 timeout, 17 survived, 0 sin cobertura, 5 error (303/320). El censo CRECE con
 * fuerza: de 277 a 320 mutantes válidos, +43.
 *
 * **Remedición del 2026-08-25**, al cerrar el ciclo de paridad con `bridge-fital-pti-api`
 * (`SecretValueObject`, `SYSTEM_ACTORS`, `SoftDeletableEntity` y el sellado de los getters de la
 * traza): **94.65 %** — 336 killed, 0 timeout, 19 survived, **0 sin cobertura**, 5 error
 * (336/355). El censo pasa de 320 a 355 mutantes válidos, +35. Reparto: `shared` 97.89 %
 * (93/95), `modules` 93.46 % (243/260).
 *
 * ⚠️ Los **0 sin cobertura** son el dato que más costó y el que conviene no perder. La primera
 * versión de `User` con borrado lógico traía un `restoreProfile()` que no llamaba nadie, y sus
 * dos mutantes fueron los ÚNICOS sin cobertura de todo el ciclo. El auditor los delató, y el
 * método se retiró el mismo día: la capacidad ya estaba probada en `SoftDeletableEntity`. Un
 * mutante sin cobertura no es «falta un test» — casi siempre es «sobra código».
 *
 * ⚠️ La cifra se remidió al cerrar el ciclo. Durante él pasó por 94.44 % (306 mutantes) y
 * 95.00 % (318): cada tanda de casos nuevos movía el censo, y citar una medición intermedia como
 * si fuera la final es justo el error que esta cabecera existe para evitar.
 *
 * Reparto medido: `shared` **100 %** (67/67), `modules` 93.12 % (230 killed, 17 survived) — y
 * dentro de modules, `orders` 85.11 % (40/47) frente a `users`+`auth` 95.00 % (190/200).
 *
 * **El dato que importa aquí es que `shared` pasa de 23 mutantes a 59.** El kernel dejó de ser
 * dos archivos pequeños y ahora carga con la identidad, la igualdad y las marcas de tiempo de
 * los tres agregados — y entra al 100 %, sin un solo superviviente, porque cada pieza llegó con
 * su tabla de casos acordada. Ese peso es el que sostiene el margen: `orders` en solitario está
 * a 0.11 puntos del umbral (85.11), pero el global tiene 9.44 de holgura. Es exactamente lo que
 * avisa la aritmética de más arriba: **medir un módulo aislado con `--mutate` NO dice a qué
 * distancia está la CI de ponerse roja**, porque cada uno pesa según sus mutantes, no según su
 * porcentaje.
 *
 * Los 17 survivors son los conocidos de siempre, ninguno nuevo: mensajes de error sin aserción
 * de igualdad y condiciones de límite en value objects sin caso de propiedad exacto. Los 5
 * `error` incluyen uno estructural nuevo — `domain-error.base.ts` genera un único mutante
 * (vaciar el constructor) que revienta con `ReferenceError: Must call super constructor…` y
 * queda fuera del denominador. No es laguna de cobertura: es que tres líneas de reenvío puro no
 * dan superficie a los mutadores.
 *
 * ⚠️ **Un scope SIN mutantes válidos pasa el gate, y conviene saber por qué.** No es que Stryker
 * dé el umbral por cumplido: es que su comprobación es `if (mutationScore < breaking)`
 * (`mutation-test-report-helper.js:135`), y en JavaScript `NaN < 85` es **`false`**, así que la
 * rama de fallo no se ejecuta nunca. El mensaje que imprime —«Final mutation score of NaN is
 * greater than or equal to break threshold 85»— es literalmente falso: `NaN` no es mayor ni
 * igual a nada. Medido: `pnpm test:mutation --mutate "src/shared/domain/domain-error.base.ts"`
 * (cuyo único mutante es `error`) sale con **exit 0**. Stryker no ofrece ninguna opción de
 * «mínimo de mutantes» — buscada en su schema y en sus tipos.
 *
 * Con el scope real esto es inalcanzable (320 mutantes válidos), así que **el riesgo no es la CI:
 * es la interpretación**. Ya costó una conclusión equivocada en el ciclo del 2026-08-22 — se
 * midió `orders` con `--mutate` en aislado, dio 85.11 % y se reportó que la CI estaba a 0.11
 * puntos de romperse, cuando el margen real era 9.44. Un scope acotado no dice a qué distancia
 * está el gate, y un scope acotado sin lógica mutable no dice nada en absoluto.
 *
 * El umbral se queda en 85 por el mismo criterio de siempre: subirlo a cuenta de un kernel que
 * nace con casos frescos premiaría el momento, no la disciplina.
 *
 * Remedición del 2026-08-07 (ciclo 4, `auth` como bounded context propio con la credencial):
 * **92.78 %** — 257 killed, 0 timeout, 20 survived, 0 sin cobertura, 8 error (257/277). Sube
 * 1.3 puntos y el censo CRECE por primera vez en el refactor: +54 mutantes válidos, todos del
 * módulo nuevo (`auth` entra al **100 %**, 41/41). Los survivors bajan de 19 a 20… y luego a
 * 20 tras matar uno: el primer pase dejó vivo el mensaje de `InvalidPasswordHashError`
 * —`not.toContain(password)` se satisface igual con la cadena vacía— y se mató fijando la
 * igualdad exacta, que además es contrato (ese texto viaja en el 400 del filtro de auth). Los
 * 20 restantes son los MISMOS de siempre, ahora repartidos entre `users` (11) y `orders` (9):
 * mensajes de error sin aserción de igualdad y regex a las que se les quita el ancla.
 *
 * El umbral se queda en 85. La aritmética del margen mejora —`users` pasa de aportar el 71 %
 * de los mutantes al 56 %, así que ya no puede tumbar el global él solo con una caída de 7
 * puntos— pero subir el techo a cuenta de un módulo que nace con casos frescos premiaría el
 * momento, no la disciplina. Se revisa cuando los 20 survivors conocidos tengan casos
 * aprobados.
 *
 * Remedición del 2026-08-07 (ciclo 3, `commands/`+`queries/`+`handlers/` colapsados en
 * `use-cases/` con el input colocado): **91.48 %**, censo de nuevo IDÉNTICO (204 killed, 0
 * timeout, 19 survived, 0 sin cobertura, 5 error) y los MISMOS 19 supervivientes. Era lo
 * esperado por partida doble: los 6 command/query borrados eran constructores con
 * parameter properties —cuerpo vacío, nada que mutar— y los `XInput` que los sustituyen son
 * `type`, borrados en compilación. El scope sí cambia de forma: `application/` de users pasa
 * a leerse `use-cases/` (29 mutantes, 100 %) + `users.facade.ts` (9, 90 %), que es
 * exactamente la separación que el ciclo quería hacer visible.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 *
 * Remedición del 2026-08-19. **El censo de arriba estaba caduco y nadie lo había notado**, que
 * es el defecto que esta entrada arregla: las cuatro remediciones anteriores razonan sobre 277
 * mutantes válidos y el número real es **296**. La causa es `42ea415`, el bump de
 * `@stryker-mutator/core` 9.6.1 → 10.0.0 — un MAJOR que tocó solo `package.json` y el lockfile,
 * sin rehacer la aritmética que este archivo declara obligatoria por ciclo. Un cambio de major
 * en el instrumentador es exactamente el evento que mueve el censo.
 *
 * Medido con `pnpm test:mutation` sobre el scope completo, copiado de la salida de Stryker:
 * **93.24 %** global — 276 killed, 0 timeout, 20 survived, 0 sin cobertura, 7 error (276/296).
 * Por módulo, con su peso en mutantes válidos, que es lo que de verdad reparte el margen:
 *
 *     auth     100.00 %   47/47     ( 47 válidos, 15.9 % del censo)
 *     users     93.21 %  151/162    (162 válidos, 54.7 %)
 *     orders    85.94 %   55/64     ( 64 válidos, 21.6 %)
 *     shared   100.00 %   23/23     ( 23 válidos,  7.8 %)
 *
 * Los +19 mutantes respecto al censo documentado están TODOS matados (killed 257 → 276,
 * survived 20 → 20), así que caen en código que los casos ya cubrían. La hipótesis es que
 * Stryker 10 añadió mutadores; no se ha comprobado cuál, y se deja escrito como hipótesis y no
 * como hecho.
 *
 * Los 20 supervivientes siguen siendo los mismos de siempre y con la misma forma —mensajes de
 * error sin aserción de igualdad y regex a las que se les quita el ancla—, repartidos entre
 * `users` (11: `users.facade.ts` 5, `user.errors.ts` 3, `email.vo.ts` 1, `user-id.vo.ts` 2) y
 * `orders` (9: `order.errors.ts` 4, `order-concept.vo.ts` 2, `order-id.vo.ts` 2,
 * `order-amount.vo.ts` 1).
 *
 * ⚠️ Los timeouts: **0 en esta corrida, pero no siempre.** El informe HTML de la corrida
 * ANTERIOR registraba 4 timeouts en `shared/domain/value-object.base.ts`, y esta corrida los
 * mata. El score no se mueve un ápice —Stryker cuenta el timeout como detectado, así que los
 * dos casos dan 276 detectados de 296 y 93.24 %— pero conviene tenerlo escrito: esos mutantes
 * son sensibles a la carga de la máquina y su estado bascula entre Killed y Timeout entre
 * corridas. Si un día aparecen como timeout, no es una regresión ni un caso perdido.
 *
 * **El umbral se queda en `break: 85`.** Con 93.24 % el margen es de 8.24 puntos y, a diferencia
 * de lo que se temía, es margen de kills y no de timeouts. Aritmética del margen: hacen falta
 * ≥252 detectados para no romper (85 % de 296), así que caben 24 kills perdidos antes del rojo.
 * Ningún módulo puede tumbar el global él solo sin un desplome grande —`orders` tendría que caer
 * de 85.94 % a ~48 %, `users` de 93.21 % a ~78 %—, pero ya no hay ninguno inofensivo: llevar
 * `auth` a 0 bastaría, porque sus 47 mutantes superan los 24 de holgura. Subir el techo se sigue
 * aplazando hasta que los 20 supervivientes conocidos tengan casos aprobados: subirlo antes
 * premiaría el momento del censo, no la disciplina.
 */
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  // El default (`['@stryker-mutator/*']`) expande el glob contra el realpath de
  // @stryker-mutator/core, que con el layout aislado de pnpm es su carpeta de
  // `.pnpm` — allí solo viven las dependencias de core, nunca el jest-runner.
  // Un nombre explícito evita el glob: se resuelve con `import()` normal, que sí
  // alcanza el `node_modules` raíz del proyecto. Sin esta línea: «Cannot find
  // TestRunner plugin "jest"».
  plugins: ['@stryker-mutator/jest-runner'],
  testRunner: 'jest',
  jest: {
    projectType: 'custom',
    configFile: 'jest.config.mjs',
    enableFindRelatedTests: true,
  },
  mutate: [
    'src/modules/*/domain/**/*.ts',
    'src/modules/*/application/**/*.ts',
    // El shared kernel es dominio: mismo criterio que `src/modules/*/domain`, solo que sin
    // dueño. Dejarlo fuera no habría sido «no medir código nuevo» sino PERDER auditoría ya
    // conseguida: `equals()` y `toString()` vivían en `Email` y `UserId` —dentro del scope— y
    // al subirlos a `ValueObject` se habrían salido de él. El score habría subido sin que
    // nadie probara nada más, que es exactamente el fallo de un auditor mal apuntado.
    'src/shared/domain/**/*.ts',
  ],
  coverageAnalysis: 'perTest',
  reporters: ['clear-text', 'progress', 'html'],
  thresholds: { high: 90, low: 80, break: 85 },
  tempDirName: '.stryker-tmp',
};

export default config;
