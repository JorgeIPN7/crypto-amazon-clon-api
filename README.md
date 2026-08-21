# nest-base-template

Base NestJS 11 lista para producción: arquitectura hexagonal (Clean Architecture + DDD), TypeORM sobre PostgreSQL, SWC, Pino, configuración validada con Zod, documentación OpenAPI servida con Scalar, Terminus, rate limiting y seguridad por defecto.

**Si acabas de clonar esto, ve directo a [Puesta en marcha](#puesta-en-marcha).** Son seis comandos.

<!-- template-only:start -->

---

## Empezar un proyecto nuevo desde esta base

Dos pasos, en este orden, y después [Puesta en marcha](#puesta-en-marcha) como todo el mundo. Esta sección solo existe mientras el repositorio **es** el template: `pnpm init:project` la borra del README del proyecto derivado, junto con el resto de bloques marcados `template-only`.

### Paso 0: Traerte el código

> ### ✅ Usa el botón «Use this template», en la página del repositorio en GitHub
>
> Te entrega todo el árbol en **un commit inicial limpio**, sin relación con el original. Las otras tres formas funcionan, pero ninguna es mejor que esta.

| Forma                          | Cómo                                                                         | Veredicto                                                                                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Botón «Use this template»**  | En la página del repositorio en GitHub                                       | ✅ **Recomendada.** Un commit inicial, limpio                                                                                                                    |
| `degit` / `giget`              | `pnpm dlx giget gh:JorgeIPN7/template-nest-js-hexagonal-ddd-mudblood mi-api` | Sirve si no quieres pasar por la interfaz web, o si el origen no está en GitHub. Descarga el árbol sin `.git`                                                    |
| `git clone` + reiniciar el git | `git clone --depth 1 <url> mi-api && cd mi-api && rm -rf .git && git init`   | Equivalente a la anterior, con más pasos                                                                                                                         |
| **Fork**                       | Botón _Fork_                                                                 | ❌ **No.** Un fork no es una copia independiente, es una rama pública del original: los PR apuntan por defecto al repositorio de origen y el tuyo sale en su red |

El botón no arrastra historial, tags, releases, issues, wiki ni los _secrets_ de GitHub Actions. Da igual: la CI de este repositorio no usa ninguno, así que funciona desde el primer push.

> **⚠️ Copiar y pegar los archivos en una carpeta nueva es la peor opción, y no por comodidad.** El explorador de archivos oculta lo que empieza por punto, que es justo donde vive media configuración. Tres pérdidas son graves:
>
> | Lo que no copias                            | Qué deja de funcionar                                                                                                                                                        |
> | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | `.swcrc`                                    | **⚠️ La inyección de dependencias, en runtime.** Sin `decoratorMetadata` Nest no sabe qué inyectar y muere con `Nest can't resolve dependencies` — con el typecheck en verde |
> | `.husky/`, `.github/`, `.secretlintrc.json` | Todos los gates a la vez: pre-commit, commitlint, escaneo de secretos y la CI entera. Nada verifica un PR                                                                    |
> | `.gitignore`, `.env.example`                | Acabas commiteando `node_modules/`, `dist/` y tu `.env` —con el `JWT_SECRET` dentro—, y pierdes el único sitio donde está documentada cada variable                          |
>
> Se quedan también `.prettierrc`, `.prettierignore`, `.editorconfig`, `.nvmrc` y `.node-version`: formato y versión de Node dejan de estar fijados, y el primer `pnpm format:check` reformatea el repositorio entero. Y aunque copies los ocultos, sigue faltando `.git`: sin él `pnpm install` termina bien pero imprime `husky - .git can't be found` y los hooks no quedan instalados.

### Paso 1: Ponerle tu nombre con `pnpm init:project`

**Requerido, y antes de `pnpm install`.** El script es Node puro —no importa nada de `node_modules`—, así que corre en un árbol recién descargado; hacerlo antes evita que `pnpm-lock.yaml` guarde el nombre viejo.

```bash
pnpm init:project --name mi-api --title "Mi API" --description "API de ejemplo" --author "Tu Nombre <tu@correo.com>" --repo https://github.com/tu-org/mi-api
```

Solo `--name` es obligatorio; el resto tiene default, se deriva o se pregunta. Añade `--dry-run` al final para ver el plan sin escribir nada.

| Qué toca                           | Cómo                                                                                                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 20 archivos con el nombre literal  | Sustitución de tokens: paquete, base de datos (la de desarrollo **y** la de tests), proyecto y contenedor de Compose, título OpenAPI, `service` de los logs, URL del repositorio |
| `package.json`                     | Campo a campo: `name`, `version` a `0.1.0`, `description`, `author`. Sin `--repo`, **elimina** `repository`, `bugs` y `homepage` en lugar de dejarlos apuntando aquí             |
| `CHANGELOG.md` y `docs/backlog.md` | Los archiva en `docs/template-history/` y crea los del proyecto nuevo, vacíos. No los reescribe: son historia real de otro proyecto, y renombrarla la falsearía                  |
| Los bloques `template-only`        | Los recorta del README                                                                                                                                                           |
| Un `JWT_SECRET`                    | Lo genera y lo **imprime** — nunca lo escribe en un archivo: `.env.example` está versionado y `secretlint` bloquearía el commit, con razón                                       |

**Al terminar imprime ese `JWT_SECRET` y los pasos que siguen: son los de [Puesta en marcha](#puesta-en-marcha).** Con una diferencia — si ya habías levantado la base **antes** de renombrar, usa `pnpm db:reset` en vez de `pnpm db:up`: el nombre de la base cambió y el volumen anterior contiene la antigua.

Lo que **no** hace: tocar git, ajustar el `scope-enum` de `commitlint.config.cjs` y borrar los módulos de ejemplo (eso es [una checklist aparte](#quitar-los-módulos-de-ejemplo)). Tampoco se autoelimina salvo con `--self-destruct`, para que un renombrado interrumpido a mitad se pueda reintentar.

> **⚠️ Dos límites que el script valida, y conviene saber antes de elegir nombre:** el slug va en `kebab-case` (`^[a-z][a-z0-9-]*$`), y su versión `snake_case` no puede pasar de **58 caracteres** — el techo de 63 de PostgreSQL menos el sufijo `_test`.

`src/__tests__/init-project.spec.ts` vigila el manifiesto del script contra el repositorio real. Si alguien escribe el nombre del template en un archivo nuevo sin declararlo, la suite se pone roja — sin ese gate, el renombrado quedaría a medias en silencio.

<!-- template-only:end -->

---

## Contenido

- [Puesta en marcha](#puesta-en-marcha) — **empieza por aquí**
- [Problemas frecuentes](#problemas-frecuentes)
- [Variables de entorno](#variables-de-entorno)
- [Arquitectura](#arquitectura)
- [Base de datos](#base-de-datos)
- [Testing](#testing)
- [Scripts](#scripts)
- [El stack](#el-stack) — qué hace cada pieza y por qué está
- [Lo que este template ya te resolvió](#lo-que-este-template-ya-te-resolvió)
- [Convenciones](#convenciones)
- [Endpoints base](#endpoints-base)
- [Deploy notes](#deploy-notes)
- [Skills de IA](#skills-de-ia)

---

## Puesta en marcha

### Requisitos previos

Nada de esto requiere darse de alta en ningún servicio. **El proyecto no usa tokens, ni registries privados, ni APIs de terceros**: todo sale de npm público y Docker Hub. Lo único que se descarga de un tercero es el bundle de CA de AWS, y solo si vas a conectar a RDS verificando el certificado ([ver más abajo](#conexión-y-tls-rds)).

| Herramienta             | Versión             | Quién la fija                              | Descarga                                                                                                                             |
| ----------------------- | ------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Node.js**             | `24.19.0`           | `.nvmrc`, `.node-version`, `Dockerfile`    | [nodejs.org](https://nodejs.org/) · [nvm](https://github.com/nvm-sh/nvm) · [nvm-windows](https://github.com/coreybutler/nvm-windows) |
| **pnpm**                | `11.22.0`           | `packageManager` en `package.json`         | Vía Corepack (incluido en Node): `corepack enable`                                                                                   |
| **Docker** + Compose v2 | cualquiera reciente | los scripts usan `docker compose --wait`   | [Docker Desktop](https://www.docker.com/products/docker-desktop/)                                                                    |
| **Git**                 | cualquiera          | necesario para que Husky instale los hooks | [git-scm.com](https://git-scm.com/)                                                                                                  |

> **Ojo con la versión de Node:** `engines` en `package.json` **no bloquea la instalación**. No hay `.npmrc` con `engine-strict=true`, así que con una versión distinta solo verás un aviso y pnpm seguirá adelante. Si algo se comporta raro, comprueba primero `node --version`.

> **Sobre pnpm:** el proyecto fija la versión exacta en `packageManager`. Con `corepack enable` (una sola vez) tu `pnpm` global respeta ese pin automáticamente. Si prefieres no habilitarlo, ejecuta los comandos como `corepack pnpm …`. Los ajustes de pnpm viven en `pnpm-workspace.yaml`; desde pnpm 11 la clave `pnpm` de `package.json` **se ignora en silencio**.

### La receta, de cero a la API respondiendo

<!-- template-only:start -->

> **¿Vienes del botón «Use this template»?** Ejecuta primero [`pnpm init:project`](#paso-1-ponerle-tu-nombre-con-pnpm-initproject) — antes de `pnpm install`.

<!-- template-only:end -->

```bash
# 1 · Traerte el código
git clone https://github.com/JorgeIPN7/template-nest-js-hexagonal-ddd-mudblood.git mi-api && cd mi-api

# 2 · Fijar el toolchain
nvm use                  # o instala Node 24.19.0 a mano
corepack enable          # usa el pnpm que fija el repo

# 3 · Dependencias
pnpm install

# 4 · Configuración — funciona tal cual: no hace falta editar ni descomentar nada
cp .env.example .env

# 5 · PostgreSQL 18 en Docker (bloquea hasta que la base responde)
pnpm db:up

# 6 · Esquema
pnpm migration:run

# 7 · Arrancar
pnpm start:dev
```

Con eso:

| Qué                  | Dónde                                 |
| -------------------- | ------------------------------------- |
| La API               | `http://localhost:8888/api/v1/…`      |
| La documentación     | `http://localhost:8888/api/docs`      |
| El documento OpenAPI | `http://localhost:8888/api/docs/json` |
| Health check         | `http://localhost:8888/api/v1/health` |

Y para los tests, **dos comandos, no uno** — la base de tests se crea vacía y hay que migrarla:

```bash
pnpm db:migrate:test     # solo la primera vez, y tras cada migración nueva
pnpm test:e2e
```

### Qué poner en tu `.env`

**Con `.env.example` copiado tal cual, la app arranca. No hace falta descomentar nada.** De las 43 variables, todas tienen valor por defecto o son opcionales sin condición.

Sin `.env` la app también arranca, pero `DOCS_ENABLED` cae al default del código (`false`) y te quedas sin `/api/docs`. Ese es el motivo real del `cp`.

Las 8 líneas comentadas de `.env.example` están comentadas **a propósito**. Aquí está cuándo descomentar cada una:

| Comentada en `.env.example`       | Descoméntala cuando…                                                                           | Lo que exige                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `JWT_SECRET`                      | despliegues a `staging`/`production` (**obligatoria ahí**), o quieras quitar el aviso en local | mínimo 32 caracteres — `openssl rand -base64 48`                         |
| `JWT_EXPIRES_IN_S`                | quieras cambiar la hora por defecto del token                                                  | entero positivo, en segundos                                             |
| `ADMIN_EMAIL` · `ADMIN_PASSWORD`  | vayas a correr [`pnpm seed:admin`](#el-primer-admin)                                           | **las dos o ninguna**; la contraseña, 12 caracteres mínimo               |
| `DOCS_USERNAME` · `DOCS_PASSWORD` | quieras Basic Auth sobre la documentación                                                      | **las dos o ninguna**                                                    |
| `DB_SSL_CA`                       | conectes a RDS verificando el certificado                                                      | una ruta que exista, o el arranque falla con `ENOENT`                    |
| `DB_DATABASE_TEST`                | hayas cambiado el nombre de la base de tests                                                   | que esa base exista — ver [personalizar](#personalizar-la-base-de-datos) |

> **⚠️ `VAR=` no es lo mismo que omitir `VAR`.** El default solo se aplica cuando la variable **no está**. `PORT=` es un error de configuración y la app se niega a arrancar — deliberado: `Number('')` es `0`, y un `SHUTDOWN_TIMEOUT_MS=` silenciosamente convertido en cero hacía que cada despliegue matara el proceso antes de terminar el cierre ordenado. Para usar el valor por defecto, comenta la línea o bórrala.
>
> Por eso esas 8 van comentadas y no en blanco: descomentar una dejándola vacía **impide el arranque**, y las cuatro que forman pareja lo impiden también si defines solo una de las dos.

El detalle completo de cada variable —qué controla, con qué combina mal y dónde se aplica en el código— vive en [`.env.example`](./.env.example), junto al valor que vas a editar. El [inventario en tablas](#variables-de-entorno) está más abajo.

### Personalizar la base de datos

Los valores por defecto son `postgres` / `postgres` / `nest_base_template`, que coinciden con los del `docker-compose.yml` para que un `.env` recién copiado conecte sin tocar nada. Para cambiarlos:

| Qué quieres cambiar                | Cómo                                                                                                                                                                              | Cuándo                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Nombre de la base (dev **y** test) | `pnpm init:project --name mi-api` → `mi_api` y `mi_api_test`, en todos los archivos a la vez                                                                                      | Antes de todo lo demás                         |
| Nombre de la base, a mano          | `DB_DATABASE` en `.env` **+** el `CREATE DATABASE` de [`docker/initdb/01-create-test-database.sql`](docker/initdb/01-create-test-database.sql) **+** `DB_DATABASE_TEST` en `.env` | Antes del primer `pnpm db:up`                  |
| Usuario y contraseña               | `DB_USERNAME` y `DB_PASSWORD` en `.env`                                                                                                                                           | Antes del primer `pnpm db:up`                  |
| Puerto                             | `DB_PORT` en `.env`                                                                                                                                                               | Cuando sea: basta `pnpm db:down && pnpm db:up` |

Funciona porque `docker-compose.yml` **lee esas cuatro variables de tu `.env`**, con los defaults como respaldo:

```yaml
POSTGRES_USER: ${DB_USERNAME:-postgres}
POSTGRES_PASSWORD: ${DB_PASSWORD:-postgres}
POSTGRES_DB: ${DB_DATABASE:-nest_base_template}
ports: ['${DB_PORT:-5432}:5432']
```

> **⚠️ PostgreSQL solo lee `POSTGRES_USER`, `POSTGRES_PASSWORD` y `POSTGRES_DB` al inicializar un volumen vacío.** Si ya ejecutaste `pnpm db:up`, cambiar el `.env` no tiene ningún efecto: el contenedor arranca con las credenciales del volumen viejo y verás `28P01 password authentication failed`. Hay que hacer `pnpm db:reset`, **que borra los datos**. El puerto es la excepción —es del mapping de Compose, no del volumen— y por eso le basta un `db:down && db:up`.

Dos cosas que no puedes olvidar si cambias el nombre a mano:

- **El `.sql` de `docker/initdb/` lleva el nombre literal**, porque un `.sql` no interpola variables de entorno. Si `DB_DATABASE` deja de ser el default, ese `CREATE DATABASE` sigue creando la base de tests con el nombre antiguo. Quien mantiene los dos sincronizados es `pnpm init:project`; a mano, es tuyo.
- **`DB_DATABASE_TEST` solo le dice a Jest a dónde apuntar**; no crea nada. La base tiene que existir.

En producción, `DB_PASSWORD` se inyecta como secreto del orquestador. Nunca en el repositorio: el hook de pre-commit escanea con `secretlint` todo archivo staged.

### Comprobar que funciona

```bash
curl http://localhost:8888/api/v1/health

curl -X POST http://localhost:8888/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"maria@example.com","name":"María González","password":"una-frase-larga-y-dificil-de-adivinar"}'

curl -X POST http://localhost:8888/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"maria@example.com","password":"una-frase-larga-y-dificil-de-adivinar"}'

curl http://localhost:8888/api/v1/users/<id> \
  -H 'Authorization: Bearer <accessToken>'
```

El alta devuelve `201` con la forma `{ "success": true, "data": { "user": { … } }, "request": { … } }` y crea **dos filas**: el perfil en `users` y la credencial en `auth_credentials` — son bounded contexts distintos, y por eso el alta vive en `/auth/register` y no en `/users`. El login devuelve `200` con `accessToken` en `data`; cópialo, junto con el `data.user.id` del alta, para la cuarta llamada. Sin el header `Authorization`, el guard global responde `401`.

### El primer admin

**`POST /auth/register` crea siempre rol `user`, nunca `admin`** — está fijo en `User.create()`. Así que con ese token, dos rutas responden `403`, y no es un fallo de configuración:

| Endpoint                                         | Exige                  | Con el token del registro |
| ------------------------------------------------ | ---------------------- | ------------------------- |
| `GET /api/v1/users/:id` · `POST /api/v1/orders`  | cualquiera autenticado | `200`                     |
| `GET /api/v1/users` · `DELETE /api/v1/users/:id` | rol `admin`            | **`403`**                 |

El único camino a un admin es el seed. Añade la pareja al `.env` —**ambas o ninguna**, o la app no arranca; la contraseña exige 12 caracteres mínimo— y ejecútalo:

```bash
# .env
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=una-frase-larga-de-prueba
```

```bash
pnpm seed:admin          # imprime "created" o "promoted"

curl -X POST http://localhost:8888/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"una-frase-larga-de-prueba"}'
```

El seed necesita las migraciones aplicadas —escribe SQL crudo sobre `users` y `auth_credentials`— y es **idempotente y sirve de rescate**: si el email ya existe, lo deja operativo (rol `admin`, activo y con hash nuevo) en vez de fallar. Eso importa porque `DELETE /users/:id` desactiva sin borrar, y desactivar al único admin por error dejaría la API sin nadie que pueda listar ni reactivar. `LoginUseCase` responde a un usuario inactivo con el mismo `401` que a una contraseña mal puesta, así que sin esta vía el síntoma sería indistinguible.

### Correr los tests

```bash
pnpm test                # unitarios: no necesitan nada levantado
pnpm db:migrate:test     # migra nest_base_template_test
pnpm test:e2e            # E2E: necesita PostgreSQL y la base de tests migrada
```

**`pnpm db:up` crea la base de tests pero no le aplica las migraciones.** La CLI de TypeORM lee `DB_DATABASE` del `.env`, que apunta a la de desarrollo, y `test/setup-env.ts` redirige a la de tests **dentro del proceso de Jest**, no en la CLI. Sin ese paso, el primer `pnpm test:e2e` muere con `QueryFailedError: relation "auth_credentials" does not exist` — medido sobre una base recién creada: la primera suite en correr es `auth.e2e-spec.ts` y su `beforeEach` trunca esa tabla antes que ninguna otra.

`pnpm db:reset` sí deja las dos bases migradas: hace `down -v` → `up --wait` → `migration:run` → `db:migrate:test`. Después de generar una migración nueva, repite `pnpm db:migrate:test` o la suite E2E se quedará con el esquema viejo.

### Qué pasa si te saltas un paso

Merece la pena leerlo: casi todos los tropiezos de la primera vez están aquí.

| Paso                   | Si lo omites                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`         | Nada funciona. Si además descargaste un ZIP en vez de clonar, verás `husky - .git can't be found`: **la instalación no falla**, pero los hooks de pre-commit y commit-msg no se instalan                                                                                                                                                                        |
| `cp .env.example .env` | La app arranca —en `development` todas las variables tienen default— pero **sin documentación** (`DOCS_ENABLED` es `false` en el código). Y `docker compose` lee `DB_PORT` de ese fichero: si lo creas o lo editas **después** de `pnpm db:up`, hace falta `pnpm db:down && pnpm db:up`                                                                         |
| `pnpm db:up`           | TypeORM reintenta unos 30 s y el arranque muere con `Fatal bootstrap error … ECONNREFUSED 127.0.0.1:5432`                                                                                                                                                                                                                                                       |
| `pnpm migration:run`   | **La app arranca y `/api/v1/health` responde 200**, así que parece que todo va bien. Pero cualquier `/api/v1/users` devuelve 500 con `relation "users" does not exist`. En desarrollo `DB_MIGRATIONS_RUN` no hace nada: es a propósito, solo aplica fuera de development                                                                                        |
| `pnpm db:migrate:test` | **`pnpm test:e2e` revienta con `relation "auth_credentials" does not exist`** —medido: la primera suite es `auth.e2e-spec.ts` y su `beforeEach` trunca esa tabla antes que ninguna otra—. Parece un fallo del código y es un esquema que nadie migró. Mismo tipo de error que la fila de arriba, pero ahí falta migrar la base de desarrollo y aquí la de tests |
| Migrar tras `db:reset` | No hace falta: `db:reset` ya deja las dos bases migradas. Sí lo hace tras `pnpm db:down && pnpm db:up`, que conserva el volumen y por tanto el esquema                                                                                                                                                                                                          |

---

## Problemas frecuentes

**`28P01 password authentication failed`** — Dos causas. La habitual: tienes un PostgreSQL instalado en la máquina ocupando el 5432, así que la app se conecta a ese en vez de al contenedor; cambia `DB_PORT` a un puerto libre (`5433`) y relanza con `pnpm db:down && pnpm db:up`. La otra: cambiaste `DB_USERNAME`/`DB_PASSWORD` **después** del primer `db:up` — ver [personalizar la base de datos](#personalizar-la-base-de-datos).

**`Bind for 0.0.0.0:5432 failed: port is already allocated`** — Mismo origen que la primera causa, misma solución.

**`EADDRINUSE` al arrancar la app** — El 8888 está ocupado. Cambia `PORT`.

**`Starting inspector on 127.0.0.1:9229 failed`** — Ya hay un depurador escuchando. Usa `npx nest start --debug=9230 --watch`.

**`relation "users" does not exist`** — Si lo devuelve la app, falta `pnpm migration:run`.

**`relation "auth_credentials" does not exist` en `pnpm test:e2e`** — Falta `pnpm db:migrate:test`. Es la base de tests, no la de desarrollo, y no es un fallo del código: nadie le aplicó las migraciones. Lo mismo si aparece tras generar una migración nueva.

**`husky - .git can't be found`** — Descargaste el proyecto como ZIP. La instalación termina bien, pero los hooks de Git no quedan instalados: los commits no se validarán.

**Los logs salen como JSON en una sola línea** — Es el comportamiento por defecto. Pon `LOG_PRETTY=true` en tu `.env` para leerlos cómodamente en desarrollo.

**`pnpm test` pasa en local y CI falla** — `pnpm test` no mide cobertura; `pnpm test:ci` sí, y aplica umbrales. Ejecuta `pnpm test:cov` antes de subir. Del mismo modo, CI instala con `--frozen-lockfile`: si tocaste `package.json` sin regenerar `pnpm-lock.yaml`, fallará solo allí.

<!-- template-only:start -->

---

## Quitar los módulos de ejemplo

Con el proyecto ya arrancando, si no vas a usar los contextos de ejemplo, quítalos **a mano y en este orden**. `health` se queda siempre. Los otros tres son ejemplos, pero **no son independientes**:

| Módulo   | ¿Se puede quitar?                | Qué arrastra                                                                                  |
| -------- | -------------------------------- | --------------------------------------------------------------------------------------------- |
| `orders` | Sí, sin tocar nada más           | Es el único consumidor de `UsersLookup`; nadie depende de él                                  |
| `auth`   | Sí, pero deja la API **abierta** | Registra el `APP_GUARD` global. Quitarlo sin sustituirlo deja todo endpoint sin autenticación |
| `users`  | **No sin reescribir `auth`**     | `auth` consume `UsersLookup` y `UsersProvisioning`; sin ellos no hay ni login ni registro     |

Para cada módulo que quites:

1. Borra `src/modules/<contexto>/` entera — los tests van dentro, así que se van con ella.
2. Quita su import y su entrada en `imports:` de [`src/app.module.ts`](src/app.module.ts).
3. Borra su migración y la tabla que creó. La de `orders` es [`1786076763455-create-orders-and-outbox.ts`](src/database/migrations/1786076763455-create-orders-and-outbox.ts); si ya la aplicaste, `pnpm migration:revert` antes de borrar el archivo. Con la base todavía sin datos, `pnpm db:reset` es más rápido.
4. Quita su scope del `scope-enum` de [`commitlint.config.cjs`](commitlint.config.cjs).
5. Si era `orders`, quita también `pnpm outbox:relay` de `package.json` y `src/database/outbox/`.
6. Revisa las secciones que lo describen en este README y en [`CLAUDE.md`](CLAUDE.md).
7. **Vuelve a medir la mutación.** `stryker.config.mjs` apunta por globs, así que no hay que editarlo, pero el umbral `break: 85` está calibrado sobre el peso en mutantes de los módulos actuales: quitar uno mueve el score global. Corre `pnpm test:mutation` y ajusta el umbral con el número nuevo, no a ojo.
8. Definition of Done completo: `typecheck` → `lint:check` → `format:check` → `test` → `test:e2e` → `build`.

<!-- template-only:end -->

---

## Variables de entorno

Todas pasan por validación Zod (`src/config/env.schema.ts`): tipos coercionados, defaults seguros y un error detallado al arrancar si algo no encaja.

> **Estas tablas son el índice; el detalle vive en [`.env.example`](./.env.example).** Allí cada variable dice qué controla, qué pasa si la cambias, con qué combina mal y dónde se aplica en el código. Para saber **qué tienes que poner tú**, ve a [qué poner en tu `.env`](#qué-poner-en-tu-env).

La columna **¿Tocarla?** responde lo único que se suele preguntar: `No` = el default sirve; `Prod` = revísala antes de desplegar; `Opcional` = solo si quieres esa función.

### Aplicación

| Variable        | Default            | ¿Tocarla? | Notas                                                                                             |
| --------------- | ------------------ | --------- | ------------------------------------------------------------------------------------------------- |
| `NODE_ENV`      | `development`      | **Prod**  | `development` / `test` / `staging` / `production`. Un valor fuera de la lista impide el arranque. |
| `PORT` / `HOST` | `8888` / `0.0.0.0` | No        | Puerto y bind del servidor HTTP.                                                                  |
| `GLOBAL_PREFIX` | `api`              | No        | Prefijo de todas las rutas.                                                                       |
| `API_VERSION`   | `1`                | No        | Versión del versioning por URI: las rutas quedan en `/<prefix>/v<versión>/…`.                     |
| `TRUST_PROXY`   | `0`                | **Prod**  | Confianza en cabeceras `X-Forwarded-*`. Acepta un entero o una spec de Express.                   |
| `BODY_LIMIT`    | `1mb`              | No        | Límite del body parser.                                                                           |

### CORS

| Variable           | Default | ¿Tocarla? | Notas                                                                                                                                                             |
| ------------------ | ------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CORS_ENABLED`     | `true`  | No        | Solo acepta `true`/`false`/`1`/`0`. `yes` o `TRUE` fallan la validación.                                                                                          |
| `CORS_ORIGINS`     | `*`     | **Prod**  | Lista separada por comas. Sin comodines de subdominio ni barra final.                                                                                             |
| `CORS_CREDENTIALS` | `false` | **Prod**  | **Incompatible con `CORS_ORIGINS=*`**: la combinación lanza un error explícito al arrancar, porque enviar credenciales a cualquier origen anularía la protección. |

### Logging

| Variable            | Default              | ¿Tocarla? | Notas                                                                                        |
| ------------------- | -------------------- | --------- | -------------------------------------------------------------------------------------------- |
| `LOG_LEVEL`         | `info`               | No        | `fatal`/`error`/`warn`/`info`/`debug`/`trace`/`silent`.                                      |
| `LOG_PRETTY`        | `false`              | Opcional  | Formato legible vía `pino-pretty`. **Por defecto verás JSON crudo**, también en `start:dev`. |
| `LOG_REDACT_FIELDS` | (ver `.env.example`) | Opcional  | Paths adicionales a redactar, que **se suman** a los 11 seguros por defecto.                 |

### Rate limiting, docs y runtime

| Variable                                       | Default          | ¿Tocarla? | Notas                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------- | ---------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `THROTTLER_TTL_MS` / `THROTTLER_LIMIT`         | `60000` / `100`  | No        | Ventana y máximo de peticiones por cliente. `/auth/login` y `/auth/register` llevan 10/min fijo en el código, aparte.                                                                                                                                                                                        |
| `DOCS_ENABLED`                                 | **`false`**      | Opcional  | Apagado por defecto a propósito: las rutas de la documentación se registran fuera del pipeline de Nest, así que el rate limiting global **no las cubre**. `.env.example` lo pone en `true` para desarrollo.                                                                                                  |
| `DOCS_PATH`                                    | `docs`           | No        | Interfaz en `/<prefix>/<DOCS_PATH>`, sin segmento de versión. El documento crudo, en `/<prefix>/<DOCS_PATH>/json`.                                                                                                                                                                                           |
| `DOCS_USERNAME` / `DOCS_PASSWORD`              | _(sin valor)_    | Opcional  | Basic Auth sobre la documentación **y sobre el documento crudo**. Ambas o ninguna: definir solo una **impide el arranque**, porque el middleware no llegaría a montarse y las docs saldrían publicadas creyendo estar protegidas. Sin ellas quedan abiertas a quien alcance la ruta.                         |
| `SHUTDOWN_TIMEOUT_MS`                          | `10000`          | **Prod**  | Debe ser **mayor que cero**: con 0 el proceso muere antes de completar el cierre ordenado. En Kubernetes, por debajo del `terminationGracePeriodSeconds` del pod.                                                                                                                                            |
| `REQUEST_TIMEOUT_MS` / `KEEP_ALIVE_TIMEOUT_MS` | `15000` / `5000` | **Prod**  | `REQUEST_TIMEOUT_MS` gobierna **dos** mecanismos con el mismo número: `server.requestTimeout` de Node y un interceptor global que responde **408** con el sobre estándar, ajustable por endpoint con `@TimeoutMs(n)` / `@SkipTimeout()`. En `KEEP_ALIVE_TIMEOUT_MS` el 0 sí es válido: desactiva el timeout. |
| `HEALTH_HEAP_LIMIT_MB` / `HEALTH_RSS_LIMIT_MB` | `300` / `600`    | **Prod**  | Umbrales de memoria de `/health` y `/health/readiness`. **No afectan a `/health/liveness`**, que no ejecuta ningún indicador. Son MiB, y el heap se mide sobre `heapUsed`.                                                                                                                                   |

> **`SWAGGER_ENABLED` y `SWAGGER_PATH` ya no se leen.** Fueron renombradas a `DOCS_ENABLED` y `DOCS_PATH`, y dejarlas en el entorno **impide el arranque** con un mensaje que nombra su reemplazo. El riesgo no era publicar la documentación por accidente —el default es `false`— sino lo contrario: que quien la tuviera encendida en staging se quedara sin ella en silencio.

> **Si activas Basic Auth detrás de un balanceador, revisa `TRUST_PROXY`.** Con `0`, `req.ip` es la IP del proxy y el limitador de intentos fallidos agrupa a todos los clientes en un solo contador. Lo que se degrada es la disponibilidad, no la protección. La aplicación avisa al arrancar cuando detecta esa combinación.

### Auth

| Variable                         | Default       | ¿Tocarla?    | Notas                                                                                                                                                                                                                                                                               |
| -------------------------------- | ------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`                     | _(sin valor)_ | **Prod: sí** | **Obligatoria fuera de `development`/`test`**: en `staging`/`production` la app no arranca sin ella. Mínimo 32 caracteres. Sin definir en `development`/`test` cae a un secreto de desarrollo inseguro, publicado en el propio repositorio, y avisa por consola en cada arranque.   |
| `JWT_EXPIRES_IN_S`               | `3600`        | Opcional     | Vigencia del access token, en segundos. No hay refresh token: al expirar, el cliente vuelve a `/auth/login`.                                                                                                                                                                        |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | _(sin valor)_ | Opcional     | Credenciales del primer admin, consumidas por `pnpm seed:admin` (nunca la app en marcha). Ambas o ninguna: definir solo una **impide el arranque** — la validación vive en el mismo `envSchema` que valida toda la app, no en el seed. `ADMIN_PASSWORD` exige 12 caracteres mínimo. |

### PostgreSQL

| Variable                                                               | Default                                        | ¿Tocarla?    | Notas                                                                                                            |
| ---------------------------------------------------------------------- | ---------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------- |
| `DB_HOST` / `DB_PORT`                                                  | `localhost` / `5432`                           | **Prod: sí** | Ver [problemas frecuentes](#problemas-frecuentes) si ya tienes Postgres instalado.                               |
| `DB_USERNAME` / `DB_PASSWORD` / `DB_DATABASE`                          | `postgres` / `postgres` / `nest_base_template` | **Prod: sí** | Coinciden con los del `docker-compose.yml`. Ver [personalizar](#personalizar-la-base-de-datos).                  |
| `DB_SCHEMA`                                                            | `public`                                       | No           | Schema donde viven las tablas.                                                                                   |
| `DB_SSL` / `DB_SSL_REJECT_UNAUTHORIZED` / `DB_SSL_CA`                  | `false` / `true` / —                           | **Prod: sí** | Ver [conexión y TLS](#conexión-y-tls-rds).                                                                       |
| `DB_SYNCHRONIZE`                                                       | `false`                                        | No           | Solo surte efecto en `development`; ver abajo.                                                                   |
| `DB_MIGRATIONS_RUN`                                                    | `false`                                        | **Prod**     | Solo surte efecto **fuera** de `development`. Lee el aviso de [deploy notes](#deploy-notes) antes de encenderla. |
| `DB_LOGGING`                                                           | `false`                                        | No           | Registra cada consulta SQL. **Ese log no pasa por la redacción de Pino.**                                        |
| `DB_POOL_MAX` / `DB_POOL_IDLE_TIMEOUT_MS` / `DB_CONNECTION_TIMEOUT_MS` | `10` / `30000` / `10000`                       | **Prod**     | Pool de `pg`. `DB_POOL_MAX × réplicas` no debe superar el `max_connections`.                                     |
| `DB_DATABASE_TEST`                                                     | `nest_base_template_test`                      | Opcional     | La **única variable que no pasa por la validación**: la lee `test/setup-env.ts` directamente.                    |

---

## Arquitectura

Cada **bounded context** vive bajo `src/modules/<context>/` con sus tres capas dentro. Nunca a la raíz de `src/`.

```
src/
├── main.ts                     # Bootstrap: helmet, compression, CORS, pipes, filtros, docs, shutdown
├── app.module.ts               # Módulo raíz
├── bootstrap/openapi.ts        # Documento OpenAPI + montaje de Scalar
├── common/                     # Cross-cutting: decorators, dto, filters, interceptors, logger
├── config/                     # Namespaces tipados validados con Zod (app, cors, database, log, …)
├── database/                   # DataSource, opciones de TypeORM, migraciones, seeds y outbox
└── modules/
    ├── health/                 # /health, /health/liveness, /health/readiness
    ├── auth/                   # Credenciales y tokens: /auth/register, /auth/login
    ├── orders/                 # Segundo contexto: eventos de dominio + outbox transaccional
    └── users/                  # ← implementación de referencia de las tres capas
        ├── domain/             # Sin imports de @nestjs/*: entidad, VOs, puertos, errores
        │   ├── entities/user.entity.ts
        │   ├── value-objects/  # email.vo.ts, user-id.vo.ts, user-role.ts
        │   ├── errors/user.errors.ts
        │   └── ports/user.repository.ts     # abstract class: contrato Y token de inyección
        ├── application/        # Casos de uso; @Injectable sí, ORM/HTTP no
        │   ├── use-cases/      # create-user.use-case.ts: el caso de uso Y su Input
        │   └── users.facade.ts # Puerta pública del contexto (no es un caso de uso)
        ├── infrastructure/     # Única capa que toca librerías externas
        │   ├── persistence/    # orm-entity, mapper, repositorio TypeORM
        │   └── http/           # controller, dto, filtro de errores de dominio
        ├── __tests__/          # Réplica exacta de la estructura de arriba
        └── users.module.ts     # Composition root: une puerto ↔ adaptador
```

**Reglas que no se negocian** (el detalle, con el porqué de cada una, está en [`CLAUDE.md` §Architecture rules](./CLAUDE.md#architecture-rules)):

- **Dependencias hacia adentro.** `domain/` no importa `@nestjs/*`, TypeORM, `axios`, decoradores de `class-validator` ni `pino`.
- **Dos modelos, nunca uno.** La entidad de dominio es una clase plana con invariantes; la entidad ORM lleva los decoradores. Un mapper es el único puente.
- **Los puertos son `abstract class`**, no `type` + token `Symbol`: una clase sobrevive a la compilación, así que la MISMA referencia es el contrato y el token de inyección, y ningún consumidor necesita `@Inject`. El adaptador hace `implements`, nunca `extends`.
- **⚠️ Nunca `import type` un puerto en un archivo con decoradores.** La referencia se borra del emit y Nest falla **en runtime** con `lint:check` y `typecheck` en verde. `eslint.config.mjs` lo prohíbe bajo `application/` e `infrastructure/`.
- **Los errores de dominio no son errores HTTP.** El dominio lanza `UserNotFoundError`; un filtro decide que eso es un 404. Traducir los errores del driver también es del adaptador: el `23505` de PostgreSQL se convierte en `EmailAlreadyTakenError`, para que una colisión concurrente salga como 409 y no 500.
- **La validación de entrada vive en los DTOs HTTP**, no en las entidades.
- **Sin barreles.** No hay `index.ts` en `src/`: cada import apunta al archivo concreto y, entre módulos, solo el `*.module.ts` es importable. Las 5 reglas de frontera viven en `eslint.boundaries.js` y tienen su propia suite.

**Los contextos se hablan solo por su `*.module.ts`.** `auth` necesita el perfil para autenticar y `orders` para saber si un cliente sigue vigente: los dos definen un puerto propio (`UserDirectory`, `CustomerDirectory`) y lo implementan con un adaptador que inyecta las puertas que `users.module.ts` publica. Son **dos, segregadas por intención**: `UsersLookup` (`userExists`, `findByEmail`) para quien solo pregunta —`orders`— y `UsersProvisioning` (`createProfile`, `deleteProfile`) para quien da de alta y de baja —`auth`, que usa las dos—. Una sola fachada con los cuatro métodos le entregaba a `orders` un borrado físico que nunca pidió; con dos tipos, llamarlo no compila.

La dirección es siempre de una vía: `auth → users`, `orders → users`. Si `users` importara `auth.module` para el guard nacería el único ciclo módulo↔módulo posible del repo, y por eso `@Public`, `@Auth` y `@CurrentUser` viven en `common/`.

### Aliases de TypeScript

| Alias         | Apunta a         |
| ------------- | ---------------- |
| `@/*`         | `src/*`          |
| `@common/*`   | `src/common/*`   |
| `@config/*`   | `src/config/*`   |
| `@database/*` | `src/database/*` |
| `@modules/*`  | `src/modules/*`  |
| `@shared/*`   | `src/shared/*`   |
| `@test/*`     | `test/*`         |

Declarados en `tsconfig.json`, `.swcrc` y `jest.config.mjs`. La config E2E hereda de esta última, así que **solo hay tres sitios que mantener en sincronía**, no cuatro.

**Dentro de un módulo, importa con rutas relativas** (`../../domain/user.entity`), no con alias: así el módulo se puede mover completo sin tocar imports.

---

## Base de datos

### Migraciones, no `synchronize`

`synchronize: true` deja que TypeORM altere el esquema para que encaje con las entidades, y eso incluye **borrar columnas y tablas con sus datos**. Por eso no se toma directamente del entorno:

```ts
// src/config/database.config.ts
synchronize: env.NODE_ENV === 'development' && env.DB_SYNCHRONIZE;
```

`DB_SYNCHRONIZE` solo puede **apagarlo**; encenderlo exige además estar en `development`. Un `.env` de producción mal copiado no puede tocar el esquema.

```bash
# 1. Cambias una *.orm-entity.ts
# 2. Generas la migración con el diff contra la base
pnpm migration:generate src/database/migrations/AddPhoneToUser

# 3. La revisas (siempre) y la aplicas
pnpm migration:run
pnpm db:migrate:test     # y la de tests, o los E2E se quedan con el esquema viejo

# Deshacer la última / ver el estado
pnpm migration:revert
pnpm migration:show
```

Las entidades ORM se descubren por glob (`*.orm-entity.ts` bajo `src/modules/`), así que un módulo nuevo se registra solo. En producción, `DB_MIGRATIONS_RUN=true` aplica las pendientes al arrancar.

> **⚠️ Si la migración DROPEA o RENOMBRA algo, no vale con generarla y correrla.** Se parte en dos —expand y contract— con el despliegue del código en medio, y `DB_MIGRATIONS_RUN=true` deja de ser seguro para la mitad destructiva. La regla completa, con el ejemplo trabajado de `MoveCredentialsToAuthExpand` / `MoveCredentialsToAuthContract`, vive en [`CLAUDE.md` §«Destructive migrations»](./CLAUDE.md#destructive-migrations-expandcontract).

### Conexión y TLS (RDS)

La conexión se define por campos separados (`DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`, `DB_SCHEMA`), no por una URL, para que cada uno pase por la validación de Zod.

| Escenario                     | Configuración                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| Local (docker-compose)        | `DB_SSL=false`                                                                        |
| RDS con verificación completa | `DB_SSL=true`, `DB_SSL_REJECT_UNAUTHORIZED=true`, `DB_SSL_CA=/ruta/global-bundle.pem` |
| RDS sin CA a mano             | `DB_SSL=true`, `DB_SSL_REJECT_UNAUTHORIZED=false`                                     |

> `DB_SSL_REJECT_UNAUTHORIZED=false` **cifra el tráfico pero no verifica la identidad del servidor**: acepta cualquier certificado, así que no protege de un man-in-the-middle. Úsalo solo si no puedes montar el bundle de CA de AWS ([descargarlo aquí](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html)). Si apuntas `DB_SSL_CA` a una ruta que no existe, el arranque falla con `ENOENT`.

---

## Testing

Los tests viven en una carpeta `__tests__/` en la raíz de cada módulo, replicando su estructura interna. Así, mover un módulo se lo lleva con todos sus tests de una pieza.

```
src/modules/users/
├── domain/entities/user.entity.ts
├── application/use-cases/create-user.use-case.ts
└── __tests__/
    ├── domain/entities/user.entity.spec.ts
    ├── application/use-cases/create-user.use-case.spec.ts
    ├── infrastructure/http/users.controller.spec.ts
    ├── helpers/user.factory.ts
    ├── helpers/in-memory-user.repository.ts
    └── users.e2e-spec.ts
```

- **Un spec por archivo de código**, con el mismo nombre base y la misma ruta relativa dentro de `__tests__/`.
- `describe` raíz con el identificador real del código (en inglés); los `describe` anidados agrupan casos y van en español, igual que cada `it`, que es una frase que empieza por **`debería…`**. Código, variables y helpers siguen en inglés.
- **AAA obligatorio**: cada `it` marca `// Arrange`, `// Act`, `// Assert`.
- **Mocking por capa**: sin mocks en `domain/`; fakes escritos a mano en `application/` (nunca `jest.mock`); los repositorios se prueban contra PostgreSQL real en los E2E.
- **Property-based con `fast-check`** en value objects, funciones puras y round-trips de mapeo. Los arbitrarios se **construyen**, nunca se filtran con `.filter()`.
- Helpers compartidos por un módulo en `<módulo>/__tests__/helpers/`; los transversales en `test/helpers/`, importados por `@test/`.

**Cómo se decide qué se prueba:** el modelo de colaboración —tabla de casos acordados, TDD y mutación como auditor— está en [`CLAUDE.md`](./CLAUDE.md#modelo-de-colaboración--casos-primero-tdd-después-mutación-como-auditor). La mutación es un gate real: `pnpm test:mutation` con `break: 85` y job propio en CI.

### Base de datos de los tests

Los E2E corren contra **`nest_base_template_test`**, no contra tu base de desarrollo, porque cada test hace `TRUNCATE` en su `beforeEach`. La crea el init script de `docker/initdb/` al inicializar el volumen, y `test/setup-env.ts` apunta la suite ahí antes de que arranque el `AppModule`.

> **⚠️ Crearla no es migrarla.** Un `.sql` de `docker-entrypoint-initdb.d` solo hace `CREATE DATABASE`. El paso que falta es **[`pnpm db:migrate:test`](#correr-los-tests)**, y hay que repetirlo cada vez que generes una migración nueva. `pnpm db:reset` ya lo incluye.

> Si tenías el contenedor creado de antes, el init script no se ejecuta sobre un volumen existente. Corre `pnpm db:reset` (borra los datos locales) o crea la base a mano:
> `docker exec nest-base-template-db psql -U postgres -c 'CREATE DATABASE nest_base_template_test'`

### Cobertura

La suite unitaria excluye módulos, repositorios TypeORM, `data-source.ts`, seeds, el outbox y migraciones. **Eso ya no es un acto de fe**: `test/jest-e2e.config.mjs` mide esos archivos con su propio umbral, así que `pnpm test:e2e:ci` falla si dejan de estar cubiertos. La excepción es `src/database/migrations/**`, que **no mide ninguna suite** — es deuda registrada, no un descuido (`docs/backlog.md` #17).

El umbral de `branches` (50) es más bajo que el resto a propósito: SWC instrumenta el código que genera para `emitDecoratorMetadata`, y esas ramas no son alcanzables desde un test.

---

## Scripts

| Comando                        | Descripción                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `pnpm start:dev`               | Arranca en modo watch                                                         |
| `pnpm start:debug`             | Watch + inspector en el 9229                                                  |
| `pnpm build`                   | Compila con SWC a `dist/`                                                     |
| `pnpm start:prod`              | Corre el build (`node dist/src/main`)                                         |
| `pnpm lint` / `lint:check`     | Lint con autofix / sin escribir (CI)                                          |
| `pnpm format` / `format:check` | Prettier write / check (CI)                                                   |
| `pnpm typecheck`               | `tsc --noEmit`                                                                |
| `pnpm test`                    | Unit tests                                                                    |
| `pnpm test:watch`              | Unit tests en watch                                                           |
| `pnpm test:cov` / `test:ci`    | Unit tests con cobertura y umbrales                                           |
| `pnpm test:e2e`                | E2E — **requiere la base levantada y migrada**                                |
| `pnpm test:e2e:ci`             | E2E para CI, con su propia cobertura                                          |
| `pnpm test:mutation`           | Stryker. `break: 85` es un gate, no una sugerencia                            |
| `pnpm db:up` / `db:down`       | Levanta / detiene PostgreSQL. `db:up` bloquea hasta que la base responde      |
| `pnpm db:reset`                | Borra el volumen, arranca limpio y **migra las dos bases**                    |
| `pnpm db:migrate:test`         | Aplica las migraciones a la base de tests                                     |
| `pnpm migration:generate`      | Genera migración por diff contra la base                                      |
| `pnpm migration:run`           | Aplica migraciones pendientes a la base de desarrollo                         |
| `pnpm migration:revert`        | Revierte la última migración                                                  |
| `pnpm migration:show`          | Lista el estado de las migraciones                                            |
| `pnpm seed:admin`              | Crea o promueve el primer admin (`ADMIN_EMAIL`/`ADMIN_PASSWORD`), idempotente |
| `pnpm outbox:relay`            | Publica (hoy: log) los eventos pendientes de `orders_outbox` y los marca      |

**Definition of Done** de cualquier cambio: `typecheck` → `lint:check` → `format:check` → `test` → `test:e2e` → `build`, todo en verde.

### Docker

```bash
pnpm db:up                              # solo la base de datos (desarrollo)

docker build -t nest-base-template .    # imagen de la aplicación
docker run --env-file .env -p 8888:8888 nest-base-template
```

El `Dockerfile` es multi-stage (deps → build → production), corre como usuario `node` sin privilegios e incluye un `HEALTHCHECK` contra el endpoint de liveness, cuya ruta se construye desde `GLOBAL_PREFIX` y `API_VERSION`.

> **⚠️ Ese `--env-file .env` lleva `DB_HOST=localhost`, que dentro del contenedor es el contenedor mismo**, no tu PostgreSQL. Para que se vean, ponlos en la misma red y usa el nombre del servicio como `DB_HOST`. _(Razonado sobre la configuración, no medido.)_

> El stage de producción instala con `--prod --ignore-scripts`. Ese `--ignore-scripts` es obligatorio: pnpm ejecuta el hook `prepare` también en instalaciones de producción, y `prepare` invoca a `husky`, que es devDependency. Sin él el build falla con `husky: command not found`. Y `LOG_PRETTY=true` en la imagen requiere `pino-pretty`, que por eso está en `dependencies`.

---

## El stack

Todas las piezas son **libres y gratuitas** (MIT o Apache-2.0). No hay cuentas, API keys ni servicios de pago en ninguna.

| Pieza         | Sustituye a                  | Qué te da                                                       |
| ------------- | ---------------------------- | --------------------------------------------------------------- |
| **SWC**       | `tsc` (solo al compilar)     | Builds y tests 10–20× más rápidos                               |
| **Zod**       | Joi / Yup                    | Una config inválida mata el arranque, no la primera petición    |
| **Pino**      | `console.log`, Morgan        | Logs JSON consultables, con request-id y secretos tapados       |
| **Scalar**    | Swagger UI                   | Documentación interactiva sin llamar a ningún tercero           |
| **Terminus**  | Un endpoint `/health` casero | El orquestador sabe cuándo reiniciar y cuándo sacar de rotación |
| **Throttler** | `express-rate-limit`         | Rate limiting que entiende guards y decoradores de Nest         |

### SWC — rápido porque borra los tipos sin comprobarlos

`nest-cli.json` declara `builder: "swc"`, y eso aplica a `nest build` (producción), `nest start --watch` y Jest. **El código que despliegas lo generó SWC.** El typecheck vive aparte, en dos sitios: `nest-cli.json` tiene `typeCheck: true`, así que `nest build` lanza `tsc --noEmit` en paralelo, y `pnpm typecheck` hace lo mismo por separado. Donde **no** hay typecheck es en watch mode y en Jest — por eso puedes ver un error de tipos en el editor mientras `pnpm test` pasa en verde.

TypeScript borra los tipos al compilar, pero **NestJS los necesita en runtime** para saber qué inyectar. Cuatro opciones de `.swcrc` existen para eso y **ninguna se toca**:

| Opción                           | Qué pasa si falta                                                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `decoratorMetadata: true`        | **La inyección de dependencias deja de funcionar.** Es lo que escribe los tipos en un metadato justo antes de borrarlos |
| `legacyDecorator: true`          | Los decoradores de Nest no se aplican: Nest usa la propuesta antigua, no la estándar de TC39                            |
| `keepClassNames: true`           | Nest usa el nombre de la clase como identificador; si el compilador renombra `UserService` a `a`, se pierde             |
| `useDefineForClassFields: false` | Las propiedades de clase se reinicializan vacías al construir el objeto, pisando lo que inyectó el decorador            |

### Zod — la config inválida mata el arranque, no la primera petición

Valida las variables de entorno **antes** de que se instancie nada. La documentación de `@nestjs/config` usa Joi en su ejemplo, pero documenta la opción `validate`, que acepta cualquier función — y por ahí entra Zod. El argumento decisivo frente a Joi y Yup: escribes el esquema **una vez** y `z.infer<typeof envSchema>` te da el tipo TypeScript gratis; con Joi mantienes a mano el esquema y la `type Env`, y el día que se desincronizan el compilador no se entera.

**División de responsabilidades:** Zod valida **configuración**; `class-validator` valida **DTOs HTTP**. No se pisan.

### Pino — logs que se pueden consultar

Esto no se puede consultar: `[2026-08-04] Usuario 42 creado correctamente`. Esto sí: `{"level":30,"userId":42,"requestId":"3f25…","msg":"user created"}`. Con lo segundo buscas en CloudWatch, Datadog o Loki todas las peticiones de un `requestId`; con lo primero haces `grep` y rezas.

Tres reglas prácticas: **producción en `info`** (`debug` multiplica el coste de ingesta y entierra lo importante); **un error esperado no es `error`** (un 404 porque el usuario no existe es `info` o `warn`; si todo es `error`, las alertas dejan de servir); **`LOG_PRETTY=true` solo en local**.

Y tres configuraciones que valen su peso en oro, todas en `src/common/logger/pino-options.ts`:

| Configuración        | Qué evita                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `redact`             | Que un `Authorization: Bearer …` acabe escrito en los logs. Un token logueado es un token filtrado |
| `genReqId`           | Reutiliza el `x-request-id` entrante en vez de generar uno nuevo, así la traza cruza servicios     |
| `autoLogging.ignore` | Los health checks se sondean cada pocos segundos; sin esto ahogan el resto de trazas               |

**Complemento obligatorio: `nestjs-cls`.** Usa `AsyncLocalStorage` para que el request-id esté disponible en cualquier punto de la cadena **sin pasarlo como parámetro**.

### Scalar — documentación interactiva sin llamar a terceros

**Scalar no sustituye a `@nestjs/swagger`**, que sigue siendo el que **genera** el documento leyendo tus decoradores. Scalar solo lo **renderiza**: lo que sustituye es Swagger UI. Se eligió sobre Redoc (no puedes probar un endpoint desde la página, y eso es la mitad del valor) y sobre Swagger UI (rendimiento, ejemplos multi-lenguaje, aspecto).

**No usamos el SaaS de Scalar.** Ni registro, ni hosting, ni cuenta, ni API key. Hay que decirlo explícitamente porque **el paquete llama a servicios de Scalar por defecto** y hay que apagarlos uno a uno en `src/bootstrap/scalar-config.ts`:

| Default del paquete                    | Qué hacía                                       | Cómo se apaga               |
| -------------------------------------- | ----------------------------------------------- | --------------------------- |
| `proxyUrl: 'https://proxy.scalar.com'` | Tus peticiones de prueba pasaban por un tercero | `proxyUrl: ''`              |
| Fuentes desde `fonts.scalar.com`       | Cargaba Inter y JetBrains Mono desde fuera      | `withDefaultFonts: false`   |
| Telemetría activa                      | Enviaba métricas de uso                         | `telemetry: false`          |
| Agente IA autodetectado por URL        | Encendido en `localhost`                        | `agent: { disabled: true }` |

**El bundle se sirve desde nuestro propio origen, nunca desde el CDN de Scalar**: el paquete no permite adjuntar un hash `integrity`, así que auto-hospedarlo es la única forma de saber qué JavaScript se ejecuta. `scripts/copy-scalar-asset.mjs` lo copia a `public/` con un hash de contenido en el nombre, y los hooks `prebuild`, `prestart:dev`, `pretest:e2e` y `pretest:e2e:ci` lo ejecutan solos. Los cuatro nombres van explícitos porque los hooks de pnpm se resuelven **por nombre exacto**.

Tres capas antes de que nadie vea las docs: `DOCS_ENABLED` apagado por defecto, Basic Auth opcional, y una CSP propia y restrictiva (`default-src 'none'`) acotada a esa ruta, con nonce por petición. **Al subir la versión del bundle**, la lista de comprobación manual de CSP está en [`CLAUDE.md`](./CLAUDE.md#maintaining-the-scalar-bundle) — es el único momento en que puede aparecer una violación nueva.

### Terminus — dos preguntas distintas, dos sondas distintas

| Sonda        | Pregunta que responde              | Si falla, el orquestador…        | ¿Consulta la base? |
| ------------ | ---------------------------------- | -------------------------------- | ------------------ |
| `/liveness`  | ¿Hay que **reiniciar** el proceso? | Mata y reinicia el pod           | **No**             |
| `/readiness` | ¿Puede **atender tráfico** ahora?  | Lo saca de rotación, sin matarlo | **Sí**             |

**Por qué liveness no consulta la base:** si Postgres cae, reiniciar el pod no arregla nada y solo añade un arranque en frío — peor, reiniciarías _todos_ los pods en bucle. **Por qué readiness sí:** sin el ping devolvía 200 con la base caída, el orquestador mantenía el pod en rotación y el 100 % de las peticiones acababa en 500.

### Evaluado y descartado

Está aquí para que nadie reabra la discusión sin un motivo nuevo. **`cors`**: redundante, `app.enableCors()` usa ese mismo paquete por debajo. **`morgan`**: `pino-http` ya loguea cada petición, en JSON, con request-id y secretos tapados. **`express-rate-limit`**: middleware ciego a la capa de Nest, cuando `@nestjs/throttler` ya entiende guards y `@SkipThrottle()`. **`mocha` + `chai`**: cambiar Jest por dos librerías equivalentes perdiendo mocks y cobertura integrados.

Y con registro en `docs/backlog.md`: **OpenTelemetry completo** (sin malla de servicios no hay trazas distribuidas que lo justifiquen), circuit breakers, feature flags y testcontainers. Condicionados a un trigger que aún no ocurrió: **Redis** (throttler compartido, cuando haya más de una réplica), **`prom-client` `/metrics`** (primer entorno con Prometheus) y **BullMQ** (primer caso real de background jobs).

---

## Lo que este template ya te resolvió

Cada punto es un fallo que ya ocurrió aquí y que ya no puede volver a ocurrir.

**Configuración**

- **Una variable vacía ya no vale `0`.** `SHUTDOWN_TIMEOUT_MS=` convertido en cero mataba el proceso antes del cierre ordenado en **todos** los despliegues.
- **`.default()` vs `.prefault()` (Zod 4).** `.default()` recibe el tipo de **salida** y cortocircuita el parseo; si tu esquema acaba en `.transform()`, se lo salta sin avisar.
- **Las listas del `.env` no se pierden en silencio.** `@nestjs/config` descarta arrays y objetos sin decir nada, así que `CORS_ORIGINS` y `LOG_REDACT_FIELDS` viajan como string y se trocean en el factory. Un test lo vigila.
- **`CORS_ORIGINS=*` con `CORS_CREDENTIALS=true` no arranca.** El navegador rechaza esa combinación de todos modos; mejor fallar al desplegar que depurarlo desde el frontend.
- **`DB_SYNCHRONIZE` no puede encenderse fuera de desarrollo**, y **las variables retiradas fallan ruidosamente** nombrando su reemplazo.

**Seguridad**

- **`enableImplicitConversion` está deliberadamente ausente del `ValidationPipe`.** Convertía cada valor _antes_ de validar, así que un `{"name": {"$ne": null}}` se volvía `"[object Object]"` y pasaba `@IsString`, `@MinLength` y `@MaxLength` sin una queja. Eso es inyección NoSQL por la puerta principal.
- **`whitelist` + `forbidNonWhitelisted`:** un campo no declarado en el DTO se rechaza con 400, no se ignora. Sin esto, alguien puede probar a colar `isAdmin: true`.
- **Los secretos no llegan a los logs:** `redact` tapa `authorization`, `cookie`, `*.password`, `*.token`, `*.apiKey` antes de escribir.
- **La CSP también corre en desarrollo**, así que lo que rompa, rompe en local y no al desplegar.
- **`styleSrc` lleva `'unsafe-inline'` sin nonce, a propósito.** En CSP Level 3 un nonce hace que `'unsafe-inline'` se **ignore**, y Scalar emite atributos `style="…"` que ningún nonce autoriza: "arreglarlo" por simetría daría una página sin errores de JS y con el layout destrozado.

**Operación**

- **Apagado ordenado con red de seguridad:** SIGTERM drena las peticiones en vuelo; si `app.close()` se atasca, un temporizador fuerza la salida.
- **Los health checks no ensucian los logs** ni consumen cuota del rate limiter, y **`isHealthPath` no muerde `/api/healthcare`**: compara segmentos completos, no substrings.
- **Los errores del driver se traducen en el adaptador:** el `23505` sale como 409, no como 500.
- **Cada endpoint está documentado, y el build lo verifica.** `openapi-contract.e2e-spec.ts` recorre el documento OpenAPI y rompe el build si falta un `operationId`, una `description`, un ejemplo o un código de error. **También al revés**: declarar un 400 en un endpoint que no acepta ni parámetros ni body falla igual. Las reglas exactas están en [`CLAUDE.md`](./CLAUDE.md#endpoint-documentation--mandatory-and-verified); `UsersController` es la implementación de referencia.

---

## Convenciones

- **Idioma**: el **código** en inglés (identificadores, claves de objeto, nombres de archivo y carpeta, variables de entorno, claves de config, columnas SQL, `operationId`, ids de formulario); la **prosa** en español (comentarios, documentación, `summary`/`description` de OpenAPI, mensajes de las reglas de ESLint, mensajes al operador). Lo verifica [`src/__tests__/language-convention.spec.ts`](./src/__tests__/language-convention.spec.ts), que se afirma sobre **identificadores y nunca sobre cadenas** — por eso los `it` en español no necesitan excepción alguna. Hay una excepción escrita: los mensajes de error de `env.schema.ts` y `validate-env.ts` van en inglés porque comparten cadena con los mensajes por defecto de Zod, que no se pueden traducir.
- **Tipos**: `type`, nunca `interface` (`@typescript-eslint/consistent-type-definitions`). Los puertos son la excepción: `abstract class`.
- **Type-only imports explícitos**, en estilo inline: `import { ValidationPipe, type INestApplication }`.
- **Logging**: nunca `console.log` (ESLint lo advierte). Inyectar `PinoLogger` o el logger de contexto.
- **Errores**: en `infrastructure/` se lanza `HttpException`; en `domain/` y `application/`, errores de dominio que un filtro traduce.
- **Validación**: DTOs con `class-validator` + `class-transformer`. El `ValidationPipe` global aplica `whitelist`, `forbidNonWhitelisted` y `transform`, y **no** `enableImplicitConversion`. Los DTO que necesitan coerción la piden con `@Type(() => Number)`.
- **Respuestas**: `TransformInterceptor` envuelve todo como `{ success, data, request }`, y los controllers lo declaran en el OpenAPI con `@ApiEnvelope(Dto)` / `@ApiPaginatedEnvelope(Dto)` para que un SDK generado deserialice el cuerpo real. Para formatos específicos (health, descargas), `@SkipTransform()`.
- **Documentación obligatoria**: todo endpoint nuevo se documenta por completo y la suite E2E **rompe el build** si falta algo.
- **Pre-commit**: Husky corre `lint-staged` (ESLint + Prettier) y `tsc --noEmit`, y `secretlint` escanea **todo archivo staged** — una clave detectada bloquea el commit antes de que entre al historial.

### Convención de commits

Los mensajes se validan con [commitlint](./commitlint.config.cjs) en el hook `commit-msg`.

```
<type>(<scope opcional>): <descripción>
```

Los types son los de Conventional Commits: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. `feat` bumpea minor y `fix` bumpea patch en SemVer.

El `scope` está restringido a una **lista cerrada**, con una entrada por cada carpeta real del repo: `health`, `users`, `auth`, `orders`, `config`, `database`, `logger`, `common`, `shared`, `main`, `bootstrap`, `openapi`, `cors`, `throttler`, `test`, `docker`, `deps`, `docs`, `ci`, `release`. **Al añadir un bounded context, añade su scope.**

Para un cambio incompatible, `!` tras el type/scope **o** un footer `BREAKING CHANGE:`.

---

## Endpoints base

| Endpoint                       | Protección          | Notas                                                                                                |
| ------------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /api/v1/health`           | **Público**         | Memoria + ping a PostgreSQL                                                                          |
| `GET /api/v1/health/liveness`  | **Público**         | Sin dependencias externas: no ejecuta ningún indicador                                               |
| `GET /api/v1/health/readiness` | **Público**         | Memoria **y** ping a PostgreSQL                                                                      |
| `POST /api/v1/auth/register`   | **Público**         | Crea perfil en `users` **y** credencial en `auth_credentials`. Si la credencial falla, borra las dos |
| `POST /api/v1/auth/login`      | **Público**         | Emite el JWT. Con `/register`, 10/min cada uno, contadores separados                                 |
| `GET /api/v1/users`            | Rol `admin`         | Lista paginada                                                                                       |
| `GET /api/v1/users/:id`        | Autenticado         | Cualquier rol                                                                                        |
| `DELETE /api/v1/users/:id`     | Rol `admin`         | Desactiva sin borrar                                                                                 |
| `POST /api/v1/orders`          | Autenticado         | El `customerId` sale del token, nunca del body. 403 si el usuario fue desactivado después            |
| `GET /api/docs`                | `DOCS_ENABLED=true` | Documentación Scalar. Sin segmento de versión                                                        |
| `GET /api/docs/json`           | `DOCS_ENABLED=true` | El documento OpenAPI crudo, para generar SDKs                                                        |

**Todo endpoint sin `@Public()` exige un JWT válido**: el guard es global y activo por defecto, registrado como `APP_GUARD` desde `auth.module` — la matriz de boundaries impide hacerlo desde `app.module`, y verificar un token es responsabilidad de `auth`. `@Auth()` marca «autenticado, cualquier rol»; `@Auth('admin')` exige además ese rol, con 403 para quien no lo tenga, y adjunta la documentación OpenAPI que el guard de contrato requiere.

Los `/health` están exentos del throttler (`@SkipThrottle`) y del `TransformInterceptor` (`@SkipTransform`), para preservar el shape canónico de Terminus.

---

## Deploy notes

- **`staging` se trata como producción**, no como desarrollo: los mensajes de error nativos se sanitizan a `Internal server error` y helmet aplica CSP. En `development` y `test` se devuelve el mensaje real para poder depurar.
- **`JWT_SECRET` es obligatorio fuera de `development`/`test`.** Sin ese veto, el guard firmaría con el secreto de desarrollo, que está publicado en este repositorio.
- **El primer admin se crea con `pnpm seed:admin`**, idempotente y con doble uso como rescate.
- `app.enableShutdownHooks()` está activo; `SIGTERM`/`SIGINT` aplican un timeout de `SHUTDOWN_TIMEOUT_MS` antes de forzar `process.exit(1)`.
- `main.ts` solo arranca el servidor si es el punto de entrada del proceso (`require.main === module`), para que importarlo desde los tests no levante un servidor real.
- Server timeouts a nivel socket: `requestTimeout = REQUEST_TIMEOUT_MS`, `headersTimeout = REQUEST_TIMEOUT_MS + 1s`, `keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS`. Para Cloud Run / ALB, `keepAliveTimeout` debe **superar** el del balanceador o verás 502 intermitentes.
- Tras un proxy, configura `TRUST_PROXY` para que `ThrottlerGuard` discrimine clientes reales y `req.ip` apunte al cliente.
- El header `x-request-id` se respeta si viene del cliente; si no, se genera un UUID v4, se refleja en la respuesta y se propaga vía `nestjs-cls`.
- **⚠️ El rate limiter guarda su estado en un `Map` en memoria del proceso.** Con N réplicas el límite efectivo es N × `THROTTLER_LIMIT`. Cerrarlo requiere Redis, y está registrado en `docs/backlog.md` con el trigger ya decidido.
- **⚠️ Una migración que dropea o renombra algo NO se despliega con `DB_MIGRATIONS_RUN=true` en un despliegue rodante**: corre al arrancar el primer pod nuevo, mientras las réplicas viejas siguen sirviendo, y TypeORM enumera las columnas en cada `SELECT` —así que un `DROP COLUMN` tumba **toda** lectura de esa tabla, no solo la que usaba la columna. El patrón obligatorio (expand → despliegue → contract), las dos salidas operativas y el ejemplo trabajado están en [`CLAUDE.md`](./CLAUDE.md#destructive-migrations-expandcontract).

---

## Skills de IA

Una **skill** es un manual que se le carga a un asistente de IA para que trabaje como se trabaja aquí, en vez de improvisar. Son archivos de texto: viven en [`.claude/skills/`](./.claude/skills/), se leen igual que cualquier documento y no ejecutan nada por su cuenta. Hay siete, en dos grupos.

**Las cuatro del flujo de trabajo**, en este orden para cualquier cambio no trivial. Cada una produce algo escrito que alimenta a la siguiente:

```
brainstorming  →  writing-plans  →  subagent-driven-development   (preferido)
   (spec)           (plan)      └→  executing-plans               (alternativa)
```

| Skill                                                                                               | Qué hace                                                                        | Cuándo                                                            |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [`brainstorming`](https://www.skills.sh/obra/superpowers/brainstorming)                             | Convierte una idea en una spec escrita, preguntando de una en una               | **Antes de escribir código nuevo.** Deja la spec en `docs/specs/` |
| [`writing-plans`](https://www.skills.sh/obra/superpowers/writing-plans)                             | Parte la spec en tareas, con qué archivo tocar y cómo probar cada una           | Cuando ya hay spec. Deja el plan en `docs/plans/`                 |
| [`subagent-driven-development`](https://www.skills.sh/obra/superpowers/subagent-driven-development) | Ejecuta el plan tarea a tarea, cada una con un asistente nuevo y dos revisiones | **La opción por defecto** si las tareas son independientes        |
| [`executing-plans`](https://www.skills.sh/obra/superpowers/executing-plans)                         | El mismo plan, pero en la conversación actual y sin delegar                     | Planes pequeños o con tareas muy acopladas                        |

**Las tres que se consultan** mientras se escribe código, para no reinventar criterios ya decididos:

| Skill                                                                                                   | Manda sobre                                                                        |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [`clean-ddd-hexagonal`](https://www.skills.sh/ccheney/robust-skills/clean-ddd-hexagonal)                | Dónde va cada archivo, qué capa puede importar a cuál, cómo se modela un dominio   |
| [`nestjs-best-practices`](https://www.skills.sh/kadajett/agent-nestjs-skills/nestjs-best-practices)     | 45 reglas de NestJS 11: módulos, inyección de dependencias, seguridad, rendimiento |
| [`javascript-typescript-jest`](https://www.skills.sh/github/awesome-copilot/javascript-typescript-jest) | Cómo se escriben los tests aquí: nombres, estructura AAA, qué mockear en cada capa |

[`skills-lock.json`](./skills-lock.json) fija el origen y un hash de contenido de cada una — el equivalente a un `pnpm-lock.yaml` para las skills.

> **⚠️ Tres están adaptadas a este repositorio y no son la versión original:** `clean-ddd-hexagonal` y `javascript-typescript-jest` se reescribieron para este stack y estas convenciones, y `nestjs-best-practices` lleva las reglas alineadas con NestJS 11. Traerse la versión de arriba sin más **pisaría esas adaptaciones**. Compara antes de actualizar.

El lint y Prettier ignoran `.claude/` a propósito: son documentación, no código del proyecto.
