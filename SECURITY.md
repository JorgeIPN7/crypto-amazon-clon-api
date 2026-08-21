# Política de seguridad

Este documento describe **lo que este repositorio hace de verdad**, no una plantilla genérica.
Cada afirmación apunta al archivo que la implementa: si el archivo cambia y esta página no, la
discrepancia es un defecto de la página.

---

## Cómo reportar una vulnerabilidad

**No abras un issue público.** Los issues de este repositorio son visibles para todo el que tenga
acceso y no sirven para coordinar una divulgación.

| Vía                                        | Cuándo                                               | Dónde                                                                                                               |
| ------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **GitHub Security Advisories** (preferida) | Siempre que tengas cuenta de GitHub y acceso al repo | [Reportar en privado](https://github.com/JorgeIPN7/template-nest-js-hexagonal-ddd-mudblood/security/advisories/new) |
| Correo electrónico                         | Si no puedes usar la vía anterior                    | `jorge.ipn.7@gmail.com`                                                                                             |

El aviso privado de GitHub es la vía preferida porque el hilo, el parche y el CVE viven en el
mismo sitio, y porque permite discutir el fallo sin que sea público hasta que exista arreglo.

### Qué incluir

Con esto se puede reproducir; sin esto, casi nunca:

- Versión: commit o rama (hoy solo hay `main`, ver [Versiones soportadas](#versiones-soportadas)).
- `NODE_ENV` con el que ocurre, y si es reproducible en `development` o solo fuera.
- Petición completa (método, ruta, cabeceras relevantes, cuerpo) y respuesta observada.
- Impacto concreto: qué obtiene o rompe quien lo explota.
- Si aplica, un test que falle — el repositorio ya trae la infraestructura para escribirlo.

### Qué esperar

**Esto es un proyecto personal mantenido por una sola persona en su tiempo libre. No hay SLA, no
hay guardia y no hay garantía de tiempo de respuesta.** Inventar aquí un «respondemos en 48 horas»
sería una promesa que nadie puede cumplir.

Lo que sí es un compromiso:

- Se responde al aviso cuando se lee, y se dice si se acepta, se rechaza o se aplaza — con el
  motivo. Un aviso aplazado acaba como entrada de [`docs/backlog.md`](./docs/backlog.md), con su
  criterio escrito, igual que el resto del trabajo diferido del repositorio.
- No se pide silencio indefinido. Si prefieres divulgar por tu cuenta pasado un plazo, dilo en el
  aviso y se acuerda.
- No hay programa de recompensas.

---

## Versiones soportadas

| Versión                    | Soportada | Nota                                                       |
| -------------------------- | --------- | ---------------------------------------------------------- |
| `main`                     | Sí        | Es lo único que existe: se corrige aquí y no hay backports |
| Cualquier otra rama o fork | No        | —                                                          |

**No hay ninguna versión publicada.** `package.json` declara `"version": "0.0.1"`, el repositorio
no tiene ni un solo tag de git y no existen releases. El
[`CHANGELOG.md`](./CHANGELOG.md) mantiene todo bajo `[Unreleased]` por ese mismo motivo. Mientras
eso siga así, «la versión soportada» y «el último commit de `main`» son la misma cosa.

⚠️ **Esto es una plantilla base, no una dependencia.** Se usa copiándola: a partir de ese momento
el código es tuyo y las correcciones de seguridad de `main` **no te llegan solas**. Si derivas un
proyecto de aquí, vigila este repositorio o asume el mantenimiento por tu cuenta.

---

## Qué protege el repositorio hoy

### Gates automáticos

| Gate                  | Qué escanea                                                                                                                                  | Dónde vive                                                                                                | Cuándo corre                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **secretlint 13.0.4** | Todo archivo _staged_, con `--maskSecrets` para no imprimir el hallazgo                                                                      | [`.secretlintrc.json`](./.secretlintrc.json) + entrada catch-all `"*"` de `lint-staged` en `package.json` | `pre-commit` ([`.husky/pre-commit`](./.husky/pre-commit)) |
| **gitleaks**          | En `push`/PR, **solo el rango que elige la action** (a menudo un commit); el historial completo **solo** en `schedule` y `workflow_dispatch` | [`.github/workflows/security.yml`](./.github/workflows/security.yml)                                      | push y PR a `main`, más un cron semanal (`17 4 * * 1`)    |
| **`pnpm audit`**      | CVEs `high`+ en dependencias de **producción** (`--prod`)                                                                                    | [`.github/workflows/ci.yml`](./.github/workflows/ci.yml), justo tras el install                           | push y PR a `main`                                        |
| **trivy v0.36.0**     | La imagen Docker construida en CI: `HIGH,CRITICAL`, `ignore-unfixed`, `exit-code: 1`                                                         | [`.github/workflows/ci.yml`](./.github/workflows/ci.yml), tras el `docker build`                          | push y PR a `main`                                        |

Detalles que importan y que no se ven en la tabla:

- **secretlint lleva `enableIDScanRule: true`** en la regla de AWS. El preset `recommend` no
  detecta los access key IDs (`AKIA…`) de serie; ese flag los añade. La configuración tiene su
  propia suite de contrato, [`src/__tests__/secretlint.spec.ts`](./src/__tests__/secretlint.spec.ts),
  que ejercita la config real con 5 casos de rechazo y 3 anti-falso-positivo.
- **gitleaks no es redundante con secretlint, y por eso son dos piezas.** El hook local solo ve lo
  que está _staged_ en el commit actual y `git commit --no-verify` lo salta entero; el workflow no
  tiene ese atajo y además mira hacia atrás, a los commits anteriores a que existiera el hook.
- **El gate de `audit` ya cazó un CVE real** antes de que existiera CI que lo ejecutara:
  `js-yaml@5.2.1` (High, ReDoS, GHSA-pm4m-ph32-ghv5) llegaba por `@nestjs/swagger` a las
  dependencias de producción. Está remediado con un override _scoped_ al path en
  [`pnpm-workspace.yaml`](./pnpm-workspace.yaml). El caso completo está en
  [`docs/backlog.md` §6](./docs/backlog.md).
- **Todas las actions se referencian por SHA de commit, nunca por tag** — un tag es mutable y se
  puede re-apuntar sin aviso. La política y cómo bumpear están en la cabecera de `ci.yml`.
- **Renovate está configurado y operativo** ([`renovate.json`](./renovate.json)): la app está
  instalada en el remoto y lleva 20 commits en `main` a fecha del 2026-08-19
  (`git log --author=renovate main`). Este documento decía «a la espera de que se instale la app»
  bastante después de que estuviera instalada, y esa frase vivía además en tres puntos de
  `docs/backlog.md`; se corrigió el 2026-08-19. Extiende dos presets que **no son el mismo** y durante un tiempo este
  documento los confundió: `:pinAllExceptPeerDependencies` fija `rangeStrategy: "pin"` —resuelve
  rangos a versiones exactas— y **no toca digests**; el pin por digest del `FROM` del `Dockerfile`
  es la opción `pinDigests`, que por defecto está en `false` y llega con el preset
  `docker:pinDigests`, incluido en `config:best-practices` pero **no** en el `config:recommended`
  que extiende este repo. Sin ese segundo preset el `FROM` nunca habría recibido digest, por muchas
  PR que abriera Renovate.

### Autenticación y credenciales

- **argon2id con parámetros explícitos.** `ARGON2_PARAMS` en
  [`src/config/auth.config.ts`](./src/config/auth.config.ts): `memoryCost: 65_536` (64 MiB),
  `timeCost: 3`, `parallelism: 4`, `type: argon2id` — el perfil que recomienda OWASP. Son
  explícitos a propósito, para que un cambio de defaults del paquete `argon2` no baje el coste en
  silencio, y son **una sola fuente** compartida por el hasher
  ([`argon2-password-hasher.ts`](./src/modules/auth/infrastructure/security/argon2-password-hasher.ts))
  y el seed del primer admin ([`seed-admin.ts`](./src/database/seeds/seed-admin.ts)).
- **La credencial vive en su propia tabla.** Desde el ciclo 4, el hash está en `auth_credentials`,
  propiedad del bounded context `auth`; `users` (el perfil) ya no sabe qué es una contraseña.
- **`JWT_SECRET` no tiene default fuera de `development`/`test`.** Un `.refine()` de
  [`src/config/env.schema.ts`](./src/config/env.schema.ts) impide que `staging`/`production`
  arranquen sin él, con mínimo de 32 caracteres. En `development`/`test` cae a un secreto de
  desarrollo (`DEV_ONLY_SECRET` en `auth.config.ts`) que **está publicado en el propio repositorio**
  y emite un `warn` al usarse: no sirve para nada real, y el arranque fuera de esos dos entornos
  falla antes de poder firmar con él.
- **Guard global, seguro por defecto.** `JwtAuthGuard` se registra como `APP_GUARD` desde
  `auth.module` ([`jwt-auth.guard.ts`](./src/modules/auth/infrastructure/http/jwt-auth.guard.ts)):
  un endpoint nuevo exige JWT válido sin que su autor haga nada. `@Public()` está solo en health,
  `POST /auth/register` y `POST /auth/login`.
- **Login anti-enumeración.** `LoginUseCase` lanza el mismo `InvalidCredentialsError` para email
  inexistente, perfil sin credencial, contraseña incorrecta y usuario inactivo, y llama a
  `hasher.verify()` **exactamente una vez** en los cuatro caminos —contra un hash dummy
  pregenerado cuando no hay credencial real— para que cuesten lo mismo. Es un requisito **medido**:
  una fila de propiedad en `login.use-case.spec.ts` lo fija.
- **`POST /auth/register` sí revela si un email está tomado (409), y es una decisión escrita.**
  Lo que se cerró fue la fuga de **tiempo**: la contraseña se hashea antes de comprobar unicidad,
  así que los dos caminos pagan el argon2id. Medido: las medianas 409/201 pasaron de
  7.52 ms / 91.47 ms (rangos disjuntos) a 79.61 ms / 90.82 ms (rangos solapados). El racional
  completo está en [`docs/backlog.md` §15](./docs/backlog.md).
- **Rate limiting más estricto en auth.** Los dos endpoints de `auth` llevan
  `@Throttle({ default: { limit: 10, ttl: 60_000 } })` a nivel de clase, con contadores separados
  por handler; el resto de la API usa el global (`THROTTLER_LIMIT`/`THROTTLER_TTL_MS`, por defecto
  100 / 60 s).

### Superficie HTTP

- **`helmet()` y CSP también en desarrollo** ([`src/main.ts`](./src/main.ts)), para que un problema
  de CSP aparezca en local y no al desplegar. La documentación tiene su propia CSP restrictiva
  (`default-src 'none'`) con nonce por petición.
- **`ValidationPipe` con `whitelist` + `forbidNonWhitelisted` y sin `enableImplicitConversion`.**
  Lo segundo no es un olvido: la conversión implícita convertía el valor _antes_ de validar, así
  que un `{"name": {"$ne": null}}` llegaba a `@IsString()` como la cadena `"[object Object]"` y
  pasaba.
- **Los secretos no llegan a los logs.** `DEFAULT_REDACT_PATHS` de Pino
  ([`src/common/logger/pino-options.ts`](./src/common/logger/pino-options.ts)) tapa
  `req.headers.authorization`, `req.headers.cookie`, `req.headers["x-api-key"]`,
  `res.headers["set-cookie"]`, `*.password`, `*.token`, `*.refreshToken`, `*.accessToken`,
  `*.apiKey`, `*.secret` y `err.parameters[*]` — esta última añadida al detectar un hash argon2id
  saliendo en claro en los parámetros de un `QueryFailedError`.
- **La documentación está apagada por defecto.** `DOCS_ENABLED=false`, con Basic Auth opcional
  (`DOCS_USERNAME`/`DOCS_PASSWORD`, ambas o ninguna: definir solo una impide el arranque, para que
  no se publique creyéndose protegida). Las rutas de docs se registran fuera del pipeline de Nest,
  así que **el rate limiting global no las cubre**.
- **El bundle de Scalar se sirve desde el propio origen**, nunca desde su CDN: el paquete no admite
  un hash `integrity`, así que auto-hospedarlo es la única forma de saber qué JavaScript se
  ejecuta. Se apagan además el proxy de terceros, las fuentes externas y la telemetría
  ([`src/bootstrap/scalar-config.ts`](./src/bootstrap/scalar-config.ts)).

### Datos y despliegue

- **`DB_SYNCHRONIZE` solo puede apagar, nunca encender fuera de `development`**
  ([`src/config/database.config.ts`](./src/config/database.config.ts), `resolveSynchronize()`) —
  `synchronize: true` puede borrar columnas y datos.
- **Las migraciones destructivas se parten en expand/contract**, con el despliegue en medio. La
  regla, con su ejemplo trabajado, está en
  [`CLAUDE.md` §«Destructive migrations»](./CLAUDE.md#destructive-migrations-expandcontract).
- **La imagen Docker corre como el usuario `node`**, sin privilegios ([`Dockerfile`](./Dockerfile)).
- **TLS a la base de datos:** `DB_SSL=true` con `DB_SSL_CA` apuntando al bundle de CA. Ojo con
  `DB_SSL_REJECT_UNAUTHORIZED=false`: cifra pero **no verifica** la identidad del servidor.

---

## Limitaciones conocidas — léelas antes de desplegar

Están registradas en [`docs/backlog.md`](./docs/backlog.md) con su criterio y su condición de
cierre. Se listan aquí porque son información de seguridad y omitirlas sería deshonesto: **ninguna
es un fallo desconocido, todas son decisiones tomadas o trabajo condicionado a un trigger.**

### ⚠️ 1. Un token sobrevive a la desactivación de su dueño ([backlog #11](./docs/backlog.md))

`JwtAuthGuard` verifica firma, expiración y el `role` **acuñado en el token**; nunca comprueba que
el sujeto siga vigente. **No hay refresh token ni revocación.** Con `JWT_EXPIRES_IN_S` en 3600, un
admin desactivado a las 10:00 con un token emitido a las 09:30 sigue pudiendo operar hasta las
10:30. El login sí comprueba `active` —un desactivado no obtiene token nuevo—, así que la ventana
es exactamente la vida del token ya emitido.

Hay una asimetría real en el repositorio: `POST /orders` **sí** revalida al cliente contra el
directorio de `users` en cada orden y devuelve 403 (`CustomerGoneError`); los endpoints de `users`
no. La decisión de cerrarlo —comprobar vigencia por petición, o TTL corto + refresh— está
pendiente y es del mantenedor.

**Qué hacer si te importa:** baja `JWT_EXPIRES_IN_S`. Es el único mitigante disponible hoy sin
tocar código.

### ⚠️ 2. El rate limiting cuenta por réplica, no por despliegue ([backlog #3](./docs/backlog.md))

`ThrottlerModule` se registra sin `storage` (`src/app.module.ts`), así que usa el almacenamiento
**en memoria del proceso**. Con N réplicas, el límite efectivo es N × `THROTTLER_LIMIT` — y eso
incluye el 10/min de los endpoints de auth. Lo mismo le pasa al `AttemptLimiter` de la Basic Auth
de la documentación, que guarda sus contadores en un `Map`.

Hay un segundo frente, independiente: ambos cuentan por `req.ip`. Detrás de un reverse proxy con
`TRUST_PROXY=0`, `req.ip` es la IP del proxy y **todos los clientes caen en el mismo contador**.

**Qué hacer si te importa:** configura `TRUST_PROXY` correctamente para tu topología, y si corres
más de una réplica, añade un `ThrottlerStorage` compartido (Redis). El trigger ya está decidido en
el backlog: se hace en cuanto cualquier entorno pase de una réplica.

### ⚠️ 3. No hay bloqueo de cuenta por identidad

El único límite sobre `POST /auth/login` es el `@Throttle` de 10/min **por IP y handler**. No
existe ningún contador por email, ni bloqueo temporal tras N fallos, ni notificación al titular.
Verificado: el único limitador por intentos del repositorio (`AttemptLimiter`,
[`src/bootstrap/docs-auth.ts`](./src/bootstrap/docs-auth.ts)) protege la Basic Auth de la
documentación, no el login.

En la práctica eso significa que un ataque de credential stuffing repartido entre muchas IPs no
encuentra nada que lo frene a nivel de cuenta. El coste de argon2id encarece el ataque, pero
encarece **igual** al servidor, porque el login verifica siempre —incluso cuando el email no
existe, que es justo lo que lo hace anti-enumeración—: cada intento son 64 MiB de memoria y 3
iteraciones, y el límite deja pasar 10 por minuto y por IP.

**Qué hacer si te importa:** ponlo detrás de un WAF, o implementa el contador por identidad. No
está en el backlog como entrada propia — se documenta aquí porque un usuario de la plantilla debe
saberlo antes de desplegarla.

### Otras, menores

- **La compensación del registro puede tapar el error original** ([backlog #16](./docs/backlog.md)).
  Si el borrado del perfil huérfano también falla, su excepción sustituye a la que explica por qué
  falló la credencial. Hacen falta dos fallos de base consecutivos.
- **Las migraciones que mueven datos no las ejercita ninguna prueba**
  ([backlog #17](./docs/backlog.md)). Se validaron a mano con un ciclo `up → down → up` sobre las
  dos bases, pero eso no impide una regresión futura.
- **Dos huecos latentes en la matriz de fronteras** ([backlog #19](./docs/backlog.md)): la lista
  negra de imports del kernel de dominio deja pasar `rxjs`, `express` y `class-transformer`. Es una
  regla de arquitectura que no se aplica del todo, no una vulnerabilidad — el impacto hoy es cero.

---

## Lo que este repositorio NO hace

Dicho explícitamente para que nadie lo dé por hecho:

| No hay                                    | Por qué                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| Refresh tokens, revocación, blacklist     | Ver limitación 1. Decisión pendiente, no olvido                           |
| MFA / 2FA                                 | Fuera del alcance de una plantilla base                                   |
| Verificación de email en el alta          | Fuera del alcance                                                         |
| Recuperación de contraseña                | Fuera del alcance                                                         |
| Auditoría de accesos (quién vio qué)      | Hay logs estructurados con request-id, no un log de auditoría             |
| Cifrado de datos en reposo a nivel de app | Se delega en el motor / el proveedor de la base                           |
| Escaneo SAST del código propio            | Los gates cubren secretos, dependencias e imagen — no análisis del código |
| Firma de commits obligatoria              | No configurada                                                            |

---

## Prácticas para quien deriva un proyecto de esta plantilla

1. **Genera un `JWT_SECRET` propio** de al menos 32 caracteres aleatorios. Fuera de
   `development`/`test` la app no arranca sin él, pero en `development` el default inseguro sí se
   usa: no promuevas un `.env` de desarrollo.
2. **Ejecuta `pnpm seed:admin` una vez** y borra `ADMIN_PASSWORD` del entorno después. El seed es
   idempotente y es el rescate documentado si el único admin se desactiva por error.
3. **Nunca commitees el `.env`.** Está en `.gitignore`, y secretlint bloquea el commit si algo se
   cuela — pero `git commit --no-verify` salta el hook: la red real es gitleaks en CI.
4. **Deja `DOCS_ENABLED=false`** en cualquier entorno expuesto, o protégelo con
   `DOCS_USERNAME`/`DOCS_PASSWORD`.
5. **Configura `TRUST_PROXY`** si hay un balanceador delante, o el rate limiting agrupará a todos
   tus clientes en un contador.
6. **Mantén los gates encendidos.** `pnpm audit --prod --audit-level=high` y trivy rompen la CI a
   propósito; silenciarlos convierte la plantilla en otra cosa.
