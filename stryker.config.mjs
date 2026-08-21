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
