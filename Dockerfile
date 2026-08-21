# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32

# ------------------------------------------------------------------------------------
# Base: fija la versión de Node del repo (.nvmrc) y habilita el pnpm de `packageManager`.
# ------------------------------------------------------------------------------------
FROM node:24.19.0-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# ⚠️ En esta imagen hay DOS OpenSSL y no son el mismo. `apk` gobierna el del sistema
# (`libcrypto3`/`libssl3`), que usan apk, busybox y wget. El de la APLICACIÓN viaja enlazado
# ESTÁTICAMENTE dentro del binario de Node —`node:*-alpine` instala un tarball musl precompilado,
# y `ldd /usr/local/bin/node` no lista ni `libssl.so.3` ni `libcrypto.so.3`— y es el que terminan
# `pg` con `DB_SSL=true` y toda llamada HTTPS saliente. Ese solo se mueve subiendo el `FROM`.
#
# La distinción no es teórica, se pagó cara. El 2026-08-14 este archivo fijaba `22.22.1-alpine` y
# `apk upgrade` subió `libcrypto3` 3.5.5-r0 → 3.5.7-r0: trivy pasó de rojo a verde mientras
# `process.versions.openssl` seguía devolviendo **3.5.5**, que es exactamente la versión del
# CVE-2026-31789 que se daba por cerrado. Trivy nunca lo vio porque su analizador de paquetes de
# SO no mira dentro del binario de Node. La salida de aquel episodio fue `22.23.2` (security
# release del 2026-07-28), que empaqueta 3.5.7 y recupera las tres security releases que el pin
# anterior se había dejado atrás (22.22.2, 22.23.0, 22.23.2).
#
# **Un verde de trivy no significa «el TLS de la aplicación está parcheado».** Lo que lo significa
# es `node -p "process.versions.openssl"`, y el único mando que lo mueve es el `FROM` de arriba.
#
# ⚠️ El párrafo de arriba describe el episodio de 22.23.2; `bdfe609` movió después el `FROM` a
# `24.19.0` —PR automática de Renovate, una sola línea— **sin** rehacer la medición que este mismo
# archivo declara obligatoria, y así estuvo hasta el 2026-08-19. **Medido ya sobre el pin vigente**,
# con la imagen construida:
#
#     docker run --rm <img> node -p "process.version + ' | openssl ' + process.versions.openssl"
#     → v24.19.0 | openssl 3.5.7
#
# Es decir: 24.19.0 empaqueta el mismo 3.5.7 que cerró el CVE-2026-31789, así que el frente sigue
# cubierto — pero eso es una medición, no una deducción del número de versión, y es la única forma
# de saberlo. Repetir este comando en CADA bump del `FROM`; es requisito escrito en
# `docs/backlog.md` #25.
#
# `apk upgrade` se queda porque sigue haciendo falta —musl, zlib, ca-certificates,
# alpine-baselayout: una imagen base se publica con los paquetes del día en que se construyó y los
# CVE del sistema aparecen DESPUÉS—, solo que no es suficiente. El precio, dicho sin adornos: hace
# el build NO reproducible, la misma instrucción instala paquetes distintos según el día. Se acepta
# a conciencia; la alternativa determinista (`apk add libcrypto3=3.5.7-r0 …`) se rompe sola en
# cuanto Alpine retira esa revisión exacta del repositorio, que es cuestión de semanas.
#
# Va en `base` y no en cada stage por eficiencia: es una sola capa que deps/build/production
# heredan, así que cubrir los cuatro cuesta exactamente una ejecución.
#
# Las aserciones tampoco son adorno — cada una cubre un fallo silencioso medido, no imaginado:
#
# 1. **Doble `apk upgrade`.** apk avisa `a preupgrade is available` y sube `libapk`/`apk-tools`
#    —el propio binario que está haciendo el upgrade— en una primera fase, antes que el resto;
#    sale 0 tras cualquiera de las dos. En el build del 2026-08-14 la traza lo enseña literal:
#    `Preupgrading: … Continuing with the main upgrade transaction`. La segunda pasada cierra la
#    fase principal y `apk version -l '<'` lo comprueba en vez de suponerlo: sin esa aserción, un
#    upgrade que no parchea nada sale 0 y solo se nota semanas después, en un rojo de trivy que se
#    achacará a un CVE nuevo y no a este paso.
# 2. **⚠️ El índice tiene que sobrevivir hasta la aserción**, y por eso `apk update` explícito en
#    vez de `apk upgrade --no-cache`: sin índice, `apk version -l '<'` no tiene contra qué comparar
#    y devuelve vacío — daría VERDE sin haber mirado, el mismo antipatrón que el control positivo
#    de `ci.yml` existe para evitar. La limpieza de la caché va al final, a mano.
# 3. **`id node`.** `alpine-baselayout` es dueño de `/etc/passwd` y su reemplazo NO trae al usuario
#    `node` (medido: `grep -c node /etc/passwd.apk-new` → 0). Hoy sobrevive solo porque apk desvía
#    el conflicto a `.apk-new`; si esa política cambia, el `USER node` del stage de producción
#    falla con un error que no señala aquí. Y esos `.apk-new` se publicaban en la imagen final —incluido
#    `/etc/shadow.apk-new`, justo lo que marca cualquier auditoría de contenedores—, que es lo que
#    barre el `rm -f`.
RUN apk update && \
    apk upgrade && apk upgrade && \
    if [ -n "$(apk version -l '<' | tail -n +2)" ]; then \
      echo "apk dejó paquetes sin actualizar: el preupgrade se quedó a medias."; \
      apk version -l '<'; \
      exit 1; \
    fi && \
    if ! id node > /dev/null 2>&1; then \
      echo "el upgrade se llevó por delante el usuario node: USER node fallaría al arrancar."; \
      exit 1; \
    fi && \
    rm -f /etc/*.apk-new && \
    corepack enable && \
    rm -rf /var/cache/apk/*
WORKDIR /app

# ------------------------------------------------------------------------------------
# Dependencias: capa cacheable — solo se invalida si cambian los manifiestos.
# ------------------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# `--trust-lockfile` por el mismo motivo que en los dos installs de `ci.yml`, y hace falta aquí
# igual: pnpm 11 reaplica `minimumReleaseAge` (24 h) a cada entrada del lockfile en CADA install,
# así que una dependencia publicada hace poco rompe el `docker build` —que en CI corre justo antes
# de trivy— con `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` y un lockfile perfectamente coherente. La
# verificación del cooldown vive aguas arriba, en el `minimumReleaseAge` de `renovate.json`.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --trust-lockfile

# ------------------------------------------------------------------------------------
# Build: compila con SWC y copia el bundle de Scalar a public/.
# ------------------------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# El hook `prebuild` ejecuta scripts/copy-scalar-asset.mjs, que resuelve el bundle por el campo
# `browser` del package.json —nunca por una ruta escrita a mano, que se rompería en el siguiente
# major— y aborta si el resultado pesa menos de 1 MB. Un `cp` que copia nada y devuelve 0 es el
# fallo que eso evita: se descubriría al abrir la documentación, no al construir.
RUN pnpm build

# ------------------------------------------------------------------------------------
# Producción: solo dependencias de runtime y el build.
# ------------------------------------------------------------------------------------
FROM base AS production
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# `--ignore-scripts` es obligatorio junto a `--prod`: pnpm ejecuta el hook `prepare` del
# proyecto raíz también en instalaciones de producción, y `prepare` invoca a `husky`, que
# es devDependency. Sin esto el stage falla con `husky: command not found`. Poner HUSKY=0
# no sirve — el binario directamente no está instalado.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --trust-lockfile --prod --ignore-scripts

COPY --from=build /app/dist ./dist
# El bundle de Scalar vive fuera de `dist` a propósito: `nest-cli.json` declara
# `deleteOutDir: true`, y eso vacía `dist` tanto en `nest build` como en `nest start --watch`.
# Dentro, el asset desaparecería en desarrollo mientras sobrevivía aquí — un fallo que solo se
# ve en la máquina de quien programa.
COPY --from=build /app/public ./public

# Tres aserciones sobre el resultado, no sobre la intención.
#
# `@scalar/api-reference` es devDependency: solo el builder la necesita para resolver el bundle.
# Si acabara en `dependencies`, `--prod` metería sus 14 MB y la imagen pesaría más que antes de
# migrar. La regresión sería invisible —todo funciona, solo pesa de más— así que se comprueba.
#
# Y sin el manifiesto, `setupOpenApi` lanza al arrancar: mejor descubrirlo construyendo.
#
# La tercera es `argon2`, la única dependencia nativa del proyecto y —hasta el 2026-08-19— el único
# artefacto de esta imagen que nadie comprobaba. El `--ignore-scripts` de arriba es obligatorio y
# tiene una consecuencia que no se ve: el script `install` de argon2 (`node-gyp-build`) NO corre
# aquí, así que en la imagen no existe fallback de compilación, solo los prebuilds que vengan en el
# tarball. Hoy están los dos que `node:24-alpine` necesita
# (`prebuilds/linux-x64/argon2.musl.node` y `prebuilds/linux-arm64/argon2.armv8.musl.node`),
# mientras `pnpm-workspace.yaml` registra `argon2: true` en `allowBuilds` — una decisión de
# confianza sobre un build que en esta imagen nunca se ejecuta.
#
# Sin esta línea, el día que argon2 renombre o retire el prebuild de la plataforma desplegada, o el
# día que se adopte otra arquitectura, TODO sale verde: el install termina en 0, el `docker build`
# en 0 y trivy pasa. El fallo llega en el primer `POST /auth/register` del entorno real, en el
# `require`.
RUN if [ -d node_modules/@scalar/api-reference ]; then \
      echo "@scalar/api-reference no debe estar en la imagen final: muévela a devDependencies."; \
      exit 1; \
    fi && \
    if [ ! -f public/scalar-asset.json ]; then \
      echo "Falta el bundle de Scalar en public/."; \
      exit 1; \
    fi && \
    node -e "require('argon2')"

# Ningún gestor de paquetes en la imagen final. No es una optimización de tamaño —son 23.5 MB
# medidos el 2026-08-14 sobre `node:22.23.2-alpine`, la base de entonces y no la de ahora: npm
# 17.2M, corepack 1.2M, yarn 5.1M—, es superficie, y el
# argumento se aplica a los tres por igual:
#
# **npm.** Empaqueta su propio árbol en /usr/local/lib/node_modules/npm, y ese árbol aportaba 34 de
# las vulnerabilidades HIGH/CRITICAL del scan del 2026-08-14 —`tar` 6.2.1 y 7.4.3 (CVE-2026-59873,
# CRITICAL), `brace-expansion`, `minimatch`, `glob`, `picomatch`, `ip-address`, `sigstore`—. Ni una
# venía de `app/node_modules`: las dependencias de este repo salieron limpias, `pnpm audit --prod`
# ya cubría ese frente. Subir de Node no lo cierra y se midió antes de descartarlo: tanto `22.23.2`
# —el pin de entonces— como `24.19.0`, que es el de la línea `FROM` desde `bdfe609`, siguen
# empaquetando el suyo. Mientras npm viaje dentro, el gate volverá a ponerse rojo por él.
#
# **corepack y sus shims.** Aquí la versión anterior de este comentario afirmaba que se conservaban
# porque «quien instala es corepack+pnpm», y era falso: medido en la imagen construida, `/pnpm` no
# existe y `/home/node` está vacío — todos los `pnpm install` corren como root ANTES del `USER node`,
# así que nunca se horneó ni store ni caché de corepack, y `pnpm --version` ya fallaba sin red. Lo
# que quedaba no era un gestor funcional sino cinco symlinks a `corepack/dist/*.js` cuya conducta
# completa es descargar un tarball de registry.npmjs.org y ejecutarlo, con el prompt suprimido por
# COREPACK_ENABLE_DOWNLOAD_PROMPT=0. Es decir: se borraba JavaScript inerte y se conservaba a
# cambio una vía de fetch-and-exec viva, con cero beneficio a cambio.
#
# **Yarn 1.22.22 en /opt.** Llega dentro de la imagen base y `corepack enable` ya pisó sus symlinks,
# así que eran 5.1 MB inalcanzables — pero con un package.json que el analizador `node-pkg` de trivy
# sí parsea, exactamente como parseó el de npm. Es Yarn 1, en mantenimiento: sin fix,
# `ignore-unfixed` lo escondería para siempre dejando la superficie; con fix, rojo por un binario
# que nadie invoca.
#
# Nada de esto hace falta en runtime: el CMD es `node dist/src/main`. Se borra DESPUÉS del install
# para no invalidar esa capa de caché ni arriesgar un script de instalación que invocara npm.
#
# El control positivo va PRIMERO por la misma razón que el de `ci.yml`: un `rm -rf` sobre una ruta
# que ya no existe devuelve 0, así que sin él un rename del layout en la imagen base dejaría el
# gestor dentro con el build en verde. Y la comprobación final asegura sobre el RESULTADO, no sobre
# la intención, misma regla que el bloque «Dos aserciones» de justo arriba.
RUN if [ ! -d /usr/local/lib/node_modules/npm ]; then \
      echo "Control positivo fallido: npm no está donde este paso lo borra."; \
      echo "El layout de la imagen base cambió, así que el rm no probaría nada."; \
      exit 1; \
    fi && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
           /usr/local/lib/node_modules/corepack /usr/local/bin/corepack \
           /usr/local/bin/pnpm /usr/local/bin/pnpx \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-v1.22.22 && \
    for bin in npm npx corepack pnpm pnpx yarn yarnpkg; do \
      if command -v "$bin" > /dev/null 2>&1; then \
        echo "Quedó un gestor de paquetes en la imagen final: $bin."; \
        exit 1; \
      fi; \
    done

# Nunca correr como root. La imagen de Node ya trae el usuario `node`.
USER node

EXPOSE 8888

# El healthcheck usa liveness, no readiness: readiness comprueba Postgres, y Docker
# reiniciaría el contenedor por una caída de la base que reiniciar no arregla.
# La versión sale de API_VERSION igual que el prefijo de GLOBAL_PREFIX; hardcodear `/v1`
# dejaba el contenedor `unhealthy` para siempre en cuanto se subiera a API_VERSION=2.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8888)+'/'+(process.env.GLOBAL_PREFIX||'api')+'/v'+(process.env.API_VERSION||1)+'/health/liveness').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/src/main"]
