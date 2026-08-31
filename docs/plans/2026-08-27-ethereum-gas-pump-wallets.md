# Direcciones Ethereum custodiadas con Gas Pump — Implementation Plan

> **For agentic workers:** Use the `subagent-driven-development` skill (recommended) or
> `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking. **Never run `git commit` or `git push` without explicit user instruction** — at most,
> suggest a commit and wait.

**Goal:** dar a cada usuario una dirección Ethereum propia a la que recibir fondos y desde la que
enviarlos, sin que necesite ETH para pagar gas, con las comisiones cubiertas por la _master address_
de la plataforma.

**Bounded context:** `src/modules/wallets/` — nuevo. Cuarto contexto del repo, tras `users`, `auth`
y `orders`.

**Architecture:** dos agregados que extienden `Entity` (no `AggregateRoot`: nadie reacciona todavía).
`Wallet` guarda la dirección custodiada de un usuario y una máquina de estados de activación
monótona; `WalletTransfer` es el libro de envíos, escrito **por delante** de la llamada al proveedor
para que un timeout deje rastro. Cinco puertos —repositorio de wallets, repositorio de
transferencias, asignador de índices, pasarela de direcciones custodiadas y directorio de dueños—,
todos `abstract class` que son su propio token de inyección. El adaptador del proveedor es HTTP
directo con el `fetch` global de Node 24, repartido en tres piezas: transporte con traducción de
errores, mapper puro del activo, y el adaptador que compone las dos y aporta la master.

**Tech stack:** NestJS 11, TypeScript 6.0, Node 24.19.0, pnpm 11, SWC, Jest 30, Supertest, TypeORM,
PostgreSQL 18, Zod 4, class-validator, fast-check 4, `@noble/hashes`, `@noble/curves`.

**Rule codes touched:** `arch-feature-modules`, `arch-avoid-circular-deps`,
`arch-single-responsibility`, `arch-use-repository-pattern`, `di-use-interfaces-tokens`,
`di-interface-segregation`, `di-prefer-constructor-injection`, `error-use-exception-filters`,
`error-throw-http-exceptions`, `error-handle-async-errors`, `security-use-guards`,
`security-auth-jwt`, `security-validate-all-input`, `security-rate-limiting`,
`security-sanitize-output`, `api-use-dto-serialization`, `api-use-pipes`, `api-use-interceptors`,
`db-use-migrations`, `db-avoid-n-plus-one`, `perf-optimize-database`, `devops-use-config-module`,
`devops-use-logging`, `test-use-testing-module`, `test-e2e-supertest`, `test-mock-external-services`.

**Spec:** [`docs/specs/2026-08-27-ethereum-gas-pump-wallets-design.md`](../specs/2026-08-27-ethereum-gas-pump-wallets-design.md)

---

## Lo que este plan da por decidido

Ocho decisiones cerradas con el usuario y once entradas de backlog escritas. **No se reabren al
implementar**; si una tarea parece exigir lo contrario, se consulta antes de desviarse.

| #   | Decisión                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | Modelo **custodial**. Nadie recibe clave privada: una gas pump address es un contrato y no tiene                          |
| 2   | Red inicial **testnet**. ⚠️ La red la decide la API key; `chain: "ETH"` es decisión nuestra, no restricción del proveedor |
| 3   | La **master EOA es la dirección del admin**; los usuarios reciben índices de una secuencia desde 0                        |
| 4   | Los **cuatro `contractType`**: fungible, NFT, multi-token y nativo                                                        |
| 5   | `POST /wallets` explícito e **idempotente**, no en el registro                                                            |
| 6   | **Checksum EIP-55** del destinatario, con `@noble/hashes`, en el DTO                                                      |
| 7   | **Libro de transferencias** dentro de este ciclo: segundo agregado con su tabla                                           |
| 8   | **`mainnet` bloqueada en el arranque.** ⚠️ Este código no va a producción sin otro ciclo (KMS)                            |
| 9   | La activación **no** escribe por delante. Asimetría aceptada, ⚠️ bloqueante para mainnet (backlog #4)                     |
| 10  | **Una sola EOA**, la del admin. `POST /wallets` da 409 al rol admin; `GET /wallets/me` responde con `kind`                |
| 11  | **`CHECK ("address" <> "owner_address")`** — ⚠️ el primero del esquema                                                    |

---

## Estructura de archivos

### Se crean — dominio

| Archivo                                                           | Responsabilidad                                                |
| ----------------------------------------------------------------- | -------------------------------------------------------------- |
| `src/modules/wallets/domain/errors/wallet.errors.ts`              | El marcador `WalletDomainError` y las clases concretas         |
| `src/modules/wallets/domain/wallet-status.ts`                     | Union `'receive-only' \| 'activating' \| 'active'`             |
| `src/modules/wallets/domain/transfer-status.ts`                   | Union `'submitting' \| 'submitted' \| 'rejected' \| 'unknown'` |
| `src/modules/wallets/domain/transfer-asset.ts`                    | La clase nominal con cuatro factorías y `match()`              |
| `src/modules/wallets/domain/value-objects/wallet-id.vo.ts`        | Identidad del agregado `Wallet`                                |
| `src/modules/wallets/domain/value-objects/transfer-id.vo.ts`      | Identidad del agregado `WalletTransfer`                        |
| `src/modules/wallets/domain/value-objects/ethereum-address.vo.ts` | Forma hexadecimal, normaliza a minúsculas                      |
| `src/modules/wallets/domain/value-objects/address-index.vo.ts`    | Entero acotado al `integer` de PostgreSQL                      |
| `src/modules/wallets/domain/value-objects/token-amount.vo.ts`     | Decimal canónico, más estricto que el proveedor                |
| `src/modules/wallets/domain/value-objects/token-id.vo.ts`         | Entero canónico de hasta 78 dígitos                            |
| `src/modules/wallets/domain/value-objects/transaction-hash.vo.ts` | `0x` + 64 hexadecimales                                        |
| `src/modules/wallets/domain/entities/wallet.entity.ts`            | La dirección custodiada y su máquina de estados                |
| `src/modules/wallets/domain/entities/wallet-transfer.entity.ts`   | El libro de envíos                                             |
| `src/modules/wallets/domain/ports/wallet.repository.ts`           | `findByOwnerId`, `save`                                        |
| `src/modules/wallets/domain/ports/wallet-transfer.repository.ts`  | `save`, `findByOwnerId` paginado                               |
| `src/modules/wallets/domain/ports/address-index.allocator.ts`     | `next()` — otro almacén, otro puerto                           |
| `src/modules/wallets/domain/ports/custodial-address.gateway.ts`   | La capacidad, no la marca del proveedor                        |
| `src/modules/wallets/domain/ports/owner.directory.ts`             | `exists(ownerId)` — hacia `users`                              |

### Se crean — aplicación

| Archivo                                                                       | Responsabilidad                      |
| ----------------------------------------------------------------------------- | ------------------------------------ |
| `src/modules/wallets/application/use-cases/assign-wallet.use-case.ts`         | Alta idempotente de la dirección     |
| `src/modules/wallets/application/use-cases/find-wallet-by-owner.use-case.ts`  | Lectura, sin red                     |
| `src/modules/wallets/application/use-cases/activate-wallet.use-case.ts`       | Activación y reconciliación perezosa |
| `src/modules/wallets/application/use-cases/transfer-asset.use-case.ts`        | Envío con escritura por delante      |
| `src/modules/wallets/application/use-cases/list-wallet-transfers.use-case.ts` | Historial paginado                   |

### Se crean — infraestructura

| Archivo                                                              | Responsabilidad                                                 |
| -------------------------------------------------------------------- | --------------------------------------------------------------- |
| `…/infrastructure/gateways/tatum-http.client.ts`                     | Transporte, timeout, reintentos y traducción de errores         |
| `…/infrastructure/gateways/tatum-asset.mapper.ts`                    | **Función pura**: dominio → `contractType` y campos excluyentes |
| `…/infrastructure/gateways/tatum-custodial-address.gateway.ts`       | Implementa el puerto; aporta la master y su clave               |
| `…/infrastructure/gateways/users-owner.directory.ts`                 | Anti-corruption layer hacia `users`                             |
| `…/infrastructure/persistence/wallet.orm-entity.ts`                  | Modelo de persistencia de `wallets`                             |
| `…/infrastructure/persistence/wallet-transfer.orm-entity.ts`         | Modelo de persistencia de `wallet_transfers`                    |
| `…/infrastructure/persistence/wallet.mapper.ts`                      | Frontera fila ↔ agregado, campo a campo                         |
| `…/infrastructure/persistence/wallet-transfer.mapper.ts`             | Ídem para el libro                                              |
| `…/infrastructure/persistence/wallet.typeorm.repository.ts`          | Traduce los tres `23505` y el `CHECK`                           |
| `…/infrastructure/persistence/wallet-transfer.typeorm.repository.ts` | Escritura y listado paginado                                    |
| `…/infrastructure/persistence/sequence-address-index.allocator.ts`   | `nextval()`, con la conversión a número                         |
| `…/infrastructure/http/is-checksummed-address.validator.ts`          | Checksum EIP-55 con `@noble/hashes`                             |
| `…/infrastructure/http/dto/transfer-from-wallet.dto.ts`              | Entrada de la transferencia                                     |
| `…/infrastructure/http/dto/wallet-response.dto.ts`                   | Salida con discriminador `kind`                                 |
| `…/infrastructure/http/dto/wallet-transfer-response.dto.ts`          | Salida del libro                                                |
| `…/infrastructure/http/wallets-domain-exception.filter.ts`           | Errores de dominio → HTTP                                       |
| `…/infrastructure/http/wallets.controller.ts`                        | Los cinco endpoints con su OpenAPI                              |
| `src/modules/wallets/wallets.module.ts`                              | Composition root del contexto                                   |

### Se crean — fuera del módulo

| Archivo                                          | Responsabilidad                                         |
| ------------------------------------------------ | ------------------------------------------------------- |
| `src/config/wallets.config.ts`                   | Credenciales y parámetros del proveedor                 |
| `src/database/migrations/<ts>-create-wallets.ts` | Dos tablas, secuencia, tres índices únicos y el `CHECK` |
| `test/helpers/tatum-stub-server.ts`              | Servidor `node:http` que dobla al proveedor en los E2E  |

### Se modifican

| Archivo                                                        | Cambio                                                                                    |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/app.module.ts`                                            | `WalletsModule` en `imports`                                                              |
| `src/config/env.schema.ts`                                     | Siete variables y tres `.refine()`                                                        |
| `src/config/configurations.ts`                                 | El namespace `wallets`                                                                    |
| `src/common/dto/error-example.factory.ts`                      | `502` y `503`, **después** de contrastarlos en su spec                                    |
| `src/common/logger/pino-options.ts`                            | Tres rutas de redacción para la clave privada                                             |
| `src/shared/domain/system-actor.ts`                            | `ACTIVATION_RECONCILIATION`                                                               |
| `src/bootstrap/__tests__/openapi-runtime-contract.e2e-spec.ts` | Cinco escenarios, `TRUNCATE` y el stub                                                    |
| `src/database/__tests__/schema-conventions.e2e-spec.ts`        | `wallets` en la lista de tablas con traza                                                 |
| `test/setup-env.ts`                                            | Cinco variables con `??=`, incluida la URL a loopback                                     |
| `jest.config.mjs` · `test/jest-e2e.config.mjs`                 | `*.allocator.ts` cambia de suite; remedir umbrales                                        |
| `eslint.config.mjs` · `CLAUDE.md`                              | Los `type` de datos de puerto en la lista cerrada                                         |
| `commitlint.config.cjs`                                        | El scope `wallets`                                                                        |
| `.env.example` · `README.md`                                   | La sección nueva de variables                                                             |
| `package.json`                                                 | `@noble/hashes` y `@noble/curves` en `dependencies`                                       |
| `.gitignore`                                                   | Corregir el comentario de `/docs/tatum`, que hoy dice lo contrario de lo que quiere decir |

### Regla de dependencias — verificada contra la matriz vigente

- `wallets/domain/**` → solo su propio dominio y `@shared/domain/**`. Cero `@nestjs/*`, cero
  `typeorm`, cero `class-validator`, cero `@noble/*`.
- `wallets/application/**` → su dominio, su propia capa, `@shared/domain/**` y `@nestjs/common`.
- `wallets/infrastructure/**` y `wallets.module.ts` → todas sus capas, `@common/`, `@config/`,
  `@shared/domain/`, y **solo el `*.module.ts`** de otro módulo (`users.module.ts`).
- `src/app.module.ts` → `wallets.module.ts`.

⚠️ **`eslint.boundaries.js` no se toca.** Los comodines `src/modules/*/…` ya cubren un módulo nuevo;
la verificación integral incluye un `git diff --stat` de ese archivo que debe salir vacío.

---

## Tareas

## Tareas

### Task 1: Errores de dominio de `wallets` y arbitrarios del módulo

**Layer:** domain
**Rule codes to honor:** `error-use-exception-filters`, `error-throw-http-exceptions`, `security-sanitize-output`, `arch-single-responsibility`

Crea el marcador `WalletDomainError`, el padre abstracto `WalletProviderError` y las **24** clases
concretas, más la lista cerrada `PROVIDER_FAILURE_REASONS` que los tres errores del proveedor
transportan en lugar del `message` de Tatum (§7.1: ese mensaje interpola la clave de API). Nace
también el vocabulario `WALLET_STATUSES` / `WalletStatus`, porque `WalletNotActivatedError` recibe
el estado y sin ese archivo el de errores no compila. De paso nace el archivo de arbitrarios del
módulo con **todos los que producen solo cadenas y números**: ninguno de esos importa un value
object, así que ninguno obliga a esperar a la tarea que lo crea.

⚠️ **Los dos arbitrarios que sí dependen de código posterior se añaden en la tarea que crea esa
dependencia, y en ninguna anterior**: `transferAssetArb` en la **Task 8** —la que crea
`TransferAsset`— y `pageArb` / `limitArb` en la **Task 16**. No es orden estético: este archivo lo
importa `wallet.errors.spec.ts`, que se ejecuta en esta misma tarea, así que un `import` a
`../../domain/transfer-asset` escrito aquí dejaría esa suite entera sin arrancar con
`Cannot find module` y `pnpm typecheck` en rojo hasta la Task 8.

⚠️ **`WalletAlreadyAssignedError` NO EXISTE**, y no es un olvido: el `23505` de
`idx_wallets_user_id` lo traduce el adaptador al desenlace `'owner-conflict'` de
`WalletRepository.save()`, así que no hay ningún camino por el que ese error llegue a HTTP. Quien
lo «eche en falta» y lo añada estará reintroduciendo una excepción para una carrera que el
desenlace ya resuelve releyendo.

⚠️ **`PROVIDER_FAILURE_REASONS` es la ÚNICA lista de motivos del módulo.** El `reasonCode` que
`WalletTransfer` guarda en `rejected` y `unknown` reutiliza este mismo tipo: no existe un
`TransferFailureReason` aparte. Es la misma información vista desde otro sitio.

⚠️ **Los tres errores del proveedor cuelgan de `WalletProviderError`**, un padre abstracto con
`protected constructor`. No es simetría: tres sitios necesitan `instanceof` sobre la familia
entera, y sin el padre cada uno tendría que enumerar las tres clases y quedarse desactualizado al
añadir la cuarta.

**Casos acordados** (Tabla S — `WALLET_STATUSES`):

| #   | Caso (se vuelve el `it`)                                             | Entrada / estado inicial | Resultado esperado                         |
| --- | -------------------------------------------------------------------- | ------------------------ | ------------------------------------------ |
| S1  | debería definir exactamente los tres estados de una wallet, en orden | `WALLET_STATUSES`        | `['receive-only', 'activating', 'active']` |

**Casos acordados** (Tabla E — `wallet.errors.ts`):

| #      | Caso (se vuelve el `it`)                                                                           | Entrada / estado inicial                                           | Resultado esperado                                                                                                     |
| ------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| E1     | debería construir `InvalidWalletIdError` con su mensaje exacto y su valor                          | `'not-a-uuid'`                                                     | `message === '"not-a-uuid" is not a valid wallet id'`; `value === 'not-a-uuid'`                                        |
| E2     | debería construir `InvalidTransferIdError` con su mensaje exacto y su valor                        | `'not-a-uuid'`                                                     | `message === '"not-a-uuid" is not a valid transfer id'`; `value === 'not-a-uuid'`                                      |
| E3     | debería construir `InvalidEthereumAddressError` con su mensaje exacto y su valor                   | `'0xzz'`                                                           | `message === '"0xzz" is not a valid Ethereum address'`; `value === '0xzz'`                                             |
| E4     | debería construir `InvalidAddressIndexError` con su mensaje exacto y su valor numérico             | `-1`                                                               | `message === '-1 is not a valid address index'`; `value === -1`                                                        |
| E5     | debería construir `InvalidTokenAmountError` con su mensaje exacto y su valor                       | `'01'`                                                             | `message === '"01" is not a valid token amount'`; `value === '01'`                                                     |
| E6     | debería construir `InvalidTokenIdError` con su mensaje exacto y su valor                           | `'01'`                                                             | `message === '"01" is not a valid token id'`; `value === '01'`                                                         |
| E7     | debería construir `InvalidTransactionHashError` con su mensaje exacto y su valor                   | `'abc'`                                                            | `message === '"abc" is not a valid transaction hash'`; `value === 'abc'`                                               |
| E8     | debería construir `MissingAssetFieldError` recibiendo primero el campo y después la clase          | `('amount', 'fungible')`                                           | `message === 'Asset of kind "fungible" requires the field "amount"'`; `field === 'amount'`; `kind === 'fungible'`      |
| E9     | debería construir `AssetFieldNotAllowedError` recibiendo primero el campo y después la clase       | `('tokenId', 'native')`                                            | `message === 'Asset of kind "native" does not accept the field "tokenId"'`; `field === 'tokenId'`; `kind === 'native'` |
| E10    | debería construir `UnknownAssetKindError` con la clase desconocida                                 | `'erc721'`                                                         | `message === '"erc721" is not a known asset kind'`; `kind === 'erc721'`                                                |
| E11    | debería construir `WalletNotFoundError` con el dueño buscado                                       | `'owner-1'`                                                        | `message === 'Wallet for owner owner-1 was not found'`; `ownerId === 'owner-1'`                                        |
| E12    | debería construir `WalletNotActivatedError` con el ESTADO que impide enviar                        | `'receive-only'`                                                   | `message === 'Wallet cannot send funds yet: its status is "receive-only"'`; `status === 'receive-only'`                |
| E13    | debería construir `WalletActivationInProgressError` sin argumentos y con mensaje fijo              | `()`                                                               | `message === 'Wallet already has an activation in progress'`                                                           |
| E14    | debería construir `WalletAlreadyActivatedError` sin argumentos y con mensaje fijo                  | `()`                                                               | `message === 'Wallet is already activated'`                                                                            |
| E15    | debería construir `WalletOwnerGoneError` con un mensaje interno que el filtro nunca publica        | `'owner-1'`                                                        | `message === 'Owner owner-1 no longer exists or is inactive'`; `ownerId === 'owner-1'`                                 |
| E16    | debería construir `AdminUsesMasterAddressError` sin argumentos y con mensaje fijo                  | `()`                                                               | `message === 'The admin operates the master address and has no gas pump wallet'`                                       |
| E17    | debería construir `AddressIndexAlreadyUsedError` con el índice repetido en el campo `index`        | `7`                                                                | `message === 'Address index 7 is already assigned to another wallet'`; `index === 7`                                   |
| E18    | debería construir `WalletAddressAlreadyUsedError` con la dirección repetida                        | `'0xabc'`                                                          | `message === 'Address 0xabc is already assigned to another wallet'`; `address === '0xabc'`                             |
| E19    | debería construir `WalletOwnerMismatchError` nombrando la master de la fila y la configurada       | `('0xold', '0xnew')`                                               | `message === 'Wallet was derived under master 0xold, not under 0xnew'`; los dos campos guardados                       |
| E20    | debería construir `WalletAddressIsMasterError` con la dirección que jamás puede entregarse         | `'0xmaster'`                                                       | `message === 'Address 0xmaster is the master address and cannot be handed to a user'`                                  |
| E21    | debería construir `WalletAssignmentLostError` con el dueño cuya relectura volvió vacía             | `'owner-1'`                                                        | `message === 'Wallet assignment for owner owner-1 vanished between the conflict and the re-read'`                      |
| E22    | debería construir `WalletProviderRejectedError` con motivo y status, sin nada del cuerpo           | `('body-rejected', 400)`                                           | `message === 'The wallet provider rejected the transfer request'`; `reason` y `providerStatus` guardados               |
| E23    | debería construir `WalletProviderUnreachableError` admitiendo un status nulo                       | `('timeout', null)`                                                | `message === 'The wallet provider could not be reached or broke its published contract'`; `providerStatus === null`    |
| E24    | debería construir `WalletProviderUnavailableError` con motivo y status                             | `('unauthorized', 401)`                                            | `message === 'The wallet provider integration is unavailable'`; `reason === 'unauthorized'`                            |
| E25    | debería agrupar los tres errores del proveedor bajo el padre `WalletProviderError`, y solo a ellos | los tres del proveedor y un `WalletNotFoundError`                  | los tres `instanceof WalletProviderError`; el de negocio, no                                                           |
| E26    | debería publicar los nueve motivos de fallo del proveedor como lista única                         | `PROVIDER_FAILURE_REASONS`                                         | la lista exacta y en orden, `'undocumented-4xx'` y `'malformed-response'` incluidos                                    |
| E27    | debería dejar fuera del marcador de `wallets` a un error de dominio de otro contexto               | `ForeignDomainError extends DomainError`                           | `instanceof WalletDomainError === false`; sí `instanceof DomainError`                                                  |
| P1     | debería heredar del marcador y publicar su nombre concreto, sea cual sea el error _(propiedad)_    | arbitrario sobre las 24 factorías del módulo                       | nunca lanza; `instanceof WalletDomainError`, `instanceof DomainError`, `name` = clase                                  |
| P2     | debería no interpolar nunca el motivo ni el status del proveedor en el mensaje _(propiedad)_       | `providerFailureReasonArb` × status `400..599`                     | nunca lanza; los tres mensajes no contienen ni el motivo ni el status                                                  |
| **P3** | debería garantizar que TODA clase exportada del catálogo hereda del marcador _(propiedad)_         | `import * as walletErrors`, cada export que sea una clase de error | todas son `instanceof`-compatibles con `WalletDomainError`; ninguna se cuela heredando de `DomainError` a secas        |

**Files:**

- Create: `src/modules/wallets/domain/wallet-status.ts`
- Create: `src/modules/wallets/domain/errors/wallet.errors.ts`
- Create: `src/modules/wallets/__tests__/helpers/arbitraries.ts`
- Test: `src/modules/wallets/__tests__/domain/wallet-status.spec.ts`
- Test: `src/modules/wallets/__tests__/domain/errors/wallet.errors.spec.ts`

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/modules/wallets/__tests__/helpers/arbitraries.ts
import fc from 'fast-check';

import {
  PROVIDER_FAILURE_REASONS,
  type ProviderFailureReason,
} from '../../domain/errors/wallet.errors';

/**
 * Arbitrarios del módulo `wallets`. Todos están **construidos** — `fc.constantFrom`, `fc.array`
 * de dígitos, `fc.tuple` + `map` —, nunca filtrados de `fc.string()`: un filtro descartaría
 * prácticamente todo lo generado y fast-check acabaría abortando la propiedad por exceso de
 * descartes.
 *
 * Ninguno de los que nacen aquí importa un value object: todos producen cadenas y números sueltos,
 * y por eso el archivo puede nacer entero en la primera tarea del módulo sin arrastrar a ninguna
 * otra.
 *
 * ⚠️ Los dos arbitrarios que SÍ necesitan código de más adelante se añaden en la tarea que crea esa
 * dependencia: `transferAssetArb` en la Task 8 (construye `TransferAsset` y tres value objects) y
 * `pageArb` / `limitArb` en la Task 16. Adelantarlos aquí rompería la suite de esta misma tarea,
 * que importa este archivo, con `Cannot find module`.
 */

const HEX_DIGITS = '0123456789abcdefABCDEF';

/** `length` hexadecimales con mayúsculas y minúsculas mezcladas a voluntad. */
const hexArb = (length: number): fc.Arbitrary<string> =>
  fc
    .array(fc.constantFrom(...HEX_DIGITS.split('')), { minLength: length, maxLength: length })
    .map((chars) => chars.join(''));

/** Cadenas de dígitos decimales de longitud acotada. */
const digitsArb = (min: number, max: number): fc.Arbitrary<string> =>
  fc
    .array(fc.integer({ min: 0, max: 9 }), { minLength: min, maxLength: max })
    .map((digits) => digits.join(''));

/** Enteros canónicos distintos de cero: `1`, `907`, `10000000000000000000`. */
const nonZeroIntegerArb = fc
  .tuple(fc.integer({ min: 1, max: 9 }), digitsArb(0, 30))
  .map(([head, tail]) => `${head}${tail}`);

/** `0.` seguido de una fracción que SIEMPRE acaba en un dígito no nulo, así que no es cero. */
const zeroIntegerAmountArb = fc
  .tuple(digitsArb(0, 10), fc.integer({ min: 1, max: 9 }))
  .map(([head, last]) => `0.${head}${last}`);

/**
 * Los motivos salen de la lista CERRADA de `wallet.errors.ts`, no de una copia escrita a mano:
 * copiarla haría que añadir un motivo dejara la propiedad P2 sin cubrirlo, en verde y en
 * silencio.
 */
export const providerFailureReasonArb: fc.Arbitrary<ProviderFailureReason> = fc.constantFrom(
  ...PROVIDER_FAILURE_REASONS,
);

/** Cualquier status de error que el proveedor puede devolver. */
export const providerStatusArb = fc.integer({ min: 400, max: 599 });

/** Direcciones que `EthereumAddress.from()` acepta: `0x` + 40 hexadecimales. */
export const ethereumAddressArb = hexArb(40).map((hex) => `0x${hex}`);

/** Hashes que `TransactionHash.from()` acepta: `0x` + 64 hexadecimales. */
export const transactionHashArb = hexArb(64).map((hex) => `0x${hex}`);

/** Exactamente el rango que la columna `integer` de PostgreSQL puede guardar. */
export const addressIndexArb = fc.integer({ min: 0, max: 2_147_483_647 });

/** Importes que `TokenAmount.from()` acepta: canónicos, sin signo y distintos de cero. */
export const tokenAmountArb = fc.oneof(
  fc
    .tuple(nonZeroIntegerArb, fc.option(digitsArb(1, 18), { nil: undefined }))
    .map(([integer, fraction]) => (fraction === undefined ? integer : `${integer}.${fraction}`)),
  zeroIntegerAmountArb,
);

/** Importes que solo contienen ceros: `0`, `0.0`, `0.000…`. Todos deben ser rechazados. */
export const allZeroAmountArb = fc
  .nat({ max: 30 })
  .map((decimals) => (decimals === 0 ? '0' : `0.${'0'.repeat(decimals)}`));

/** Ids que `TokenId.from()` acepta, `"0"` incluido — la asimetría deliberada con el importe. */
export const tokenIdArb = fc.oneof(
  fc.constant('0'),
  fc
    .tuple(fc.integer({ min: 1, max: 9 }), digitsArb(0, 77))
    .map(([head, tail]) => `${head}${tail}`),
);

/** Ids con al menos un cero a la izquierda: `01`, `007`, `0009`. Todos deben ser rechazados. */
export const leadingZeroTokenIdArb = fc
  .tuple(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 9 }), digitsArb(0, 20))
  .map(([zeros, head, tail]) => `${'0'.repeat(zeros)}${head}${tail}`);
```

```ts
// src/modules/wallets/__tests__/domain/wallet-status.spec.ts
import { WALLET_STATUSES } from '../../domain/wallet-status';

describe('WALLET_STATUSES', () => {
  // El orden ES la máquina de estados: `receive-only` → `activating` → `active`, monótona. Un
  // reordenado silencioso convertiría la lista en un conjunto y perdería esa lectura.
  it('debería definir exactamente los tres estados de una wallet, en orden', () => {
    // Arrange + Act + Assert
    expect(WALLET_STATUSES).toEqual(['receive-only', 'activating', 'active']);
  });
});
```

```ts
// src/modules/wallets/__tests__/domain/errors/wallet.errors.spec.ts
import fc from 'fast-check';

import { DomainError } from '@shared/domain/domain-error.base';

import {
  AddressIndexAlreadyUsedError,
  AdminUsesMasterAddressError,
  AssetFieldNotAllowedError,
  InvalidAddressIndexError,
  InvalidEthereumAddressError,
  InvalidTokenAmountError,
  InvalidTokenIdError,
  InvalidTransactionHashError,
  InvalidTransferIdError,
  InvalidWalletIdError,
  MissingAssetFieldError,
  PROVIDER_FAILURE_REASONS,
  UnknownAssetKindError,
  WalletActivationInProgressError,
  WalletAddressAlreadyUsedError,
  WalletAddressIsMasterError,
  WalletAlreadyActivatedError,
  WalletAssignmentLostError,
  WalletDomainError,
  WalletNotActivatedError,
  WalletNotFoundError,
  WalletOwnerGoneError,
  WalletOwnerMismatchError,
  WalletProviderError,
  WalletProviderRejectedError,
  WalletProviderUnavailableError,
  WalletProviderUnreachableError,
} from '../../../domain/errors/wallet.errors';
import { providerFailureReasonArb, providerStatusArb } from '../../helpers/arbitraries';

describe('wallet.errors', () => {
  describe('errores de identidad y formato', () => {
    it('debería construir InvalidWalletIdError con su mensaje exacto y su valor', () => {
      // Arrange
      const value = 'not-a-uuid';

      // Act
      const error = new InvalidWalletIdError(value);

      // Assert
      expect(error.message).toBe('"not-a-uuid" is not a valid wallet id');
      expect(error.value).toBe(value);
    });

    it('debería construir InvalidTransferIdError con su mensaje exacto y su valor', () => {
      // Arrange
      const value = 'not-a-uuid';

      // Act
      const error = new InvalidTransferIdError(value);

      // Assert
      expect(error.message).toBe('"not-a-uuid" is not a valid transfer id');
      expect(error.value).toBe(value);
    });

    it('debería construir InvalidEthereumAddressError con su mensaje exacto y su valor', () => {
      // Arrange
      const value = '0xzz';

      // Act
      const error = new InvalidEthereumAddressError(value);

      // Assert
      expect(error.message).toBe('"0xzz" is not a valid Ethereum address');
      expect(error.value).toBe(value);
    });

    it('debería construir InvalidAddressIndexError con su mensaje exacto y su valor numérico', () => {
      // Arrange
      const value = -1;

      // Act
      const error = new InvalidAddressIndexError(value);

      // Assert
      expect(error.message).toBe('-1 is not a valid address index');
      expect(error.value).toBe(-1);
    });

    it('debería construir InvalidTokenAmountError con su mensaje exacto y su valor', () => {
      // Arrange
      const value = '01';

      // Act
      const error = new InvalidTokenAmountError(value);

      // Assert
      expect(error.message).toBe('"01" is not a valid token amount');
      expect(error.value).toBe('01');
    });

    it('debería construir InvalidTokenIdError con su mensaje exacto y su valor', () => {
      // Arrange
      const value = '01';

      // Act
      const error = new InvalidTokenIdError(value);

      // Assert
      expect(error.message).toBe('"01" is not a valid token id');
      expect(error.value).toBe('01');
    });

    it('debería construir InvalidTransactionHashError con su mensaje exacto y su valor', () => {
      // Arrange
      const value = 'abc';

      // Act
      const error = new InvalidTransactionHashError(value);

      // Assert
      expect(error.message).toBe('"abc" is not a valid transaction hash');
      expect(error.value).toBe('abc');
    });
  });

  describe('errores del activo a transferir', () => {
    // ⚠️ El orden de los argumentos es (campo, clase) y el del mensaje es el inverso. Es la
    // trampa exacta que este caso fija: invertir la llamada compila —los dos son `string`— y
    // publicaría «Asset of kind "amount" requires the field "fungible"», que es literalmente al
    // revés y ningún tipo lo caza.
    it('debería construir MissingAssetFieldError recibiendo primero el campo y después la clase', () => {
      // Arrange + Act
      const error = new MissingAssetFieldError('amount', 'fungible');

      // Assert
      expect(error.message).toBe('Asset of kind "fungible" requires the field "amount"');
      expect(error.field).toBe('amount');
      expect(error.kind).toBe('fungible');
    });

    it('debería construir AssetFieldNotAllowedError recibiendo primero el campo y después la clase', () => {
      // Arrange + Act
      const error = new AssetFieldNotAllowedError('tokenId', 'native');

      // Assert
      expect(error.message).toBe('Asset of kind "native" does not accept the field "tokenId"');
      expect(error.field).toBe('tokenId');
      expect(error.kind).toBe('native');
    });

    it('debería construir UnknownAssetKindError con la clase desconocida', () => {
      // Arrange + Act
      const error = new UnknownAssetKindError('erc721');

      // Assert
      expect(error.message).toBe('"erc721" is not a known asset kind');
      expect(error.kind).toBe('erc721');
    });
  });

  describe('errores de estado de la wallet', () => {
    it('debería construir WalletNotFoundError con el dueño buscado', () => {
      // Arrange + Act
      const error = new WalletNotFoundError('owner-1');

      // Assert
      expect(error.message).toBe('Wallet for owner owner-1 was not found');
      expect(error.ownerId).toBe('owner-1');
    });

    // Lleva el ESTADO y no el id de la wallet: el id no le dice nada al cliente —los cinco
    // endpoints son «lo mío» y nunca lo ve—, mientras que el estado le dice si le toca activar o
    // esperar a que termine la activación en curso.
    it('debería construir WalletNotActivatedError con el ESTADO que impide enviar', () => {
      // Arrange + Act
      const error = new WalletNotActivatedError('receive-only');

      // Assert
      expect(error.message).toBe('Wallet cannot send funds yet: its status is "receive-only"');
      expect(error.status).toBe('receive-only');
    });

    it('debería construir WalletActivationInProgressError sin argumentos y con mensaje fijo', () => {
      // Arrange + Act
      const error = new WalletActivationInProgressError();

      // Assert
      expect(error.message).toBe('Wallet already has an activation in progress');
    });

    it('debería construir WalletAlreadyActivatedError sin argumentos y con mensaje fijo', () => {
      // Arrange + Act
      const error = new WalletAlreadyActivatedError();

      // Assert
      expect(error.message).toBe('Wallet is already activated');
    });

    it('debería construir WalletOwnerGoneError con un mensaje interno que el filtro nunca publica', () => {
      // Arrange + Act
      const error = new WalletOwnerGoneError('owner-1');

      // Assert
      expect(error.message).toBe('Owner owner-1 no longer exists or is inactive');
      expect(error.ownerId).toBe('owner-1');
    });

    // El admin ya opera la master: darle una dirección derivada crearía una segunda EOA en el
    // sistema, que es justo la invariante de §3.1.1. No lleva argumentos porque no hay nada
    // variable que contar — el rol ya es la explicación entera.
    it('debería construir AdminUsesMasterAddressError sin argumentos y con mensaje fijo', () => {
      // Arrange + Act
      const error = new AdminUsesMasterAddressError();

      // Assert
      expect(error.message).toBe(
        'The admin operates the master address and has no gas pump wallet',
      );
    });
  });

  describe('violaciones de invariante y de configuración', () => {
    it('debería construir AddressIndexAlreadyUsedError con el índice repetido en el campo index', () => {
      // Arrange + Act
      const error = new AddressIndexAlreadyUsedError(7);

      // Assert
      expect(error.message).toBe('Address index 7 is already assigned to another wallet');
      expect(error.index).toBe(7);
    });

    it('debería construir WalletAddressAlreadyUsedError con la dirección repetida', () => {
      // Arrange + Act
      const error = new WalletAddressAlreadyUsedError('0xabc');

      // Assert
      expect(error.message).toBe('Address 0xabc is already assigned to another wallet');
      expect(error.address).toBe('0xabc');
    });

    it('debería construir WalletOwnerMismatchError nombrando la master de la fila y la configurada', () => {
      // Arrange + Act
      const error = new WalletOwnerMismatchError('0xold', '0xnew');

      // Assert
      expect(error.message).toBe('Wallet was derived under master 0xold, not under 0xnew');
      expect(error.walletOwnerAddress).toBe('0xold');
      expect(error.configuredMaster).toBe('0xnew');
    });

    it('debería construir WalletAddressIsMasterError con la dirección que jamás puede entregarse', () => {
      // Arrange + Act
      const error = new WalletAddressIsMasterError('0xmaster');

      // Assert
      expect(error.message).toBe(
        'Address 0xmaster is the master address and cannot be handed to a user',
      );
      expect(error.address).toBe('0xmaster');
    });

    it('debería construir WalletAssignmentLostError con el dueño cuya relectura volvió vacía', () => {
      // Arrange + Act
      const error = new WalletAssignmentLostError('owner-1');

      // Assert
      expect(error.message).toBe(
        'Wallet assignment for owner owner-1 vanished between the conflict and the re-read',
      );
      expect(error.ownerId).toBe('owner-1');
    });
  });

  describe('errores del proveedor', () => {
    it('debería construir WalletProviderRejectedError con motivo y status, sin nada del cuerpo', () => {
      // Arrange + Act
      const error = new WalletProviderRejectedError('body-rejected', 400);

      // Assert
      expect(error.message).toBe('The wallet provider rejected the transfer request');
      expect(error.reason).toBe('body-rejected');
      expect(error.providerStatus).toBe(400);
    });

    it('debería construir WalletProviderUnreachableError admitiendo un status nulo', () => {
      // Arrange + Act
      const error = new WalletProviderUnreachableError('timeout', null);

      // Assert
      expect(error.message).toBe(
        'The wallet provider could not be reached or broke its published contract',
      );
      expect(error.reason).toBe('timeout');
      expect(error.providerStatus).toBeNull();
    });

    it('debería construir WalletProviderUnavailableError con motivo y status', () => {
      // Arrange + Act
      const error = new WalletProviderUnavailableError('unauthorized', 401);

      // Assert
      expect(error.message).toBe('The wallet provider integration is unavailable');
      expect(error.reason).toBe('unauthorized');
      expect(error.providerStatus).toBe(401);
    });

    // El padre existe porque tres sitios necesitan `instanceof` sobre la FAMILIA —el filtro, el
    // caso de uso de la transferencia y el gateway—. Sin él cada uno enumeraría las tres clases y
    // se quedaría desactualizado al añadir la cuarta, en verde y sin que nada lo dijera.
    it('debería agrupar los tres errores del proveedor bajo el padre WalletProviderError, y solo a ellos', () => {
      // Arrange
      const fromTheProvider = [
        new WalletProviderRejectedError('body-rejected', 400),
        new WalletProviderUnreachableError('timeout', null),
        new WalletProviderUnavailableError('unauthorized', 401),
      ];

      // Act
      const allUnderTheFamily = fromTheProvider.every(
        (error) => error instanceof WalletProviderError,
      );

      // Assert
      expect(allUnderTheFamily).toBe(true);
      expect(new WalletNotFoundError('owner-1')).not.toBeInstanceOf(WalletProviderError);
    });

    // La lista es ÚNICA: el `reasonCode` del libro de transferencias reutiliza este mismo tipo, y
    // añadir un motivo aquí es lo que lo hace guardable allí. Un segundo vocabulario paralelo
    // dejaría dos verdades sobre por qué falló la misma llamada.
    it('debería publicar los nueve motivos de fallo del proveedor como lista única', () => {
      // Arrange + Act + Assert
      expect(PROVIDER_FAILURE_REASONS).toEqual([
        'body-rejected',
        'misconfigured',
        'unauthorized',
        'forbidden',
        'undocumented-4xx',
        'upstream-error',
        'unreachable',
        'timeout',
        'malformed-response',
      ]);
    });
  });

  describe('WalletDomainError', () => {
    it('debería dejar fuera del marcador de wallets a un error de dominio de otro contexto', () => {
      // Arrange
      const foreign = new ForeignDomainError();

      // Act
      const caughtByTheMarker = foreign instanceof WalletDomainError;

      // Assert
      expect(caughtByTheMarker).toBe(false);
      expect(foreign).toBeInstanceOf(DomainError);
    });
  });

  describe('wallet.errors (property-based)', () => {
    // Compartir abuelo (`DomainError`) NO ensancha el `instanceof`: lo que se comprueba aquí es
    // que ninguna de las 24 clases se saltó el marcador, porque una que heredara directamente de
    // `DomainError` compilaría igual y el filtro de `wallets` dejaría de verla — un 500 mudo.
    it('debería heredar del marcador y publicar su nombre concreto, sea cual sea el error', () => {
      fc.assert(
        fc.property(fc.constantFrom(...errorFactories), ([name, build]) => {
          // Act
          const error = build();

          // Assert
          expect(error).toBeInstanceOf(WalletDomainError);
          expect(error).toBeInstanceOf(DomainError);
          expect(error.name).toBe(name);
        }),
      );
    });

    // §7.1: el mensaje viaja al cliente tal cual fuera de producción y staging, y `pino` lo
    // escribe siempre. Un mensaje que interpolara el motivo o el status abriría la puerta a
    // interpolar también el cuerpo, que es donde va la clave privada de la master.
    //
    // ⚠️ Es también lo que impide reescribir el mensaje del 502 como «is unreachable»: ese
    // literal CONTIENE el motivo `'unreachable'` de la lista, y esta propiedad se pondría roja.
    it('debería no interpolar nunca el motivo ni el status del proveedor en el mensaje', () => {
      fc.assert(
        fc.property(providerFailureReasonArb, providerStatusArb, (reason, status) => {
          // Act
          const errors = [
            new WalletProviderRejectedError(reason, status),
            new WalletProviderUnreachableError(reason, status),
            new WalletProviderUnavailableError(reason, status),
          ];

          // Assert
          for (const error of errors) {
            expect(error.message).not.toContain(reason);
            expect(error.message).not.toContain(String(status));
          }
        }),
      );
    });
  });
});

// Helpers

/** Un error de dominio que NO es de `wallets`: el contraejemplo del caso E27. */
class ForeignDomainError extends DomainError {
  constructor() {
    super('un error de otro bounded context');
  }
}

/**
 * Las 24 clases concretas del archivo, con el nombre que cada una debe publicar en `name`.
 * ⚠️ Añadir una clase a `wallet.errors.ts` obliga a añadirla aquí: la propiedad P1 solo
 * comprueba lo que esta lista contiene.
 */
const errorFactories: ReadonlyArray<readonly [string, () => WalletDomainError]> = [
  ['InvalidWalletIdError', () => new InvalidWalletIdError('x')],
  ['InvalidTransferIdError', () => new InvalidTransferIdError('x')],
  ['InvalidEthereumAddressError', () => new InvalidEthereumAddressError('x')],
  ['InvalidAddressIndexError', () => new InvalidAddressIndexError(-1)],
  ['InvalidTokenAmountError', () => new InvalidTokenAmountError('x')],
  ['InvalidTokenIdError', () => new InvalidTokenIdError('x')],
  ['InvalidTransactionHashError', () => new InvalidTransactionHashError('x')],
  ['MissingAssetFieldError', () => new MissingAssetFieldError('amount', 'fungible')],
  ['AssetFieldNotAllowedError', () => new AssetFieldNotAllowedError('tokenId', 'native')],
  ['UnknownAssetKindError', () => new UnknownAssetKindError('x')],
  ['WalletNotFoundError', () => new WalletNotFoundError('owner-1')],
  ['WalletNotActivatedError', () => new WalletNotActivatedError('receive-only')],
  ['WalletActivationInProgressError', () => new WalletActivationInProgressError()],
  ['WalletAlreadyActivatedError', () => new WalletAlreadyActivatedError()],
  ['WalletOwnerGoneError', () => new WalletOwnerGoneError('owner-1')],
  ['AdminUsesMasterAddressError', () => new AdminUsesMasterAddressError()],
  ['AddressIndexAlreadyUsedError', () => new AddressIndexAlreadyUsedError(7)],
  ['WalletAddressAlreadyUsedError', () => new WalletAddressAlreadyUsedError('0xabc')],
  ['WalletOwnerMismatchError', () => new WalletOwnerMismatchError('0xold', '0xnew')],
  ['WalletAddressIsMasterError', () => new WalletAddressIsMasterError('0xmaster')],
  ['WalletAssignmentLostError', () => new WalletAssignmentLostError('owner-1')],
  ['WalletProviderRejectedError', () => new WalletProviderRejectedError('body-rejected', 400)],
  ['WalletProviderUnreachableError', () => new WalletProviderUnreachableError('timeout', null)],
  ['WalletProviderUnavailableError', () => new WalletProviderUnavailableError('unauthorized', 401)],
];
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/modules/wallets/__tests__/domain/wallet-status.spec.ts src/modules/wallets/__tests__/domain/errors/wallet.errors.spec.ts`
Expected: FAIL — `Cannot find module '../../domain/wallet-status' from 'src/modules/wallets/__tests__/domain/wallet-status.spec.ts'` y `Cannot find module '../../../domain/errors/wallet.errors' from 'src/modules/wallets/__tests__/domain/errors/wallet.errors.spec.ts'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/modules/wallets/domain/wallet-status.ts
/**
 * Unión y no enum: convención del repo (`type`, nunca `interface`; uniones sobre enums), la
 * misma forma que `USER_ROLES` en `users`.
 *
 * **Vive suelto en `domain/` y NO en `domain/value-objects/`**: no extiende `ValueObject`, no
 * tiene factoría y no encapsula ninguna invariante — es un vocabulario cerrado que se compara
 * con `===`. En `value-objects/` solo entra lo que extiende `ValueObject`.
 *
 * El orden ES la máquina de estados y es **monótona**: `receive-only` → `activating` → `active`,
 * y nunca retrocede. Una wallet en `receive-only` puede recibir fondos pero no enviarlos, que es
 * exactamente lo que `WalletNotActivatedError` cuenta cuando lleva este valor.
 */
export const WALLET_STATUSES = ['receive-only', 'activating', 'active'] as const;
export type WalletStatus = (typeof WALLET_STATUSES)[number];
```

```ts
// src/modules/wallets/domain/errors/wallet.errors.ts
import { DomainError } from '@shared/domain/domain-error.base';

import type { WalletStatus } from '../wallet-status';

/**
 * Errores de dominio de `wallets`: de negocio, no de transporte. Traducirlos a HTTP es tarea de
 * `infrastructure/http/wallets-domain-exception.filter.ts` — mismo contrato que `user.errors.ts`,
 * `auth.errors.ts` y `order.errors.ts`. El cuerpo compartido (constructor y `new.target.name`)
 * está en `DomainError`; lo que este marcador aporta es la IDENTIDAD del contexto, que es lo que
 * `@Catch(WalletDomainError)` discrimina.
 *
 * ⚠️ El fallback del filtro es **400**. Todo error de este archivo que no sea una entrada inválida
 * del cliente necesita su fila EXPLÍCITA en el mapa del filtro (spec §3.5): sin ella un 502 se
 * publicaría como «entrada inválida» y —lo caro— se escondería del `ErrorReporter`, que solo ve
 * 5xx. Es la razón por la que los tres `Invalid*Error` de identidad e índice salen como 500.
 *
 * ⚠️ **`WalletAlreadyAssignedError` no existe.** El `23505` de `idx_wallets_user_id` es una
 * carrera normal entre dos altas, y el adaptador lo traduce al desenlace `'owner-conflict'` de
 * `WalletRepository.save()`, que el caso de uso resuelve releyendo. No hay ningún camino por el
 * que ese error llegue a HTTP, así que la clase no se escribe: añadirla sería reintroducir una
 * excepción para un caso que ya tiene respuesta.
 */
export abstract class WalletDomainError extends DomainError {}

/**
 * Lista CERRADA de motivos de fallo del proveedor. Es un código NUESTRO, jamás el `message` de
 * Tatum: el del 401 interpola la clave de API —`"Unable to find valid subscription for
 * '${apiKey}'"`, medido en `docs/tatum/gas-pump/openapi.json`— y ese valor acabaría en una tabla
 * que además se publica por `GET /wallets/me/transfers`.
 *
 * ⚠️ **Es la única lista del módulo.** `WalletTransfer` guarda exactamente este mismo código en
 * sus estados `rejected` y `unknown` (spec §3.2) y la columna se llama `reason_code`: no hay un
 * `TransferFailureReason` aparte, porque es la misma información vista desde otro sitio.
 */
export const PROVIDER_FAILURE_REASONS = [
  'body-rejected', // 400 del proveedor en la TRANSFERENCIA (culpa del cliente)
  'misconfigured', // 400 del proveedor al derivar o activar (culpa nuestra)
  'unauthorized', // 401
  'forbidden', // 403
  'undocumented-4xx', // 404, 429, 402, 409… nada de esto está en su contrato
  'upstream-error', // 5xx
  'unreachable', // DNS / TCP / TLS
  'timeout',
  'malformed-response', // cuerpo no-JSON, o 200 que no satisface el esquema
] as const;
export type ProviderFailureReason = (typeof PROVIDER_FAILURE_REASONS)[number];

export class InvalidWalletIdError extends WalletDomainError {
  constructor(readonly value: string) {
    super(`"${value}" is not a valid wallet id`);
  }
}

export class InvalidTransferIdError extends WalletDomainError {
  constructor(readonly value: string) {
    super(`"${value}" is not a valid transfer id`);
  }
}

export class InvalidEthereumAddressError extends WalletDomainError {
  constructor(readonly value: string) {
    super(`"${value}" is not a valid Ethereum address`);
  }
}

export class InvalidAddressIndexError extends WalletDomainError {
  constructor(readonly value: number) {
    super(`${value} is not a valid address index`);
  }
}

export class InvalidTokenAmountError extends WalletDomainError {
  constructor(readonly value: string) {
    super(`"${value}" is not a valid token amount`);
  }
}

export class InvalidTokenIdError extends WalletDomainError {
  constructor(readonly value: string) {
    super(`"${value}" is not a valid token id`);
  }
}

export class InvalidTransactionHashError extends WalletDomainError {
  constructor(readonly value: string) {
    super(`"${value}" is not a valid transaction hash`);
  }
}

/**
 * ⚠️ **Recibe el CAMPO primero y la CLASE después, y el mensaje los nombra al revés.** Los dos
 * parámetros son `string`, así que invertir la llamada compila y publica «Asset of kind "amount"
 * requires the field "fungible"» — literalmente al revés, y ningún tipo lo caza. El caso E8 lo
 * fija, y `TransferAsset.requiredField` (Task 8) será el único sitio del árbol que lo construya —
 * hoy, con `TransferAsset` aún sin escribir, solo lo construye este spec.
 */
export class MissingAssetFieldError extends WalletDomainError {
  constructor(
    readonly field: string,
    readonly kind: string,
  ) {
    super(`Asset of kind "${kind}" requires the field "${field}"`);
  }
}

/** Mismo orden invertido que `MissingAssetFieldError`, y por la misma razón. Caso E9. */
export class AssetFieldNotAllowedError extends WalletDomainError {
  constructor(
    readonly field: string,
    readonly kind: string,
  ) {
    super(`Asset of kind "${kind}" does not accept the field "${field}"`);
  }
}

export class UnknownAssetKindError extends WalletDomainError {
  constructor(readonly kind: string) {
    super(`"${kind}" is not a known asset kind`);
  }
}

export class WalletNotFoundError extends WalletDomainError {
  constructor(readonly ownerId: string) {
    super(`Wallet for owner ${ownerId} was not found`);
  }
}

/**
 * Lleva el ESTADO, no el id de la wallet. El id no le sirve de nada al cliente —los cinco
 * endpoints son «lo mío» y nunca lo ve—, mientras que el estado le dice si le toca activar
 * (`receive-only`) o esperar a que termine la activación en curso (`activating`).
 */
export class WalletNotActivatedError extends WalletDomainError {
  constructor(readonly status: WalletStatus) {
    super(`Wallet cannot send funds yet: its status is "${status}"`);
  }
}

/** Sin argumentos: el cliente solo tiene una wallet y ya sabe cuál. Nada variable que contar. */
export class WalletActivationInProgressError extends WalletDomainError {
  constructor() {
    super('Wallet already has an activation in progress');
  }
}

/** Sin argumentos, por lo mismo que `WalletActivationInProgressError`. */
export class WalletAlreadyActivatedError extends WalletDomainError {
  constructor() {
    super('Wallet is already activated');
  }
}

export class WalletOwnerGoneError extends WalletDomainError {
  constructor(readonly ownerId: string) {
    // El mensaje es interno: el filter publica el 403 canónico, nunca esta cadena. Mismo
    // contrato que `CustomerGoneError` de `orders`.
    super(`Owner ${ownerId} no longer exists or is inactive`);
  }
}

/**
 * El admin ya opera la master, así que darle una dirección derivada crearía una SEGUNDA EOA en el
 * sistema — justo la invariante de §3.1.1. Sin argumentos: el rol es la explicación entera.
 */
export class AdminUsesMasterAddressError extends WalletDomainError {
  constructor() {
    super('The admin operates the master address and has no gas pump wallet');
  }
}

export class AddressIndexAlreadyUsedError extends WalletDomainError {
  constructor(readonly index: number) {
    super(`Address index ${index} is already assigned to another wallet`);
  }
}

export class WalletAddressAlreadyUsedError extends WalletDomainError {
  constructor(readonly address: string) {
    super(`Address ${address} is already assigned to another wallet`);
  }
}

export class WalletOwnerMismatchError extends WalletDomainError {
  constructor(
    readonly walletOwnerAddress: string,
    readonly configuredMaster: string,
  ) {
    super(`Wallet was derived under master ${walletOwnerAddress}, not under ${configuredMaster}`);
  }
}

export class WalletAddressIsMasterError extends WalletDomainError {
  constructor(readonly address: string) {
    super(`Address ${address} is the master address and cannot be handed to a user`);
  }
}

export class WalletAssignmentLostError extends WalletDomainError {
  constructor(readonly ownerId: string) {
    super(`Wallet assignment for owner ${ownerId} vanished between the conflict and the re-read`);
  }
}

/**
 * Padre de los tres errores del proveedor. Existe porque tres sitios necesitan `instanceof` sobre
 * la FAMILIA entera —el filtro, el caso de uso de la transferencia y el gateway—: sin él cada uno
 * enumeraría las tres clases y se quedaría desactualizado al añadir la cuarta, en verde y sin que
 * nada lo dijera.
 *
 * Aquí viven los dos únicos campos que un error del proveedor puede transportar: el código
 * NUESTRO y el status. `providerStatus` es nullable porque los casos normalizados del §6.2 —un
 * `activated` ausente, un array de derivación con cardinalidad distinta de uno, un timeout— no
 * tienen status que citar.
 *
 * ⚠️ Los mensajes de los tres hijos son **FIJOS** y no interpolan nada. Es lo que impide que la
 * clave privada de la master, que viaja en el cuerpo de la transferencia, entre en un error:
 * `pino-std-serializers` recorre toda propiedad enumerable del error y la escribe. La propiedad
 * P2 lo fija, y de paso prohíbe escribir «is unreachable» en el 502 — ese literal contiene el
 * motivo `'unreachable'` de la lista.
 */
export abstract class WalletProviderError extends WalletDomainError {
  protected constructor(
    message: string,
    readonly reason: ProviderFailureReason,
    readonly providerStatus: number | null,
  ) {
    super(message);
  }
}

/**
 * El proveedor rechazó NUESTRO cuerpo con un 400, y solo puede pasar en la transferencia: es la
 * única de las tres llamadas que lleva entrada del cliente a la que culpar (spec §7.2) ⇒ 400.
 */
export class WalletProviderRejectedError extends WalletProviderError {
  constructor(reason: ProviderFailureReason, providerStatus: number | null) {
    super('The wallet provider rejected the transfer request', reason, providerStatus);
  }
}

/** Proveedor caído o contrato roto ⇒ 502. */
export class WalletProviderUnreachableError extends WalletProviderError {
  constructor(reason: ProviderFailureReason, providerStatus: number | null) {
    super(
      'The wallet provider could not be reached or broke its published contract',
      reason,
      providerStatus,
    );
  }
}

/**
 * Configuración NUESTRA rota (400 en derivar o activar, 401, 403, cualquier otro 4xx no
 * documentado) ⇒ 503. Son dos clases y no una porque el filtro mapea clase → excepción HTTP: una
 * sola no puede rendir 502 y 503 a la vez.
 */
export class WalletProviderUnavailableError extends WalletProviderError {
  constructor(reason: ProviderFailureReason, providerStatus: number | null) {
    super('The wallet provider integration is unavailable', reason, providerStatus);
  }
}
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/modules/wallets/__tests__/domain/wallet-status.spec.ts src/modules/wallets/__tests__/domain/errors/wallet.errors.spec.ts`
Expected: PASS — 31 passed (1 en `wallet-status.spec.ts`, 30 en `wallet.errors.spec.ts`)

---

### Task 2: `WalletId` y `TransferId`, las dos identidades del contexto

**Layer:** domain
**Rule codes to honor:** `security-validate-all-input`, `arch-single-responsibility`, `arch-feature-modules`

Los dos extienden `UuidId`: el formato y `newUuid()` los pone el kernel, y lo único de este
contexto es qué error se lanza. Van en una sola tarea porque no comparten más que la base y
partirlos duplicaría la misma tabla dos veces.

**Casos acordados** (Tabla W — `WalletId`):

| #   | Caso (se vuelve el `it`)                                                | Entrada / estado inicial                 | Resultado esperado                                             |
| --- | ----------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------- |
| W1  | debería producir un UUID de versión 4 y variante RFC 4122               | `WalletId.generate()`                    | 36 caracteres; dígito 15 = `4`; dígito 20 ∈ `89ab`             |
| W2  | debería producir un identificador distinto en cada llamada              | dos `generate()`                         | valores distintos                                              |
| W3  | debería aceptar un UUID v4 bien formado y conservarlo                   | `'7c9e6679-7425-40de-944b-e07fc1f90ae7'` | `value` idéntico a la entrada                                  |
| W4  | debería rechazar un UUID de versión 1 con el error y el mensaje exactos | `'3f2504e0-4f89-11d3-9a0c-0305e82c3301'` | `InvalidWalletIdError`; `message` exacto; `value` = la entrada |
| W5  | debería distinguir un `WalletId` de un `TransferId` con el mismo UUID   | mismo UUID en las dos clases             | `equals()` devuelve `false`                                    |
| P1  | debería aceptar cualquier UUID v4 bien formado _(propiedad)_            | `fc.uuid({ version: 4 })`                | nunca lanza; `value` idéntico a la entrada                     |
| P2  | debería aceptar indistintamente mayúsculas y minúsculas _(propiedad)_   | `fc.uuid({ version: 4 })` en mayúsculas  | nunca lanza                                                    |

**Casos acordados** (Tabla T — `TransferId`):

| #   | Caso (se vuelve el `it`)                                            | Entrada / estado inicial                 | Resultado esperado                                                      |
| --- | ------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------- |
| T1  | debería producir un UUID de versión 4 y variante RFC 4122           | `TransferId.generate()`                  | 36 caracteres; dígito 15 = `4`; dígito 20 ∈ `89ab`                      |
| T2  | debería producir un identificador distinto en cada llamada          | dos `generate()`                         | valores distintos                                                       |
| T3  | debería aceptar un UUID v4 bien formado y conservarlo               | `'3f2504e0-4f89-41d3-9a0c-0305e82c3301'` | `value` idéntico a la entrada                                           |
| T4  | debería rechazar una cadena vacía con el error y el mensaje exactos | `''`                                     | `InvalidTransferIdError`; `message === '"" is not a valid transfer id'` |
| P1  | debería aceptar cualquier UUID v4 bien formado _(propiedad)_        | `fc.uuid({ version: 4 })`                | nunca lanza; `value` idéntico a la entrada                              |

**Files:**

- Create: `src/modules/wallets/domain/value-objects/wallet-id.vo.ts`
- Create: `src/modules/wallets/domain/value-objects/transfer-id.vo.ts`
- Test: `src/modules/wallets/__tests__/domain/value-objects/wallet-id.vo.spec.ts`
- Test: `src/modules/wallets/__tests__/domain/value-objects/transfer-id.vo.spec.ts`

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/modules/wallets/__tests__/domain/value-objects/wallet-id.vo.spec.ts
import fc from 'fast-check';

import { InvalidWalletIdError } from '../../../domain/errors/wallet.errors';
import { TransferId } from '../../../domain/value-objects/transfer-id.vo';
import { WalletId } from '../../../domain/value-objects/wallet-id.vo';

describe('WalletId', () => {
  describe('generate()', () => {
    // La aserción va contra la especificación del UUID v4, no contra `WalletId.from()`:
    // comprobarlo con la misma regex que usa `from()` sería probar la regex contra sí misma.
    it('debería producir un UUID de versión 4 y variante RFC 4122', () => {
      // Act
      const value = WalletId.generate().value;

      // Assert
      expect(value).toHaveLength(36);
      expect(value[14]).toBe('4');
      expect('89ab').toContain(value[19]);
    });

    it('debería producir un identificador distinto en cada llamada', () => {
      // Act
      const first = WalletId.generate();
      const second = WalletId.generate();

      // Assert
      expect(first.value).not.toBe(second.value);
    });
  });

  describe('from()', () => {
    it('debería aceptar un UUID v4 bien formado y conservarlo', () => {
      // Arrange
      const value = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

      // Act
      const id = WalletId.from(value);

      // Assert
      expect(id.value).toBe(value);
    });

    it('debería rechazar un UUID de versión 1 con el error y el mensaje exactos', () => {
      // Arrange
      const value = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

      // Act
      const error = captureError(() => WalletId.from(value));

      // Assert
      expect(error).toBeInstanceOf(InvalidWalletIdError);
      expect(error.message).toBe(`"${value}" is not a valid wallet id`);
      expect((error as InvalidWalletIdError).value).toBe(value);
    });
  });

  describe('equals()', () => {
    // `ValueObject.equals` compara también la clase: sin esa comprobación, un `TransferId`
    // podría colarse donde se espera la identidad de una wallet y nadie lo notaría.
    it('debería distinguir un WalletId de un TransferId con el mismo UUID', () => {
      // Arrange
      const value = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

      // Act
      const result = WalletId.from(value).equals(TransferId.from(value));

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('from() (property-based)', () => {
    it('debería aceptar cualquier UUID v4 bien formado', () => {
      fc.assert(
        fc.property(fc.uuid({ version: 4 }), (value) => {
          // Act
          const id = WalletId.from(value);

          // Assert
          expect(id.value).toBe(value);
        }),
      );
    });

    it('debería aceptar indistintamente mayúsculas y minúsculas', () => {
      fc.assert(
        fc.property(fc.uuid({ version: 4 }), (value) => {
          // Act + Assert
          expect(() => WalletId.from(value.toUpperCase())).not.toThrow();
        }),
      );
    });
  });
});

// Helpers

/**
 * Devuelve el error que `act` lanzó. `toThrow(Clase)` NO mira el mensaje y `toThrow('texto')` lo
 * compara por SUBCADENA: con cualquiera de las dos, un mutante que cambie el literal del mensaje
 * sobrevive. Es una de las dos familias de supervivientes conocidas del repo, así que aquí el
 * error se captura y su `message` se compara con `toBe`.
 */
const captureError = (act: () => unknown): Error => {
  try {
    act();
  } catch (error) {
    return error as Error;
  }
  throw new Error('se esperaba una excepción y no se lanzó ninguna');
};
```

```ts
// src/modules/wallets/__tests__/domain/value-objects/transfer-id.vo.spec.ts
import fc from 'fast-check';

import { InvalidTransferIdError } from '../../../domain/errors/wallet.errors';
import { TransferId } from '../../../domain/value-objects/transfer-id.vo';

describe('TransferId', () => {
  describe('generate()', () => {
    it('debería producir un UUID de versión 4 y variante RFC 4122', () => {
      // Act
      const value = TransferId.generate().value;

      // Assert
      expect(value).toHaveLength(36);
      expect(value[14]).toBe('4');
      expect('89ab').toContain(value[19]);
    });

    it('debería producir un identificador distinto en cada llamada', () => {
      // Act
      const first = TransferId.generate();
      const second = TransferId.generate();

      // Assert
      expect(first.value).not.toBe(second.value);
    });
  });

  describe('from()', () => {
    it('debería aceptar un UUID v4 bien formado y conservarlo', () => {
      // Arrange
      const value = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

      // Act
      const id = TransferId.from(value);

      // Assert
      expect(id.value).toBe(value);
    });

    it('debería rechazar una cadena vacía con el error y el mensaje exactos', () => {
      // Act
      const error = captureError(() => TransferId.from(''));

      // Assert
      expect(error).toBeInstanceOf(InvalidTransferIdError);
      expect(error.message).toBe('"" is not a valid transfer id');
      expect((error as InvalidTransferIdError).value).toBe('');
    });
  });

  describe('from() (property-based)', () => {
    it('debería aceptar cualquier UUID v4 bien formado', () => {
      fc.assert(
        fc.property(fc.uuid({ version: 4 }), (value) => {
          // Act
          const id = TransferId.from(value);

          // Assert
          expect(id.value).toBe(value);
        }),
      );
    });
  });
});

// Helpers

/** Ver el mismo helper en `wallet-id.vo.spec.ts`: `toThrow` no compara el mensaje exacto. */
const captureError = (act: () => unknown): Error => {
  try {
    act();
  } catch (error) {
    return error as Error;
  }
  throw new Error('se esperaba una excepción y no se lanzó ninguna');
};
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/modules/wallets/__tests__/domain/value-objects/wallet-id.vo.spec.ts src/modules/wallets/__tests__/domain/value-objects/transfer-id.vo.spec.ts`
Expected: FAIL — `Cannot find module '../../../domain/value-objects/wallet-id.vo'` y `Cannot find module '../../../domain/value-objects/transfer-id.vo'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/modules/wallets/domain/value-objects/wallet-id.vo.ts
import { UuidId } from '@shared/domain/uuid-id.base';

import { InvalidWalletIdError } from '../errors/wallet.errors';

/**
 * Identidad del agregado `Wallet`, patrón de `order-id.vo.ts`. `equals()` y `toString()` vienen
 * de `ValueObject` y el formato de `UuidId`; lo único de este contexto es qué error se lanza.
 *
 * ⚠️ Ese error sale como **500**, no como 400 (spec §3.5): ningún endpoint de `wallets` recibe un
 * id de wallet —los cinco son «lo mío»—, así que si esto se dispara es una fila corrupta, y
 * publicarlo como «entrada inválida» lo escondería del `ErrorReporter`, que solo ve 5xx.
 */
export class WalletId extends UuidId {
  static generate(): WalletId {
    return new WalletId(UuidId.newUuid());
  }

  static from(value: string): WalletId {
    return new WalletId(UuidId.assertUuid(value, (invalid) => new InvalidWalletIdError(invalid)));
  }
}
```

```ts
// src/modules/wallets/domain/value-objects/transfer-id.vo.ts
import { UuidId } from '@shared/domain/uuid-id.base';

import { InvalidTransferIdError } from '../errors/wallet.errors';

/**
 * Identidad del agregado `WalletTransfer`. Es una clase aparte de `WalletId` y no un alias:
 * `ValueObject.equals` compara la clase, así que dos ids de agregados distintos con el mismo UUID
 * no son iguales — y el libro de transferencias y la wallet no pueden confundirse por accidente.
 */
export class TransferId extends UuidId {
  static generate(): TransferId {
    return new TransferId(UuidId.newUuid());
  }

  static from(value: string): TransferId {
    return new TransferId(
      UuidId.assertUuid(value, (invalid) => new InvalidTransferIdError(invalid)),
    );
  }
}
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/modules/wallets/__tests__/domain/value-objects/wallet-id.vo.spec.ts src/modules/wallets/__tests__/domain/value-objects/transfer-id.vo.spec.ts`
Expected: PASS — 12 passed (7 en `wallet-id.vo.spec.ts`, 5 en `transfer-id.vo.spec.ts`)

---

### Task 3: `EthereumAddress` — forma y normalización a minúsculas, sin checksum

**Layer:** domain
**Rule codes to honor:** `security-validate-all-input`, `arch-single-responsibility`, `arch-feature-modules`

Recorta, exige `0x` + 40 hexadecimales y **normaliza a minúsculas**, que es lo que hace que
`equals()` y el índice único de la base coincidan — mismo patrón que `Email`. **No valida el
checksum EIP-55**: eso vive en el validador del DTO (`infrastructure/http/`), porque `domain/` no
puede importar `@noble/hashes` (regla 1 del gate) y keccak256 no está en `node:crypto`.

**Casos acordados** (Tabla A):

| #       | Caso (se vuelve el `it`)                                                                         | Entrada / estado inicial                           | Resultado esperado                                               |
| ------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------- | ---------------------------------------------------------------- |
| A1      | debería aceptar una dirección en minúsculas y conservarla                                        | `'0x742d35cc…f44e'`                                | `value` idéntico a la entrada                                    |
| A2      | debería normalizar a minúsculas una dirección con checksum EIP-55                                | `'0x742d35Cc6634C0532925a3b844Bc454e4438f44e'`     | `value` = la misma en minúsculas                                 |
| A3      | debería recortar los espacios de los extremos                                                    | `'  0x742d35cc…f44e  '`                            | `value` = la dirección sin espacios                              |
| A4      | debería aceptar el prefijo `0X` en mayúsculas, normalizándolo                                    | `'0X742d35cc…f44e'`                                | `value` empieza por `0x`                                         |
| A5      | debería aceptar una dirección con el checksum EIP-55 incorrecto                                  | `'0x742D35cc…f44e'` (caja distinta de la canónica) | no lanza; `value` = la versión en minúsculas                     |
| A6      | debería rechazar una dirección sin el prefijo `0x`                                               | 40 hexadecimales pelados                           | `InvalidEthereumAddressError`; `message` exacto; `value` crudo   |
| A7      | debería rechazar una dirección de 39 hexadecimales                                               | `'0x' + 'a'×39`                                    | `InvalidEthereumAddressError`; `message` exacto                  |
| A8      | debería rechazar una dirección de 41 hexadecimales                                               | `'0x' + 'a'×41`                                    | `InvalidEthereumAddressError`; `message` exacto                  |
| A9      | debería rechazar un carácter no hexadecimal dentro de los 40                                     | `'0x' + 'a'×39 + 'g'`                              | `InvalidEthereumAddressError`; `message` exacto                  |
| A10     | debería rechazar la cadena vacía                                                                 | `''`                                               | `message === '"" is not a valid Ethereum address'`               |
| A11     | debería rechazar una dirección precedida de basura _(solo falla por el ancla `^`)_               | `'zz0x742d35cc…f44e'`                              | `InvalidEthereumAddressError`; `message` exacto                  |
| A12     | debería rechazar una dirección seguida de basura _(solo falla por el ancla `$`)_                 | `'0x742d35cc…f44ezz'`                              | `InvalidEthereumAddressError`; `message` exacto                  |
| A13     | debería considerar iguales la misma dirección en EIP-55 y en minúsculas                          | las dos formas de la misma dirección               | `equals()` devuelve `true`                                       |
| **A14** | debería llevar en el error el valor CRUDO, no el normalizado                                     | `from("  0xZZ…  ")` con espacios y mayúsculas      | `error.value` es la entrada tal cual, con sus espacios y su caja |
| P1      | debería aceptar cualquier dirección de 40 hexadecimales y devolverla en minúsculas _(propiedad)_ | arbitrario `0x` + 40 hex con cajas mezcladas       | nunca lanza; `value === entrada.toLowerCase()`                   |
| P2      | debería ser idempotente al normalizar _(propiedad)_                                              | ídem                                               | nunca lanza; normalizar dos veces da lo mismo que una            |

⚠️ **A14 se añadió por confirmación JIT tras la revisión, no estaba en la tabla original.** Cierra
un hueco que el gate de mutación NO puede ver: el JSDoc de `from()` afirma que el error lleva el
valor CRUDO, y ninguno de los quince casos anteriores lo fijaba —todas sus entradas de rechazo
tenían crudo y normalizado idénticos, así que cambiar `value` por `normalized` dejaba la suite en
verde—. Verificado rompiéndolo: con ese cambio A14 es el ÚNICO que cae (`1 failed, 58 passed`).

Stryker no genera el mutante «cambia un identificador por otro del mismo ámbito», así que el score
de mutación es idéntico con y sin A14 (48/48): este caso no aporta score, aporta la única
protección que existe sobre esa línea del JSDoc.

⚠️ **El bloque de código del Step 1 de abajo reproduce el spec SIN A14**, tal como se acordó
originalmente. El árbol lleva los dieciséis casos.

**Files:**

- Create: `src/modules/wallets/domain/value-objects/ethereum-address.vo.ts`
- Test: `src/modules/wallets/__tests__/domain/value-objects/ethereum-address.vo.spec.ts`

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/modules/wallets/__tests__/domain/value-objects/ethereum-address.vo.spec.ts
import fc from 'fast-check';

import { InvalidEthereumAddressError } from '../../../domain/errors/wallet.errors';
import { EthereumAddress } from '../../../domain/value-objects/ethereum-address.vo';
import { ethereumAddressArb } from '../../helpers/arbitraries';

const LOWERCASE = '0x742d35cc6634c0532925a3b844bc454e4438f44e';
const CHECKSUMMED = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';

describe('EthereumAddress', () => {
  describe('from()', () => {
    it('debería aceptar una dirección en minúsculas y conservarla', () => {
      // Act
      const address = EthereumAddress.from(LOWERCASE);

      // Assert
      expect(address.value).toBe(LOWERCASE);
    });

    it('debería normalizar a minúsculas una dirección con checksum EIP-55', () => {
      // Act
      const address = EthereumAddress.from(CHECKSUMMED);

      // Assert
      expect(address.value).toBe(LOWERCASE);
    });

    it('debería recortar los espacios de los extremos', () => {
      // Act
      const address = EthereumAddress.from(`  ${LOWERCASE}  `);

      // Assert
      expect(address.value).toBe(LOWERCASE);
    });

    it('debería aceptar el prefijo 0X en mayúsculas, normalizándolo', () => {
      // Act
      const address = EthereumAddress.from(`0X${LOWERCASE.slice(2)}`);

      // Assert
      expect(address.value).toBe(LOWERCASE);
    });

    // La forma con checksum de una dirección es ÚNICA, así que cualquier otra combinación de
    // cajas de esa misma dirección lo tiene roto. Aquí se acepta a propósito: el checksum se
    // comprueba en el validador del DTO, y este VO también recibe direcciones del proveedor, que
    // las devuelve en minúsculas — es decir, sin checksum que comprobar.
    it('debería aceptar una dirección con el checksum EIP-55 incorrecto', () => {
      // Arrange
      const brokenChecksum = '0x742D35cc6634c0532925a3b844bc454e4438f44e';

      // Act
      const address = EthereumAddress.from(brokenChecksum);

      // Assert
      expect(address.value).toBe(LOWERCASE);
    });

    it('debería rechazar una dirección sin el prefijo 0x', () => {
      // Arrange
      const withoutPrefix = LOWERCASE.slice(2);

      // Act
      const error = captureError(() => EthereumAddress.from(withoutPrefix));

      // Assert
      expect(error).toBeInstanceOf(InvalidEthereumAddressError);
      expect(error.message).toBe(`"${withoutPrefix}" is not a valid Ethereum address`);
      expect((error as InvalidEthereumAddressError).value).toBe(withoutPrefix);
    });

    it('debería rechazar una dirección de 39 hexadecimales', () => {
      // Arrange
      const tooShort = `0x${'a'.repeat(39)}`;

      // Act
      const error = captureError(() => EthereumAddress.from(tooShort));

      // Assert
      expect(error).toBeInstanceOf(InvalidEthereumAddressError);
      expect(error.message).toBe(`"${tooShort}" is not a valid Ethereum address`);
    });

    it('debería rechazar una dirección de 41 hexadecimales', () => {
      // Arrange
      const tooLong = `0x${'a'.repeat(41)}`;

      // Act
      const error = captureError(() => EthereumAddress.from(tooLong));

      // Assert
      expect(error).toBeInstanceOf(InvalidEthereumAddressError);
      expect(error.message).toBe(`"${tooLong}" is not a valid Ethereum address`);
    });

    it('debería rechazar un carácter no hexadecimal dentro de los 40', () => {
      // Arrange
      const notHex = `0x${'a'.repeat(39)}g`;

      // Act
      const error = captureError(() => EthereumAddress.from(notHex));

      // Assert
      expect(error).toBeInstanceOf(InvalidEthereumAddressError);
      expect(error.message).toBe(`"${notHex}" is not a valid Ethereum address`);
    });

    it('debería rechazar la cadena vacía', () => {
      // Act
      const error = captureError(() => EthereumAddress.from(''));

      // Assert
      expect(error).toBeInstanceOf(InvalidEthereumAddressError);
      expect(error.message).toBe('"" is not a valid Ethereum address');
    });

    // Sin el ancla `^`, la expresión encontraría la dirección EN MEDIO de la basura y aceptaría
    // esta entrada. Es el único caso de la tabla que muere por esa ancla y por nada más.
    it('debería rechazar una dirección precedida de basura', () => {
      // Arrange
      const prefixed = `zz${LOWERCASE}`;

      // Act
      const error = captureError(() => EthereumAddress.from(prefixed));

      // Assert
      expect(error).toBeInstanceOf(InvalidEthereumAddressError);
      expect(error.message).toBe(`"${prefixed}" is not a valid Ethereum address`);
    });

    // El simétrico: sin el ancla `$` la expresión casaría el prefijo y daría por buena una
    // dirección con cola. Los 41 hexadecimales de A8 matan además el cuantificador `{40}`.
    it('debería rechazar una dirección seguida de basura', () => {
      // Arrange
      const suffixed = `${LOWERCASE}zz`;

      // Act
      const error = captureError(() => EthereumAddress.from(suffixed));

      // Assert
      expect(error).toBeInstanceOf(InvalidEthereumAddressError);
      expect(error.message).toBe(`"${suffixed}" is not a valid Ethereum address`);
    });
  });

  describe('equals()', () => {
    // Es la invariante de la que depende que el índice único de `address` proteja algo: si las
    // dos cajas no fueran iguales, la misma dirección entraría dos veces en la tabla.
    it('debería considerar iguales la misma dirección en EIP-55 y en minúsculas', () => {
      // Act
      const result = EthereumAddress.from(CHECKSUMMED).equals(EthereumAddress.from(LOWERCASE));

      // Assert
      expect(result).toBe(true);
    });
  });

  describe('from() (property-based)', () => {
    it('debería aceptar cualquier dirección de 40 hexadecimales y devolverla en minúsculas', () => {
      fc.assert(
        fc.property(ethereumAddressArb, (raw) => {
          // Act
          const address = EthereumAddress.from(raw);

          // Assert
          expect(address.value).toBe(raw.toLowerCase());
        }),
      );
    });

    it('debería ser idempotente al normalizar', () => {
      fc.assert(
        fc.property(ethereumAddressArb, (raw) => {
          // Act
          const once = EthereumAddress.from(raw).value;
          const twice = EthereumAddress.from(once).value;

          // Assert
          expect(twice).toBe(once);
        }),
      );
    });
  });
});

// Helpers

/** Ver `wallet-id.vo.spec.ts`: `toThrow` no compara el mensaje de forma exacta. */
const captureError = (act: () => unknown): Error => {
  try {
    act();
  } catch (error) {
    return error as Error;
  }
  throw new Error('se esperaba una excepción y no se lanzó ninguna');
};
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/modules/wallets/__tests__/domain/value-objects/ethereum-address.vo.spec.ts`
Expected: FAIL — `Cannot find module '../../../domain/value-objects/ethereum-address.vo'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/modules/wallets/domain/value-objects/ethereum-address.vo.ts
import { ValueObject } from '@shared/domain/value-object.base';

import { InvalidEthereumAddressError } from '../errors/wallet.errors';

/** Se comprueba sobre el valor YA recortado y en minúsculas, de ahí que no incluya `A-F`. */
const ETHEREUM_ADDRESS = /^0x[0-9a-f]{40}$/;

/**
 * Dirección Ethereum: forma y nada más. Se normaliza a minúsculas porque la misma dirección en
 * EIP-55 y en minúsculas ES la misma dirección, y normalizar es lo que hace que `equals()` y el
 * índice único de la tabla coincidan — mismo patrón que `Email`.
 *
 * ⚠️ **No valida el checksum EIP-55, y es deliberado.** `domain/` no puede importar librerías
 * externas (regla 1 del gate) y keccak256 no está en `node:crypto`: el `sha3-256` de la
 * biblioteca estándar usa otro padding y da otro hash. La comprobación vive en el validador del
 * DTO, en `infrastructure/http/`, y **solo cubre lo que entra por HTTP**. El otro origen de
 * direcciones es el proveedor, que las devuelve en minúsculas, es decir sin checksum que
 * comprobar.
 */
export class EthereumAddress extends ValueObject<string> {
  static from(value: string): EthereumAddress {
    const normalized = value.trim().toLowerCase();
    if (!ETHEREUM_ADDRESS.test(normalized)) {
      throw new InvalidEthereumAddressError(value);
    }
    return new EthereumAddress(normalized);
  }
}
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/modules/wallets/__tests__/domain/value-objects/ethereum-address.vo.spec.ts`
Expected: PASS — 15 passed

---

### Task 4: `AddressIndex` — entero no negativo con el tope de la columna

**Layer:** domain
**Rule codes to honor:** `security-validate-all-input`, `db-use-migrations`, `arch-single-responsibility`

Entero entre 0 y **2 147 483 647**, el máximo de un `integer` de PostgreSQL. Un VO que admitiera
lo que la columna no puede guardar sería una mentira: el fallo aparecería en el `INSERT`, donde ya
no se distingue de un problema del driver.

**Casos acordados** (Tabla X):

| #   | Caso (se vuelve el `it`)                                               | Entrada / estado inicial     | Resultado esperado                                              |
| --- | ---------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------- |
| X1  | debería aceptar el índice 0, que es el primero que da la secuencia     | `0`                          | `value === 0`                                                   |
| X2  | debería aceptar exactamente el máximo de un `integer` de PostgreSQL    | `2_147_483_647`              | `value === 2_147_483_647`                                       |
| X3  | debería rechazar el primer índice que la columna ya no puede guardar   | `2_147_483_648`              | `InvalidAddressIndexError`; `message` exacto; `value` = entrada |
| X4  | debería rechazar un índice negativo                                    | `-1`                         | `message === '-1 is not a valid address index'`                 |
| X5  | debería rechazar un índice no entero                                   | `0.5`                        | `message === '0.5 is not a valid address index'`                |
| X6  | debería rechazar `NaN`                                                 | `Number.NaN`                 | `message === 'NaN is not a valid address index'`                |
| P1  | debería aceptar cualquier entero del rango y conservarlo _(propiedad)_ | `fc.integer({0…2147483647})` | nunca lanza; `value` idéntico a la entrada                      |

**Files:**

- Create: `src/modules/wallets/domain/value-objects/address-index.vo.ts`
- Test: `src/modules/wallets/__tests__/domain/value-objects/address-index.vo.spec.ts`

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/modules/wallets/__tests__/domain/value-objects/address-index.vo.spec.ts
import fc from 'fast-check';

import { InvalidAddressIndexError } from '../../../domain/errors/wallet.errors';
import { AddressIndex } from '../../../domain/value-objects/address-index.vo';
import { addressIndexArb } from '../../helpers/arbitraries';

describe('AddressIndex', () => {
  describe('from()', () => {
    it('debería aceptar el índice 0, que es el primero que da la secuencia', () => {
      // Act
      const index = AddressIndex.from(0);

      // Assert
      expect(index.value).toBe(0);
    });

    it('debería aceptar exactamente el máximo de un integer de PostgreSQL', () => {
      // Act
      const index = AddressIndex.from(2_147_483_647);

      // Assert
      expect(index.value).toBe(2_147_483_647);
    });

    // El límite exacto por los dos lados: sin este caso, un `>=` en vez de un `>` rechazaría el
    // último índice utilizable y nadie se enteraría hasta agotar la secuencia.
    it('debería rechazar el primer índice que la columna ya no puede guardar', () => {
      // Act
      const error = captureError(() => AddressIndex.from(2_147_483_648));

      // Assert
      expect(error).toBeInstanceOf(InvalidAddressIndexError);
      expect(error.message).toBe('2147483648 is not a valid address index');
      expect((error as InvalidAddressIndexError).value).toBe(2_147_483_648);
    });

    it('debería rechazar un índice negativo', () => {
      // Act
      const error = captureError(() => AddressIndex.from(-1));

      // Assert
      expect(error).toBeInstanceOf(InvalidAddressIndexError);
      expect(error.message).toBe('-1 is not a valid address index');
    });

    it('debería rechazar un índice no entero', () => {
      // Act
      const error = captureError(() => AddressIndex.from(0.5));

      // Assert
      expect(error).toBeInstanceOf(InvalidAddressIndexError);
      expect(error.message).toBe('0.5 is not a valid address index');
    });

    it('debería rechazar NaN', () => {
      // Act
      const error = captureError(() => AddressIndex.from(Number.NaN));

      // Assert
      expect(error).toBeInstanceOf(InvalidAddressIndexError);
      expect(error.message).toBe('NaN is not a valid address index');
    });
  });

  describe('from() (property-based)', () => {
    it('debería aceptar cualquier entero del rango y conservarlo', () => {
      fc.assert(
        fc.property(addressIndexArb, (value) => {
          // Act
          const index = AddressIndex.from(value);

          // Assert
          expect(index.value).toBe(value);
        }),
      );
    });
  });
});

// Helpers

/** Ver `wallet-id.vo.spec.ts`: `toThrow` no compara el mensaje de forma exacta. */
const captureError = (act: () => unknown): Error => {
  try {
    act();
  } catch (error) {
    return error as Error;
  }
  throw new Error('se esperaba una excepción y no se lanzó ninguna');
};
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/modules/wallets/__tests__/domain/value-objects/address-index.vo.spec.ts`
Expected: FAIL — `Cannot find module '../../../domain/value-objects/address-index.vo'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/modules/wallets/domain/value-objects/address-index.vo.ts
import { ValueObject } from '@shared/domain/value-object.base';

import { InvalidAddressIndexError } from '../errors/wallet.errors';

/**
 * El máximo de un `integer` de PostgreSQL, que es el tipo de la columna `address_index`. Aceptar
 * uno más aquí trasladaría el fallo del dominio al `INSERT`, donde ya no se distingue de un
 * problema del driver.
 */
const MAX_ADDRESS_INDEX = 2_147_483_647;

/**
 * Índice de derivación de una gas pump address bajo la master. Entero no negativo: el primero que
 * entrega la secuencia de PostgreSQL es el 0, y el admin no consume ninguno.
 *
 * ⚠️ Su error sale como **500**, no como 400 (spec §3.5): ningún cliente pasa un índice por la
 * API, así que si esto se dispara es la secuencia agotada o una fila corrupta. Publicarlo como
 * «entrada inválida» lo escondería del `ErrorReporter`, que solo ve 5xx.
 */
export class AddressIndex extends ValueObject<number> {
  static from(value: number): AddressIndex {
    if (!Number.isInteger(value) || value < 0 || value > MAX_ADDRESS_INDEX) {
      throw new InvalidAddressIndexError(value);
    }
    return new AddressIndex(value);
  }
}
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/modules/wallets/__tests__/domain/value-objects/address-index.vo.spec.ts`
Expected: PASS — 7 passed

---

### Task 5: `TokenAmount` — decimal canónico, más estricto que el patrón del proveedor

**Layer:** domain
**Rule codes to honor:** `security-validate-all-input`, `arch-single-responsibility`, `api-use-dto-serialization`

Decimal canónico sin ceros a la izquierda, distinto de cero y de hasta 79 caracteres. Es **más
estricto que el patrón del proveedor**, que acepta `+1`, `.5` y `1.`: los tres rompen la igualdad
canónica del string, y el string es lo que se firma y lo que se guarda en el libro. El cero se
rechaza porque un envío de cero quema gas y no mueve nada.

**Casos acordados** (Tabla M):

| #   | Caso (se vuelve el `it`)                                                           | Entrada / estado inicial   | Resultado esperado                                              |
| --- | ---------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------- |
| M1  | debería aceptar un entero canónico                                                 | `'1'`                      | `value === '1'`                                                 |
| M2  | debería aceptar un entero grande en unidades mínimas                               | `'1500000000000000000'`    | `value` idéntico a la entrada                                   |
| M3  | debería aceptar un decimal canónico                                                | `'1.5'`                    | `value === '1.5'`                                               |
| M4  | debería aceptar un importe menor que uno, con parte entera cero                    | `'0.5'`                    | `value === '0.5'`                                               |
| M5  | debería aceptar un importe de exactamente 79 caracteres                            | `'1' + '0'×78`             | `value` de longitud 79                                          |
| M6  | debería rechazar un importe de 80 caracteres                                       | `'1' + '0'×79`             | `InvalidTokenAmountError`; `message` exacto                     |
| M7  | debería rechazar el cero, que quema gas sin mover nada                             | `'0'`                      | `message === '"0" is not a valid token amount'`                 |
| M8  | debería rechazar un cero escrito con decimales                                     | `'0.0'`                    | `InvalidTokenAmountError`; `message` exacto                     |
| M9  | debería rechazar un importe con cero a la izquierda                                | `'01'`                     | `InvalidTokenAmountError`; `message` exacto                     |
| M10 | debería rechazar el signo `+` que el patrón del proveedor sí acepta                | `'+1'`                     | `InvalidTokenAmountError`; `message` exacto                     |
| M11 | debería rechazar un importe sin parte entera                                       | `'.5'`                     | `InvalidTokenAmountError`; `message` exacto                     |
| M12 | debería rechazar un importe con punto y sin decimales                              | `'1.'`                     | `InvalidTokenAmountError`; `message` exacto                     |
| M13 | debería rechazar un importe negativo                                               | `'-1'`                     | `InvalidTokenAmountError`; `message` exacto                     |
| M14 | debería rechazar la cadena vacía                                                   | `''`                       | `message === '"" is not a valid token amount'`                  |
| M15 | debería rechazar un importe con un espacio delante _(solo falla por el ancla `^`)_ | `' 1'`                     | `InvalidTokenAmountError`; `message` exacto                     |
| M16 | debería rechazar un importe con un espacio detrás _(solo falla por el ancla `$`)_  | `'1 '`                     | `InvalidTokenAmountError`; `message` exacto                     |
| M17 | debería rechazar la notación exponencial                                           | `'1e18'`                   | `InvalidTokenAmountError`; `message` exacto                     |
| P1  | debería aceptar cualquier importe canónico no nulo _(propiedad)_                   | arbitrario construido      | nunca lanza; `value` idéntico a la entrada, carácter a carácter |
| P2  | debería rechazar cualquier importe formado solo por ceros _(propiedad)_            | `'0'`, `'0.0'`, `'0.000…'` | siempre `InvalidTokenAmountError` con el mensaje exacto         |

**Files:**

- Create: `src/modules/wallets/domain/value-objects/token-amount.vo.ts`
- Test: `src/modules/wallets/__tests__/domain/value-objects/token-amount.vo.spec.ts`

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/modules/wallets/__tests__/domain/value-objects/token-amount.vo.spec.ts
import fc from 'fast-check';

import { InvalidTokenAmountError } from '../../../domain/errors/wallet.errors';
import { TokenAmount } from '../../../domain/value-objects/token-amount.vo';
import { allZeroAmountArb, tokenAmountArb } from '../../helpers/arbitraries';

describe('TokenAmount', () => {
  describe('from()', () => {
    it('debería aceptar un entero canónico', () => {
      // Act
      const amount = TokenAmount.from('1');

      // Assert
      expect(amount.value).toBe('1');
    });

    it('debería aceptar un entero grande en unidades mínimas', () => {
      // Act
      const amount = TokenAmount.from('1500000000000000000');

      // Assert
      expect(amount.value).toBe('1500000000000000000');
    });

    it('debería aceptar un decimal canónico', () => {
      // Act
      const amount = TokenAmount.from('1.5');

      // Assert
      expect(amount.value).toBe('1.5');
    });

    // La parte entera `0` sí es legal: lo que se rechaza es que TODO sea cero.
    it('debería aceptar un importe menor que uno, con parte entera cero', () => {
      // Act
      const amount = TokenAmount.from('0.5');

      // Assert
      expect(amount.value).toBe('0.5');
    });

    it('debería aceptar un importe de exactamente 79 caracteres', () => {
      // Arrange
      const exact = `1${'0'.repeat(78)}`;

      // Act
      const amount = TokenAmount.from(exact);

      // Assert
      expect(amount.value).toHaveLength(79);
    });

    it('debería rechazar un importe de 80 caracteres', () => {
      // Arrange
      const tooLong = `1${'0'.repeat(79)}`;

      // Act
      const error = captureError(() => TokenAmount.from(tooLong));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenAmountError);
      expect(error.message).toBe(`"${tooLong}" is not a valid token amount`);
    });

    it('debería rechazar el cero, que quema gas sin mover nada', () => {
      // Act
      const error = captureError(() => TokenAmount.from('0'));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenAmountError);
      expect(error.message).toBe('"0" is not a valid token amount');
      expect((error as InvalidTokenAmountError).value).toBe('0');
    });

    it('debería rechazar un cero escrito con decimales', () => {
      // Act
      const error = captureError(() => TokenAmount.from('0.0'));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenAmountError);
      expect(error.message).toBe('"0.0" is not a valid token amount');
    });

    it('debería rechazar un importe con cero a la izquierda', () => {
      // Act
      const error = captureError(() => TokenAmount.from('01'));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenAmountError);
      expect(error.message).toBe('"01" is not a valid token amount');
    });

    it('debería rechazar el signo + que el patrón del proveedor sí acepta', () => {
      // Act
      const error = captureError(() => TokenAmount.from('+1'));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenAmountError);
      expect(error.message).toBe('"+1" is not a valid token amount');
    });

    it('debería rechazar un importe sin parte entera', () => {
      // Act
      const error = captureError(() => TokenAmount.from('.5'));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenAmountError);
      expect(error.message).toBe('".5" is not a valid token amount');
    });

    it('debería rechazar un importe con punto y sin decimales', () => {
      // Act
      const error = captureError(() => TokenAmount.from('1.'));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenAmountError);
      expect(error.message).toBe('"1." is not a valid token amount');
    });

    it('debería rechazar un importe negativo', () => {
      // Act
      const error = captureError(() => TokenAmount.from('-1'));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenAmountError);
      expect(error.message).toBe('"-1" is not a valid token amount');
    });

    it('debería rechazar la cadena vacía', () => {
      // Act
      const error = captureError(() => TokenAmount.from(''));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenAmountError);
      expect(error.message).toBe('"" is not a valid token amount');
    });

    // Sin el ancla `^` la expresión casaría el `1` final y daría por bueno `' 1'`. Es el único
    // caso de la tabla que muere solo por esa ancla.
    it('debería rechazar un importe con un espacio delante', () => {
      // Act
      const error = captureError(() => TokenAmount.from(' 1'));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenAmountError);
      expect(error.message).toBe('" 1" is not a valid token amount');
    });

    // El simétrico: sin `$` la expresión casaría el `1` inicial y aceptaría `'1 '`.
    it('debería rechazar un importe con un espacio detrás', () => {
      // Act
      const error = captureError(() => TokenAmount.from('1 '));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenAmountError);
      expect(error.message).toBe('"1 " is not a valid token amount');
    });

    it('debería rechazar la notación exponencial', () => {
      // Act
      const error = captureError(() => TokenAmount.from('1e18'));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenAmountError);
      expect(error.message).toBe('"1e18" is not a valid token amount');
    });
  });

  describe('from() (property-based)', () => {
    // El valor se conserva CARÁCTER a carácter: es el string el que viaja a la cadena, así que
    // cualquier reescritura —recortar, reformatear— cambiaría el importe enviado.
    it('debería aceptar cualquier importe canónico no nulo', () => {
      fc.assert(
        fc.property(tokenAmountArb, (raw) => {
          // Act
          const amount = TokenAmount.from(raw);

          // Assert
          expect(amount.value).toBe(raw);
        }),
      );
    });

    it('debería rechazar cualquier importe formado solo por ceros', () => {
      fc.assert(
        fc.property(allZeroAmountArb, (raw) => {
          // Act
          const error = captureError(() => TokenAmount.from(raw));

          // Assert
          expect(error).toBeInstanceOf(InvalidTokenAmountError);
          expect(error.message).toBe(`"${raw}" is not a valid token amount`);
        }),
      );
    });
  });
});

// Helpers

/** Ver `wallet-id.vo.spec.ts`: `toThrow` no compara el mensaje de forma exacta. */
const captureError = (act: () => unknown): Error => {
  try {
    act();
  } catch (error) {
    return error as Error;
  }
  throw new Error('se esperaba una excepción y no se lanzó ninguna');
};
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/modules/wallets/__tests__/domain/value-objects/token-amount.vo.spec.ts`
Expected: FAIL — `Cannot find module '../../../domain/value-objects/token-amount.vo'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/modules/wallets/domain/value-objects/token-amount.vo.ts
import { ValueObject } from '@shared/domain/value-object.base';

import { InvalidTokenAmountError } from '../errors/wallet.errors';

/**
 * Decimal canónico: parte entera `0` o sin ceros a la izquierda, y parte decimal opcional pero
 * nunca vacía. Ni signo ni exponente.
 */
const CANONICAL_DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

/**
 * «No todo ceros» se comprueba buscando UN dígito distinto de cero, no con una segunda expresión
 * anclada: una regex de más es una regex de más que anclar, que probar y que mutar.
 */
const NON_ZERO_DIGIT = /[1-9]/;

/** 78 dígitos es el máximo de un uint256; el 79 es el punto decimal. */
const MAX_LENGTH = 79;

/**
 * Importe a transferir, en las unidades mínimas del token. Viaja como **string** de punta a
 * punta: un token de 18 decimales no cabe en un flotante sin perder precisión.
 *
 * ⚠️ Es MÁS estricto que el patrón del proveedor, que acepta `+1`, `.5` y `1.`. Los tres
 * representan el mismo número que `1` y `0.5`, pero rompen la igualdad canónica del string — y el
 * string es lo que se firma y lo que se guarda en el libro. Y **el cero se rechaza**: un envío de
 * cero quema gas y no mueve nada.
 *
 * ⚠️ **No recorta espacios**, a diferencia de `EthereumAddress`. Un importe con espacios no es un
 * formato alternativo de nada: es una entrada rota, y el DTO ya valida el transporte.
 *
 * La asimetría con `TokenId` —que sí acepta `"0"`— es deliberada: el token 0 existe.
 */
export class TokenAmount extends ValueObject<string> {
  static from(value: string): TokenAmount {
    if (
      value.length > MAX_LENGTH ||
      !CANONICAL_DECIMAL.test(value) ||
      !NON_ZERO_DIGIT.test(value)
    ) {
      throw new InvalidTokenAmountError(value);
    }
    return new TokenAmount(value);
  }
}
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/modules/wallets/__tests__/domain/value-objects/token-amount.vo.spec.ts`
Expected: PASS — 19 passed

---

### Task 6: `TokenId` — entero canónico de hasta 78 dígitos, y el `"0"` sí vale

**Layer:** domain
**Rule codes to honor:** `security-validate-all-input`, `arch-single-responsibility`, `arch-feature-modules`

Entero decimal canónico de hasta 78 dígitos —el máximo de un uint256—. **Acepta `"0"`**, que es
la asimetría deliberada con `TokenAmount`: el token 0 existe, un envío de cero no.

**Casos acordados** (Tabla K):

| #   | Caso (se vuelve el `it`)                                                      | Entrada / estado inicial | Resultado esperado                                  |
| --- | ----------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------- |
| K1  | debería aceptar el token 0, que sí existe                                     | `'0'`                    | `value === '0'`                                     |
| K2  | debería aceptar un id de un solo dígito                                       | `'7'`                    | `value === '7'`                                     |
| K3  | debería aceptar un id de exactamente 78 dígitos                               | `'1' + '0'×77`           | `value` de longitud 78                              |
| K4  | debería rechazar un id de 79 dígitos                                          | `'1' + '0'×78`           | `InvalidTokenIdError`; `message` exacto             |
| K5  | debería rechazar un id con cero a la izquierda                                | `'01'`                   | `message === '"01" is not a valid token id'`        |
| K6  | debería rechazar un id con decimales, que es un importe y no un id            | `'1.0'`                  | `InvalidTokenIdError`; `message` exacto             |
| K7  | debería rechazar el signo `+`                                                 | `'+1'`                   | `InvalidTokenIdError`; `message` exacto             |
| K8  | debería rechazar un id negativo                                               | `'-1'`                   | `InvalidTokenIdError`; `message` exacto             |
| K9  | debería rechazar la cadena vacía                                              | `''`                     | `message === '"" is not a valid token id'`          |
| K10 | debería rechazar un id con un espacio delante _(solo falla por el ancla `^`)_ | `' 1'`                   | `InvalidTokenIdError`; `message` exacto             |
| K11 | debería rechazar un id con un espacio detrás _(solo falla por el ancla `$`)_  | `'1 '`                   | `InvalidTokenIdError`; `message` exacto             |
| K12 | debería rechazar un id en hexadecimal                                         | `'0x1'`                  | `InvalidTokenIdError`; `message` exacto             |
| P1  | debería aceptar cualquier entero canónico de hasta 78 dígitos _(propiedad)_   | arbitrario construido    | nunca lanza; `value` idéntico a la entrada          |
| P2  | debería rechazar cualquier id con ceros a la izquierda _(propiedad)_          | `'0'×n + no-cero + …`    | siempre `InvalidTokenIdError` con el mensaje exacto |

**Files:**

- Create: `src/modules/wallets/domain/value-objects/token-id.vo.ts`
- Test: `src/modules/wallets/__tests__/domain/value-objects/token-id.vo.spec.ts`

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/modules/wallets/__tests__/domain/value-objects/token-id.vo.spec.ts
import fc from 'fast-check';

import { InvalidTokenIdError } from '../../../domain/errors/wallet.errors';
import { TokenId } from '../../../domain/value-objects/token-id.vo';
import { leadingZeroTokenIdArb, tokenIdArb } from '../../helpers/arbitraries';

describe('TokenId', () => {
  describe('from()', () => {
    // La asimetría con `TokenAmount`, que rechaza `"0"`: el token 0 existe, el envío de cero no.
    it('debería aceptar el token 0, que sí existe', () => {
      // Act
      const tokenId = TokenId.from('0');

      // Assert
      expect(tokenId.value).toBe('0');
    });

    it('debería aceptar un id de un solo dígito', () => {
      // Act
      const tokenId = TokenId.from('7');

      // Assert
      expect(tokenId.value).toBe('7');
    });

    it('debería aceptar un id de exactamente 78 dígitos', () => {
      // Arrange
      const exact = `1${'0'.repeat(77)}`;

      // Act
      const tokenId = TokenId.from(exact);

      // Assert
      expect(tokenId.value).toHaveLength(78);
    });

    it('debería rechazar un id de 79 dígitos', () => {
      // Arrange
      const tooLong = `1${'0'.repeat(78)}`;

      // Act
      const error = captureError(() => TokenId.from(tooLong));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenIdError);
      expect(error.message).toBe(`"${tooLong}" is not a valid token id`);
    });

    it('debería rechazar un id con cero a la izquierda', () => {
      // Act
      const error = captureError(() => TokenId.from('01'));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenIdError);
      expect(error.message).toBe('"01" is not a valid token id');
      expect((error as InvalidTokenIdError).value).toBe('01');
    });

    it('debería rechazar un id con decimales, que es un importe y no un id', () => {
      // Act
      const error = captureError(() => TokenId.from('1.0'));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenIdError);
      expect(error.message).toBe('"1.0" is not a valid token id');
    });

    it('debería rechazar el signo +', () => {
      // Act
      const error = captureError(() => TokenId.from('+1'));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenIdError);
      expect(error.message).toBe('"+1" is not a valid token id');
    });

    it('debería rechazar un id negativo', () => {
      // Act
      const error = captureError(() => TokenId.from('-1'));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenIdError);
      expect(error.message).toBe('"-1" is not a valid token id');
    });

    it('debería rechazar la cadena vacía', () => {
      // Act
      const error = captureError(() => TokenId.from(''));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenIdError);
      expect(error.message).toBe('"" is not a valid token id');
    });

    // Sin el ancla `^` la expresión casaría el `1` final y `' 1'` pasaría.
    it('debería rechazar un id con un espacio delante', () => {
      // Act
      const error = captureError(() => TokenId.from(' 1'));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenIdError);
      expect(error.message).toBe('" 1" is not a valid token id');
    });

    // El simétrico: sin `$` la expresión casaría el `1` inicial y `'1 '` pasaría.
    it('debería rechazar un id con un espacio detrás', () => {
      // Act
      const error = captureError(() => TokenId.from('1 '));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenIdError);
      expect(error.message).toBe('"1 " is not a valid token id');
    });

    it('debería rechazar un id en hexadecimal', () => {
      // Act
      const error = captureError(() => TokenId.from('0x1'));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenIdError);
      expect(error.message).toBe('"0x1" is not a valid token id');
    });
  });

  describe('from() (property-based)', () => {
    it('debería aceptar cualquier entero canónico de hasta 78 dígitos', () => {
      fc.assert(
        fc.property(tokenIdArb, (raw) => {
          // Act
          const tokenId = TokenId.from(raw);

          // Assert
          expect(tokenId.value).toBe(raw);
        }),
      );
    });

    it('debería rechazar cualquier id con ceros a la izquierda', () => {
      fc.assert(
        fc.property(leadingZeroTokenIdArb, (raw) => {
          // Act
          const error = captureError(() => TokenId.from(raw));

          // Assert
          expect(error).toBeInstanceOf(InvalidTokenIdError);
          expect(error.message).toBe(`"${raw}" is not a valid token id`);
        }),
      );
    });
  });
});

// Helpers

/** Ver `wallet-id.vo.spec.ts`: `toThrow` no compara el mensaje de forma exacta. */
const captureError = (act: () => unknown): Error => {
  try {
    act();
  } catch (error) {
    return error as Error;
  }
  throw new Error('se esperaba una excepción y no se lanzó ninguna');
};
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/modules/wallets/__tests__/domain/value-objects/token-id.vo.spec.ts`
Expected: FAIL — `Cannot find module '../../../domain/value-objects/token-id.vo'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/modules/wallets/domain/value-objects/token-id.vo.ts
import { ValueObject } from '@shared/domain/value-object.base';

import { InvalidTokenIdError } from '../errors/wallet.errors';

/** Entero canónico: `0`, o un dígito no nulo seguido de lo que sea. Sin punto, signo ni prefijo. */
const CANONICAL_INTEGER = /^(?:0|[1-9][0-9]*)$/;

/** 78 dígitos decimales es el máximo de un uint256, que es el tipo del `tokenId` en EVM. */
const MAX_DIGITS = 78;

/**
 * Identificador de un token dentro de su contrato (NFT y multi-token). Viaja como **string**: un
 * uint256 no cabe en un `number`.
 *
 * ⚠️ **Acepta `"0"`, y es la asimetría deliberada con `TokenAmount`.** El token 0 existe y se
 * transfiere como cualquier otro; un importe de cero, en cambio, quema gas y no mueve nada. Quien
 * «arregle» la asimetría igualando los dos VOs romperá las colecciones cuyo primer token es el 0.
 *
 * Los ceros a la izquierda se rechazan por la misma razón que en el importe: `"01"` y `"1"` son
 * el mismo token con dos strings distintos, y el string es lo que se compara y se guarda.
 */
export class TokenId extends ValueObject<string> {
  static from(value: string): TokenId {
    if (value.length > MAX_DIGITS || !CANONICAL_INTEGER.test(value)) {
      throw new InvalidTokenIdError(value);
    }
    return new TokenId(value);
  }
}
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/modules/wallets/__tests__/domain/value-objects/token-id.vo.spec.ts`
Expected: PASS — 14 passed

---

### Task 7: `TransactionHash` — `0x` + 64 hexadecimales, normalizado a minúsculas

**Layer:** domain
**Rule codes to honor:** `security-validate-all-input`, `arch-single-responsibility`, `error-handle-async-errors`

Hash de una transacción de la cadena: el de la activación y el de la transferencia. ⚠️ El
proveedor lo devuelve **sin** el prefijo `0x` —el ejemplo de `openapi.json` son 64 hexadecimales
pelados y el campo es `type: string` sin `pattern`—, así que **la normalización la hace el
adaptador, no este VO**. Va escrito en su JSDoc porque es el camino por el que el camino feliz
moriría en un 400 con el gas ya pagado.

**Casos acordados** (Tabla H):

| #       | Caso (se vuelve el `it`)                                                                    | Entrada / estado inicial                                          | Resultado esperado                                               |
| ------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| H1      | debería aceptar un hash en minúsculas y conservarlo                                         | `'0x5c504ed4…2060'`                                               | `value` idéntico a la entrada                                    |
| H2      | debería normalizar a minúsculas un hash en mayúsculas                                       | el mismo en mayúsculas                                            | `value` = la versión en minúsculas                               |
| H3      | debería recortar los espacios de los extremos                                               | `'  0x5c504ed4…2060  '`                                           | `value` sin espacios                                             |
| H4      | debería aceptar el prefijo `0X` en mayúsculas, normalizándolo                               | `'0X5c504ed4…2060'`                                               | `value` empieza por `0x`                                         |
| H5      | debería rechazar un hash sin el prefijo `0x`, que es como lo devuelve el proveedor          | 64 hexadecimales pelados                                          | `InvalidTransactionHashError`; `message` exacto                  |
| H6      | debería rechazar un hash de 63 hexadecimales                                                | `'0x' + 'a'×63`                                                   | `InvalidTransactionHashError`; `message` exacto                  |
| H7      | debería rechazar un hash de 65 hexadecimales                                                | `'0x' + 'a'×65`                                                   | `InvalidTransactionHashError`; `message` exacto                  |
| H8      | debería rechazar un carácter no hexadecimal dentro de los 64                                | `'0x' + 'a'×63 + 'g'`                                             | `InvalidTransactionHashError`; `message` exacto                  |
| H9      | debería rechazar la cadena vacía                                                            | `''`                                                              | `message === '"" is not a valid transaction hash'`               |
| H10     | debería rechazar un hash precedido de basura _(solo falla por el ancla `^`)_                | `'zz0x5c504ed4…2060'`                                             | `InvalidTransactionHashError`; `message` exacto                  |
| H11     | debería rechazar un hash seguido de basura _(solo falla por el ancla `$`)_                  | `'0x5c504ed4…2060zz'`                                             | `InvalidTransactionHashError`; `message` exacto                  |
| H12     | debería considerar iguales el mismo hash en mayúsculas y en minúsculas                      | las dos cajas del mismo hash                                      | `equals()` devuelve `true`                                       |
| **H13** | debería llevar en el error el valor CRUDO, no el normalizado                                | `from("  0X" + "A"×63 + "ZZ  ")` — espacios y mayúsculas a la vez | `error.value` es la entrada tal cual, con sus espacios y su caja |
| P1      | debería aceptar cualquier hash de 64 hexadecimales y devolverlo en minúsculas _(propiedad)_ | arbitrario construido                                             | nunca lanza; `value === entrada.toLowerCase()`                   |
| P2      | debería ser idempotente al normalizar _(propiedad)_                                         | ídem                                                              | nunca lanza; normalizar dos veces da lo mismo que una            |

⚠️ **H13 se añadió por confirmación tras la revisión, no estaba en la tabla original.** Es el
hermano del A14 de `ethereum-address.vo.ts` y cierra el mismo hueco: el JSDoc afirma que el error
lleva el valor CRUDO y ninguno de los doce casos lo fijaba, porque las siete entradas de rechazo
ya cumplían `raw === raw.trim().toLowerCase()`. Medido: sin H13 el cambio `value` → `normalized`
deja `113 passed` sin que caiga uno; con H13 da `1 failed, 113 passed` y el único que cae es él.
Stryker no lo caza —no intercambia identificadores—, así que este caso no aporta score sino la
única protección que existe sobre esa línea.

**Files:**

- Create: `src/modules/wallets/domain/value-objects/transaction-hash.vo.ts`
- Test: `src/modules/wallets/__tests__/domain/value-objects/transaction-hash.vo.spec.ts`

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/modules/wallets/__tests__/domain/value-objects/transaction-hash.vo.spec.ts
import fc from 'fast-check';

import { InvalidTransactionHashError } from '../../../domain/errors/wallet.errors';
import { TransactionHash } from '../../../domain/value-objects/transaction-hash.vo';
import { transactionHashArb } from '../../helpers/arbitraries';

const LOWERCASE = '0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060';

describe('TransactionHash', () => {
  describe('from()', () => {
    it('debería aceptar un hash en minúsculas y conservarlo', () => {
      // Act
      const hash = TransactionHash.from(LOWERCASE);

      // Assert
      expect(hash.value).toBe(LOWERCASE);
    });

    it('debería normalizar a minúsculas un hash en mayúsculas', () => {
      // Act
      const hash = TransactionHash.from(LOWERCASE.toUpperCase());

      // Assert
      expect(hash.value).toBe(LOWERCASE);
    });

    it('debería recortar los espacios de los extremos', () => {
      // Act
      const hash = TransactionHash.from(`  ${LOWERCASE}  `);

      // Assert
      expect(hash.value).toBe(LOWERCASE);
    });

    it('debería aceptar el prefijo 0X en mayúsculas, normalizándolo', () => {
      // Act
      const hash = TransactionHash.from(`0X${LOWERCASE.slice(2)}`);

      // Assert
      expect(hash.value).toBe(LOWERCASE);
    });

    // Este es el caso que el adaptador tiene que evitar: el proveedor devuelve el `txId` SIN
    // prefijo, y construir el VO con él daría un 400 con el gas ya pagado. El VO no lo arregla a
    // propósito — quien conoce la forma del proveedor es el adaptador, no el dominio.
    it('debería rechazar un hash sin el prefijo 0x, que es como lo devuelve el proveedor', () => {
      // Arrange
      const withoutPrefix = LOWERCASE.slice(2);

      // Act
      const error = captureError(() => TransactionHash.from(withoutPrefix));

      // Assert
      expect(error).toBeInstanceOf(InvalidTransactionHashError);
      expect(error.message).toBe(`"${withoutPrefix}" is not a valid transaction hash`);
      expect((error as InvalidTransactionHashError).value).toBe(withoutPrefix);
    });

    it('debería rechazar un hash de 63 hexadecimales', () => {
      // Arrange
      const tooShort = `0x${'a'.repeat(63)}`;

      // Act
      const error = captureError(() => TransactionHash.from(tooShort));

      // Assert
      expect(error).toBeInstanceOf(InvalidTransactionHashError);
      expect(error.message).toBe(`"${tooShort}" is not a valid transaction hash`);
    });

    it('debería rechazar un hash de 65 hexadecimales', () => {
      // Arrange
      const tooLong = `0x${'a'.repeat(65)}`;

      // Act
      const error = captureError(() => TransactionHash.from(tooLong));

      // Assert
      expect(error).toBeInstanceOf(InvalidTransactionHashError);
      expect(error.message).toBe(`"${tooLong}" is not a valid transaction hash`);
    });

    it('debería rechazar un carácter no hexadecimal dentro de los 64', () => {
      // Arrange
      const notHex = `0x${'a'.repeat(63)}g`;

      // Act
      const error = captureError(() => TransactionHash.from(notHex));

      // Assert
      expect(error).toBeInstanceOf(InvalidTransactionHashError);
      expect(error.message).toBe(`"${notHex}" is not a valid transaction hash`);
    });

    it('debería rechazar la cadena vacía', () => {
      // Act
      const error = captureError(() => TransactionHash.from(''));

      // Assert
      expect(error).toBeInstanceOf(InvalidTransactionHashError);
      expect(error.message).toBe('"" is not a valid transaction hash');
    });

    // Sin el ancla `^`, la expresión encontraría el hash EN MEDIO de la basura y lo aceptaría.
    it('debería rechazar un hash precedido de basura', () => {
      // Arrange
      const prefixed = `zz${LOWERCASE}`;

      // Act
      const error = captureError(() => TransactionHash.from(prefixed));

      // Assert
      expect(error).toBeInstanceOf(InvalidTransactionHashError);
      expect(error.message).toBe(`"${prefixed}" is not a valid transaction hash`);
    });

    // El simétrico: sin `$` la expresión casaría el prefijo y daría por bueno un hash con cola.
    it('debería rechazar un hash seguido de basura', () => {
      // Arrange
      const suffixed = `${LOWERCASE}zz`;

      // Act
      const error = captureError(() => TransactionHash.from(suffixed));

      // Assert
      expect(error).toBeInstanceOf(InvalidTransactionHashError);
      expect(error.message).toBe(`"${suffixed}" is not a valid transaction hash`);
    });
  });

  describe('equals()', () => {
    it('debería considerar iguales el mismo hash en mayúsculas y en minúsculas', () => {
      // Act
      const result = TransactionHash.from(LOWERCASE.toUpperCase()).equals(
        TransactionHash.from(LOWERCASE),
      );

      // Assert
      expect(result).toBe(true);
    });
  });

  describe('from() (property-based)', () => {
    it('debería aceptar cualquier hash de 64 hexadecimales y devolverlo en minúsculas', () => {
      fc.assert(
        fc.property(transactionHashArb, (raw) => {
          // Act
          const hash = TransactionHash.from(raw);

          // Assert
          expect(hash.value).toBe(raw.toLowerCase());
        }),
      );
    });

    it('debería ser idempotente al normalizar', () => {
      fc.assert(
        fc.property(transactionHashArb, (raw) => {
          // Act
          const once = TransactionHash.from(raw).value;
          const twice = TransactionHash.from(once).value;

          // Assert
          expect(twice).toBe(once);
        }),
      );
    });
  });
});

// Helpers

/** Ver `wallet-id.vo.spec.ts`: `toThrow` no compara el mensaje de forma exacta. */
const captureError = (act: () => unknown): Error => {
  try {
    act();
  } catch (error) {
    return error as Error;
  }
  throw new Error('se esperaba una excepción y no se lanzó ninguna');
};
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/modules/wallets/__tests__/domain/value-objects/transaction-hash.vo.spec.ts`
Expected: FAIL — `Cannot find module '../../../domain/value-objects/transaction-hash.vo'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/modules/wallets/domain/value-objects/transaction-hash.vo.ts
import { ValueObject } from '@shared/domain/value-object.base';

import { InvalidTransactionHashError } from '../errors/wallet.errors';

/** Se comprueba sobre el valor YA recortado y en minúsculas, de ahí que no incluya `A-F`. */
const TRANSACTION_HASH = /^0x[0-9a-f]{64}$/;

/**
 * Hash de una transacción de la cadena: el de la activación (`activationTxId`) y el de la
 * transferencia. Se normaliza a minúsculas por la misma razón que `EthereumAddress`: el mismo
 * hash escrito en dos cajas es el mismo hash.
 *
 * ⚠️ **El proveedor lo devuelve SIN el prefijo `0x`** — el `example` de `openapi.json` son 64
 * hexadecimales pelados y el campo es `type: string` sin `pattern`. Prefijarlo es tarea del
 * ADAPTADOR (`infrastructure/gateways/`), **no de este VO**, y hay que hacerlo antes de
 * construirlo: sin ese paso el camino feliz muere aquí con un `InvalidTransactionHashError`, es
 * decir un 400 con el gas ya pagado. El dominio no conoce la forma del proveedor, y por eso no
 * puede ser el que la arregle.
 */
export class TransactionHash extends ValueObject<string> {
  static from(value: string): TransactionHash {
    const normalized = value.trim().toLowerCase();
    if (!TRANSACTION_HASH.test(normalized)) {
      throw new InvalidTransactionHashError(value);
    }
    return new TransactionHash(normalized);
  }
}
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/modules/wallets/__tests__/domain/value-objects/transaction-hash.vo.spec.ts`
Expected: PASS — 14 passed

---

### Task 8: `TransferAsset` — hacer imposibles las cuatro combinaciones excluyentes

**Layer:** domain
**Rule codes to honor:** `security-validate-all-input`, `arch-single-responsibility`, `error-throw-http-exceptions`

Clase con **constructor privado**, cuatro factorías estáticas, `fromParts()` que acepta la clase
como `string`, el getter `kind` y `match()`. Va **suelta en `domain/`**, no en `value-objects/`: no
extiende `ValueObject` (§3.4) y esa carpeta contiene solo lo que sí lo extiende. El archivo publica
además el vocabulario `TRANSFER_ASSET_KINDS` / `TransferAssetKind`, que es el que la entidad, el
mapper, los DTO y la columna `asset_kind` comparten.

⚠️ **El literal de la cuarta clase es `'multi-token'`, CON GUION**, en el dominio, en el mapper, en
los DTO de entrada y salida, en los ejemplos de OpenAPI y en la columna de la base. No existe
`'multitoken'`. La clave del matcher, en cambio, es **`multiToken`** en camelCase: es un
identificador de TypeScript, no el valor del vocabulario. Son cosas distintas y las dos son
correctas en su sitio.

⚠️ **Las partes en crudo nombran la dirección del contrato `tokenAddress`**, igual que la columna
`token_address` y que el campo del snapshot de `WalletTransfer`. Las factorías, que reciben value
objects ya construidos y no partes, la llaman `token`.

Una unión discriminada suelta no basta, y es medible: TypeScript es estructural y el chequeo de
propiedades sobrantes solo se aplica a literales _frescos_, así que con una variable intermedia
`const x = { kind: 'native', amount, tokenId }; const a: TransferAsset = x;` **compila**. El campo
privado `state` es lo que hace la clase nominal y cierra esa puerta.

**Casos acordados** (Tabla F):

| #   | Caso (se vuelve el `it`)                                                                    | Entrada / estado inicial                                     | Resultado esperado                                                                        |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| F1  | debería entregar token e importe a la rama fungible                                         | `TransferAsset.fungible({ token, amount })`                  | `match()` devuelve `fungible:<token>:<amount>`                                            |
| F2  | debería entregar token e id a la rama nft                                                   | `TransferAsset.nft({ token, tokenId })`                      | `match()` devuelve `nft:<token>:<tokenId>`                                                |
| F3  | debería entregar token, importe e id a la rama multi-token                                  | `TransferAsset.multiToken({ token, amount, tokenId })`       | `match()` devuelve `multi-token:<token>:<amount>:<tokenId>`                               |
| F4  | debería entregar solo el importe a la rama nativa                                           | `TransferAsset.native({ amount })`                           | `match()` devuelve `native:<amount>`                                                      |
| F5  | debería invocar exactamente una rama de `match()` y ninguna más                             | activo nativo, cuatro ramas que registran su llamada         | se registró `['native']`, nada más                                                        |
| F6  | debería construir un activo fungible desde sus partes en crudo                              | `{ kind: 'fungible', tokenAddress, amount }`                 | `match()` devuelve `fungible:…` con el token normalizado a minúsculas                     |
| F7  | debería construir un activo nft desde sus partes en crudo                                   | `{ kind: 'nft', tokenAddress, tokenId }`                     | `match()` devuelve `nft:…`                                                                |
| F8  | debería construir un activo multi-token desde sus partes en crudo                           | `{ kind: 'multi-token', tokenAddress, amount, tokenId }`     | `match()` devuelve `multi-token:…`                                                        |
| F9  | debería construir un activo nativo desde sus partes en crudo                                | `{ kind: 'native', amount }`                                 | `match()` devuelve `native:…`                                                             |
| F10 | debería rechazar una clase de activo desconocida con el error y el mensaje exactos          | `{ kind: 'erc721', … }`                                      | `UnknownAssetKindError`; `message === '"erc721" is not a known asset kind'`               |
| F11 | debería rechazar una clase de activo vacía                                                  | `{ kind: '', … }`                                            | `UnknownAssetKindError`; `message === '"" is not a known asset kind'`                     |
| F12 | debería rechazar un fungible sin importe, nombrando la clase y el campo                     | `{ kind: 'fungible', tokenAddress }`                         | `MissingAssetFieldError`; `message` exacto con `fungible` y `amount`                      |
| F13 | debería rechazar un fungible con id de token, que su clase prohíbe                          | `{ kind: 'fungible', tokenAddress, amount, tokenId }`        | `AssetFieldNotAllowedError`; `message` exacto con `fungible` y `tokenId`                  |
| F14 | debería rechazar un nft sin id de token                                                     | `{ kind: 'nft', tokenAddress }`                              | `MissingAssetFieldError`; `message` exacto con `nft` y `tokenId`                          |
| F15 | debería rechazar un nft con importe, que su clase prohíbe                                   | `{ kind: 'nft', tokenAddress, tokenId, amount }`             | `AssetFieldNotAllowedError`; `message` exacto con `nft` y `amount`                        |
| F16 | debería rechazar un envío nativo con dirección de token, que su clase prohíbe               | `{ kind: 'native', amount, tokenAddress }`                   | `AssetFieldNotAllowedError`; `message` exacto con `native` y `tokenAddress`               |
| F17 | debería rechazar un envío nativo sin importe                                                | `{ kind: 'native' }`                                         | `MissingAssetFieldError`; `message` exacto con `native` y `amount`                        |
| F18 | debería denunciar antes el campo prohibido que el obligatorio cuando faltan los dos         | `{ kind: 'fungible', tokenAddress, tokenId }` (sin `amount`) | `AssetFieldNotAllowedError` de `tokenId`, **no** el `MissingAssetFieldError`              |
| F19 | debería propagar el error del value object cuando el importe no es canónico                 | `{ kind: 'native', amount: '01' }`                           | `InvalidTokenAmountError`; `message === '"01" is not a valid token amount'`               |
| F20 | debería impedir construir un activo sin pasar por una de las cuatro factorías               | `new TransferAsset(...)` y un literal con la misma forma     | los dos rojos en compilación (`@ts-expect-error`); en runtime `new` sí crea una instancia |
| F21 | debería no extender `ValueObject` ni exponer `equals`                                       | cualquier activo                                             | `not.toBeInstanceOf(ValueObject)`; `equals` es `undefined`                                |
| F22 | debería publicar en `kind` la clase de cada uno de los cuatro activos                       | los cuatro construidos por su factoría                       | `'fungible'`, `'nft'`, `'multi-token'`, `'native'`                                        |
| F23 | debería publicar el vocabulario cerrado de clases con `multi-token` escrito con guion       | `TRANSFER_ASSET_KINDS`                                       | `['native', 'fungible', 'nft', 'multi-token']`                                            |
| P1  | debería caer siempre en la rama de su clase, sea cual sea la clase _(propiedad)_            | arbitrario sobre las cuatro clases construidas               | nunca lanza; `match()` devuelve la descripción de esa clase                               |
| P2  | debería rechazar cualquier campo prohibido de cualquier clase, nombrándolo _(propiedad)_    | arbitrario sobre los 4 pares (clase, campo prohibido)        | siempre `AssetFieldNotAllowedError` con el mensaje exacto de ese par                      |
| P3  | debería rechazar la omisión de cualquier campo obligatorio de cualquier clase _(propiedad)_ | arbitrario sobre los 8 pares (clase, campo obligatorio)      | siempre `MissingAssetFieldError` con el mensaje exacto de ese par                         |

**Files:**

- Create: `src/modules/wallets/domain/transfer-asset.ts`
- Test: `src/modules/wallets/__tests__/domain/transfer-asset.spec.ts`
- Modify: `src/modules/wallets/__tests__/helpers/arbitraries.ts` (lo crea la Task 1 con los
  arbitrarios que solo producen cadenas y números; aquí se le añade `transferAssetArb`, el primero
  del catálogo que necesita construir value objects — ver el Step 5)

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/modules/wallets/__tests__/domain/transfer-asset.spec.ts
import fc from 'fast-check';

import { ValueObject } from '@shared/domain/value-object.base';

import {
  AssetFieldNotAllowedError,
  InvalidTokenAmountError,
  MissingAssetFieldError,
  UnknownAssetKindError,
} from '../../domain/errors/wallet.errors';
import {
  TRANSFER_ASSET_KINDS,
  TransferAsset,
  type TransferAssetMatchers,
  type TransferAssetParts,
} from '../../domain/transfer-asset';
import { EthereumAddress } from '../../domain/value-objects/ethereum-address.vo';
import { TokenAmount } from '../../domain/value-objects/token-amount.vo';
import { TokenId } from '../../domain/value-objects/token-id.vo';

const TOKEN = '0x742d35cc6634c0532925a3b844bc454e4438f44e';
const AMOUNT = '1500000000000000000';
const TOKEN_ID = '42';

describe('TransferAsset', () => {
  describe('TRANSFER_ASSET_KINDS', () => {
    // El guion de `multi-token` es load-bearing: es el literal que viajan el DTO de entrada, el
    // de salida, el ejemplo de OpenAPI y la columna `asset_kind`. Escribirlo `multitoken` en
    // cualquiera de esos cinco sitios rompe el mapeo en un punto y deja los otros cuatro verdes.
    it('debería publicar el vocabulario cerrado de clases con multi-token escrito con guion', () => {
      // Arrange + Act + Assert
      expect(TRANSFER_ASSET_KINDS).toEqual(['native', 'fungible', 'nft', 'multi-token']);
    });
  });

  describe('factorías', () => {
    it('debería entregar token e importe a la rama fungible', () => {
      // Arrange
      const asset = TransferAsset.fungible({
        token: EthereumAddress.from(TOKEN),
        amount: TokenAmount.from(AMOUNT),
      });

      // Act
      const described = describeAsset(asset);

      // Assert
      expect(described).toBe(`fungible:${TOKEN}:${AMOUNT}`);
    });

    it('debería entregar token e id a la rama nft', () => {
      // Arrange
      const asset = TransferAsset.nft({
        token: EthereumAddress.from(TOKEN),
        tokenId: TokenId.from(TOKEN_ID),
      });

      // Act
      const described = describeAsset(asset);

      // Assert
      expect(described).toBe(`nft:${TOKEN}:${TOKEN_ID}`);
    });

    it('debería entregar token, importe e id a la rama multi-token', () => {
      // Arrange
      const asset = TransferAsset.multiToken({
        token: EthereumAddress.from(TOKEN),
        amount: TokenAmount.from(AMOUNT),
        tokenId: TokenId.from(TOKEN_ID),
      });

      // Act
      const described = describeAsset(asset);

      // Assert
      expect(described).toBe(`multi-token:${TOKEN}:${AMOUNT}:${TOKEN_ID}`);
    });

    it('debería entregar solo el importe a la rama nativa', () => {
      // Arrange
      const asset = TransferAsset.native({ amount: TokenAmount.from(AMOUNT) });

      // Act
      const described = describeAsset(asset);

      // Assert
      expect(described).toBe(`native:${AMOUNT}`);
    });
  });

  describe('kind', () => {
    // El getter es lo que el mapper escribe en `asset_kind` y el DTO publica. Sin él, cada
    // consumidor tendría que hacer su propio `match()` de cuatro ramas para averiguar una cadena.
    it('debería publicar en kind la clase de cada uno de los cuatro activos', () => {
      // Arrange
      const token = EthereumAddress.from(TOKEN);
      const amount = TokenAmount.from(AMOUNT);
      const tokenId = TokenId.from(TOKEN_ID);

      // Act
      const kinds = [
        TransferAsset.fungible({ token, amount }).kind,
        TransferAsset.nft({ token, tokenId }).kind,
        TransferAsset.multiToken({ token, amount, tokenId }).kind,
        TransferAsset.native({ amount }).kind,
      ];

      // Assert
      expect(kinds).toEqual(['fungible', 'nft', 'multi-token', 'native']);
    });
  });

  describe('match()', () => {
    // Sin este caso, un `switch` que cayera en dos ramas seguiría en verde: la última en escribir
    // ganaría y el valor devuelto seguiría siendo el correcto. Aquí se mira QUIÉN se ejecutó.
    it('debería invocar exactamente una rama de match() y ninguna más', () => {
      // Arrange
      const calls: string[] = [];
      const recorders: TransferAssetMatchers<void> = {
        native: () => {
          calls.push('native');
        },
        fungible: () => {
          calls.push('fungible');
        },
        nft: () => {
          calls.push('nft');
        },
        multiToken: () => {
          calls.push('multi-token');
        },
      };

      // Act
      TransferAsset.native({ amount: TokenAmount.from(AMOUNT) }).match(recorders);

      // Assert
      expect(calls).toEqual(['native']);
    });
  });

  describe('fromParts()', () => {
    it('debería construir un activo fungible desde sus partes en crudo', () => {
      // Arrange
      const parts: TransferAssetParts = { kind: 'fungible', tokenAddress: TOKEN, amount: AMOUNT };

      // Act
      const described = describeAsset(TransferAsset.fromParts(parts));

      // Assert
      expect(described).toBe(`fungible:${TOKEN}:${AMOUNT}`);
    });

    it('debería construir un activo nft desde sus partes en crudo', () => {
      // Arrange
      const parts: TransferAssetParts = { kind: 'nft', tokenAddress: TOKEN, tokenId: TOKEN_ID };

      // Act
      const described = describeAsset(TransferAsset.fromParts(parts));

      // Assert
      expect(described).toBe(`nft:${TOKEN}:${TOKEN_ID}`);
    });

    it('debería construir un activo multi-token desde sus partes en crudo', () => {
      // Arrange
      const parts: TransferAssetParts = {
        kind: 'multi-token',
        tokenAddress: TOKEN,
        amount: AMOUNT,
        tokenId: TOKEN_ID,
      };

      // Act
      const described = describeAsset(TransferAsset.fromParts(parts));

      // Assert
      expect(described).toBe(`multi-token:${TOKEN}:${AMOUNT}:${TOKEN_ID}`);
    });

    it('debería construir un activo nativo desde sus partes en crudo', () => {
      // Arrange
      const parts: TransferAssetParts = { kind: 'native', amount: AMOUNT };

      // Act
      const described = describeAsset(TransferAsset.fromParts(parts));

      // Assert
      expect(described).toBe(`native:${AMOUNT}`);
    });

    // `fromParts` acepta `kind: string` y NO el union estrecho: es la lección medida con
    // `invalid-profile`. Con el tipo estrecho, una clase desconocida caería por un `switch` sin
    // `default` devolviendo `undefined` — un 500 donde tocaba un 400.
    it('debería rechazar una clase de activo desconocida con el error y el mensaje exactos', () => {
      // Arrange
      const parts: TransferAssetParts = {
        kind: 'erc721',
        tokenAddress: TOKEN,
        tokenId: TOKEN_ID,
      };

      // Act
      const error = captureError(() => TransferAsset.fromParts(parts));

      // Assert
      expect(error).toBeInstanceOf(UnknownAssetKindError);
      expect(error.message).toBe('"erc721" is not a known asset kind');
      expect((error as UnknownAssetKindError).kind).toBe('erc721');
    });

    it('debería rechazar una clase de activo vacía', () => {
      // Arrange
      const parts: TransferAssetParts = { kind: '', amount: AMOUNT };

      // Act
      const error = captureError(() => TransferAsset.fromParts(parts));

      // Assert
      expect(error).toBeInstanceOf(UnknownAssetKindError);
      expect(error.message).toBe('"" is not a known asset kind');
    });

    it('debería rechazar un fungible sin importe, nombrando la clase y el campo', () => {
      // Arrange
      const parts: TransferAssetParts = { kind: 'fungible', tokenAddress: TOKEN };

      // Act
      const error = captureError(() => TransferAsset.fromParts(parts));

      // Assert
      expect(error).toBeInstanceOf(MissingAssetFieldError);
      expect(error.message).toBe('Asset of kind "fungible" requires the field "amount"');
    });

    it('debería rechazar un fungible con id de token, que su clase prohíbe', () => {
      // Arrange
      const parts: TransferAssetParts = {
        kind: 'fungible',
        tokenAddress: TOKEN,
        amount: AMOUNT,
        tokenId: TOKEN_ID,
      };

      // Act
      const error = captureError(() => TransferAsset.fromParts(parts));

      // Assert
      expect(error).toBeInstanceOf(AssetFieldNotAllowedError);
      expect(error.message).toBe('Asset of kind "fungible" does not accept the field "tokenId"');
    });

    it('debería rechazar un nft sin id de token', () => {
      // Arrange
      const parts: TransferAssetParts = { kind: 'nft', tokenAddress: TOKEN };

      // Act
      const error = captureError(() => TransferAsset.fromParts(parts));

      // Assert
      expect(error).toBeInstanceOf(MissingAssetFieldError);
      expect(error.message).toBe('Asset of kind "nft" requires the field "tokenId"');
    });

    it('debería rechazar un nft con importe, que su clase prohíbe', () => {
      // Arrange
      const parts: TransferAssetParts = {
        kind: 'nft',
        tokenAddress: TOKEN,
        tokenId: TOKEN_ID,
        amount: AMOUNT,
      };

      // Act
      const error = captureError(() => TransferAsset.fromParts(parts));

      // Assert
      expect(error).toBeInstanceOf(AssetFieldNotAllowedError);
      expect(error.message).toBe('Asset of kind "nft" does not accept the field "amount"');
    });

    it('debería rechazar un envío nativo con dirección de token, que su clase prohíbe', () => {
      // Arrange
      const parts: TransferAssetParts = { kind: 'native', amount: AMOUNT, tokenAddress: TOKEN };

      // Act
      const error = captureError(() => TransferAsset.fromParts(parts));

      // Assert
      expect(error).toBeInstanceOf(AssetFieldNotAllowedError);
      expect(error.message).toBe('Asset of kind "native" does not accept the field "tokenAddress"');
    });

    it('debería rechazar un envío nativo sin importe', () => {
      // Arrange
      const parts: TransferAssetParts = { kind: 'native' };

      // Act
      const error = captureError(() => TransferAsset.fromParts(parts));

      // Assert
      expect(error).toBeInstanceOf(MissingAssetFieldError);
      expect(error.message).toBe('Asset of kind "native" requires the field "amount"');
    });

    // El orden está fijado a propósito: con un cuerpo que a la vez omite un campo obligatorio y
    // lleva uno prohibido, decirle al cliente «te sobra tokenId» le señala el error real —eligió
    // la clase equivocada—, mientras que «te falta amount» le manda a completar una forma que ya
    // estaba mal. Es una decisión, no una medición.
    it('debería denunciar antes el campo prohibido que el obligatorio cuando faltan los dos', () => {
      // Arrange
      const parts: TransferAssetParts = {
        kind: 'fungible',
        tokenAddress: TOKEN,
        tokenId: TOKEN_ID,
      };

      // Act
      const error = captureError(() => TransferAsset.fromParts(parts));

      // Assert
      expect(error).toBeInstanceOf(AssetFieldNotAllowedError);
      expect(error.message).toBe('Asset of kind "fungible" does not accept the field "tokenId"');
    });

    it('debería propagar el error del value object cuando el importe no es canónico', () => {
      // Arrange
      const parts: TransferAssetParts = { kind: 'native', amount: '01' };

      // Act
      const error = captureError(() => TransferAsset.fromParts(parts));

      // Assert
      expect(error).toBeInstanceOf(InvalidTokenAmountError);
      expect(error.message).toBe('"01" is not a valid token amount');
    });
  });

  describe('nominalidad', () => {
    // La puerta la cierra el COMPILADOR, no el runtime: `private` se borra al compilar, así que
    // `new` sí construye una instancia real. Lo que este caso fija es que las dos formas de
    // saltarse las factorías son rojas en `pnpm typecheck` — y la segunda es exactamente la que
    // una unión discriminada suelta dejaba pasar.
    it('debería impedir construir un activo sin pasar por una de las cuatro factorías', () => {
      // Arrange
      const amount = TokenAmount.from(AMOUNT);

      // Act
      // @ts-expect-error El constructor es privado y `TransferAssetState` no se exporta (TS2673).
      const built = new TransferAsset({ kind: 'native', amount });
      // @ts-expect-error El campo privado `state` hace la clase NOMINAL: un objeto con la misma
      // forma que la unión no es asignable (TS2739).
      const impostor: TransferAsset = { kind: 'native', amount };

      // Assert
      expect(built).toBeInstanceOf(TransferAsset);
      expect(impostor).not.toBeInstanceOf(TransferAsset);
    });

    // `ValueObject.equals` compara con `===`, que sobre un objeto es identidad de referencia, y
    // `toString()` daría `[object Object]`. Heredar obligaría a sobreescribir las dos únicas
    // cosas que la base aporta, así que no se hereda — y no se escribe `equals` en absoluto,
    // porque ningún caso de uso compara dos activos.
    it('debería no extender ValueObject ni exponer equals', () => {
      // Arrange
      const asset = TransferAsset.native({ amount: TokenAmount.from(AMOUNT) });

      // Act
      const equals = (asset as unknown as { equals?: unknown }).equals;

      // Assert
      expect(asset).not.toBeInstanceOf(ValueObject);
      expect(equals).toBeUndefined();
    });
  });

  describe('TransferAsset (property-based)', () => {
    it('debería caer siempre en la rama de su clase, sea cual sea la clase', () => {
      fc.assert(
        fc.property(fc.constantFrom(...ASSET_CASES), ([kind, expected]) => {
          // Act
          const described = describeAsset(TransferAsset.fromParts(validPartsFor(kind)));

          // Assert
          expect(described).toBe(expected);
        }),
      );
    });

    it('debería rechazar cualquier campo prohibido de cualquier clase, nombrándolo', () => {
      fc.assert(
        fc.property(fc.constantFrom(...FORBIDDEN_FIELDS), ([kind, field]) => {
          // Arrange
          const parts = withField(validPartsFor(kind), field, SAMPLE[field]);

          // Act
          const error = captureError(() => TransferAsset.fromParts(parts));

          // Assert
          expect(error).toBeInstanceOf(AssetFieldNotAllowedError);
          expect(error.message).toBe(
            `Asset of kind "${kind}" does not accept the field "${field}"`,
          );
        }),
      );
    });

    it('debería rechazar la omisión de cualquier campo obligatorio de cualquier clase', () => {
      fc.assert(
        fc.property(fc.constantFrom(...REQUIRED_FIELDS), ([kind, field]) => {
          // Arrange
          const parts = withoutField(validPartsFor(kind), field);

          // Act
          const error = captureError(() => TransferAsset.fromParts(parts));

          // Assert
          expect(error).toBeInstanceOf(MissingAssetFieldError);
          expect(error.message).toBe(`Asset of kind "${kind}" requires the field "${field}"`);
        }),
      );
    });
  });
});

// Helpers

type OptionalField = 'tokenAddress' | 'amount' | 'tokenId';

/** Un valor válido por campo, para que el error nunca venga del value object. */
const SAMPLE: Record<OptionalField, string> = {
  tokenAddress: TOKEN,
  amount: AMOUNT,
  tokenId: TOKEN_ID,
};

/** Las cuatro clases con la descripción que `match()` debe producir para sus partes válidas. */
const ASSET_CASES: ReadonlyArray<readonly [string, string]> = [
  ['fungible', `fungible:${TOKEN}:${AMOUNT}`],
  ['nft', `nft:${TOKEN}:${TOKEN_ID}`],
  ['multi-token', `multi-token:${TOKEN}:${AMOUNT}:${TOKEN_ID}`],
  ['native', `native:${AMOUNT}`],
];

/** La rejilla completa de campos PROHIBIDOS. `multi-token` no prohíbe ninguno. */
const FORBIDDEN_FIELDS: ReadonlyArray<readonly [string, OptionalField]> = [
  ['fungible', 'tokenId'],
  ['nft', 'amount'],
  ['native', 'tokenAddress'],
  ['native', 'tokenId'],
];

/** La rejilla completa de campos OBLIGATORIOS. */
const REQUIRED_FIELDS: ReadonlyArray<readonly [string, OptionalField]> = [
  ['fungible', 'tokenAddress'],
  ['fungible', 'amount'],
  ['nft', 'tokenAddress'],
  ['nft', 'tokenId'],
  ['multi-token', 'tokenAddress'],
  ['multi-token', 'amount'],
  ['multi-token', 'tokenId'],
  ['native', 'amount'],
];

/** Descripción textual por rama: el valor devuelto dice QUÉ rama corrió y con qué valores. */
const describeAsset = (asset: TransferAsset): string =>
  asset.match({
    native: (amount) => `native:${amount.value}`,
    fungible: (token, amount) => `fungible:${token.value}:${amount.value}`,
    nft: (token, tokenId) => `nft:${token.value}:${tokenId.value}`,
    multiToken: (token, amount, tokenId) =>
      `multi-token:${token.value}:${amount.value}:${tokenId.value}`,
  });

/** Las partes mínimas y válidas de cada clase. */
const validPartsFor = (kind: string): TransferAssetParts => {
  switch (kind) {
    case 'fungible':
      return { kind, tokenAddress: TOKEN, amount: AMOUNT };
    case 'nft':
      return { kind, tokenAddress: TOKEN, tokenId: TOKEN_ID };
    case 'multi-token':
      return { kind, tokenAddress: TOKEN, amount: AMOUNT, tokenId: TOKEN_ID };
    default:
      return { kind, amount: AMOUNT };
  }
};

const withField = (
  parts: TransferAssetParts,
  field: OptionalField,
  value: string,
): TransferAssetParts => {
  const copy = { ...parts };
  copy[field] = value;
  return copy;
};

const withoutField = (parts: TransferAssetParts, field: OptionalField): TransferAssetParts => {
  const copy = { ...parts };
  delete copy[field];
  return copy;
};

/** Ver `wallet-id.vo.spec.ts`: `toThrow` no compara el mensaje de forma exacta. */
const captureError = (act: () => unknown): Error => {
  try {
    act();
  } catch (error) {
    return error as Error;
  }
  throw new Error('se esperaba una excepción y no se lanzó ninguna');
};
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/modules/wallets/__tests__/domain/transfer-asset.spec.ts`
Expected: FAIL — `Cannot find module '../../domain/transfer-asset' from 'src/modules/wallets/__tests__/domain/transfer-asset.spec.ts'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/modules/wallets/domain/transfer-asset.ts
import {
  AssetFieldNotAllowedError,
  MissingAssetFieldError,
  UnknownAssetKindError,
} from './errors/wallet.errors';
import { EthereumAddress } from './value-objects/ethereum-address.vo';
import { TokenAmount } from './value-objects/token-amount.vo';
import { TokenId } from './value-objects/token-id.vo';

/**
 * Vocabulario cerrado de clases de activo. Vive aquí, junto a la clase que lo hace cumplir, y no
 * en un archivo aparte: el literal y las cuatro ramas de `match()` tienen que cambiar A LA VEZ.
 *
 * ⚠️ **`'multi-token'` va CON GUION**, y ese literal es el mismo en el dominio, en el mapper, en
 * los DTO de entrada y salida, en los ejemplos de OpenAPI y en la columna `asset_kind`. No existe
 * `'multitoken'`. La clave del matcher, en cambio, es `multiToken` en camelCase porque es un
 * identificador de TypeScript: son cosas distintas y las dos son correctas en su sitio.
 */
export const TRANSFER_ASSET_KINDS = ['native', 'fungible', 'nft', 'multi-token'] as const;
export type TransferAssetKind = (typeof TRANSFER_ASSET_KINDS)[number];

/**
 * El estado interno, con una variante por clase de activo. No se exporta: lo que sale de aquí es
 * la clase, no su forma.
 */
type TransferAssetState =
  | { kind: 'native'; amount: TokenAmount }
  | { kind: 'fungible'; token: EthereumAddress; amount: TokenAmount }
  | { kind: 'nft'; token: EthereumAddress; tokenId: TokenId }
  | { kind: 'multi-token'; token: EthereumAddress; amount: TokenAmount; tokenId: TokenId };

/**
 * Una función por rama, cada una recibiendo SOLO los valores que su clase tiene. El adaptador no
 * puede leer un `amount` en la rama del NFT porque esa rama no lo recibe, y una quinta clase
 * rompería la compilación de todos los `match()` del árbol — que es donde se quiere que rompa.
 */
export type TransferAssetMatchers<TResult> = {
  native: (amount: TokenAmount) => TResult;
  fungible: (token: EthereumAddress, amount: TokenAmount) => TResult;
  nft: (token: EthereumAddress, tokenId: TokenId) => TResult;
  multiToken: (token: EthereumAddress, amount: TokenAmount, tokenId: TokenId) => TResult;
};

/**
 * Las partes en crudo, tal como llegan del DTO. `kind` es `string` a propósito — ver `fromParts`.
 *
 * ⚠️ La dirección del contrato se llama **`tokenAddress`**, igual que la columna `token_address` y
 * que el campo del snapshot de `WalletTransfer`. Las factorías, que reciben value objects ya
 * construidos y no partes, la llaman `token`.
 */
export type TransferAssetParts = {
  kind: string;
  tokenAddress?: string;
  amount?: string;
  tokenId?: string;
};

/**
 * El activo a transferir. El proveedor exige exclusión mutua entre `tokenAddress`, `amount` y
 * `tokenId` según el `contractType`, y esta clase la hace **imposible de incumplir**.
 *
 * ⚠️ **Una unión discriminada suelta no basta, y es medible:** TypeScript es estructural y el
 * chequeo de propiedades sobrantes solo se aplica a literales *frescos*, así que con una variable
 * intermedia —`const x = { kind: 'native', amount, tokenId }; const a: TransferAsset = x;`— la
 * combinación ilegal COMPILA. El campo privado `state` es lo que hace la clase nominal y cierra
 * esa puerta; el caso F20 lo fija con `@ts-expect-error`.
 *
 * ⚠️ **No extiende `ValueObject`, y por eso vive suelta en `domain/` y no en `value-objects/`.**
 * `ValueObject.equals` compara con `===`, que sobre un objeto es identidad de referencia, y
 * `toString()` daría `[object Object]`: heredar obligaría a sobreescribir las dos únicas cosas que
 * la base aporta. La salida es **no escribir `equals` en absoluto**, porque ningún caso de uso
 * compara dos activos.
 *
 * **El dominio no conoce los números `0`, `1`, `2` y `3`.** Son el `contractType` del contrato del
 * proveedor, no un concepto del negocio: la traducción vive en cuatro líneas del adaptador, una
 * por rama de `match()`.
 */
export class TransferAsset {
  private constructor(private readonly state: TransferAssetState) {}

  static native(parts: { amount: TokenAmount }): TransferAsset {
    return new TransferAsset({ kind: 'native', amount: parts.amount });
  }

  static fungible(parts: { token: EthereumAddress; amount: TokenAmount }): TransferAsset {
    return new TransferAsset({ kind: 'fungible', token: parts.token, amount: parts.amount });
  }

  static nft(parts: { token: EthereumAddress; tokenId: TokenId }): TransferAsset {
    return new TransferAsset({ kind: 'nft', token: parts.token, tokenId: parts.tokenId });
  }

  static multiToken(parts: {
    token: EthereumAddress;
    amount: TokenAmount;
    tokenId: TokenId;
  }): TransferAsset {
    return new TransferAsset({
      kind: 'multi-token',
      token: parts.token,
      amount: parts.amount,
      tokenId: parts.tokenId,
    });
  }

  /**
   * ⚠️ Acepta la clase como `string`, **no** como el union estrecho, y esa es la lección medida
   * con `invalid-profile`: hay entradas que pasan el DTO y mueren en el dominio. Con el tipo
   * estrecho, una clase desconocida caería por un `switch` sin `default` devolviendo `undefined`
   * — un 500 donde tocaba un 400.
   *
   * El campo PROHIBIDO se comprueba antes que el obligatorio: con un cuerpo que a la vez omite un
   * campo y lleva uno de más, «te sobra tokenId» señala el error real —el cliente eligió la clase
   * equivocada— mientras que «te falta amount» le manda a completar una forma que ya estaba mal.
   * Es una decisión, no una medición, y el caso F18 la fija para que no cambie por accidente.
   */
  static fromParts(parts: TransferAssetParts): TransferAsset {
    switch (parts.kind) {
      case 'native':
        TransferAsset.forbiddenField(parts.kind, 'tokenAddress', parts.tokenAddress);
        TransferAsset.forbiddenField(parts.kind, 'tokenId', parts.tokenId);
        return TransferAsset.native({
          amount: TokenAmount.from(TransferAsset.requiredField(parts.kind, 'amount', parts.amount)),
        });
      case 'fungible':
        TransferAsset.forbiddenField(parts.kind, 'tokenId', parts.tokenId);
        return TransferAsset.fungible({
          token: EthereumAddress.from(
            TransferAsset.requiredField(parts.kind, 'tokenAddress', parts.tokenAddress),
          ),
          amount: TokenAmount.from(TransferAsset.requiredField(parts.kind, 'amount', parts.amount)),
        });
      case 'nft':
        TransferAsset.forbiddenField(parts.kind, 'amount', parts.amount);
        return TransferAsset.nft({
          token: EthereumAddress.from(
            TransferAsset.requiredField(parts.kind, 'tokenAddress', parts.tokenAddress),
          ),
          tokenId: TokenId.from(TransferAsset.requiredField(parts.kind, 'tokenId', parts.tokenId)),
        });
      case 'multi-token':
        return TransferAsset.multiToken({
          token: EthereumAddress.from(
            TransferAsset.requiredField(parts.kind, 'tokenAddress', parts.tokenAddress),
          ),
          amount: TokenAmount.from(TransferAsset.requiredField(parts.kind, 'amount', parts.amount)),
          tokenId: TokenId.from(TransferAsset.requiredField(parts.kind, 'tokenId', parts.tokenId)),
        });
      default:
        throw new UnknownAssetKindError(parts.kind);
    }
  }

  /** Lo que el mapper escribe en `asset_kind` y el DTO publica, sin obligar a hacer un `match()`. */
  get kind(): TransferAssetKind {
    return this.state.kind;
  }

  /**
   * Entrega los valores ya estrechados por rama. Sin `default` a propósito: el `switch` es
   * exhaustivo sobre la unión, así que añadir una quinta clase deja el final de la función
   * alcanzable y `noImplicitReturns` la pone roja.
   */
  match<TResult>(matchers: TransferAssetMatchers<TResult>): TResult {
    const state = this.state;
    switch (state.kind) {
      case 'native':
        return matchers.native(state.amount);
      case 'fungible':
        return matchers.fungible(state.token, state.amount);
      case 'nft':
        return matchers.nft(state.token, state.tokenId);
      case 'multi-token':
        return matchers.multiToken(state.token, state.amount, state.tokenId);
    }
  }

  /**
   * ⚠️ Los parámetros de este helper van (clase, campo) y los del error van **(campo, clase)**.
   * La inversión es deliberada en el error —ver su JSDoc— y aquí es el único sitio del árbol que
   * lo construye, así que es el único sitio donde puede invertirse por accidente. Los dos son
   * `string`: el compilador no dice nada, y el caso E8 sí.
   */
  private static requiredField(kind: string, field: string, value: string | undefined): string {
    if (value === undefined) {
      throw new MissingAssetFieldError(field, kind);
    }
    return value;
  }

  /** Mismo cruce de orden que `requiredField`, y por la misma razón. */
  private static forbiddenField(kind: string, field: string, value: string | undefined): void {
    if (value !== undefined) {
      throw new AssetFieldNotAllowedError(field, kind);
    }
  }
}
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/modules/wallets/__tests__/domain/transfer-asset.spec.ts`
Expected: PASS — 26 passed

- [ ] **Step 5: Publica `transferAssetArb` en el catálogo de arbitrarios del módulo**

El archivo lo creó la Task 1 con los arbitrarios que solo producen cadenas y números. Éste es el
primero que necesita construir value objects, y por eso llega **aquí** y no antes: `arbitraries.ts`
lo importa `wallet.errors.spec.ts` desde la Task 1, así que un `import` de
`../../domain/transfer-asset` escrito antes de este paso dejaba esa suite sin arrancar con
`Cannot find module`.

Lo consume la **Task 22** (`tatum-asset.mapper.spec.ts`, propiedades P1 y P2) y nadie más. Tiene
que vivir en este archivo y no bajo el `// Helpers` del spec: `it.prop([...])` se evalúa al cargar
el `describe`, así que un `const` declarado al final del spec cae en su zona muerta temporal y
tumba la suite entera antes de ejecutar un solo caso.

⚠️ **No gana fila en la Tabla F.** Los arbitrarios son andamio de pruebas y quedan exentos de la
tabla por la regla ya escrita; éste se ejercita entero en las dos propiedades de la Task 22, que sí
tienen las suyas.

```ts
// src/modules/wallets/__tests__/helpers/arbitraries.ts
// ⚠️ Los cuatro `import` van ARRIBA, junto a los que el archivo ya tiene; lo demás se AÑADE al
// final. Ningún arbitrario existente se toca.
import { TransferAsset, type TransferAssetKind } from '../../domain/transfer-asset';
import { EthereumAddress } from '../../domain/value-objects/ethereum-address.vo';
import { TokenAmount } from '../../domain/value-objects/token-amount.vo';
import { TokenId } from '../../domain/value-objects/token-id.vo';

/**
 * Un activo de una de las cuatro clases, con el rastro de cómo se construyó: la clase con la que se
 * pidió —el literal del vocabulario, o sea `'multi-token'` CON GUION— y los valores que lleva
 * dentro, en el orden en que los recibe su factoría.
 *
 * `values` existe para que la propiedad P2 de la Task 22 compare lo que el mapper copió contra lo
 * que el activo lleva dentro **sin volver a leerlo del propio activo**: leerlo de ahí sería
 * reimplementar el mapper dentro de su test, y un mapper que reformatease un valor seguiría verde.
 *
 * ⚠️ Los valores salen de `.value` del value object ya construido, **nunca de la cadena cruda que
 * generó el arbitrario**. `EthereumAddress.from()` normaliza a minúsculas (caso A2 de la Task 3),
 * así que con la cadena cruda la propiedad se pondría roja en cuanto el generador sacase una
 * mayúscula, culpando al mapper de una normalización que hizo el dominio.
 */
export type TransferAssetSample = {
  asset: TransferAsset;
  kind: TransferAssetKind;
  values: readonly string[];
};

const nativeAssetArb: fc.Arbitrary<TransferAssetSample> = tokenAmountArb.map((rawAmount) => {
  const amount = TokenAmount.from(rawAmount);
  return { asset: TransferAsset.native({ amount }), kind: 'native', values: [amount.value] };
});

const fungibleAssetArb: fc.Arbitrary<TransferAssetSample> = fc
  .tuple(ethereumAddressArb, tokenAmountArb)
  .map(([rawToken, rawAmount]) => {
    const token = EthereumAddress.from(rawToken);
    const amount = TokenAmount.from(rawAmount);
    return {
      asset: TransferAsset.fungible({ token, amount }),
      kind: 'fungible',
      values: [token.value, amount.value],
    };
  });

const nftAssetArb: fc.Arbitrary<TransferAssetSample> = fc
  .tuple(ethereumAddressArb, tokenIdArb)
  .map(([rawToken, rawTokenId]) => {
    const token = EthereumAddress.from(rawToken);
    const tokenId = TokenId.from(rawTokenId);
    return {
      asset: TransferAsset.nft({ token, tokenId }),
      kind: 'nft',
      values: [token.value, tokenId.value],
    };
  });

const multiTokenAssetArb: fc.Arbitrary<TransferAssetSample> = fc
  .tuple(ethereumAddressArb, tokenAmountArb, tokenIdArb)
  .map(([rawToken, rawAmount, rawTokenId]) => {
    const token = EthereumAddress.from(rawToken);
    const amount = TokenAmount.from(rawAmount);
    const tokenId = TokenId.from(rawTokenId);
    return {
      asset: TransferAsset.multiToken({ token, amount, tokenId }),
      kind: 'multi-token',
      values: [token.value, amount.value, tokenId.value],
    };
  });

/**
 * Las cuatro clases, cada una construida por su factoría y compuesta a partir de los arbitrarios de
 * dirección, importe e id que ya viven arriba en este mismo archivo. Reutilizarlos es lo que hace
 * que endurecer un value object llegue solo a estas propiedades: un `TokenAmount` más estricto
 * cambia `tokenAmountArb` y con él las cuatro ramas, sin tocar nada más.
 *
 * ⚠️ Todo está **construido**, nunca filtrado de `fc.string()`, igual que el resto del archivo.
 * `fc.hexaString()` tampoco es una salida: **no existe en `fast-check@4.9.0`** —medido con
 * `node -e "const fc=require('fast-check'); console.log(typeof fc.hexaString)"` → `undefined`—, y
 * por eso el hexadecimal lo pone `hexArb`, que compone `fc.constantFrom` sobre el alfabeto.
 */
export const transferAssetArb: fc.Arbitrary<TransferAssetSample> = fc.oneof(
  nativeAssetArb,
  fungibleAssetArb,
  nftAssetArb,
  multiTokenAssetArb,
);
```

- [ ] **Step 6: Comprueba que el arbitrario nuevo compila y no rompe lo ya verde**

Run: `pnpm typecheck && pnpm test src/modules/wallets/__tests__`
Expected: PASS — `typecheck` sin salida de error y la suite del módulo igual que en el Step 4 (26
casos en `transfer-asset.spec.ts`, ninguno nuevo). `transferAssetArb` no tiene suite propia porque
es andamio; quien lo ejercita es la Task 22.

---

### Task 9: Los dos vocabularios de estado, sueltos en `domain/`

**Layer:** domain
**Rule codes to honor:** `arch-feature-modules`, `arch-single-responsibility`

Dos uniones cerradas con su constante `as const`, mismo criterio que `users/domain/user-role.ts`:
no extienden `ValueObject`, no validan nada y se comparan con `===`, así que **van sueltas en
`domain/` y NO en `domain/value-objects/`** — esa carpeta contiene solo lo que extiende
`ValueObject`, regla escrita tras mover `user-role.ts` el 2026-08-25.

⚠️ **El orden de `WALLET_STATUSES` es load-bearing y el de `TRANSFER_STATUSES` no.** El primero es
el orden monótono de la máquina de estados de §3.1: la propiedad P1 de la Task 10 usa el índice en
ese array como rango. Reordenarlo dejaría pasar un `active → receive-only` con la suite en verde.
El segundo no tiene rango: `submitting` es el único estado inicial y los otros tres son terminales
y excluyentes.

**Casos acordados**

| #   | Caso (se vuelve el `it`)                                                     | Entrada / estado inicial | Resultado esperado                                   |
| --- | ---------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------- |
| A1  | debería declarar exactamente receive-only, activating y active, en ese orden | `WALLET_STATUSES`        | `['receive-only', 'activating', 'active']`           |
| A2  | debería declarar exactamente submitting, submitted, rejected y unknown       | `TRANSFER_STATUSES`      | `['submitting', 'submitted', 'rejected', 'unknown']` |

**Files:**

- Create: `src/modules/wallets/domain/wallet-status.ts`
- Create: `src/modules/wallets/domain/transfer-status.ts`
- Test: `src/modules/wallets/__tests__/domain/wallet-status.spec.ts`
- Test: `src/modules/wallets/__tests__/domain/transfer-status.spec.ts`

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/modules/wallets/__tests__/domain/wallet-status.spec.ts
import { WALLET_STATUSES } from '../../domain/wallet-status';

describe('WALLET_STATUSES', () => {
  it('debería declarar exactamente receive-only, activating y active, en ese orden', () => {
    // Arrange: el orden ES el de la máquina de estados de §3.1, de menos a más capacidad.
    // La propiedad de monotonía de `wallet.entity.spec.ts` usa el índice de este array como
    // rango, así que reordenarlo la deja verde afirmando algo falso. Este caso lo pone rojo
    // aquí primero, que es donde se entiende el motivo.
    const expected = ['receive-only', 'activating', 'active'];

    // Act
    const declared = [...WALLET_STATUSES];

    // Assert
    expect(declared).toEqual(expected);
  });
});
```

```ts
// src/modules/wallets/__tests__/domain/transfer-status.spec.ts
import { TRANSFER_STATUSES } from '../../domain/transfer-status';

describe('TRANSFER_STATUSES', () => {
  it('debería declarar exactamente submitting, submitted, rejected y unknown', () => {
    // Arrange: aquí el orden NO significa nada — `submitting` es el único estado inicial y los
    // otros tres son terminales y excluyentes entre sí. El caso fija el CONJUNTO; que además
    // compare la secuencia es un efecto de `toEqual`, no una afirmación sobre un rango.
    const expected = ['submitting', 'submitted', 'rejected', 'unknown'];

    // Act
    const declared = [...TRANSFER_STATUSES];

    // Assert
    expect(declared).toEqual(expected);
  });
});
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/modules/wallets/__tests__/domain/wallet-status.spec.ts src/modules/wallets/__tests__/domain/transfer-status.spec.ts`
Expected: FAIL — `Cannot find module '../../domain/wallet-status' from 'src/modules/wallets/__tests__/domain/wallet-status.spec.ts'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/modules/wallets/domain/wallet-status.ts
/**
 * Union y no enum: convención del repo (`type`, nunca `interface`). Vive SUELTO en `domain/` y no
 * en `value-objects/`, mismo criterio que `users/domain/user-role.ts` — no extiende `ValueObject`,
 * no tiene factoría, no valida nada y no encapsula ninguna invariante.
 *
 * Los nombres son la CAPACIDAD, no el vocabulario del proveedor: `receive-only` es «puede recibir
 * pero todavía no enviar». Y **no existe `activation-failed`**: con la reconciliación perezosa de
 * §5.4 un `activated:false` es indistinguible de «todavía no», así que ese estado sería
 * inalcanzable — y este repo borra el dominio inalcanzable (mismo motivo por el que no existe
 * `WalletAlreadyAssignedError`).
 *
 * ⚠️ **El ORDEN de este array es el orden monótono de la máquina de estados, no alfabético ni
 * casual.** `Wallet` nunca retrocede (§3.1) y la propiedad P1 de `wallet.entity.spec.ts` usa el
 * índice aquí como rango para comprobarlo. Reordenarlo NO es cosmético: dejaría pasar un
 * `active → receive-only` con la suite entera en verde, porque el rango se calcularía sobre el
 * orden nuevo. Lo fija el caso A1 de `wallet-status.spec.ts`, que compara la secuencia exacta.
 */
export const WALLET_STATUSES = ['receive-only', 'activating', 'active'] as const;
export type WalletStatus = (typeof WALLET_STATUSES)[number];
```

```ts
// src/modules/wallets/domain/transfer-status.ts
/**
 * Los cuatro estados del libro de transferencias (§3.2). Union suelto en `domain/`, mismo criterio
 * que `wallet-status.ts`.
 *
 * ⚠️ **A diferencia de `WALLET_STATUSES`, este orden NO significa nada.** `submitting` es el único
 * estado inicial y los otros tres son terminales y excluyentes entre sí, así que no hay rango ni
 * monotonía que comprobar: una propiedad que la afirmara estaría afirmando algo falso.
 *
 * Qué distingue a los tres terminales, porque confundirlos hace que la fila mienta:
 *   - `rejected` es SOLO el 400 de validación del cuerpo. Significa que **no pasó nada en la
 *     cadena**. Un 401 o un 403 no son un rechazo del envío —nadie rechazó nada, la petición ni
 *     siquiera se procesó como transferencia— y van a `unknown`.
 *   - `unknown` es la respuesta honesta a un timeout, una red caída o un 5xx: **pudo minarse o
 *     no**. No se inventa un `rejected`, que afirmaría algo falso, ni un `submitted` sin `txId`.
 *     A diferencia de `activation-failed`, este estado se alcanza cada vez que expira el timeout,
 *     así que el dominio lo modela.
 *   - `submitting` es la escritura POR DELANTE de la llamada. Regla escrita en §3.2: una fila que
 *     sobrevive en `submitting` a su petición **se lee como `unknown`**. Esa lectura es del
 *     consumidor, no de la entidad: aquí `submitting` significa solo «escrita, aún sin respuesta».
 */
export const TRANSFER_STATUSES = ['submitting', 'submitted', 'rejected', 'unknown'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/modules/wallets/__tests__/domain/wallet-status.spec.ts src/modules/wallets/__tests__/domain/transfer-status.spec.ts`
Expected: PASS — 2 passed (2 suites)

---

### Task 10: `Wallet extends Entity<WalletId>` — la máquina de estados completa

**Layer:** domain
**Rule codes to honor:** `arch-feature-modules`, `arch-single-responsibility`, `arch-avoid-circular-deps`

El agregado de §3.1. **`Entity` y no `AggregateRoot`**: `docs/module-blueprint.md` marca eventos y
outbox como opcionales —«solo si algo fuera del agregado debe reaccionar»— y en este ciclo nadie
reacciona; el auditor de mutación castiga el código sin consumidor. Tampoco `SoftDeletableEntity`:
una gas pump address no se des-asigna, porque puede tener fondos.

Cuatro decisiones de esta tarea que no son obvias:

- **`assertOwnedBy` compara VALUE OBJECTS**, no strings, así que acepta una master construida en
  otra caja siempre que valga lo mismo. Es lo que hace que el caso de uso pueda pasarle el
  `EthereumAddress` que le devuelve el gateway sin coordinar instancias (A14). Cuando no coincide
  lanza `WalletOwnerMismatchError(this.ownerAddress.value, master.value)` — **dos argumentos**: la
  master bajo la que se derivó la fila y la que hay configurada ahora. Con uno solo, el operador
  vería «no coinciden» sin poder saber cuál de las dos rotó.
- **`assertCanSend` lanza `WalletNotActivatedError(this.status)`** tanto desde `receive-only` como
  desde `activating`, y el argumento es el ESTADO, no el id de la wallet: el cliente ya sabe de qué
  wallet habla —los cinco endpoints son «lo mío»— y lo que no sabe es en qué punto está.
  `WalletActivationInProgressError` es del camino de ACTIVAR —una segunda petición de activación—,
  no del de enviar: darle dos productores lo dejaría publicado en dos endpoints distintos con
  significados distintos.
- **`WalletActivationInProgressError` y `WalletAlreadyActivatedError` se construyen SIN argumentos.**
  Son 409 sobre «lo mío»: no hay nada que nombrar que el llamante no tenga ya. Las aserciones de
  A5 y A6 comprueban el tipo y que el estado guardado no se movió, que es lo que de verdad se puede
  romper.
- **`rehydrate` NO re-aplica la invariante de la master.** La tabla de §3.1.1 enumera cuatro
  controles y la reconstitución no es ninguno: el de la fila leída es el `CHECK ("address" <>
"owner_address")` del esquema, que además ve las escrituras por SQL crudo que el dominio nunca
  vería. Es el mismo criterio con el que `User.rehydrate` no re-valida el nombre.

**Casos acordados**

| #   | Caso (se vuelve el `it`)                                                                                 | Entrada / estado inicial                                                                                                                | Resultado esperado                                                                  |
| --- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| A1  | debería nacer en receive-only, sin txId de activación y con las dos marcas selladas en el mismo instante | `assign()` con `now`                                                                                                                    | `status: 'receive-only'`, `activationTxId: null`, `createdAt` = `updatedAt` = `now` |
| A2  | debería registrar el actor recibido en createdBy y updatedBy sin derivarlo del dueño                     | `assign()` con `createdBy` ≠ `ownerId`                                                                                                  | `createdBy` = `updatedBy` = actor; `ownerId` intacto                                |
| A3  | debería lanzar WalletAddressIsMasterError con la dirección cuando la derivada es la propia master        | `assign()` con `address` = `ownerAddress`                                                                                               | lanza; `error.address` es la dirección repetida                                     |
| A4  | debería pasar de receive-only a activating guardando el txId y moviendo la traza                         | wallet recién asignada + `markActivationRequested(tx)`                                                                                  | `status: 'activating'`, `activationTxId` = tx, `updatedAt`/`updatedBy` nuevos       |
| A5  | debería lanzar WalletActivationInProgressError al pedir la activación de una wallet en activating        | wallet en `activating` + `markActivationRequested(tx2)`                                                                                 | lanza; el txId guardado sigue siendo el primero                                     |
| A6  | debería lanzar WalletAlreadyActivatedError al pedir la activación de una wallet ya activa                | wallet en `active` + `markActivationRequested(tx2)`                                                                                     | lanza; `status` y `activationTxId` sin cambios                                      |
| A7  | debería pasar de activating a active conservando el txId de la activación                                | wallet en `activating` + `confirmActivated()`                                                                                           | `status: 'active'`, `activationTxId` sin cambios                                    |
| A8  | debería pasar de receive-only a active sin txId cuando la cadena ya lo confirma                          | wallet en `receive-only` + `confirmActivated()`                                                                                         | `status: 'active'`, `activationTxId: null` (curación de §3.1)                       |
| A9  | debería ser no-op y NO mover la traza al confirmar una wallet ya activa                                  | wallet en `active` + `confirmActivated()` con otro actor                                                                                | `updatedAt` y `updatedBy` idénticos a antes                                         |
| A10 | debería exponer canSend en true solo cuando la wallet está activa                                        | las tres wallets, una por estado                                                                                                        | `[false, false, true]` para receive-only, activating y active                       |
| A11 | debería no lanzar en assertCanSend cuando la wallet está activa                                          | wallet en `active`                                                                                                                      | no lanza                                                                            |
| A12 | debería lanzar WalletNotActivatedError con el estado receive-only en assertCanSend                       | wallet en `receive-only`                                                                                                                | lanza; `error.status` es `'receive-only'`                                           |
| A13 | debería lanzar WalletNotActivatedError con el estado activating en assertCanSend                         | wallet en `activating`                                                                                                                  | lanza; `error.status` es `'activating'`                                             |
| A14 | debería aceptar en assertOwnedBy una master equivalente construida en otra instancia                     | `assertOwnedBy(EthereumAddress.from(<misma master>))`                                                                                   | no lanza — compara valor, no identidad                                              |
| A15 | debería lanzar WalletOwnerMismatchError con las dos direcciones cuando la master no coincide             | `assertOwnedBy(<otra EOA>)`                                                                                                             | lanza; `walletOwnerAddress` es la de la fila y `configuredMaster` la recibida       |
| A16 | debería reconstituir el estado y el txId guardados                                                       | `rehydrate()` en `activating` con txId                                                                                                  | `status` y `activationTxId` los de la fila                                          |
| A17 | debería conservar por separado las dos marcas y los dos actores al reconstituir                          | `rehydrate()` con 2 fechas y 2 actores distintos                                                                                        | los cuatro valores intactos, sin colapsar                                           |
| A18 | debería exponer estado, índice, direcciones y txId en el snapshot                                        | wallet en `activating`                                                                                                                  | `toSnapshot()` igual al objeto completo esperado                                    |
| P1  | debería no retroceder nunca de estado, aplique la secuencia de transiciones que se aplique _(propiedad)_ | arbitrario: array no vacío de `'request' \| 'confirm'` aplicados sobre una wallet recién asignada, tragándose las transiciones ilegales | la serie de rangos (índice en `WALLET_STATUSES`) es no decreciente                  |

**Files:**

- Create: `src/modules/wallets/domain/entities/wallet.entity.ts`
- Test: `src/modules/wallets/__tests__/domain/entities/wallet.entity.spec.ts`

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/modules/wallets/__tests__/domain/entities/wallet.entity.spec.ts
import { fc, test as fcTest } from '@fast-check/jest';

import { AddressIndex } from '../../../domain/value-objects/address-index.vo';
import { EthereumAddress } from '../../../domain/value-objects/ethereum-address.vo';
import { TransactionHash } from '../../../domain/value-objects/transaction-hash.vo';
import { Wallet } from '../../../domain/entities/wallet.entity';
import { WalletId } from '../../../domain/value-objects/wallet-id.vo';
import { WALLET_STATUSES, type WalletStatus } from '../../../domain/wallet-status';
import {
  WalletActivationInProgressError,
  WalletAddressIsMasterError,
  WalletAlreadyActivatedError,
  WalletNotActivatedError,
  WalletOwnerMismatchError,
} from '../../../domain/errors/wallet.errors';

const WALLET_ID = WalletId.from('7c9e6679-7425-40de-944b-e07fc1f90ae7');
const OWNER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
/**
 * Actor DISTINTO del dueño a propósito, aunque hoy `AssignWalletUseCase` pase el mismo `sub` a
 * los dos: es lo único que demuestra que el agregado guarda ambos campos por separado en lugar
 * de derivar `createdBy` de `ownerId`. Mismo argumento que en `order.entity.spec.ts`.
 */
const ACTOR_ID = '5b7c2d4e-9a1f-4c3b-8e6d-0f2a4b6c8d1e';
const OTHER_ACTOR_ID = '3f1a9b2c-8d4e-4f6a-9b1c-2e5d7a0f3b48';

const MASTER = EthereumAddress.from('0x4f3edf983ac636a65a842ce7c78d9aa706d3b113');
const ROTATED_MASTER = EthereumAddress.from('0x627306090abab3a6e1400e9345bc60c78a8bef57');
const DERIVED = EthereumAddress.from('0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3');
const INDEX = AddressIndex.from(7);

const TX_ID = TransactionHash.from(
  '0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060',
);
const OTHER_TX_ID = TransactionHash.from(
  '0x88df016429689c079f3b2f6ad39fa052532c56795b733da78a91ebe6a713944b',
);

const NOW = new Date('2026-08-27T09:00:00.000Z');
const LATER = new Date('2026-08-27T10:30:00.000Z');
const MUCH_LATER = new Date('2026-08-27T12:45:00.000Z');

describe('Wallet', () => {
  describe('assign()', () => {
    it('debería nacer en receive-only, sin txId de activación y con las dos marcas selladas en el mismo instante', () => {
      // Arrange
      const now = NOW;

      // Act
      const wallet = buildAssignedWallet();

      // Assert — `toEqual` y no `toBe` sobre las fechas: los getters de `Entity` devuelven copias.
      expect(wallet.status).toBe('receive-only');
      expect(wallet.activationTxId).toBeNull();
      expect(wallet.createdAt).toEqual(now);
      expect(wallet.updatedAt).toEqual(now);
    });

    it('debería registrar el actor recibido en createdBy y updatedBy sin derivarlo del dueño', () => {
      // Arrange
      const wallet = buildAssignedWallet();

      // Act
      const actors = { createdBy: wallet.createdBy, updatedBy: wallet.updatedBy };

      // Assert — con ACTOR_ID ≠ OWNER_ID, una implementación que escribiera `params.ownerId`
      // en la traza cae aquí.
      expect(actors).toEqual({ createdBy: ACTOR_ID, updatedBy: ACTOR_ID });
      expect(wallet.ownerId).toBe(OWNER_ID);
    });

    it('debería lanzar WalletAddressIsMasterError con la dirección cuando la derivada es la propia master', () => {
      // Arrange: el fallo que este caso cierra es catastrófico y silencioso — ese usuario
      // «tendría» el fondo de gas de la plataforma, y el siguiente también (§3.1.1).
      const act = (): Wallet =>
        Wallet.assign({
          id: WALLET_ID,
          ownerId: OWNER_ID,
          ownerAddress: MASTER,
          addressIndex: INDEX,
          address: EthereumAddress.from(MASTER.value),
          now: NOW,
          createdBy: ACTOR_ID,
        });

      // Act
      const error = catchError(act);

      // Assert — el error lleva la dirección repetida, que es el único dato que el operador
      // necesita para saber qué acuñó el adaptador.
      expect(error).toBeInstanceOf(WalletAddressIsMasterError);
      expect((error as WalletAddressIsMasterError).address).toBe(MASTER.value);
    });
  });

  describe('markActivationRequested()', () => {
    it('debería pasar de receive-only a activating guardando el txId y moviendo la traza', () => {
      // Arrange
      const wallet = buildAssignedWallet();

      // Act
      wallet.markActivationRequested(TX_ID, LATER, OTHER_ACTOR_ID);

      // Assert
      expect(wallet.status).toBe('activating');
      expect(wallet.activationTxId).toBe(TX_ID);
      expect(wallet.updatedAt).toEqual(LATER);
      expect(wallet.updatedBy).toBe(OTHER_ACTOR_ID);
    });

    it('debería lanzar WalletActivationInProgressError al pedir la activación de una wallet en activating', () => {
      // Arrange: una segunda petición trae un txId NUEVO. Tragársela dejaría guardado el
      // primero mientras el sistema cree haber registrado el segundo (§3.1).
      const wallet = buildActivatingWallet();

      // Act
      const error = catchError(() =>
        wallet.markActivationRequested(OTHER_TX_ID, MUCH_LATER, ACTOR_ID),
      );

      // Assert — el error no lleva argumentos: lo que hay que comprobar es que el estado
      // guardado no se movió.
      expect(error).toBeInstanceOf(WalletActivationInProgressError);
      expect(wallet.activationTxId).toBe(TX_ID);
    });

    it('debería lanzar WalletAlreadyActivatedError al pedir la activación de una wallet ya activa', () => {
      // Arrange: volver a activar NO falla de forma visible en el proveedor —la operación 02
      // responde 200 y el gas se quema—, así que el corte tiene que estar aquí (§3.1).
      const wallet = buildActiveWallet();

      // Act
      const error = catchError(() =>
        wallet.markActivationRequested(OTHER_TX_ID, MUCH_LATER, ACTOR_ID),
      );

      // Assert
      expect(error).toBeInstanceOf(WalletAlreadyActivatedError);
      expect(wallet.status).toBe('active');
      expect(wallet.activationTxId).toBe(TX_ID);
    });
  });

  describe('confirmActivated()', () => {
    it('debería pasar de activating a active conservando el txId de la activación', () => {
      // Arrange
      const wallet = buildActivatingWallet();

      // Act
      wallet.confirmActivated(MUCH_LATER, ACTOR_ID);

      // Assert
      expect(wallet.status).toBe('active');
      expect(wallet.activationTxId).toBe(TX_ID);
    });

    it('debería pasar de receive-only a active sin txId cuando la cadena ya lo confirma', () => {
      // Arrange: curación del fallo parcial de la activación —el proveedor aceptó la
      // transacción y perdimos su respuesta—. Sin esta transición la wallet queda colgada
      // para siempre y el intento siguiente VOLVERÍA a activar (§3.1).
      const wallet = buildAssignedWallet();

      // Act
      wallet.confirmActivated(LATER, ACTOR_ID);

      // Assert
      expect(wallet.status).toBe('active');
      expect(wallet.activationTxId).toBeNull();
    });

    it('debería ser no-op y NO mover la traza al confirmar una wallet ya activa', () => {
      // Arrange: mismo criterio que `User.promoteToAdmin` — repetir la confirmación no debe
      // reescribir `updatedBy`, o la traza acabaría nombrando a quien no activó nada.
      const wallet = buildActiveWallet();
      const before = { updatedAt: wallet.updatedAt, updatedBy: wallet.updatedBy };

      // Act
      wallet.confirmActivated(MUCH_LATER, OTHER_ACTOR_ID);

      // Assert
      expect(wallet.updatedAt).toEqual(before.updatedAt);
      expect(wallet.updatedBy).toBe(before.updatedBy);
    });
  });

  describe('canSend', () => {
    it('debería exponer canSend en true solo cuando la wallet está activa', () => {
      // Arrange: el getter es lo que publica el DTO de lectura; `assertCanSend()` es lo que
      // corta la transferencia. Los dos leen el mismo estado y por eso no pueden divergir.
      const wallets = [buildAssignedWallet(), buildActivatingWallet(), buildActiveWallet()];

      // Act
      const flags = wallets.map((wallet) => wallet.canSend);

      // Assert
      expect(flags).toEqual([false, false, true]);
    });
  });

  describe('assertCanSend()', () => {
    it('debería no lanzar en assertCanSend cuando la wallet está activa', () => {
      // Arrange
      const wallet = buildActiveWallet();

      // Act
      const error = catchError(() => wallet.assertCanSend());

      // Assert
      expect(error).toBeUndefined();
    });

    it('debería lanzar WalletNotActivatedError con el estado receive-only en assertCanSend', () => {
      // Arrange
      const wallet = buildAssignedWallet();

      // Act
      const error = catchError(() => wallet.assertCanSend());

      // Assert — el error lleva el ESTADO, no el id: el cliente ya sabe de qué wallet habla
      // —los cinco endpoints son «lo mío»— y lo que no sabe es en qué punto está.
      expect(error).toBeInstanceOf(WalletNotActivatedError);
      expect((error as WalletNotActivatedError).status).toBe('receive-only');
    });

    it('debería lanzar WalletNotActivatedError con el estado activating en assertCanSend', () => {
      // Arrange: `WalletActivationInProgressError` es del camino de ACTIVAR, no del de enviar.
      // Aquí el cliente pregunta «¿puedo enviar?» y la respuesta es «todavía no».
      const wallet = buildActivatingWallet();

      // Act
      const error = catchError(() => wallet.assertCanSend());

      // Assert
      expect(error).toBeInstanceOf(WalletNotActivatedError);
      expect((error as WalletNotActivatedError).status).toBe('activating');
    });
  });

  describe('assertOwnedBy()', () => {
    it('debería aceptar en assertOwnedBy una master equivalente construida en otra instancia', () => {
      // Arrange: el caso de uso pasa el `EthereumAddress` que le devuelve el gateway, que NO es
      // la instancia con la que se asignó la wallet. Compara VALOR, no identidad.
      const wallet = buildAssignedWallet();
      const sameMasterFromElsewhere = EthereumAddress.from(MASTER.value);

      // Act
      const error = catchError(() => wallet.assertOwnedBy(sameMasterFromElsewhere));

      // Assert
      expect(error).toBeUndefined();
    });

    it('debería lanzar WalletOwnerMismatchError con las dos direcciones cuando la master no coincide', () => {
      // Arrange: una rotación de la master cambia la dirección de cada índice; sin esta
      // comprobación el sistema seguiría OPERANDO direcciones que ya no controlamos (§3.1).
      const wallet = buildAssignedWallet();

      // Act
      const error = catchError(() => wallet.assertOwnedBy(ROTATED_MASTER));

      // Assert — las DOS direcciones, en ese orden: con una sola, el operador vería «no
      // coinciden» sin poder saber cuál de las dos rotó.
      expect(error).toBeInstanceOf(WalletOwnerMismatchError);
      const mismatch = error as WalletOwnerMismatchError;
      expect({
        walletOwnerAddress: mismatch.walletOwnerAddress,
        configuredMaster: mismatch.configuredMaster,
      }).toEqual({ walletOwnerAddress: MASTER.value, configuredMaster: ROTATED_MASTER.value });
    });
  });

  describe('rehydrate()', () => {
    it('debería reconstituir el estado y el txId guardados', () => {
      // Arrange
      const wallet = rehydrateWallet({ status: 'activating', activationTxId: TX_ID });

      // Act
      const state = { status: wallet.status, activationTxId: wallet.activationTxId };

      // Assert
      expect(state).toEqual({ status: 'activating', activationTxId: TX_ID });
    });

    it('debería conservar por separado las dos marcas y los dos actores al reconstituir', () => {
      // Arrange — dos fechas y dos actores DISTINTOS aunque el sistema real no produzca hoy esa
      // fila: es lo único que demuestra que `rehydrate` no los colapsa. Con los cuatro valores
      // iguales, una implementación que ignorase dos parámetros pasaría igual.
      const wallet = rehydrateWallet({
        status: 'active',
        activationTxId: TX_ID,
        createdAt: NOW,
        updatedAt: MUCH_LATER,
        createdBy: null,
        updatedBy: ACTOR_ID,
      });

      // Act
      const trail = {
        createdAt: wallet.createdAt,
        updatedAt: wallet.updatedAt,
        createdBy: wallet.createdBy,
        updatedBy: wallet.updatedBy,
      };

      // Assert
      expect(trail).toEqual({
        createdAt: NOW,
        updatedAt: MUCH_LATER,
        createdBy: null,
        updatedBy: ACTOR_ID,
      });
    });
  });

  describe('toSnapshot()', () => {
    it('debería exponer estado, índice, direcciones y txId en el snapshot', () => {
      // Arrange
      const wallet = buildActivatingWallet();

      // Act
      const snapshot = wallet.toSnapshot();

      // Assert — el objeto COMPLETO: un campo de menos en el snapshot deja el mapper sin dato y
      // el DTO sin publicar, y comparar campo a campo dejaría vivo ese mutante.
      expect(snapshot).toEqual({
        id: WALLET_ID.value,
        ownerId: OWNER_ID,
        ownerAddress: MASTER.value,
        addressIndex: 7,
        address: DERIVED.value,
        status: 'activating',
        activationTxId: TX_ID.value,
        createdAt: NOW,
        updatedAt: LATER,
        createdBy: ACTOR_ID,
        updatedBy: ACTOR_ID,
      });
    });
  });

  describe('monotonía del estado (property-based)', () => {
    fcTest.prop([fc.array(fc.constantFrom('request', 'confirm'), { minLength: 1 })])(
      'debería no retroceder nunca de estado, aplique la secuencia de transiciones que se aplique',
      (steps) => {
        // Arrange
        const wallet = buildAssignedWallet();
        const ranks = [rankOf(wallet.status)];

        // Act — las transiciones ilegales LANZAN (A5, A6) y no mueven nada; se tragan a
        // propósito, porque lo que la propiedad afirma es que NINGUNA secuencia —legal o no—
        // hace retroceder el estado. El rango sale del índice en `WALLET_STATUSES`, cuyo orden
        // fija el caso A1 de `wallet-status.spec.ts`.
        for (const step of steps) {
          catchError(() =>
            step === 'request'
              ? wallet.markActivationRequested(TX_ID, LATER, ACTOR_ID)
              : wallet.confirmActivated(LATER, ACTOR_ID),
          );
          ranks.push(rankOf(wallet.status));
        }

        // Assert
        expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
      },
    );
  });
});

// Helpers

const buildAssignedWallet = (): Wallet =>
  Wallet.assign({
    id: WALLET_ID,
    ownerId: OWNER_ID,
    ownerAddress: MASTER,
    addressIndex: INDEX,
    address: DERIVED,
    now: NOW,
    createdBy: ACTOR_ID,
  });

const buildActivatingWallet = (): Wallet => {
  const wallet = buildAssignedWallet();
  wallet.markActivationRequested(TX_ID, LATER, ACTOR_ID);
  return wallet;
};

const buildActiveWallet = (): Wallet => {
  const wallet = buildActivatingWallet();
  wallet.confirmActivated(LATER, ACTOR_ID);
  return wallet;
};

const rehydrateWallet = (row: {
  status: WalletStatus;
  activationTxId: TransactionHash | null;
  createdAt?: Date;
  updatedAt?: Date;
  createdBy?: string | null;
  updatedBy?: string | null;
}): Wallet =>
  Wallet.rehydrate({
    id: WALLET_ID,
    ownerId: OWNER_ID,
    ownerAddress: MASTER,
    addressIndex: INDEX,
    address: DERIVED,
    status: row.status,
    activationTxId: row.activationTxId,
    createdAt: row.createdAt ?? NOW,
    updatedAt: row.updatedAt ?? NOW,
    createdBy: row.createdBy ?? ACTOR_ID,
    updatedBy: row.updatedBy ?? ACTOR_ID,
  });

const rankOf = (status: WalletStatus): number => WALLET_STATUSES.indexOf(status);

const catchError = (act: () => unknown): Error | undefined => {
  try {
    act();
    return undefined;
  } catch (error) {
    return error as Error;
  }
};
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/modules/wallets/__tests__/domain/entities/wallet.entity.spec.ts`
Expected: FAIL — `Cannot find module '../../../domain/entities/wallet.entity' from 'src/modules/wallets/__tests__/domain/entities/wallet.entity.spec.ts'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/modules/wallets/domain/entities/wallet.entity.ts
import { Entity, type AuditTrail } from '@shared/domain/entity.base';

import type { AddressIndex } from '../value-objects/address-index.vo';
import type { EthereumAddress } from '../value-objects/ethereum-address.vo';
import type { TransactionHash } from '../value-objects/transaction-hash.vo';
import type { WalletId } from '../value-objects/wallet-id.vo';
import type { WalletStatus } from '../wallet-status';
import {
  WalletActivationInProgressError,
  WalletAddressIsMasterError,
  WalletAlreadyActivatedError,
  WalletNotActivatedError,
  WalletOwnerMismatchError,
} from '../errors/wallet.errors';

export type WalletSnapshot = {
  id: string;
  ownerId: string;
  ownerAddress: string;
  addressIndex: number;
  address: string;
  status: WalletStatus;
  activationTxId: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
};

/**
 * La dirección custodiada de un usuario. `Entity` y **no `AggregateRoot`**: en este ciclo nadie
 * reacciona a nada de `wallets` (§3.1), y `docs/module-blueprint.md` marca eventos y outbox como
 * opcionales — «solo si algo fuera del agregado debe reaccionar». Tampoco `SoftDeletableEntity`:
 * una gas pump address no se des-asigna, porque puede tener fondos.
 *
 * `ownerId` es un `string` y no un VO propio: llega del `sub` de un token ya verificado y el
 * identificador pertenece a `users`. Mismo criterio, y por la misma regla del gate de fronteras,
 * que `Order.customerId` y que `createdBy`/`updatedBy` de la traza.
 *
 * `ownerAddress` y `assertOwnedBy()` **van juntos o no van** (§3.1). Una rotación de la master
 * cambia la dirección de cada índice: sin la comprobación, el sistema seguiría operando
 * direcciones que ya no controla, y la columna sería un dato sin consumidor.
 */
export class Wallet extends Entity<WalletId> {
  private constructor(
    id: WalletId,
    readonly ownerId: string,
    readonly ownerAddress: EthereumAddress,
    readonly addressIndex: AddressIndex,
    readonly address: EthereumAddress,
    private _status: WalletStatus,
    private _activationTxId: TransactionHash | null,
    audit: AuditTrail,
  ) {
    super(id, audit);
  }

  /**
   * Alta de la dirección derivada. `updatedBy` nace igual a `createdBy` por la misma simetría con
   * la que `updatedAt` nace igual a `createdAt`: quien creó la fila es, hasta el primer `touch()`,
   * el último que la escribió.
   *
   * ⚠️ **La comprobación contra la master es defensa en profundidad, no validación de entrada.**
   * Hoy el sistema solo sabe acuñar direcciones derivadas, así que la invariante de §3.1.1 se
   * cumple por construcción. Lo que esta línea caza es el fallo que SÍ es posible: que el
   * adaptador devuelva la master por error y se la entreguemos a un usuario. Sería catastrófico y
   * silencioso — ese usuario «tendría» el fondo de gas de la plataforma, y el siguiente también.
   * Es uno de los cinco controles de la tabla de §3.1.1, y el único que da un error con nombre en
   * el instante exacto de construir el agregado.
   */
  static assign(params: {
    id: WalletId;
    ownerId: string;
    ownerAddress: EthereumAddress;
    addressIndex: AddressIndex;
    address: EthereumAddress;
    now: Date;
    createdBy: string | null;
  }): Wallet {
    if (params.address.equals(params.ownerAddress)) {
      throw new WalletAddressIsMasterError(params.address.value);
    }
    return new Wallet(
      params.id,
      params.ownerId,
      params.ownerAddress,
      params.addressIndex,
      params.address,
      'receive-only',
      null,
      {
        createdAt: params.now,
        updatedAt: params.now,
        createdBy: params.createdBy,
        updatedBy: params.createdBy,
      },
    );
  }

  /**
   * Reconstituye desde persistencia sin re-aplicar las reglas de creación, igual que
   * `User.rehydrate`. **No repite la comprobación contra la master a propósito**: la tabla de
   * §3.1.1 enumera cuatro controles y la reconstitución no es ninguno. El de la fila leída es el
   * `CHECK ("address" <> "owner_address")` del esquema, que además ve las escrituras por SQL
   * crudo —seed, migración, consola— que este constructor no vería jamás.
   */
  static rehydrate(params: {
    id: WalletId;
    ownerId: string;
    ownerAddress: EthereumAddress;
    addressIndex: AddressIndex;
    address: EthereumAddress;
    status: WalletStatus;
    activationTxId: TransactionHash | null;
    createdAt: Date;
    updatedAt: Date;
    createdBy: string | null;
    updatedBy: string | null;
  }): Wallet {
    return new Wallet(
      params.id,
      params.ownerId,
      params.ownerAddress,
      params.addressIndex,
      params.address,
      params.status,
      params.activationTxId,
      {
        createdAt: params.createdAt,
        updatedAt: params.updatedAt,
        createdBy: params.createdBy,
        updatedBy: params.updatedBy,
      },
    );
  }

  get status(): WalletStatus {
    return this._status;
  }

  get activationTxId(): TransactionHash | null {
    return this._activationTxId;
  }

  /**
   * Lo que publica el DTO de lectura, y la misma condición que corta `assertCanSend()`. Un solo
   * sitio decide qué significa «puede enviar»: con dos copias de la comparación, el día que el
   * dominio gane un estado más, la respuesta del `GET` y el corte del `POST` podrían divergir.
   */
  get canSend(): boolean {
    return this._status === 'active';
  }

  /**
   * ⚠️ **`activating → activating` LANZA, no es idempotente** (§3.1). Una segunda petición trae un
   * txId NUEVO: tragársela dejaría guardado el primero mientras el sistema cree haber registrado
   * el segundo, y nadie podría reconciliar ninguno de los dos.
   *
   * Y desde `active` lanza porque **volver a activar no falla de forma visible en el proveedor**.
   * Medido sobre `openapi.json`: la operación 02 responde 200 con un `TransactionHash`; la cadena
   * `"Wallet already exists"` es el `example` del campo `reason` de la operación 03, que este
   * ciclo no lee (§9). Sin este corte, el gas se quema y nadie se entera.
   *
   * Los dos errores se construyen **sin argumentos**: son 409 sobre «lo mío» y no hay nada que
   * nombrar que el llamante no tenga ya delante.
   */
  markActivationRequested(txId: TransactionHash, now: Date, by: string | null): void {
    if (this._status === 'activating') {
      throw new WalletActivationInProgressError();
    }
    if (this._status === 'active') {
      throw new WalletAlreadyActivatedError();
    }
    this._status = 'activating';
    this._activationTxId = txId;
    this.touch(now, by);
  }

  /**
   * Reconciliación de §5.4, y también la CURACIÓN de `receive-only → active`: el proveedor aceptó
   * la transacción y perdimos su respuesta, así que la cadena ya dice que puede enviar y nuestro
   * txId no existe. Sin esa transición directa la wallet quedaría colgada para siempre y el
   * intento siguiente volvería a activar. Por eso `activationTxId` puede seguir siendo `null` en
   * `active`, que es lo que el caso A8 fija.
   *
   * **Sobre una wallet ya activa es no-op SIN `touch()`**, mismo criterio que
   * `User.promoteToAdmin`: repetir la confirmación no debe reescribir `updatedBy`, o la traza
   * acabaría nombrando a quien no activó nada. El corte en seco es anterior al `touch`.
   */
  confirmActivated(now: Date, by: string | null): void {
    if (this._status === 'active') {
      return;
    }
    this._status = 'active';
    this.touch(now, by);
  }

  /**
   * Precondición de la transferencia. Lanza `WalletNotActivatedError` **con el ESTADO** tanto desde
   * `receive-only` como desde `activating`: el cliente ya sabe de qué wallet habla —los cinco
   * endpoints son «lo mío»— y lo que no sabe es en qué punto está.
   * `WalletActivationInProgressError` es del camino de ACTIVAR —una segunda petición de
   * activación— y darle un segundo productor lo publicaría en dos endpoints con dos significados
   * distintos.
   */
  assertCanSend(): void {
    if (!this.canSend) {
      throw new WalletNotActivatedError(this._status);
    }
  }

  /**
   * Compara VALUE OBJECTS, no strings: `ValueObject.equals` mira la clase y el valor, así que
   * acepta la master construida en otra caja —la que devuelve `CustodialAddressGateway`— sin que
   * nadie tenga que compartir instancias. Corre en los tres casos de uso que llaman al proveedor
   * y NO en las dos lecturas (§5), donde meterla obligaría a inyectar el gateway solo para leer
   * un dato de configuración en el endpoint que más se llama.
   *
   * El error lleva **las dos direcciones**, en este orden: la master bajo la que se derivó la fila
   * y la que hay configurada ahora. Con una sola, el 500 diría «no coinciden» sin permitir saber
   * cuál de las dos rotó, que es justo lo que el operador necesita para decidir.
   */
  assertOwnedBy(master: EthereumAddress): void {
    if (!this.ownerAddress.equals(master)) {
      throw new WalletOwnerMismatchError(this.ownerAddress.value, master.value);
    }
  }

  toSnapshot(): WalletSnapshot {
    return {
      id: this.id.value,
      ownerId: this.ownerId,
      ownerAddress: this.ownerAddress.value,
      addressIndex: this.addressIndex.value,
      address: this.address.value,
      status: this._status,
      activationTxId: this._activationTxId?.value ?? null,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      createdBy: this.createdBy,
      updatedBy: this.updatedBy,
    };
  }
}
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/modules/wallets/__tests__/domain/entities/wallet.entity.spec.ts`
Expected: PASS — 19 passed (18 casos puntuales + la propiedad P1)

---

### Task 11: `WalletTransfer extends Entity<TransferId>` — el libro, con motivo de lista cerrada

**Layer:** domain
**Rule codes to honor:** `arch-feature-modules`, `arch-single-responsibility`, `security-sanitize-output`

El segundo agregado de §3.2. La fila se escribe **antes** de llamar al proveedor: con la escritura
posterior, un timeout no dejaría rastro — que es justo el caso para el que el libro existe.

Cuatro decisiones de esta tarea, las cuatro con consecuencia:

- ⚠️ **El motivo es un CÓDIGO propio de lista cerrada, nunca el `message` del proveedor.** No es
  purismo: el mensaje del 401 de Tatum interpola la clave —`"Unable to find valid subscription for
'${apiKey}'"`, medido en `openapi.json`— y esta tabla se publica por `GET /wallets/me/transfers`.
  Guardar su texto escribiría un secreto en una respuesta HTTP. Lo impide el TIPO.
- **La lista es `PROVIDER_FAILURE_REASONS` y no una propia del libro.** Es la misma información
  vista desde otro sitio: lo que el adaptador clasificó al fallar la llamada es exactamente lo que
  la fila tiene que registrar. Un segundo vocabulario obligaría a una traducción entre dos listas
  que pueden divergir en silencio. **Esta tarea NO crea esa constante**: nace en la tarea que crea
  `src/modules/wallets/domain/errors/wallet.errors.ts`, junto a los errores del proveedor que la
  usan en su constructor. Aquí solo se importa.
- **`markRejected` y `markUnknown` RECIBEN el motivo**, los dos. Quien sabe por qué falló la llamada
  es el caso de uso que la hizo, no la entidad: fijar el motivo aquí dentro obligaría a la entidad
  a adivinar el código HTTP del proveedor, que es precisamente lo que el adaptador ya clasificó.
- **Gana la PRIMERA liquidación: una segunda llamada a cualquier `mark*` es no-op, sin `touch()`.**
  El fallo que evita es concreto y alcanzable: §3.2 obliga a reintentar UNA vez el guardado
  posterior a la llamada, así que existe un `catch` alrededor de una entidad ya marcada. Sin esta
  regla, un `markUnknown` en ese `catch` reescribiría una fila `submitted` que ya tiene `txId` —el
  libro afirmando «no sé si se movió el dinero» sobre una transacción cuyo hash tenemos, que es la
  peor mentira posible en esta tabla—. El no-op sin `touch` es el mismo criterio que
  `Wallet.confirmActivated` sobre una wallet ya activa.

**Con `toSnapshot()`, igual que `Wallet` y que `Order`.** El aplanado de `TransferAsset` en sus
cuatro columnas (`assetKind`, `tokenAddress`, `amount`, `tokenId`) vive **aquí y una sola vez**: es
el único sitio que ya tiene el activo estrechado por `match()`, y ponerlo en el mapper obligaría a
repetir el mismo `match()` en el DTO. La rama del multi-token usa la clave **`multiToken`** del
matcher —un identificador de TypeScript— y escribe el literal **`'multi-token'`** en `assetKind`,
que es el vocabulario del dominio y de la columna. Son dos cosas distintas y las dos son correctas
en su sitio.

**Casos acordados**

| #   | Caso (se vuelve el `it`)                                                                           | Entrada / estado inicial                               | Resultado esperado                                                                      |
| --- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| A1  | debería nacer en submitting, sin txId ni motivo y con las dos marcas selladas en el mismo instante | `start()` con `now`                                    | `status: 'submitting'`, `txId: null`, `reasonCode: null`, marcas iguales                |
| A2  | debería registrar el actor recibido en createdBy y updatedBy sin derivarlo del dueño               | `start()` con `createdBy` ≠ `ownerId`                  | `createdBy` = `updatedBy` = actor; `ownerId` intacto                                    |
| A3  | debería pasar a submitted guardando el txId y moviendo la traza                                    | fila en `submitting` + `markSubmitted(tx)`             | `status: 'submitted'`, `txId` = tx, `reasonCode: null`, traza movida                    |
| A4  | debería pasar a rejected con el motivo recibido y sin txId                                         | fila en `submitting` + `markRejected('body-rejected')` | `status: 'rejected'`, `reasonCode: 'body-rejected'`, `txId: null`                       |
| A5  | debería pasar a unknown con el motivo recibido y sin txId                                          | fila en `submitting` + `markUnknown('timeout')`        | `status: 'unknown'`, `reasonCode: 'timeout'`, `txId: null`                              |
| A6  | debería conservar submitted y su txId cuando se marca rechazo sobre una fila ya liquidada          | fila en `submitted` + `markRejected('body-rejected')`  | estado, txId, motivo y traza sin cambios                                                |
| A7  | debería conservar submitted y su txId cuando se marca unknown sobre una fila ya liquidada          | fila en `submitted` + `markUnknown('unreachable')`     | estado, txId, motivo y traza sin cambios                                                |
| A8  | debería conservar rejected y su motivo cuando se marca envío sobre una fila ya liquidada           | fila en `rejected` + `markSubmitted(tx)`               | estado, motivo y traza sin cambios; `txId` sigue `null`                                 |
| A9  | debería reconstituir el estado, el txId y el motivo guardados                                      | `rehydrate()` de una fila `unknown` con motivo         | los tres valores los de la fila                                                         |
| A10 | debería conservar por separado las dos marcas y los dos actores al reconstituir                    | `rehydrate()` con 2 fechas y 2 actores distintos       | los cuatro valores intactos, sin colapsar                                               |
| A11 | debería aplanar el activo nativo en el snapshot dejando nulos tokenAddress y tokenId               | fila nativa en `submitting`                            | `toSnapshot()` igual al objeto completo esperado, con `assetKind: 'native'`             |
| A12 | debería aplanar el activo multi-token y publicar el motivo en el snapshot                          | fila multi-token rechazada                             | `assetKind: 'multi-token'`, las tres columnas del activo llenas, `reasonCode` publicado |
| P1  | debería guardar cualquier motivo de PROVIDER_FAILURE_REASONS tal cual _(propiedad)_                | arbitrario: un elemento de `PROVIDER_FAILURE_REASONS`  | `status: 'unknown'` y `reasonCode` idéntico al recibido, sin normalizar                 |

**Files:**

- Create: `src/modules/wallets/domain/entities/wallet-transfer.entity.ts`
- Test: `src/modules/wallets/__tests__/domain/entities/wallet-transfer.entity.spec.ts`

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/modules/wallets/__tests__/domain/entities/wallet-transfer.entity.spec.ts
import { fc, test as fcTest } from '@fast-check/jest';

import { EthereumAddress } from '../../../domain/value-objects/ethereum-address.vo';
import { TokenAmount } from '../../../domain/value-objects/token-amount.vo';
import { TokenId } from '../../../domain/value-objects/token-id.vo';
import { TransactionHash } from '../../../domain/value-objects/transaction-hash.vo';
import { TransferAsset } from '../../../domain/transfer-asset';
import { TransferId } from '../../../domain/value-objects/transfer-id.vo';
import { WalletTransfer } from '../../../domain/entities/wallet-transfer.entity';
import {
  PROVIDER_FAILURE_REASONS,
  type ProviderFailureReason,
} from '../../../domain/errors/wallet.errors';
import type { TransferStatus } from '../../../domain/transfer-status';

const TRANSFER_ID = TransferId.from('3f2504e0-4f89-41d3-9a0c-0305e82c3301');
const OWNER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
/** Actor DISTINTO del dueño, por el mismo motivo que en `wallet.entity.spec.ts`. */
const ACTOR_ID = '5b7c2d4e-9a1f-4c3b-8e6d-0f2a4b6c8d1e';
const OTHER_ACTOR_ID = '3f1a9b2c-8d4e-4f6a-9b1c-2e5d7a0f3b48';

const FROM = EthereumAddress.from('0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3');
const RECIPIENT = EthereumAddress.from('0x627306090abab3a6e1400e9345bc60c78a8bef57');
const TOKEN = EthereumAddress.from('0xdac17f958d2ee523a2206206994597c13d831ec7');
const AMOUNT = TokenAmount.from('1000000000000000000');
const TOKEN_ID = TokenId.from('42');

/** Un envío nativo de 1 ETH: la clase más simple de `TransferAsset`. */
const NATIVE_ASSET = TransferAsset.native({ amount: AMOUNT });
/** La clase con las TRES columnas del activo llenas: es la que caza un aplanado incompleto. */
const MULTI_TOKEN_ASSET = TransferAsset.multiToken({
  token: TOKEN,
  amount: AMOUNT,
  tokenId: TOKEN_ID,
});

const TX_ID = TransactionHash.from(
  '0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060',
);
const OTHER_TX_ID = TransactionHash.from(
  '0x88df016429689c079f3b2f6ad39fa052532c56795b733da78a91ebe6a713944b',
);

const NOW = new Date('2026-08-27T09:00:00.000Z');
const LATER = new Date('2026-08-27T10:30:00.000Z');
const MUCH_LATER = new Date('2026-08-27T12:45:00.000Z');

describe('WalletTransfer', () => {
  describe('start()', () => {
    it('debería nacer en submitting, sin txId ni motivo y con las dos marcas selladas en el mismo instante', () => {
      // Arrange: la fila se escribe ANTES de llamar al proveedor. Con la escritura posterior, un
      // timeout no dejaría rastro — que es justo el caso para el que el libro existe (§3.2).
      const now = NOW;

      // Act
      const transfer = buildStartedTransfer();

      // Assert — `toEqual` y no `toBe` sobre las fechas: los getters de `Entity` devuelven copias.
      expect(settlementOf(transfer)).toEqual({
        status: 'submitting',
        txId: null,
        reasonCode: null,
      });
      expect(transfer.createdAt).toEqual(now);
      expect(transfer.updatedAt).toEqual(now);
    });

    it('debería registrar el actor recibido en createdBy y updatedBy sin derivarlo del dueño', () => {
      // Arrange
      const transfer = buildStartedTransfer();

      // Act
      const actors = { createdBy: transfer.createdBy, updatedBy: transfer.updatedBy };

      // Assert
      expect(actors).toEqual({ createdBy: ACTOR_ID, updatedBy: ACTOR_ID });
      expect(transfer.ownerId).toBe(OWNER_ID);
    });
  });

  describe('markSubmitted()', () => {
    it('debería pasar a submitted guardando el txId y moviendo la traza', () => {
      // Arrange
      const transfer = buildStartedTransfer();

      // Act
      transfer.markSubmitted(TX_ID, LATER, OTHER_ACTOR_ID);

      // Assert
      expect(settlementOf(transfer)).toEqual({
        status: 'submitted',
        txId: TX_ID,
        reasonCode: null,
      });
      expect(transfer.updatedAt).toEqual(LATER);
      expect(transfer.updatedBy).toBe(OTHER_ACTOR_ID);
    });

    it('debería conservar rejected y su motivo cuando se marca envío sobre una fila ya liquidada', () => {
      // Arrange
      const transfer = buildRejectedTransfer();
      const before = { updatedAt: transfer.updatedAt, updatedBy: transfer.updatedBy };

      // Act
      transfer.markSubmitted(TX_ID, MUCH_LATER, OTHER_ACTOR_ID);

      // Assert
      expect(settlementOf(transfer)).toEqual({
        status: 'rejected',
        txId: null,
        reasonCode: 'body-rejected',
      });
      expect(transfer.updatedAt).toEqual(before.updatedAt);
      expect(transfer.updatedBy).toBe(before.updatedBy);
    });
  });

  describe('markRejected()', () => {
    it('debería pasar a rejected con el motivo recibido y sin txId', () => {
      // Arrange: `rejected` es SOLO el 400 de validación del cuerpo —`'body-rejected'`—, es decir
      // que no pasó nada en la cadena y no hay hash que guardar (§3.2).
      const transfer = buildStartedTransfer();

      // Act
      transfer.markRejected('body-rejected', LATER, ACTOR_ID);

      // Assert
      expect(settlementOf(transfer)).toEqual({
        status: 'rejected',
        txId: null,
        reasonCode: 'body-rejected',
      });
    });

    it('debería conservar submitted y su txId cuando se marca rechazo sobre una fila ya liquidada', () => {
      // Arrange: el fallo que este caso cierra es alcanzable — §3.2 obliga a reintentar UNA vez
      // el guardado posterior a la llamada, así que existe un `catch` alrededor de una entidad ya
      // marcada. Sin la regla «gana la primera liquidación», el libro afirmaría un rechazo sobre
      // una transacción cuyo hash tenemos.
      const transfer = buildSubmittedTransfer();
      const before = { updatedAt: transfer.updatedAt, updatedBy: transfer.updatedBy };

      // Act
      transfer.markRejected('body-rejected', MUCH_LATER, OTHER_ACTOR_ID);

      // Assert
      expect(settlementOf(transfer)).toEqual({
        status: 'submitted',
        txId: TX_ID,
        reasonCode: null,
      });
      expect(transfer.updatedAt).toEqual(before.updatedAt);
      expect(transfer.updatedBy).toBe(before.updatedBy);
    });
  });

  describe('markUnknown()', () => {
    it('debería pasar a unknown con el motivo recibido y sin txId', () => {
      // Arrange: `unknown` es la respuesta honesta a un timeout — pudo minarse o no. No se
      // inventa un `rejected`, que afirmaría algo falso, ni un `submitted` sin `txId` (§3.2).
      const transfer = buildStartedTransfer();

      // Act
      transfer.markUnknown('timeout', LATER, ACTOR_ID);

      // Assert
      expect(settlementOf(transfer)).toEqual({
        status: 'unknown',
        txId: null,
        reasonCode: 'timeout',
      });
    });

    it('debería conservar submitted y su txId cuando se marca unknown sobre una fila ya liquidada', () => {
      // Arrange: la variante peor del caso anterior — el libro diría «no sé si se movió el
      // dinero» sobre una transacción cuyo hash ya tenemos guardado.
      const transfer = buildSubmittedTransfer();
      const before = { updatedAt: transfer.updatedAt, updatedBy: transfer.updatedBy };

      // Act
      transfer.markUnknown('unreachable', MUCH_LATER, OTHER_ACTOR_ID);

      // Assert
      expect(settlementOf(transfer)).toEqual({
        status: 'submitted',
        txId: TX_ID,
        reasonCode: null,
      });
      expect(transfer.updatedAt).toEqual(before.updatedAt);
      expect(transfer.updatedBy).toBe(before.updatedBy);
    });
  });

  describe('rehydrate()', () => {
    it('debería reconstituir el estado, el txId y el motivo guardados', () => {
      // Arrange
      const transfer = rehydrateTransfer({
        status: 'unknown',
        txId: null,
        reasonCode: 'upstream-error',
      });

      // Act
      const state = settlementOf(transfer);

      // Assert
      expect(state).toEqual({
        status: 'unknown',
        txId: null,
        reasonCode: 'upstream-error',
      });
    });

    it('debería conservar por separado las dos marcas y los dos actores al reconstituir', () => {
      // Arrange — dos fechas y dos actores DISTINTOS: es lo único que demuestra que `rehydrate`
      // no los colapsa. Con los cuatro iguales, una implementación que ignorase dos parámetros
      // pasaría igual.
      const transfer = rehydrateTransfer({
        status: 'submitted',
        txId: OTHER_TX_ID,
        reasonCode: null,
        createdAt: NOW,
        updatedAt: MUCH_LATER,
        createdBy: null,
        updatedBy: ACTOR_ID,
      });

      // Act
      const trail = {
        createdAt: transfer.createdAt,
        updatedAt: transfer.updatedAt,
        createdBy: transfer.createdBy,
        updatedBy: transfer.updatedBy,
      };

      // Assert
      expect(trail).toEqual({
        createdAt: NOW,
        updatedAt: MUCH_LATER,
        createdBy: null,
        updatedBy: ACTOR_ID,
      });
    });
  });

  describe('toSnapshot()', () => {
    it('debería aplanar el activo nativo en el snapshot dejando nulos tokenAddress y tokenId', () => {
      // Arrange: la rama nativa es la única sin contrato, y la que caza un aplanado que escribiera
      // la dirección del token «por si acaso».
      const transfer = buildStartedTransfer(NATIVE_ASSET);

      // Act
      const snapshot = transfer.toSnapshot();

      // Assert — el objeto COMPLETO: un campo de menos deja al mapper sin dato y al DTO sin
      // publicar, y comparar campo a campo dejaría vivo ese mutante.
      expect(snapshot).toEqual({
        id: TRANSFER_ID.value,
        ownerId: OWNER_ID,
        from: FROM.value,
        recipient: RECIPIENT.value,
        assetKind: 'native',
        tokenAddress: null,
        amount: AMOUNT.value,
        tokenId: null,
        status: 'submitting',
        txId: null,
        reasonCode: null,
        createdAt: NOW,
        updatedAt: NOW,
        createdBy: ACTOR_ID,
        updatedBy: ACTOR_ID,
      });
    });

    it('debería aplanar el activo multi-token y publicar el motivo en el snapshot', () => {
      // Arrange: `'multi-token'` CON GUION es el literal del dominio y el de la columna; la clave
      // del matcher es `multiToken` porque es un identificador de TypeScript. Son dos cosas
      // distintas y este caso fija la que sale publicada.
      const transfer = buildStartedTransfer(MULTI_TOKEN_ASSET);
      transfer.markRejected('body-rejected', LATER, OTHER_ACTOR_ID);

      // Act
      const snapshot = transfer.toSnapshot();

      // Assert
      expect(snapshot).toEqual({
        id: TRANSFER_ID.value,
        ownerId: OWNER_ID,
        from: FROM.value,
        recipient: RECIPIENT.value,
        assetKind: 'multi-token',
        tokenAddress: TOKEN.value,
        amount: AMOUNT.value,
        tokenId: TOKEN_ID.value,
        status: 'rejected',
        txId: null,
        reasonCode: 'body-rejected',
        createdAt: NOW,
        updatedAt: LATER,
        createdBy: ACTOR_ID,
        updatedBy: OTHER_ACTOR_ID,
      });
    });
  });

  describe('motivo de la liquidación (property-based)', () => {
    fcTest.prop([fc.constantFrom(...PROVIDER_FAILURE_REASONS)])(
      'debería guardar cualquier motivo de PROVIDER_FAILURE_REASONS tal cual',
      (reason) => {
        // Arrange
        const transfer = buildStartedTransfer();

        // Act
        transfer.markUnknown(reason, LATER, ACTOR_ID);

        // Assert — «tal cual» es la propiedad: ni se normaliza, ni se traduce, ni se sustituye
        // por texto del proveedor. Lo que impide que entre texto libre es el TIPO; lo que esta
        // propiedad fija es que los nueve códigos legales llegan intactos a la fila.
        expect(settlementOf(transfer)).toEqual({
          status: 'unknown',
          txId: null,
          reasonCode: reason,
        });
      },
    );
  });
});

// Helpers

/**
 * La liquidación completa en un objeto: estado, hash y motivo. El motivo se lee del snapshot
 * porque la entidad NO publica un getter para él — el mapper y el DTO también lo leen de ahí.
 */
const settlementOf = (
  transfer: WalletTransfer,
): {
  status: TransferStatus;
  txId: TransactionHash | null;
  reasonCode: ProviderFailureReason | null;
} => ({
  status: transfer.status,
  txId: transfer.txId,
  reasonCode: transfer.toSnapshot().reasonCode,
});

const buildStartedTransfer = (asset: TransferAsset = NATIVE_ASSET): WalletTransfer =>
  WalletTransfer.start({
    id: TRANSFER_ID,
    ownerId: OWNER_ID,
    from: FROM,
    recipient: RECIPIENT,
    asset,
    now: NOW,
    createdBy: ACTOR_ID,
  });

const buildSubmittedTransfer = (): WalletTransfer => {
  const transfer = buildStartedTransfer();
  transfer.markSubmitted(TX_ID, LATER, ACTOR_ID);
  return transfer;
};

const buildRejectedTransfer = (): WalletTransfer => {
  const transfer = buildStartedTransfer();
  transfer.markRejected('body-rejected', LATER, ACTOR_ID);
  return transfer;
};

const rehydrateTransfer = (row: {
  status: TransferStatus;
  txId: TransactionHash | null;
  reasonCode: ProviderFailureReason | null;
  createdAt?: Date;
  updatedAt?: Date;
  createdBy?: string | null;
  updatedBy?: string | null;
}): WalletTransfer =>
  WalletTransfer.rehydrate({
    id: TRANSFER_ID,
    ownerId: OWNER_ID,
    from: FROM,
    recipient: RECIPIENT,
    asset: NATIVE_ASSET,
    status: row.status,
    txId: row.txId,
    reasonCode: row.reasonCode,
    createdAt: row.createdAt ?? NOW,
    updatedAt: row.updatedAt ?? NOW,
    createdBy: row.createdBy ?? ACTOR_ID,
    updatedBy: row.updatedBy ?? ACTOR_ID,
  });
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/modules/wallets/__tests__/domain/entities/wallet-transfer.entity.spec.ts`
Expected: FAIL — `Cannot find module '../../../domain/entities/wallet-transfer.entity' from 'src/modules/wallets/__tests__/domain/entities/wallet-transfer.entity.spec.ts'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/modules/wallets/domain/entities/wallet-transfer.entity.ts
import { Entity, type AuditTrail } from '@shared/domain/entity.base';

import type { EthereumAddress } from '../value-objects/ethereum-address.vo';
import type { ProviderFailureReason } from '../errors/wallet.errors';
import type { TransactionHash } from '../value-objects/transaction-hash.vo';
import type { TransferAsset, TransferAssetKind } from '../transfer-asset';
import type { TransferId } from '../value-objects/transfer-id.vo';
import type { TransferStatus } from '../transfer-status';

export type WalletTransferSnapshot = {
  id: string;
  ownerId: string;
  from: string;
  recipient: string;
  assetKind: TransferAssetKind;
  tokenAddress: string | null;
  amount: string | null;
  tokenId: string | null;
  status: TransferStatus;
  txId: string | null;
  reasonCode: ProviderFailureReason | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
};

/**
 * El libro de transferencias, con **escritura por delante**: la fila se escribe ANTES de llamar al
 * proveedor (§3.2). Eso es lo que convierte al libro en algo útil — con la escritura posterior, un
 * timeout no dejaría rastro, que es justo el caso para el que existe.
 *
 * `from` es la dirección de la wallet y NO la master: la master firma, no envía (§5.3). Se guarda
 * la dirección y no el id de la wallet porque es lo que un explorador de bloques necesita y lo que
 * sigue siendo cierto tras una rotación de la master; y no se guardan las dos porque toda consulta
 * del libro es por dueño (`findByOwner`), así que un segundo camino hacia la misma fila no
 * tendría consumidor.
 *
 * El motivo es `ProviderFailureReason`, **la misma lista cerrada que usan los errores del
 * proveedor** y no un vocabulario propio del libro: es la misma información vista desde otro sitio,
 * y dos listas paralelas divergirían en silencio. Nunca el `message` del proveedor — el del 401 de
 * Tatum interpola la API key y esta columna se publica por `GET /wallets/me/transfers`.
 */
export class WalletTransfer extends Entity<TransferId> {
  private constructor(
    id: TransferId,
    readonly ownerId: string,
    readonly from: EthereumAddress,
    readonly recipient: EthereumAddress,
    readonly asset: TransferAsset,
    private _status: TransferStatus,
    private _txId: TransactionHash | null,
    private _reasonCode: ProviderFailureReason | null,
    audit: AuditTrail,
  ) {
    super(id, audit);
  }

  /**
   * La escritura por delante. Ocurre DESPUÉS de toda la validación local y de la precondición de
   * activación, justo antes de la llamada: antes, el libro se llenaría de rechazos que nunca
   * salieron del proceso (§3.2).
   */
  static start(params: {
    id: TransferId;
    ownerId: string;
    from: EthereumAddress;
    recipient: EthereumAddress;
    asset: TransferAsset;
    now: Date;
    createdBy: string | null;
  }): WalletTransfer {
    return new WalletTransfer(
      params.id,
      params.ownerId,
      params.from,
      params.recipient,
      params.asset,
      'submitting',
      null,
      null,
      {
        createdAt: params.now,
        updatedAt: params.now,
        createdBy: params.createdBy,
        updatedBy: params.createdBy,
      },
    );
  }

  /**
   * Reconstituye desde persistencia sin re-aplicar reglas de creación, igual que
   * `Order.rehydrate`. Recibe el activo ya construido —`TransferAsset`— y no sus cuatro columnas
   * sueltas: quien lee la fila es el mapper, y es él quien tiene que decidir qué clase de activo
   * era. Con las cuatro columnas aquí dentro, la entidad tendría que volver a validar la
   * combinación excluyente que `TransferAsset.fromParts` ya sabe rechazar, y una fila guardada no
   * es una entrada del cliente.
   */
  static rehydrate(params: {
    id: TransferId;
    ownerId: string;
    from: EthereumAddress;
    recipient: EthereumAddress;
    asset: TransferAsset;
    status: TransferStatus;
    txId: TransactionHash | null;
    reasonCode: ProviderFailureReason | null;
    createdAt: Date;
    updatedAt: Date;
    createdBy: string | null;
    updatedBy: string | null;
  }): WalletTransfer {
    return new WalletTransfer(
      params.id,
      params.ownerId,
      params.from,
      params.recipient,
      params.asset,
      params.status,
      params.txId,
      params.reasonCode,
      {
        createdAt: params.createdAt,
        updatedAt: params.updatedAt,
        createdBy: params.createdBy,
        updatedBy: params.updatedBy,
      },
    );
  }

  get status(): TransferStatus {
    return this._status;
  }

  get txId(): TransactionHash | null {
    return this._txId;
  }

  /** El proveedor devolvió `txId`: la transacción está ENVIADA, no necesariamente minada. */
  markSubmitted(txId: TransactionHash, now: Date, by: string | null): void {
    this.settle('submitted', txId, null, now, by);
  }

  /**
   * Recibe el motivo como los otros dos mutadores. Hoy el único código que llega aquí es
   * `'body-rejected'` —el 400 de validación del cuerpo, lo único que significa «no pasó nada en la
   * cadena» (§3.2)—, y aun así el parámetro existe: quien clasifica la respuesta del proveedor es
   * el adaptador, y fijar el código dentro de la entidad la obligaría a adivinar un estado HTTP
   * que no ve.
   */
  markRejected(reason: ProviderFailureReason, now: Date, by: string | null): void {
    this.settle('rejected', null, reason, now, by);
  }

  /**
   * El resto de la lista: timeout, red caída, 5xx, 401/403 y cualquier 4xx no documentado. Todos
   * significan **pudo minarse o no**, que es exactamente lo que `unknown` registra.
   */
  markUnknown(reason: ProviderFailureReason, now: Date, by: string | null): void {
    this.settle('unknown', null, reason, now, by);
  }

  /**
   * El aplanado del activo vive AQUÍ y una sola vez: es el único sitio que ya tiene los valores
   * estrechados por `match()`, y repetirlo en el mapper obligaría a repetirlo también en el DTO.
   *
   * ⚠️ La clave del matcher es **`multiToken`** —un identificador de TypeScript— y el literal que
   * sale publicado es **`'multi-token'`**, con guion, que es el vocabulario del dominio, el de la
   * columna `asset_kind` y el del ejemplo de OpenAPI. Escribir `'multitoken'` en cualquiera de los
   * dos sitios rompe el mapeo sin que el compilador diga nada, porque son strings distintos que
   * caben en el mismo hueco.
   */
  toSnapshot(): WalletTransferSnapshot {
    const asset = this.asset.match<{
      tokenAddress: string | null;
      amount: string | null;
      tokenId: string | null;
    }>({
      native: (amount) => ({ tokenAddress: null, amount: amount.value, tokenId: null }),
      fungible: (token, amount) => ({
        tokenAddress: token.value,
        amount: amount.value,
        tokenId: null,
      }),
      nft: (token, tokenId) => ({
        tokenAddress: token.value,
        amount: null,
        tokenId: tokenId.value,
      }),
      multiToken: (token, amount, tokenId) => ({
        tokenAddress: token.value,
        amount: amount.value,
        tokenId: tokenId.value,
      }),
    });

    return {
      id: this.id.value,
      ownerId: this.ownerId,
      from: this.from.value,
      recipient: this.recipient.value,
      assetKind: this.asset.kind,
      tokenAddress: asset.tokenAddress,
      amount: asset.amount,
      tokenId: asset.tokenId,
      status: this._status,
      txId: this._txId?.value ?? null,
      reasonCode: this._reasonCode,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      createdBy: this.createdBy,
      updatedBy: this.updatedBy,
    };
  }

  /**
   * ⚠️ **Gana la PRIMERA liquidación: sobre una fila ya liquidada esto es no-op, y sin `touch()`.**
   * El fallo que evita es alcanzable, no hipotético: §3.2 obliga a reintentar UNA vez el guardado
   * posterior a la llamada, así que existe un `catch` alrededor de una entidad ya marcada. Sin
   * este corte, un `markUnknown` en ese `catch` reescribiría una fila `submitted` que ya tiene
   * `txId` — el libro afirmando «no sé si se movió el dinero» sobre una transacción cuyo hash
   * tenemos guardado, que es la peor mentira posible en esta tabla.
   *
   * Que el no-op sea anterior al `touch` es el mismo criterio que `User.promoteToAdmin` y que
   * `Wallet.confirmActivated`: la traza debe seguir nombrando a quien liquidó de verdad.
   *
   * Un solo guardián para los tres mutadores y no tres copias: con tres, el auditor de mutación
   * tendría tres mutantes equivalentes del mismo corte y bastaría con olvidarlo en uno.
   */
  private settle(
    status: Exclude<TransferStatus, 'submitting'>,
    txId: TransactionHash | null,
    reasonCode: ProviderFailureReason | null,
    now: Date,
    by: string | null,
  ): void {
    if (this._status !== 'submitting') {
      return;
    }
    this._status = status;
    this._txId = txId;
    this._reasonCode = reasonCode;
    this.touch(now, by);
  }
}
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/modules/wallets/__tests__/domain/entities/wallet-transfer.entity.spec.ts`
Expected: PASS — 13 passed (12 casos puntuales + la propiedad P1)

---

### Task 12: Los cinco puertos de `domain/ports/`

**Layer:** domain
**Rule codes to honor:** `di-use-interfaces-tokens`, `di-interface-segregation`, `di-prefer-constructor-injection`, `arch-use-repository-pattern`, `test-mock-external-services`

Los cinco de §4, todos `abstract class` con **solo miembros `abstract` públicos** — sin campos, sin
constructor, sin `protected`. Tipo y token de inyección son la misma referencia, así que ningún
consumidor necesita `@Inject`; los adaptadores hacen `implements`, **nunca** `extends`.

Tres firmas de esta tarea son decisiones, no gusto, y ninguna se puede cambiar por su cuenta:

- **`WalletRepository.save()` devuelve un DESENLACE (`WalletSaveOutcome`), no lanza.** El `23505` de
  `idx_wallets_user_id` es una carrera normal entre dos altas del mismo dueño: el adaptador lo
  traduce a `'owner-conflict'` y el caso de uso relee la fila que ganó. Esto es lo que hace que
  **`WalletAlreadyAssignedError` no exista**, y ahora es cierto: no hay ningún camino por el que
  ese error llegue a HTTP, porque no hay error. Los otros dos `23505` (`address_index`, `address`)
  y la violación del `CHECK` **sí lanzan**: son violaciones de invariante y tienen que ser 500
  ruidosos que el `ErrorReporter` vea.
- **`WalletTransferRepository.findByOwner` recibe UN SOLO objeto** con el `ownerId` dentro, y ese
  criterio lleva `page`/`limit` —lo que el cliente manda— y no `skip`/`take`. La aritmética de la
  paginación es del adaptador, que es quien conoce a TypeORM.
- **`enableSending` e `isSendingEnabled` reciben un ÍNDICE, no una dirección.** Lo arbitra la API
  del proveedor, no el gusto: `POST /v3/gas-pump/activate` toma `{chain, owner, from, to}` —índices—
  y `GET /v3/gas-pump/activated/{chain}/{owner}/{index}` lo lleva en la ruta. Medido en
  `openapi.json`. Pasarles la dirección obligaría al adaptador a invertir la derivación, que no
  tiene inversa. Por lo mismo, `deriveAddress` recibe **solo** el índice: la master la aporta el
  adaptador desde la configuración, y pasársela desde el caso de uso duplicaría `masterAddress()`.

**Qué prueba el test de forma, y qué no.** Los puertos no llevan lógica —el precedente escrito del
repo es la cabecera de `auth/__tests__/domain/ports/password-hasher.spec.ts`: «el SUT es la
constante, no el puerto: solo declara miembros `abstract` y no hay nada que probar en él»—, así que
cada spec tiene **un** caso y comprueba las dos cosas que sí se pueden romper en ejecución:

| Lo que rompe                                    | Cómo se manifiesta                                                                                                        | ¿Lo caza este caso?                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Convertir el puerto en `type` + `Symbol`        | El import se elide en el emit de SWC ⇒ `undefined.prototype` ⇒ **TypeError en ejecución**, además del rojo de `typecheck` | **Sí**, y es su valor principal                                                 |
| Añadirle un método o getter CONCRETO            | El prototipo gana un nombre; el puerto deja de ser solo contrato                                                          | **Sí**: `prototypeMembers` deja de ser `['constructor']`                        |
| Añadirle una **parameter property**             | `Port.length` pasa de 0 a 1, y los fakes por objeto literal dejan de compilar (`TS2741`, medido en `user.repository.ts`)  | **Sí**, por la aridad                                                           |
| Añadirle un **campo declarado** sin inicializar | No emite nada observable en el prototipo                                                                                  | **No.** Lo caza el compilador en los fakes por objeto literal de `application/` |
| Un `protected constructor()` vacío              | No emite nada distinguible                                                                                                | **No, y no hace falta**: no rompe los fakes; se prohíbe porque es código muerto |

⚠️ **Los cuatro `type` que viajan con estos puertos —`WalletSaveOutcome`, `FindTransfersCriteria`,
`TransferPage` y `SendCommand`— tienen que entrar en la lista cerrada del selector de
`eslint.config.mjs`, y esta tarea NO edita ese archivo.** Lo hace la Task 41, con la lista final
completa y en una sola pasada; con cuatro tareas editando la misma línea, la última en aterrizar
borraba las tres anteriores. La consecuencia mientras tanto es acotada y conocida: hasta que la
Task 41 aterrice, un `import { WalletTransferRepository, type TransferPage } from '…'` se pone rojo
en `lint:check`, y la salida es escribir ese import **como valor** —que es lo que el lint pide— o
no escribirlo todavía. La lista falla en cerrado a propósito: un dato nuevo cuesta una línea
revisada, y un puerto marcado `type` por descuido se pone rojo solo. La copia en prosa que
`CLAUDE.md` mantiene de esa lista —«Those seven names are a closed list»— pasa a once nombres en el
mismo cambio de la Task 41; si divergen manda `eslint.config.mjs`, según dice su propio comentario.

**Casos acordados**

| #   | Caso (se vuelve el `it`)                                                                                          | Entrada / estado inicial | Resultado esperado                                         |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------- |
| A1  | debería exponer WalletRepository como token de inyección sin implementación ni constructor con parámetros         | la clase del puerto      | `prototypeMembers: ['constructor']`, `constructorArity: 0` |
| A2  | debería exponer WalletTransferRepository como token de inyección sin implementación ni constructor con parámetros | la clase del puerto      | `prototypeMembers: ['constructor']`, `constructorArity: 0` |
| A3  | debería exponer AddressIndexAllocator como token de inyección sin implementación ni constructor con parámetros    | la clase del puerto      | `prototypeMembers: ['constructor']`, `constructorArity: 0` |
| A4  | debería exponer CustodialAddressGateway como token de inyección sin implementación ni constructor con parámetros  | la clase del puerto      | `prototypeMembers: ['constructor']`, `constructorArity: 0` |
| A5  | debería exponer OwnerDirectory como token de inyección sin implementación ni constructor con parámetros           | la clase del puerto      | `prototypeMembers: ['constructor']`, `constructorArity: 0` |

**Files:**

- Create: `src/modules/wallets/domain/ports/wallet.repository.ts`
- Create: `src/modules/wallets/domain/ports/wallet-transfer.repository.ts`
- Create: `src/modules/wallets/domain/ports/address-index.allocator.ts`
- Create: `src/modules/wallets/domain/ports/custodial-address.gateway.ts`
- Create: `src/modules/wallets/domain/ports/owner.directory.ts`
- Test: `src/modules/wallets/__tests__/helpers/port-shape.ts` (helper, sin spec propio)
- Test: `src/modules/wallets/__tests__/domain/ports/wallet.repository.spec.ts`
- Test: `src/modules/wallets/__tests__/domain/ports/wallet-transfer.repository.spec.ts`
- Test: `src/modules/wallets/__tests__/domain/ports/address-index.allocator.spec.ts`
- Test: `src/modules/wallets/__tests__/domain/ports/custodial-address.gateway.spec.ts`
- Test: `src/modules/wallets/__tests__/domain/ports/owner.directory.spec.ts`

`eslint.config.mjs` **no está en esta lista a propósito**: la lista cerrada del selector de `type`
inline la amplía la Task 41 en una sola pasada, con los nombres de todo el contexto.

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/modules/wallets/__tests__/helpers/port-shape.ts
/**
 * Lo mínimo que hace falta para leer la forma de un puerto: su prototipo y la aridad de su
 * constructor. Se tipa por ESTRUCTURA y no como `abstract new (…) => object` a propósito — un tipo
 * con solo firma de construcción no expone `length`, y `length` es justo la mitad de la
 * comprobación.
 *
 * ⚠️ Si alguien convierte un puerto en `type` + `Symbol`, la llamada deja de compilar («solo se
 * refiere a un tipo») **y** revienta en ejecución bajo `@swc/jest`, que borra los tipos sin
 * comprobarlos: el import se elide y aquí llega `undefined`. Ese doble rojo es el valor principal
 * de estos specs.
 */
type PortClass = { readonly prototype: object; readonly length: number };

export const readPortShape = (
  port: PortClass,
): { prototypeMembers: string[]; constructorArity: number } => ({
  prototypeMembers: Object.getOwnPropertyNames(port.prototype),
  constructorArity: port.length,
});
```

```ts
// src/modules/wallets/__tests__/domain/ports/wallet.repository.spec.ts
import { readPortShape } from '../../helpers/port-shape';
import { WalletRepository } from '../../../domain/ports/wallet.repository';

describe('WalletRepository', () => {
  it('debería exponer WalletRepository como token de inyección sin implementación ni constructor con parámetros', () => {
    // Arrange
    const port = WalletRepository;

    // Act
    const shape = readPortShape(port);

    // Assert
    expect(shape).toEqual({ prototypeMembers: ['constructor'], constructorArity: 0 });
  });
});
```

```ts
// src/modules/wallets/__tests__/domain/ports/wallet-transfer.repository.spec.ts
import { readPortShape } from '../../helpers/port-shape';
import { WalletTransferRepository } from '../../../domain/ports/wallet-transfer.repository';

describe('WalletTransferRepository', () => {
  it('debería exponer WalletTransferRepository como token de inyección sin implementación ni constructor con parámetros', () => {
    // Arrange
    const port = WalletTransferRepository;

    // Act
    const shape = readPortShape(port);

    // Assert
    expect(shape).toEqual({ prototypeMembers: ['constructor'], constructorArity: 0 });
  });
});
```

```ts
// src/modules/wallets/__tests__/domain/ports/address-index.allocator.spec.ts
import { readPortShape } from '../../helpers/port-shape';
import { AddressIndexAllocator } from '../../../domain/ports/address-index.allocator';

describe('AddressIndexAllocator', () => {
  it('debería exponer AddressIndexAllocator como token de inyección sin implementación ni constructor con parámetros', () => {
    // Arrange
    const port = AddressIndexAllocator;

    // Act
    const shape = readPortShape(port);

    // Assert
    expect(shape).toEqual({ prototypeMembers: ['constructor'], constructorArity: 0 });
  });
});
```

```ts
// src/modules/wallets/__tests__/domain/ports/custodial-address.gateway.spec.ts
import { readPortShape } from '../../helpers/port-shape';
import { CustodialAddressGateway } from '../../../domain/ports/custodial-address.gateway';

describe('CustodialAddressGateway', () => {
  it('debería exponer CustodialAddressGateway como token de inyección sin implementación ni constructor con parámetros', () => {
    // Arrange
    const port = CustodialAddressGateway;

    // Act
    const shape = readPortShape(port);

    // Assert
    expect(shape).toEqual({ prototypeMembers: ['constructor'], constructorArity: 0 });
  });
});
```

```ts
// src/modules/wallets/__tests__/domain/ports/owner.directory.spec.ts
import { readPortShape } from '../../helpers/port-shape';
import { OwnerDirectory } from '../../../domain/ports/owner.directory';

describe('OwnerDirectory', () => {
  it('debería exponer OwnerDirectory como token de inyección sin implementación ni constructor con parámetros', () => {
    // Arrange
    const port = OwnerDirectory;

    // Act
    const shape = readPortShape(port);

    // Assert
    expect(shape).toEqual({ prototypeMembers: ['constructor'], constructorArity: 0 });
  });
});
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/modules/wallets/__tests__/domain/ports`
Expected: FAIL — `Cannot find module '../../../domain/ports/wallet.repository' from 'src/modules/wallets/__tests__/domain/ports/wallet.repository.spec.ts'` (y las cuatro equivalentes)

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/modules/wallets/domain/ports/wallet.repository.ts
import type { Wallet } from '../entities/wallet.entity';

/**
 * El desenlace de guardar una wallet. `type` y no clase: es un DATO que acompaña al puerto, no algo
 * inyectable — misma forma que `UserPage` en `users/domain/ports/user.repository.ts`, y por eso su
 * nombre entra en la lista cerrada del selector de `eslint.config.mjs` que amplía la Task 41.
 */
export type WalletSaveOutcome = 'saved' | 'owner-conflict';

/**
 * Puerto de salida (driven). Vive en el dominio porque es el dominio quien decide qué necesita de
 * la persistencia; `infrastructure/persistence/` provee la implementación.
 *
 * `abstract class` y no `type` + `Symbol`: la clase SOBREVIVE a la compilación, así que la misma
 * referencia es el tipo del contrato y el token de inyección. El razonamiento completo, con las
 * dos prohibiciones medidas con `tsc --noEmit --strict`, vive en
 * `users/domain/ports/user.repository.ts`.
 *
 * **Dos métodos y no tres: no hay `findById`.** Los cinco endpoints del contexto son «lo mío» y el
 * dueño sale siempre del `sub` del token, jamás del cuerpo ni de la ruta, así que nadie busca por
 * id de wallet. Mismo criterio con el que `delete()` salió de `UserRepository`: un método público
 * invita a llamarlo, y aquí el que sobra abriría una lectura por id que ningún guard protege.
 *
 * ⚠️ **`save` devuelve un DESENLACE y no lanza cuando el dueño ya tiene wallet.** El `23505` de
 * `idx_wallets_user_id` es una carrera normal entre dos altas simultáneas del mismo dueño —dos
 * pestañas, un reintento del cliente—, no una invariante rota: el adaptador lo traduce a
 * `'owner-conflict'` y el caso de uso relee la fila que ganó y la devuelve. Por eso
 * `WalletAlreadyAssignedError` **no existe**: no hay ningún camino por el que llegue a HTTP,
 * porque no hay error. Los otros dos `23505` (`idx_wallets_address_index`, `idx_wallets_address`) y
 * la violación de `ck_wallets_address_not_master` **sí lanzan** —`AddressIndexAlreadyUsedError`,
 * `WalletAddressAlreadyUsedError`, `WalletAddressIsMasterError`—, porque ahí sí hay una invariante
 * rota y tiene que ser un 500 ruidoso que el `ErrorReporter` vea.
 *
 * `save` cubre el alta y la actualización de estado, y **no lleva eventos** en la firma a
 * diferencia de `OrderRepository`: en este ciclo no hay eventos de dominio ni outbox porque nadie
 * reacciona (§3.1 y `docs/module-blueprint.md`).
 */
export abstract class WalletRepository {
  abstract findByOwnerId(ownerId: string): Promise<Wallet | null>;
  abstract save(wallet: Wallet): Promise<WalletSaveOutcome>;
}
```

```ts
// src/modules/wallets/domain/ports/wallet-transfer.repository.ts
import type { WalletTransfer } from '../entities/wallet-transfer.entity';

/**
 * El criterio del listado. Lleva el `ownerId` DENTRO y no como parámetro aparte: el listado siempre
 * es de un dueño, y separarlo dejaría escribir una consulta paginada sin filtro por dueño que
 * compilaría perfectamente.
 *
 * ⚠️ Lleva `page`/`limit` —lo que el cliente manda— y **no `skip`/`take`**: la aritmética de la
 * paginación es del adaptador, que es quien conoce a TypeORM. Un puerto que hablara de `skip`
 * obligaría a cada fake de `application/` a repetir esa multiplicación para poder mentir igual que
 * la base.
 *
 * `type` y no clase: es un dato que acompaña al puerto, así que su nombre entra en la lista cerrada
 * del selector de `eslint.config.mjs` que amplía la Task 41.
 */
export type FindTransfersCriteria = {
  ownerId: string;
  page: number;
  limit: number;
};

/**
 * Página del libro. `items` es `readonly` porque el caso de uso solo la lee y el DTO la mapea:
 * publicar un array mutable invitaría a ordenarlo en sitio sobre lo que devolvió el adaptador.
 * Misma forma que `UserPage` en `users/domain/ports/user.repository.ts`, y su nombre entra también
 * en esa lista cerrada.
 */
export type TransferPage = {
  items: readonly WalletTransfer[];
  total: number;
};

/**
 * Puerto de salida (driven) del segundo agregado. `abstract class` —tipo y token en la misma
 * referencia— por el mismo motivo que `wallet.repository.ts`.
 *
 * `save` sirve para las dos escrituras del libro: la de por delante (`submitting`) y la
 * liquidación posterior. Es **idempotente por diseño** —la segunda no toca la cadena—, que es lo
 * que permite el único reintento que §3.2 autoriza. Devuelve `void` y no un desenlace: aquí no hay
 * ningún índice único que dos peticiones puedan disputarse, porque el id lo pone el caso de uso.
 */
export abstract class WalletTransferRepository {
  abstract save(transfer: WalletTransfer): Promise<void>;
  abstract findByOwner(criteria: FindTransfersCriteria): Promise<TransferPage>;
}
```

```ts
// src/modules/wallets/domain/ports/address-index.allocator.ts
import type { AddressIndex } from '../value-objects/address-index.vo';

/**
 * Reserva del índice de derivación. **Puerto propio y no un método más del repositorio**, y el
 * motivo es medible, no estético: detrás hay OTRO almacén —una secuencia de PostgreSQL, no la
 * tabla `wallets`— con otro modo de fallo. Metido en el repositorio, todo fake que no reserva
 * índices tendría que implementarlo igualmente (§4).
 *
 * La secuencia, y no `max(index)+1`, por dos razones y la segunda es la decisiva: `max()` mira la
 * tabla y **recicla el índice de una fila borrada** —dos usuarios sobre la misma dirección—, y
 * obligaría al orden «leer el máximo → derivar en el proveedor → insertar», donde cada colisión
 * tira los créditos de una llamada ya hecha. Con la secuencia el índice es nuestro antes de gastar
 * nada (§5.1).
 *
 * Los huecos son gratis: derivar no escribe en la cadena ni consume gas, así que un hueco es una
 * dirección que nadie posee y a la que nadie va a mandar nada. Por eso `next()` no tiene
 * contrapartida para devolver un índice: consumir una secuencia es irreversible por diseño, y no
 * hay compensación que escribir (§5.2).
 */
export abstract class AddressIndexAllocator {
  abstract next(): Promise<AddressIndex>;
}
```

```ts
// src/modules/wallets/domain/ports/custodial-address.gateway.ts
import type { AddressIndex } from '../value-objects/address-index.vo';
import type { EthereumAddress } from '../value-objects/ethereum-address.vo';
import type { TransactionHash } from '../value-objects/transaction-hash.vo';
import type { TransferAsset } from '../transfer-asset';

/**
 * Lo que hace falta para firmar un envío. `from` es la dirección de la WALLET, nunca la master: la
 * master firma, no envía (§5.3). El destinatario se llama **`recipient`** y no `to` porque en la
 * API del proveedor `to` es un ÍNDICE de derivación —lo usa `POST /v3/gas-pump/activate`—, y
 * reutilizar ese nombre para una dirección invitaría a pasar uno donde va el otro.
 *
 * La clave privada **no aparece aquí y no puede aparecer**: la aporta el adaptador en el único
 * punto donde se lee, y meterla en este tipo la pasearía por `application/`, que es exactamente la
 * superficie que §7.1 cierra.
 *
 * `type` y no clase: es un dato que acompaña al puerto, así que su nombre entra en la lista cerrada
 * del selector de `eslint.config.mjs` que amplía la Task 41.
 */
export type SendCommand = {
  from: EthereumAddress;
  recipient: EthereumAddress;
  asset: TransferAsset;
};

/**
 * El proveedor de direcciones custodiadas, nombrado por la CAPACIDAD: «gas pump» es la marca del
 * producto de Tatum, no un concepto de este dominio.
 *
 * **Uno solo y no tres**, a diferencia de la fachada de `users`: detrás hay un único adaptador
 * contra un único proveedor y ningún método es peligroso-por-descuido —que fue el motivo real de
 * partir `UsersFacade` en dos tokens—. Segregarlo multiplicaría el fake sin ganar una garantía del
 * compilador (§4).
 *
 * `masterAddress()` es SÍNCRONO: lee configuración ya resuelta, no sale a la red. Devolver una
 * promesa obligaría a `await` en `assertOwnedBy` y sugeriría un coste que no existe.
 *
 * ⚠️ **`deriveAddress`, `enableSending` e `isSendingEnabled` reciben un ÍNDICE, no una dirección.**
 * Lo arbitra la API del proveedor: `POST /v3/gas-pump/activate` toma `{chain, owner, from, to}`
 * —índices, no direcciones— y `GET /v3/gas-pump/activated/{chain}/{owner}/{index}` lo lleva en la
 * ruta. Medido en `openapi.json`. Pasarles la dirección obligaría al adaptador a invertir la
 * derivación, que no tiene inversa. Y la master no viaja en la firma de `deriveAddress` porque la
 * aporta el adaptador desde la configuración: pasársela desde el caso de uso duplicaría
 * `masterAddress()` y abriría la puerta a derivar bajo una master que no es la nuestra.
 *
 * ⚠️ `isSendingEnabled` devuelve `boolean` y **nunca `null`**. El esquema `Activated` del proveedor
 * no declara `required`, así que `{}` es un 200 válido; y las dos lecturas por defecto son
 * destructivas sobre un estado monótono —leerlo como `false` quema gas en una dirección quizá ya
 * activada, leerlo como `true` cura a un estado del que no se retrocede—. La ausencia no es un
 * booleano: el adaptador la traduce a `WalletProviderUnreachableError` (502, al APM) antes de que
 * el dominio la vea (§6.2).
 *
 * ⚠️ `enableSending` y `send` **no son reintentables** y eso vive en el adaptador, no aquí: un
 * reintento de la primera paga el gas dos veces y uno de la segunda mueve el dinero dos veces.
 * `deriveAddress` e `isSendingEnabled` sí lo son, y el argumento es «no cuesta gas», NO «es
 * determinista» — la documentación del proveedor no promete en ningún sitio que derivar
 * `(owner, índice)` sea determinista. La consecuencia práctica: **la fuente de verdad de la
 * dirección es la fila guardada**, nunca una rederivación.
 */
export abstract class CustodialAddressGateway {
  abstract masterAddress(): EthereumAddress;
  abstract deriveAddress(index: AddressIndex): Promise<EthereumAddress>;
  abstract enableSending(index: AddressIndex): Promise<TransactionHash>;
  abstract isSendingEnabled(index: AddressIndex): Promise<boolean>;
  abstract send(command: SendCommand): Promise<TransactionHash>;
}
```

```ts
// src/modules/wallets/domain/ports/owner.directory.ts
/**
 * La vista que `wallets` tiene de `users`: un directorio de dueños. `wallets` define el puerto y no
 * sabe qué módulo lo implementa; el adaptador (`infrastructure/gateways/users-owner.directory.ts`)
 * inyecta `UsersLookup`, que es la única superficie cross-módulo legal.
 *
 * Idéntico en espíritu a `CustomerDirectory` de `orders`, y por el mismo fallo: **un JWT firmado
 * sobrevive a la desactivación de su dueño** y el esquema no tiene ni una clave foránea, así que
 * nada más impediría que una cuenta desactivada siguiera pidiendo direcciones y moviendo fondos
 * hasta que expire su token.
 *
 * `exists` devuelve `true` solo si el dueño existe Y está activo. Lo consultan los TRES casos de
 * uso que cuestan dinero o crean estado, y **no las dos lecturas** (§5): ahí el token ya probó el
 * `sub`, y un 403 cosmético costaría una consulta extra en los endpoints más llamados —la gente
 * consulta repetidamente esperando la activación—.
 */
export abstract class OwnerDirectory {
  abstract exists(ownerId: string): Promise<boolean>;
}
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/modules/wallets/__tests__/domain/ports`
Expected: PASS — 5 passed (5 suites)

---

### Task 13: Las siete variables de `wallets` en `env.schema.ts`, con sus tres `.refine()`

**Layer:** bootstrap — `src/config/`, que el gate de fronteras trata como su propia capa: solo `config → config`
**Rule codes to honor:** `devops-use-config-module`, `security-validate-all-input`

**Casos acordados:** no aplica. Es configuración, y el modelo de colaboración la exime
explícitamente (`CLAUDE.md`, «Infra, config, wiring y docs quedan exentas de la tabla»). Tampoco
entra en el auditor de mutación: `stryker.config.mjs` apunta `mutate` solo a `domain/` y
`application/` — «Infra, config y wiring quedan fuera a propósito», línea 7 de su cabecera.

Las siete variables son exactamente estas, y no hay ninguna más: `TATUM_API_URL`, `TATUM_API_KEY`,
`TATUM_TIMEOUT_MS`, `WALLETS_MASTER_ADDRESS`, `WALLETS_MASTER_PRIVATE_KEY`,
`WALLETS_ACTIVATION_PAYER` y `WALLETS_NETWORK`. La cadena **no** es una variable: es la constante
`TATUM_CHAIN` de `wallets.config.ts`, que escribe la tarea 14.

⚠️ **Esta tarea rompe cuatro specs que hoy están en verde, y por eso los toca.** El refine de
credenciales hace que `envSchema.parse({ NODE_ENV: 'production', … })` falle, y cuatro casos de
`src/config/__tests__/` construyen un entorno production-like para comprobar **otra cosa** (los
flags derivados de `NODE_ENV`, la guarda de `synchronize`, el veto de `JWT_SECRET`). Sin el
arreglo se pondrían rojos por un motivo que no es el suyo, señalando al refine equivocado. Las
constantes compartidas evitan que el siguiente refine obligue a editar los cuatro otra vez.

**Files:**

- Modify: `src/config/env.schema.ts`
- Modify (test): `src/config/__tests__/env.schema.spec.ts`
- Modify (test): `src/config/__tests__/auth.config.spec.ts`
- Modify (test): `src/config/__tests__/configurations.spec.ts`
- Modify (test): `src/config/__tests__/database.config.spec.ts`
- Modify (test): `test/helpers/config.factory.ts`

- [ ] **Step 1: Escribe el test que falla**

Primero las constantes compartidas. Se añaden **al final** de `test/helpers/config.factory.ts`,
debajo de `buildDatabaseConfig`:

```ts
// test/helpers/config.factory.ts  (añadir al final del archivo)

/**
 * Las credenciales del proveedor custodial sin las que `envSchema` no acepta `staging` ni
 * `production`. Se centralizan aquí porque cuatro specs de `src/config/__tests__/` parsean un
 * entorno production-like para comprobar algo que no tiene nada que ver —los flags derivados de
 * `NODE_ENV`, la guarda de `synchronize`— y sin ellas fallarían señalando al refine equivocado.
 *
 * ⚠️ La clave es `0x` + 64 ceros a propósito: no es una clave, es un relleno de entropía nula.
 * Es la misma forma que usa el placeholder de desarrollo de `wallets.config.ts`, y la razón es
 * la misma — una cadena de ceros no puede confundirse con una clave real ni por un humano ni por
 * un escáner de secretos.
 */
export const PRODUCTION_LIKE_WALLETS_ENV: Readonly<Record<string, string>> = {
  TATUM_API_KEY: 'test-api-key',
  WALLETS_MASTER_ADDRESS: `0x${'a'.repeat(40)}`,
  WALLETS_MASTER_PRIVATE_KEY: `0x${'0'.repeat(64)}`,
};

/**
 * Todo lo que `envSchema` exige para aceptar `staging`/`production`: las credenciales de arriba
 * más el `JWT_SECRET`. Se mantienen separadas porque hay un caso que necesita justo lo
 * contrario —`auth.config.spec.ts` comprueba que production SIN `JWT_SECRET` se rechaza— y
 * mezclarlas lo dejaría sin forma de expresarse.
 */
export const PRODUCTION_LIKE_ENV: Readonly<Record<string, string>> = {
  JWT_SECRET: 'x'.repeat(32),
  ...PRODUCTION_LIKE_WALLETS_ENV,
};
```

Ahora el bloque nuevo de `env.schema.spec.ts`. Va **después** del `describe('credenciales de la
documentación', …)` y **antes** de la línea `// Helpers`:

```ts
// src/config/__tests__/env.schema.spec.ts  (bloque nuevo, dentro de describe('envSchema'))

describe('wallets y proveedor custodial', () => {
  it('debería aplicar los defaults del proveedor cuando no se define ninguna variable', () => {
    // Arrange
    const raw = {};

    // Act
    const env = parseOrThrow(raw);

    // Assert
    expect(env.TATUM_API_URL).toBe('https://api.tatum.io');
    expect(env.TATUM_TIMEOUT_MS).toBe(10_000);
    expect(env.WALLETS_ACTIVATION_PAYER).toBe('tatum');
    expect(env.WALLETS_NETWORK).toBe('testnet');
  });

  it('debería dejar las tres credenciales indefinidas en development, sin default', () => {
    // Arrange
    const raw = { NODE_ENV: 'development' };

    // Act
    const env = parseOrThrow(raw);

    // Assert
    // El default depende de NODE_ENV y lo resuelve `wallets.config.ts`, igual que el de
    // JWT_SECRET: aquí solo se comprueba que el schema no inventa uno.
    expect(env.TATUM_API_KEY).toBeUndefined();
    expect(env.WALLETS_MASTER_ADDRESS).toBeUndefined();
    expect(env.WALLETS_MASTER_PRIVATE_KEY).toBeUndefined();
  });

  it('debería rechazar un TATUM_API_URL que no sea una URL', () => {
    // Arrange
    const raw = { TATUM_API_URL: 'api.tatum.io' };

    // Act
    const result = envSchema.safeParse(raw);

    // Assert
    expect(result.success).toBe(false);
  });

  it('debería aceptar un TATUM_API_URL de loopback, que es lo que usa el stub del E2E', () => {
    // Arrange
    const raw = { TATUM_API_URL: 'http://127.0.0.1:34567' };

    // Act
    const env = parseOrThrow(raw);

    // Assert
    expect(env.TATUM_API_URL).toBe('http://127.0.0.1:34567');
  });

  it('debería rechazar TATUM_TIMEOUT_MS presente pero vacía, en vez de coercionarla a 0', () => {
    // Arrange
    const raw = { TATUM_TIMEOUT_MS: '' };

    // Act
    const result = envSchema.safeParse(raw);

    // Assert
    expect(result.success).toBe(false);
  });

  it('debería rechazar una WALLETS_MASTER_ADDRESS que no sea 0x más 40 hexadecimales', () => {
    // Arrange
    const raw = { WALLETS_MASTER_ADDRESS: `0x${'a'.repeat(39)}` };

    // Act
    const result = envSchema.safeParse(raw);

    // Assert
    expect(result.success).toBe(false);
  });

  it('debería aceptar una WALLETS_MASTER_ADDRESS con mayúsculas, que es la forma EIP-55', () => {
    // Arrange
    const raw = { WALLETS_MASTER_ADDRESS: `0x${'A'.repeat(40)}` };

    // Act
    const env = parseOrThrow(raw);

    // Assert
    // Quien copia la dirección de un explorador la copia con checksum. Rechazarla aquí
    // obligaría a pasarla a minúsculas a mano antes de escribir el `.env`.
    expect(env.WALLETS_MASTER_ADDRESS).toBe(`0x${'A'.repeat(40)}`);
  });

  it('debería rechazar una WALLETS_MASTER_PRIVATE_KEY sin el prefijo 0x', () => {
    // Arrange
    const raw = { WALLETS_MASTER_PRIVATE_KEY: '0'.repeat(64) };

    // Act
    const result = envSchema.safeParse(raw);

    // Assert
    // El proveedor exige longitud 66 exacta para ETH (`fromPrivateKey`, minLength y maxLength
    // 66 en docs/tatum/gas-pump/openapi.json). Sin prefijo son 64 y la llamada muere allí.
    expect(result.success).toBe(false);
  });

  it('debería rechazar un WALLETS_ACTIVATION_PAYER que no sea tatum ni master', () => {
    // Arrange
    const raw = { WALLETS_ACTIVATION_PAYER: 'usuario' };

    // Act
    const result = envSchema.safeParse(raw);

    // Assert
    // Solo hay dos esquemas de cuerpo para `POST /v3/gas-pump/activate` en
    // docs/tatum/gas-pump/openapi.json que apliquen a ETH: `ActivateGasPumpTatum`
    // (`feesCovered: true`) y `ActivateGasPump` (`fromPrivateKey`). Un tercer valor no tiene
    // cuerpo que construir.
    expect(result.success).toBe(false);
  });

  it('debería aceptar WALLETS_ACTIVATION_PAYER=master, que paga el gas con la clave', () => {
    // Arrange
    const raw = { WALLETS_ACTIVATION_PAYER: 'master' };

    // Act
    const env = parseOrThrow(raw);

    // Assert
    expect(env.WALLETS_ACTIVATION_PAYER).toBe('master');
  });

  it.each(['staging', 'production'])(
    'debería rechazar %s sin las credenciales del proveedor',
    (nodeEnv) => {
      // Arrange
      const raw = { NODE_ENV: nodeEnv, JWT_SECRET: 'x'.repeat(32) };

      // Act
      const result = envSchema.safeParse(raw);

      // Assert
      expect(result.success).toBe(false);
      expect(JSON.stringify(result.error?.issues)).toContain('WALLETS_MASTER_PRIVATE_KEY');
    },
  );

  it.each(['staging', 'production'])(
    'debería aceptar %s con las tres credenciales definidas',
    (nodeEnv) => {
      // Arrange
      const raw = { NODE_ENV: nodeEnv, ...PRODUCTION_LIKE_ENV };

      // Act
      const result = envSchema.safeParse(raw);

      // Assert
      expect(result.success).toBe(true);
    },
  );

  it('debería aceptar development sin ninguna credencial del proveedor', () => {
    // Arrange
    const raw = { NODE_ENV: 'development' };

    // Act
    const result = envSchema.safeParse(raw);

    // Assert
    // Levantar la API no puede exigir darse de alta en el proveedor: los cinco endpoints de
    // /wallets fallarán en la primera llamada, y el resto del sistema funciona igual.
    expect(result.success).toBe(true);
  });

  it('debería rechazar WALLETS_NETWORK=mainnet nombrando el KMS como condición de salida', () => {
    // Arrange
    const raw = { WALLETS_NETWORK: 'mainnet' };

    // Act
    const result = envSchema.safeParse(raw);

    // Assert
    // El enum ACEPTA `mainnet` y es el refine quien lo veta, a propósito: con
    // `z.enum(['testnet'])` el mensaje sería «invalid enum value» y nadie sabría por qué.
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('KMS');
  });

  it('debería aceptar WALLETS_NETWORK=testnet', () => {
    // Arrange
    const raw = { WALLETS_NETWORK: 'testnet' };

    // Act
    const env = parseOrThrow(raw);

    // Assert
    expect(env.WALLETS_NETWORK).toBe('testnet');
  });

  it('debería rechazar TATUM_TIMEOUT_MS igual a REQUEST_TIMEOUT_MS', () => {
    // Arrange
    const raw = { TATUM_TIMEOUT_MS: '15000', REQUEST_TIMEOUT_MS: '15000' };

    // Act
    const result = envSchema.safeParse(raw);

    // Assert
    // El caso del empate es el que de verdad prueba el `<` estricto: con `<=` pasaría, y una
    // carrera entre los dos temporizadores es exactamente lo que no se quiere.
    expect(result.success).toBe(false);
  });

  it('debería rechazar TATUM_TIMEOUT_MS mayor que REQUEST_TIMEOUT_MS', () => {
    // Arrange
    const raw = { TATUM_TIMEOUT_MS: '20000', REQUEST_TIMEOUT_MS: '15000' };

    // Act
    const result = envSchema.safeParse(raw);

    // Assert
    // Con el corte global por delante, el interceptor responde 408 y la fila del libro se
    // queda en `submitting` con la llamada al proveedor todavía en vuelo.
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('TATUM_TIMEOUT_MS');
  });

  it('debería aceptar TATUM_TIMEOUT_MS estrictamente menor que REQUEST_TIMEOUT_MS', () => {
    // Arrange
    const raw = { TATUM_TIMEOUT_MS: '14999', REQUEST_TIMEOUT_MS: '15000' };

    // Act
    const env = parseOrThrow(raw);

    // Assert
    expect(env.TATUM_TIMEOUT_MS).toBe(14_999);
  });
});
```

Y el import que ese bloque necesita, en la cabecera del mismo archivo:

```ts
// src/config/__tests__/env.schema.spec.ts  (líneas 1-3, sustituyen a la línea 1 actual)

import { PRODUCTION_LIKE_ENV } from '@test/helpers/config.factory';

import { envSchema, splitList } from '../env.schema';
```

El caso de escalares del mismo archivo pasa a ejercitar también las variables nuevas — es el
guardarraíl de «solo escalares» y una variable nueva es justo lo que podría romperlo:

```ts
// src/config/__tests__/env.schema.spec.ts
// (sustituye el Arrange de `debería emitir solo valores escalares, porque @nestjs/config descarta el resto`)

// Arrange
const raw = {
  CORS_ORIGINS: 'https://a.com,https://b.com',
  LOG_REDACT_FIELDS: 'password,token',
  TRUST_PROXY: 'loopback',
  DB_SSL_CA: '/etc/ssl/certs/rds.pem',
  TATUM_API_URL: 'https://api.tatum.io',
  WALLETS_NETWORK: 'testnet',
  WALLETS_ACTIVATION_PAYER: 'tatum',
  WALLETS_MASTER_ADDRESS: `0x${'a'.repeat(40)}`,
};
```

El caso del enum de `NODE_ENV`, del mismo archivo, deja de construir su propio `JWT_SECRET`:

```ts
// src/config/__tests__/env.schema.spec.ts
// (sustituye el it.each `debería aceptar NODE_ENV="%s"` de describe('valores por defecto'))

it.each(['development', 'test', 'staging', 'production'])(
  'debería aceptar NODE_ENV="%s"',
  (value) => {
    // Arrange
    // `staging` y `production` exigen JWT_SECRET y las tres credenciales del proveedor —ver
    // los refines de env.schema.ts—. Aquí lo que se comprueba es el enum de NODE_ENV, no eso.
    const isProductionLike = value === 'staging' || value === 'production';
    const raw = { NODE_ENV: value, ...(isProductionLike ? PRODUCTION_LIKE_ENV : {}) };

    // Act
    const env = parseOrThrow(raw);

    // Assert
    expect(env.NODE_ENV).toBe(value);
  },
);
```

Los tres specs restantes que construyen un entorno production-like:

```ts
// src/config/__tests__/auth.config.spec.ts  (sustituye las dos líneas de import de la cabecera)

import { PRODUCTION_LIKE_WALLETS_ENV } from '@test/helpers/config.factory';

import { resolveJwtSecret, ARGON2_PARAMS } from '../auth.config';
import { envSchema } from '../env.schema';
```

```ts
// src/config/__tests__/auth.config.spec.ts
// (sustituye el it.each `debería rechazar %s sin JWT_SECRET` de describe('envSchema (auth)'))

it.each(['staging', 'production'] as const)('debería rechazar %s sin JWT_SECRET', (nodeEnv) => {
  // Arrange
  // Las credenciales del proveedor van puestas para que el ÚNICO motivo de rechazo sea el que
  // este caso nombra. Sin ellas seguiría en verde, pero por el refine de wallets: un test que
  // pasa por el motivo equivocado deja de proteger lo que dice proteger.
  const raw = { NODE_ENV: nodeEnv, ...PRODUCTION_LIKE_WALLETS_ENV };

  // Act
  const result = envSchema.safeParse(raw);

  // Assert
  expect(result.success).toBe(false);
  expect(JSON.stringify(result.error?.issues)).toContain('JWT_SECRET');
});
```

```ts
// src/config/__tests__/configurations.spec.ts
// (sustituye el Arrange de `debería derivar los flags de entorno a partir de NODE_ENV`)

// Arrange
// JWT_SECRET y las credenciales del proveedor son obligatorios en production por los refines
// de env.schema.ts; no tienen relación con lo que este caso comprueba (los flags derivados
// de NODE_ENV).
withEnv({ NODE_ENV: 'production', ...PRODUCTION_LIKE_ENV });
```

```ts
// src/config/__tests__/configurations.spec.ts  (añadir al bloque de imports de la cabecera)

import { PRODUCTION_LIKE_ENV } from '@test/helpers/config.factory';
```

```ts
// src/config/__tests__/database.config.spec.ts
// (sustituye el Arrange de `debería aplicar la guarda de synchronize al construir la configuración`)

// Arrange
// JWT_SECRET y las credenciales del proveedor son obligatorios en production por los refines
// de env.schema.ts; no tienen relación con lo que este caso comprueba (la guarda de
// synchronize).
const env = buildEnv({
  NODE_ENV: 'production',
  DB_SYNCHRONIZE: 'true',
  ...PRODUCTION_LIKE_ENV,
});
```

```ts
// src/config/__tests__/database.config.spec.ts  (añadir al bloque de imports de la cabecera)

import { PRODUCTION_LIKE_ENV } from '@test/helpers/config.factory';
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/config/__tests__/env.schema.spec.ts`
Expected: FAIL — los 18 casos nuevos del bloque `wallets y proveedor custodial` rojos (20
ejecutados: dos de ellos son `it.each` de dos entradas).
Los que esperan `success: false` fallan con `expect(received).toBe(expected) // Expected: false, Received: true` (las variables aún no existen, así que Zod hace _strip_ y no valida nada); los que leen un default fallan con `Expected: "https://api.tatum.io", Received: undefined`.

Run: `pnpm typecheck`
Expected: FAIL — `Property 'TATUM_API_URL' does not exist on type '{ NODE_ENV: …; }'`, una vez por
cada acceso a una variable nueva desde el spec.

- [ ] **Step 3: Escribe la implementación mínima**

Bloque nuevo dentro de `baseEnvSchema`, **detrás** del grupo de PostgreSQL y antes del `});` que
cierra el objeto:

```ts
// src/config/env.schema.ts  (bloque nuevo al final de baseEnvSchema)

  // --- Wallets: proveedor custodial (Tatum Gas Pump) ------------------------
  //
  // Las tres credenciales van `optional()` aquí y las hace obligatorias el refine del final,
  // exactamente como `JWT_SECRET`: el default depende de `NODE_ENV` y lo resuelve
  // `resolveTatumCredentials()` en `wallets.config.ts`. Un default de desarrollo escrito aquí
  // se aplicaría también en production, que es lo que ese refine existe para impedir.
  TATUM_API_KEY: z.string().min(1).optional(),

  // ⚠️ La dirección viaja SOLO como dirección (derivar, activar) y la clave SOLO como firma
  // (transferir): medido sobre `docs/tatum/gas-pump/openapi.json`, `TransferCustodialWallet`
  // tiene diez propiedades y ninguna se llama `owner`. Nada en el contrato del proveedor ata
  // las dos, así que una configuración con dirección y clave de cuentas distintas pasa toda la
  // validación y solo falla al enviar, con el gas ya gastado. Cerrarlo es derivar la dirección
  // desde la clave al arrancar; el formato es lo único que se puede comprobar aquí.
  WALLETS_MASTER_ADDRESS: z
    .string()
    .regex(
      /^0x[0-9a-fA-F]{40}$/,
      'WALLETS_MASTER_ADDRESS must be 0x followed by 40 hexadecimal characters.',
    )
    .optional(),

  // 66 caracteres: `0x` + 64 hexadecimales. Es la longitud exacta que el proveedor exige para
  // ETH — `fromPrivateKey`, `minLength: 66` y `maxLength: 66` en su `openapi.json`. Sin el
  // prefijo son 64 y la llamada muere en el proveedor, con el mensaje del proveedor.
  WALLETS_MASTER_PRIVATE_KEY: z
    .string()
    .regex(
      /^0x[0-9a-fA-F]{64}$/,
      'WALLETS_MASTER_PRIVATE_KEY must be 0x followed by 64 hexadecimal characters.',
    )
    .optional(),

  // `z.url()` y no `z.string().url()`: la forma encadenada está deprecada en Zod 4.
  TATUM_API_URL: z.url().default('https://api.tatum.io'),

  TATUM_TIMEOUT_MS: rejectEmpty(int().positive()).default(10_000),

  // Quién paga la comisión de la transacción de activación, que es lo mismo que decir CUÁL de
  // los dos cuerpos se envía a `POST /v3/gas-pump/activate` — medido sobre
  // `docs/tatum/gas-pump/openapi.json`: `ActivateGasPumpTatum` lleva `feesCovered: true` y la
  // cobra el proveedor contra la cuota de créditos; `ActivateGasPump` lleva `fromPrivateKey` y
  // la paga la master en ETH. No hay un tercer esquema aplicable a ETH.
  //
  // Default `tatum` porque en testnet cuesta 1 crédito y no toca el saldo de la master, que es
  // el punto único de fallo que nadie vigila todavía.
  WALLETS_ACTIVATION_PAYER: z.enum(['tatum', 'master']).default('tatum'),

  // El enum ACEPTA `mainnet` y es el refine del final quien lo veta. Con `z.enum(['testnet'])`
  // el arranque diría «invalid enum value» y quien lo leyera no sabría si es un veto nuestro o
  // una cadena mal escrita.
  //
  // ⚠️ Esta variable NO cambia de red: la red la decide la API key. No hay campo de red en
  // ninguno de los 32 esquemas de `openapi.json` — medido sobre el fichero. Lo que declara es
  // cuál se cree que es la key, y sirve para bloquear el arranque cuando esa creencia es
  // `mainnet`.
  WALLETS_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
```

Y la cadena de refines completa, que sustituye al `export const envSchema` actual:

```ts
// src/config/env.schema.ts  (sustituye el export const envSchema completo)

export const envSchema = baseEnvSchema
  .refine((env) => (env.DOCS_USERNAME === undefined) === (env.DOCS_PASSWORD === undefined), {
    message:
      'DOCS_USERNAME and DOCS_PASSWORD must both be set or both be omitted: with only one, ' +
      'the Basic Auth middleware never mounts and the docs are published without asking for ' +
      'credentials.',
    path: ['DOCS_PASSWORD'],
  })
  .refine(
    (env) =>
      !(env.NODE_ENV === 'staging' || env.NODE_ENV === 'production') ||
      env.JWT_SECRET !== undefined,
    {
      message:
        'JWT_SECRET is required in staging/production: without it the guard would sign with ' +
        'the development default, which is public in the repository.',
      path: ['JWT_SECRET'],
    },
  )
  .refine((env) => (env.ADMIN_EMAIL === undefined) === (env.ADMIN_PASSWORD === undefined), {
    message:
      'ADMIN_EMAIL and ADMIN_PASSWORD must both be set or both be omitted: the first-admin ' +
      'seed needs them together.',
    path: ['ADMIN_PASSWORD'],
  })
  // Mismo criterio que el refine de JWT_SECRET, y por el mismo motivo: sin este veto la
  // aplicación arrancaría en production con los placeholders de desarrollo, cuya clave privada
  // son 64 ceros y está publicada en el repositorio. La diferencia con JWT_SECRET es que aquí
  // el placeholder ni siquiera puede firmar, así que el síntoma sería un 502 por transferencia
  // en vez de una puerta abierta — pero el diagnóstico llegaría en producción, no al desplegar.
  .refine(
    (env) =>
      !(env.NODE_ENV === 'staging' || env.NODE_ENV === 'production') ||
      (env.TATUM_API_KEY !== undefined &&
        env.WALLETS_MASTER_ADDRESS !== undefined &&
        env.WALLETS_MASTER_PRIVATE_KEY !== undefined),
    {
      message:
        'TATUM_API_KEY, WALLETS_MASTER_ADDRESS and WALLETS_MASTER_PRIVATE_KEY are all required ' +
        'in staging/production: without them the wallets module falls back to the development ' +
        'placeholders, whose private key is 64 zeros and cannot sign anything.',
      path: ['WALLETS_MASTER_PRIVATE_KEY'],
    },
  )
  // El veto de mainnet es de arranque y no de despliegue a propósito: la clave privada de la
  // master viaja en el CUERPO de cada transferencia y vive en configuración en claro. Con dinero
  // real, cualquiera de las superficies de fuga que hoy están tapadas a mano —un serializador de
  // pino, un `error.cause`, un `console.warn`— pasa de incidente a robo. La condición de salida
  // es el sistema de gestión de claves del proveedor, que además cambia la firma del puerto:
  // devuelve un identificador de firma en lugar de un hash de transacción.
  .refine((env) => env.WALLETS_NETWORK !== 'mainnet', {
    message:
      'WALLETS_NETWORK=mainnet is blocked at startup: the master private key is held in plain ' +
      'configuration and travels in the body of every transfer. Real funds require the provider ' +
      'KMS, which also changes the port signature (signature id instead of transaction hash).',
    path: ['WALLETS_NETWORK'],
  })
  // Estrictamente menor, no menor o igual. Si el corte global llega primero, el interceptor
  // responde 408 y la llamada al proveedor sigue en vuelo: la fila del libro de transferencias
  // se queda en `submitting` —el estado del que nadie sabe salir— en lugar de en `unknown`, que
  // es lo que de verdad sabemos. Con el empate los dos temporizadores compiten y el resultado
  // depende del orden de los timers, que es peor que cualquiera de los dos comportamientos.
  .refine((env) => env.TATUM_TIMEOUT_MS < env.REQUEST_TIMEOUT_MS, {
    message:
      'TATUM_TIMEOUT_MS must be strictly lower than REQUEST_TIMEOUT_MS: otherwise the global ' +
      'timeout interceptor answers 408 first and the transfer ledger row is left in ' +
      '"submitting" with the provider call still in flight.',
    path: ['TATUM_TIMEOUT_MS'],
  });
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/config/__tests__/`
Expected: PASS — las cuatro suites de `src/config/__tests__/` en verde, con los 18 casos nuevos
de `env.schema.spec.ts` incluidos.

Run: `pnpm typecheck`
Expected: PASS — sin salida.

---

### Task 14: `wallets.config.ts`, `TATUM_CHAIN`, los placeholders y `resolveTatumCredentials`

**Layer:** bootstrap — `src/config/`
**Rule codes to honor:** `devops-use-config-module`, `security-sanitize-output`

**Casos acordados:** no aplica, por la misma exención de la tarea anterior.

⚠️ **Este archivo es el único punto por el que la clave privada de la master entra al sistema.**
No la transforma, no la loguea y no la mete en ningún mensaje de error: el `console.warn` de la
rama de placeholders nombra **variables**, nunca valores. El value object que la envuelve **no
puede vivir aquí** —el gate de fronteras solo permite `config → config`, así que ni el shared
kernel ni los módulos son alcanzables desde `src/config/`—, y por eso la configuración devuelve
un string plano y el adaptador lo envuelve en su constructor.

`WalletsConfig` publica exactamente siete campos —`apiUrl`, `apiKey`, `timeoutMs`,
`masterAddress`, `masterPrivateKey`, `activationPayer` y `network`— más el derivado
`usingDevPlaceholders`, que no viene de ninguna variable. **La cadena no es un campo**: es la
constante exportada `TATUM_CHAIN`, y el adaptador la importa de aquí.

⚠️ **Esta tarea NO toca `test/setup-env.ts`.** Las variables de `wallets` que la suite necesita con
`??=` —incluida la URL a loopback que impide que un test salga a `api.tatum.io`— las escribe la
**tarea 43**, que es su única dueña. Hasta que esa tarea corra, ejecutar la suite E2E completa
imprimirá el aviso de `resolveTatumCredentials` en cada arranque de `AppModule`; los tests de esta
tarea son unitarios y no dependen de ello.

**Files:**

- Create: `src/config/wallets.config.ts`
- Modify: `src/config/configurations.ts`
- Test: `src/config/__tests__/wallets.config.spec.ts`
- Modify (test): `src/config/__tests__/configurations.spec.ts`

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/config/__tests__/wallets.config.spec.ts

import {
  TATUM_CHAIN,
  buildWalletsConfig,
  resolveTatumCredentials,
  walletsConfig,
} from '../wallets.config';
import { envSchema } from '../env.schema';

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('TATUM_CHAIN', () => {
  it('debería fijar ETH como la única cadena que este ciclo envía', () => {
    // Arrange + Act + Assert
    // Es decisión NUESTRA, no restricción del proveedor: medido sobre
    // docs/tatum/gas-pump/openapi.json, `CreateGasPump` admite 7 cadenas, `ActivateGasPump` 5 y
    // `TransferCustodialWallet` 6. La wallet no guarda la cadena, así que una segunda exigiría
    // una pareja expand/contract sobre el índice único.
    expect(TATUM_CHAIN).toBe('ETH');
  });
});

describe('resolveTatumCredentials', () => {
  // `console.warn` es global: un spy que sobreviva a su test se lleva por delante la salida de
  // las suites siguientes. Mismo cuidado que en `auth.config.spec.ts`.
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('debería usar las credenciales del entorno cuando las tres están definidas', () => {
    // Arrange
    const env = buildCredentialsEnv({
      NODE_ENV: 'production',
      TATUM_API_KEY: 'real-api-key',
      WALLETS_MASTER_ADDRESS: `0x${'b'.repeat(40)}`,
      WALLETS_MASTER_PRIVATE_KEY: PRIVATE_KEY_OF_ZEROS,
    });

    // Act
    const credentials = resolveTatumCredentials(env);

    // Assert
    expect(credentials.apiKey).toBe('real-api-key');
    expect(credentials.masterPrivateKey).toBe(PRIVATE_KEY_OF_ZEROS);
    expect(credentials.usingDevPlaceholders).toBe(false);
  });

  it('debería normalizar la master address a minúsculas', () => {
    // Arrange
    const env = buildCredentialsEnv({
      TATUM_API_KEY: 'real-api-key',
      WALLETS_MASTER_ADDRESS: `0x${'B'.repeat(40)}`,
      WALLETS_MASTER_PRIVATE_KEY: PRIVATE_KEY_OF_ZEROS,
    });

    // Act
    const credentials = resolveTatumCredentials(env);

    // Assert
    // Quien copia la dirección de un explorador la copia con checksum EIP-55. Este es el único
    // punto por el que entra al sistema, así que normalizarla aquí es lo que hace que ninguna
    // comparación posterior dependa de cómo la escribió el operador.
    expect(credentials.masterAddress).toBe(`0x${'b'.repeat(40)}`);
  });

  it('debería no tocar la clave privada, ni siquiera para normalizar mayúsculas', () => {
    // Arrange
    const key = `0x${'AB'.repeat(32)}`;
    const env = buildCredentialsEnv({
      TATUM_API_KEY: 'real-api-key',
      WALLETS_MASTER_ADDRESS: `0x${'b'.repeat(40)}`,
      WALLETS_MASTER_PRIVATE_KEY: key,
    });

    // Act
    const credentials = resolveTatumCredentials(env);

    // Assert
    // El proveedor no distingue mayúsculas en el hexadecimal, así que transformarla no arregla
    // nada y sí añade un sitio más donde el secreto se lee y se copia.
    expect(credentials.masterPrivateKey).toBe(key);
  });

  it('debería caer a los placeholders y avisar cuando faltan las tres credenciales', () => {
    // Arrange
    // Esta rama avisa por consola a propósito. Se silencia para no ensuciar la salida, y se
    // AFIRMA en lugar de solo taparse: sin la aserción, borrar el `console.warn` dejaría la
    // suite verde y el aviso desaparecería.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const env = buildCredentialsEnv({ NODE_ENV: 'development' });

    // Act
    const credentials = resolveTatumCredentials(env);

    // Assert
    expect(credentials.usingDevPlaceholders).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('TATUM_API_KEY');
    expect(String(warn.mock.calls[0]?.[0])).toContain('WALLETS_MASTER_ADDRESS');
    expect(String(warn.mock.calls[0]?.[0])).toContain('WALLETS_MASTER_PRIVATE_KEY');
  });

  it('debería nombrar en el aviso solo la credencial que falta', () => {
    // Arrange
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const env = buildCredentialsEnv({
      TATUM_API_KEY: 'real-api-key',
      WALLETS_MASTER_ADDRESS: `0x${'b'.repeat(40)}`,
    });

    // Act
    resolveTatumCredentials(env);

    // Assert
    // Con una credencial a medias se cae a los placeholders ENTEROS: mezclar una API key real
    // con una clave que no firma gastaría créditos para acabar en un 500. El aviso nombra la que
    // falta porque, si no, el operador vería su API key ignorada sin saber por qué.
    expect(String(warn.mock.calls[0]?.[0])).toContain('WALLETS_MASTER_PRIVATE_KEY');
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('TATUM_API_KEY');
  });

  it('debería usar 64 ceros como clave de relleno, con entropía nula a propósito', () => {
    // Arrange
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const env = buildCredentialsEnv({ NODE_ENV: 'development' });

    // Act
    const credentials = resolveTatumCredentials(env);

    // Assert
    // Es lo que permite que el placeholder viva en un archivo versionado: una cadena de ceros no
    // la confunde con una clave real ni un humano ni la regla de entropía de gitleaks. Y como
    // cero está fuera del rango [1, n-1] de secp256k1, tampoco puede firmar nada por accidente.
    expect(credentials.masterPrivateKey).toBe(PRIVATE_KEY_OF_ZEROS);
  });
});

describe('buildWalletsConfig', () => {
  it('debería trasladar el transporte, el pagador y la red tal cual desde el entorno', () => {
    // Arrange
    const env = envSchema.parse({
      ...CREDENTIALS_IN_ENV,
      TATUM_API_URL: 'http://127.0.0.1:34567',
      TATUM_TIMEOUT_MS: '7000',
      WALLETS_ACTIVATION_PAYER: 'master',
    });

    // Act
    const config = buildWalletsConfig(env);

    // Assert
    expect(config.apiUrl).toBe('http://127.0.0.1:34567');
    expect(config.timeoutMs).toBe(7_000);
    expect(config.activationPayer).toBe('master');
    expect(config.network).toBe('testnet');
  });

  it('debería no publicar la cadena como campo de configuración', () => {
    // Arrange
    const env = envSchema.parse({ ...CREDENTIALS_IN_ENV });

    // Act
    const config = buildWalletsConfig(env);

    // Assert
    // La cadena es la constante `TATUM_CHAIN` y el adaptador la importa. Publicarla también como
    // campo daría dos fuentes para el mismo dato, y la de configuración parecería cambiable
    // cuando cambiarla exige una pareja expand/contract sobre el índice único de `address`.
    expect(Object.keys(config)).not.toContain('chain');
  });
});

describe('walletsConfig', () => {
  it('debería registrarse bajo el namespace "wallets"', () => {
    // Arrange + Act
    const namespace = walletsConfig.KEY;

    // Assert
    // `registerAs` construye el token como `CONFIGURATION(<namespace>)`. Si el namespace no
    // coincide, `configService.get('wallets.…')` devuelve `undefined` sin error.
    expect(namespace).toContain('wallets');
  });

  it('debería leer el entorno en el momento de invocarse, no al importarse', () => {
    // Arrange
    process.env = { ...ORIGINAL_ENV, ...CREDENTIALS_IN_ENV, TATUM_TIMEOUT_MS: '3000' };

    // Act
    const config = walletsConfig();

    // Assert
    expect(config.timeoutMs).toBe(3_000);
  });
});

// Helpers

const PRIVATE_KEY_OF_ZEROS = `0x${'0'.repeat(64)}`;

const CREDENTIALS_IN_ENV: Readonly<Record<string, string>> = {
  TATUM_API_KEY: 'test-api-key',
  WALLETS_MASTER_ADDRESS: `0x${'b'.repeat(40)}`,
  WALLETS_MASTER_PRIVATE_KEY: PRIVATE_KEY_OF_ZEROS,
};

/**
 * `resolveTatumCredentials` recibe un `Pick` del entorno ya validado. Se construye aquí en vez
 * de parsear todo el schema porque el SUT es una función pura y no debe depender de defaults
 * que no lee.
 */
const buildCredentialsEnv = (
  overrides: {
    NODE_ENV?: 'development' | 'test' | 'staging' | 'production';
    TATUM_API_KEY?: string;
    WALLETS_MASTER_ADDRESS?: string;
    WALLETS_MASTER_PRIVATE_KEY?: string;
  } = {},
): Parameters<typeof resolveTatumCredentials>[0] => ({
  NODE_ENV: 'development',
  TATUM_API_KEY: undefined,
  WALLETS_MASTER_ADDRESS: undefined,
  WALLETS_MASTER_PRIVATE_KEY: undefined,
  ...overrides,
});
```

Y el caso de registro, que va en el spec de `configurations.ts` por la regla 1:1. Se añade
**después** del `describe('authConfig', …)` y antes de la línea `// Helpers`:

```ts
// src/config/__tests__/configurations.spec.ts  (bloque nuevo)

describe('configurations', () => {
  it('debería registrar el namespace de wallets en la lista que carga ConfigModule', () => {
    // Arrange + Act + Assert
    // Sin esta línea el módulo `wallets` compila, arranca y falla en la primera petición con
    // `Cannot read properties of undefined`: `ConfigModule.forRoot({ load })` es lo único que
    // convierte el factory en un provider inyectable.
    expect(configurations).toContain(walletsConfig);
  });
});
```

```ts
// src/config/__tests__/configurations.spec.ts  (añadir al bloque de imports)

import { configurations } from '../configurations';
import { walletsConfig } from '../wallets.config';
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/config/__tests__/wallets.config.spec.ts`
Expected: FAIL — `Cannot find module '../wallets.config' from 'src/config/__tests__/wallets.config.spec.ts'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/config/wallets.config.ts

import { registerAs } from '@nestjs/config';

import { envSchema, type Env } from './env.schema';

/**
 * La cadena que este ciclo envía en el campo `chain` de las cuatro operaciones que usa.
 *
 * ⚠️ Es decisión NUESTRA, no una restricción del proveedor: medido sobre
 * `docs/tatum/gas-pump/openapi.json`, `CreateGasPump` admite 7 cadenas, `ActivateGasPump` 5 y
 * `TransferCustodialWallet` 6. Y la RED —testnet o mainnet— no viaja en ningún cuerpo: la decide
 * la API key, que es el motivo de que no exista campo de red en ninguno de los 32 esquemas.
 *
 * Es una CONSTANTE y no un campo de `WalletsConfig` a propósito: un campo de configuración
 * parecería cambiable, y añadir una segunda cadena no es cambiar un valor. La tabla `wallets` no
 * guarda la cadena, así que el índice único de `address` pasaría a ser ambiguo y haría falta una
 * pareja expand/contract sobre él.
 */
export const TATUM_CHAIN = 'ETH';

/**
 * Placeholders de desarrollo, mismo criterio que `resolveJwtSecret()`: fuera de
 * `development`/`test` el refine de `env.schema.ts` ya impidió arrancar sin credenciales, así que
 * esta rama no se alcanza en staging ni en production.
 *
 * ⚠️ La clave son `0x` + 64 CEROS y la entropía nula es el punto, no un descuido. Dos
 * consecuencias, las dos buscadas:
 *
 *  1. Puede vivir en un archivo versionado sin que nadie —ni un humano ni la regla de entropía
 *     de gitleaks, que es el gate real: `secretlint` con el `.secretlintrc.json` de este repo da
 *     cero avisos ante una clave privada de Ethereum, medido ejecutándolo— la confunda con una
 *     clave de verdad.
 *  2. Cero está fuera del rango `[1, n-1]` que secp256k1 exige a una clave privada, así que no
 *     puede firmar nada por accidente. (Hecho matemático de la curva; no se ha medido cómo lo
 *     rechaza exactamente `@noble/curves`.)
 *
 * La dirección es la dirección cero, la única que todo el ecosistema lee como «esto no es una
 * cuenta». No se deriva de la clave —no se puede, ver el punto 2— y por eso existe
 * `usingDevPlaceholders`: la comprobación de arranque que ata dirección y clave tiene que poder
 * saltarse justo aquí, o `pnpm start:dev` dejaría de arrancar en un clon recién hecho.
 */
const DEV_ONLY_API_KEY = 'development-placeholder-without-credits';
const DEV_ONLY_MASTER_ADDRESS = `0x${'0'.repeat(40)}`;
const DEV_ONLY_MASTER_PRIVATE_KEY = `0x${'0'.repeat(64)}`;

export type TatumCredentials = {
  apiKey: string;
  masterAddress: string;
  /**
   * ⚠️ String plano, y no puede ser otra cosa: el gate de fronteras solo permite
   * `config → config`, así que desde aquí no se alcanza ni el shared kernel ni un módulo, y el
   * value object que envuelve el secreto no puede vivir en esta carpeta. Lo envuelve el
   * adaptador en su constructor. Es un hecho de la matriz de fronteras, no una preferencia.
   */
  masterPrivateKey: string;
  /**
   * `true` cuando los tres valores de arriba son los placeholders de desarrollo.
   *
   * Existe para una cosa concreta: la comprobación de arranque que deriva la dirección desde la
   * clave privada no puede correr sobre el placeholder, porque la clave de ceros no es un escalar
   * válido de secp256k1. Sin este flag habría que elegir entre no hacer la comprobación nunca o
   * romper `pnpm start:dev` en un clon recién hecho.
   *
   * No viene de ninguna variable de entorno: es derivado, y por eso no está en la tabla de
   * variables del `.env.example`.
   */
  usingDevPlaceholders: boolean;
};

export type WalletsConfig = TatumCredentials & {
  apiUrl: string;
  timeoutMs: number;
  /**
   * `'tatum'` cobra la comisión de la activación contra la cuota de créditos (cuerpo
   * `ActivateGasPumpTatum`, con `feesCovered: true`); `'master'` la paga en ETH firmando con la
   * clave de la master (cuerpo `ActivateGasPump`, con `fromPrivateKey`). Son los dos únicos
   * esquemas de `POST /v3/gas-pump/activate` aplicables a ETH.
   */
  activationPayer: Env['WALLETS_ACTIVATION_PAYER'];
  /**
   * Solo puede valer `'testnet'`: el refine de `env.schema.ts` veta `mainnet` al arrancar. El
   * tipo conserva la unión en vez de estrecharse con un `as` porque un `as` afirmaría en el tipo
   * lo que de verdad garantiza una validación en tiempo de ejecución — y si alguien retira ese
   * refine, el compilador debe volver a enseñar las dos ramas.
   */
  network: Env['WALLETS_NETWORK'];
};

/**
 * ⚠️ Con una credencial a medias se cae a los placeholders ENTEROS, no a una mezcla. Mezclar una
 * API key real con una clave que no puede firmar gastaría créditos del plan para acabar en un
 * error del proveedor; el aviso nombra las que faltan porque, si no, el operador vería su API key
 * ignorada sin ninguna pista de por qué.
 *
 * El aviso nombra VARIABLES, nunca valores: este archivo es el único punto por el que la clave
 * privada entra al sistema y no debe aparecer en un log, en un mensaje de error ni en un `cause`.
 */
export const resolveTatumCredentials = (
  env: Pick<
    Env,
    'NODE_ENV' | 'TATUM_API_KEY' | 'WALLETS_MASTER_ADDRESS' | 'WALLETS_MASTER_PRIVATE_KEY'
  >,
): TatumCredentials => {
  const missing = (
    [
      ['TATUM_API_KEY', env.TATUM_API_KEY],
      ['WALLETS_MASTER_ADDRESS', env.WALLETS_MASTER_ADDRESS],
      ['WALLETS_MASTER_PRIVATE_KEY', env.WALLETS_MASTER_PRIVATE_KEY],
    ] as const
  )
    .filter(([, value]) => value === undefined)
    .map(([name]) => name);

  if (
    env.TATUM_API_KEY !== undefined &&
    env.WALLETS_MASTER_ADDRESS !== undefined &&
    env.WALLETS_MASTER_PRIVATE_KEY !== undefined
  ) {
    return {
      apiKey: env.TATUM_API_KEY,
      // Quien copia la dirección de un explorador la copia con checksum EIP-55. Este es el único
      // punto por el que entra al sistema, así que normalizarla aquí es lo que hace que ninguna
      // comparación posterior dependa de cómo la escribió el operador. La clave privada NO se
      // toca: el hexadecimal es indiferente a mayúsculas para el proveedor, y transformarla solo
      // añadiría un sitio más donde el secreto se lee y se copia.
      masterAddress: env.WALLETS_MASTER_ADDRESS.toLowerCase(),
      masterPrivateKey: env.WALLETS_MASTER_PRIVATE_KEY,
      usingDevPlaceholders: false,
    };
  }

  // El refine de `env.schema.ts` garantiza que solo development/test llegan aquí.
  console.warn(
    `[wallets] ${missing.join(', ')} sin definir: usando los placeholders de desarrollo. ` +
      'La clave de relleno son 64 ceros y no puede firmar, así que los endpoints de /wallets ' +
      'fallarán en la primera llamada al proveedor. No sirve para staging/production (el ' +
      'arranque fallaría).',
  );

  return {
    apiKey: DEV_ONLY_API_KEY,
    masterAddress: DEV_ONLY_MASTER_ADDRESS,
    masterPrivateKey: DEV_ONLY_MASTER_PRIVATE_KEY,
    usingDevPlaceholders: true,
  };
};

export const buildWalletsConfig = (env: Env): WalletsConfig => ({
  apiUrl: env.TATUM_API_URL,
  timeoutMs: env.TATUM_TIMEOUT_MS,
  activationPayer: env.WALLETS_ACTIVATION_PAYER,
  network: env.WALLETS_NETWORK,
  ...resolveTatumCredentials(env),
});

export const walletsConfig = registerAs('wallets', (): WalletsConfig =>
  buildWalletsConfig(envSchema.parse(process.env)),
);
```

```ts
// src/config/configurations.ts

import { appConfig, type AppConfig } from './app.config';
import { authConfig, type AuthConfig } from './auth.config';
import { corsConfig, type CorsConfig } from './cors.config';
import { databaseConfig, type DatabaseConfig } from './database.config';
import { docsConfig, type DocsConfig } from './docs.config';
import { logConfig, type LogConfig } from './log.config';
import { throttlerConfig, type ThrottlerConfigValues } from './throttler.config';
import { walletsConfig, type WalletsConfig } from './wallets.config';

/** Los namespaces que `ConfigModule.forRoot({ load })` registra. Vivía en el barrel de config. */
export const configurations = [
  appConfig,
  corsConfig,
  databaseConfig,
  logConfig,
  throttlerConfig,
  docsConfig,
  authConfig,
  walletsConfig,
];

export type Configurations = {
  app: AppConfig;
  cors: CorsConfig;
  database: DatabaseConfig;
  log: LogConfig;
  throttler: ThrottlerConfigValues;
  docs: DocsConfig;
  auth: AuthConfig;
  wallets: WalletsConfig;
};
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/config/__tests__/wallets.config.spec.ts src/config/__tests__/configurations.spec.ts`
Expected: PASS — 11 passed en `wallets.config.spec.ts` y la suite de `configurations.spec.ts`
completa en verde con su caso nuevo.

Run: `pnpm typecheck && pnpm lint:check`
Expected: PASS — sin salida en ninguno de los dos.

---

### Task 15: La sección de `.env.example` y su tabla en el README

**Layer:** bootstrap — documentación de configuración, sin código
**Rule codes to honor:** `devops-use-config-module`

**Casos acordados:** no aplica. Son documentación y `.env.example`; la exención de `CLAUDE.md`
nombra «infra, config, wiring y docs» explícitamente.

⚠️ **La clave privada va COMENTADA Y SIN VALOR, igual que `# JWT_SECRET=`, y la API key también.**
`secretlint` **no** es el gate aquí: con el `.secretlintrc.json` de este repo, un `.env.example`
con una clave privada de Ethereum da cero avisos, porque `preset-recommend` dispara con formas
conocidas y no trae regla de entropía genérica. El gate real es **gitleaks**, cuya regla genérica
combina palabra clave y entropía — y su barrido del historial completo solo corre en el cron
semanal, nunca en el PR, así que ejecutarlo a mano antes del primer commit no es opcional.

Las siete variables documentadas son las mismas siete que valida `env.schema.ts`: cuatro con valor
activo (`TATUM_API_URL`, `TATUM_TIMEOUT_MS`, `WALLETS_ACTIVATION_PAYER`, `WALLETS_NETWORK`) y tres
comentadas (`TATUM_API_KEY`, `WALLETS_MASTER_ADDRESS`, `WALLETS_MASTER_PRIVATE_KEY`). La cadena no
aparece: es la constante `TATUM_CHAIN` y no se configura.

**Files:**

- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Escribe el test que falla**

No hay test nuevo que escribir: el guardarraíl ya existe y es
`src/__tests__/secretlint.spec.ts:94`, «debería aceptar el contenido actual de `.env.example`»,
que lee el archivo del disco y lo pasa por el mismo `.secretlintrc.json` del hook de pre-commit.
Se ejecuta **antes** de tocar nada para tener la línea base:

Run: `pnpm test src/__tests__/secretlint.spec.ts`
Expected: PASS — la suite en verde sobre el `.env.example` actual. Es la referencia contra la que
se compara después del cambio.

Y la medición de los números que el README publica, que hay que rehacer al final:

```bash
grep -cE '^[A-Z_]+=' .env.example     # asignaciones activas — medido hoy: 36
grep -cE '^# [A-Z_]+=' .env.example   # comentadas          — medido hoy: 8
grep -cE '^#? ?[A-Z_]+=' .env.example # total               — medido hoy: 44
```

⚠️ El README dice «43 variables» y el grep cuenta 44. La diferencia es `DB_DATABASE_TEST`, la
única que el propio README declara fuera de la validación — **inferencia, no medición**. Vuelve a
correr los tres greps al terminar y ajusta ambos números del README a lo que salga, en vez de
sumar 7 sobre el número publicado.

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Este paso no tiene rojo previo que provocar, y decirlo es preferible a inventarse uno: la tarea no
añade comportamiento, añade documentación. Lo que sí se comprueba es que el gate **existe y
funciona** antes de confiar en él, rompiéndolo a propósito:

Run: `printf 'AWS_SECRET_ACCESS_KEY=%s\n' "$(head -c 30 /dev/zero | tr '\0' 'A')" >> .env.example && pnpm test src/__tests__/secretlint.spec.ts; git checkout -- .env.example`
Expected: FAIL — el caso «debería aceptar el contenido actual de .env.example» rojo, nombrando la
regla de AWS. Si sale verde, el gate no está mirando el archivo y arreglar eso es lo primero.

⚠️ La última orden (`git checkout -- .env.example`) restaura el archivo. Compruébalo con
`git status` antes de seguir: el resto de la tarea escribe sobre ese mismo archivo.

- [ ] **Step 3: Escribe la implementación mínima**

La sección nueva va **al final** de `.env.example`, como un bloque de primer nivel detrás de
«Base de datos de los tests», con el mismo marco de guiones que usan los demás bloques del
archivo:

```bash
# .env.example  (añadir al final del archivo)

# -----------------------------------------------------------------------------
#  Wallets — direcciones Ethereum custodiadas (Tatum Gas Pump)
# -----------------------------------------------------------------------------
#
#  Con las tres credenciales sin definir la app ARRANCA y todo lo demás funciona:
#  el módulo cae a unos placeholders de desarrollo y avisa por consola en cada
#  arranque. Lo que NO funciona son los cinco endpoints de /wallets, que fallan en
#  su primera llamada al proveedor. Es a propósito: levantar esta API no puede
#  exigir darse de alta en Tatum.
#
#  ⚠️ En staging y production las tres son OBLIGATORIAS y la app NO ARRANCA sin
#     ellas. Mismo veto que JWT_SECRET y por el mismo motivo: el placeholder de la
#     clave privada son 64 ceros y está publicado en este repositorio.
#
#  ⚠️ MODELO CUSTODIAL. Una gas pump address es un CONTRATO: no tiene clave
#     privada y no hay ninguna que entregar al usuario. Quien firma es siempre la
#     master, que es la cuenta del admin. Nadie recibe una clave.
#
#  La cadena NO es una variable: es la constante TATUM_CHAIN='ETH' de
#  src/config/wallets.config.ts. Cambiarla no es editar un valor — la tabla
#  `wallets` no guarda la cadena, así que su índice único de `address` pasaría a
#  ser ambiguo y haría falta una pareja expand/contract sobre él.

# TATUM_API_KEY — cabecera `x-api-key` de todas las llamadas al proveedor.
#   ⚠️ ES LA API KEY LA QUE DECIDE LA RED. No hay campo de red en ninguno de los
#      32 esquemas de docs/tatum/gas-pump/openapi.json: una key de testnet habla
#      con testnet y una de mainnet con mainnet. WALLETS_NETWORK, más abajo, NO
#      cambia de red — solo declara cuál crees que es tu key.
#   Créditos por llamada en el plan gratuito: derivar 2, comprobar 1, activar 2,
#   transferir 2. Y 5 llamadas por segundo.
#
# WALLETS_MASTER_ADDRESS — la cuenta del admin, bajo la que se derivan TODAS las
# direcciones de los usuarios. Formato: 0x + 40 hexadecimales. Se acepta con
# checksum EIP-55 (mayúsculas) y se normaliza a minúsculas al leerla.
#   ⚠️ NO ESTÁ EN LA TABLA `wallets`. Responder "qué direcciones controlamos"
#      exige mirar la tabla Y esta variable — y esta es justo la que tiene los
#      fondos de gas. Quien lo olvide se dejará fuera la única que importa.
#   ⚠️ Tiene que ser la dirección de WALLETS_MASTER_PRIVATE_KEY. Si son de dos
#      cuentas distintas, derivar y activar funcionan (usan la dirección) y
#      transferir falla (firma con la clave), con el gas ya gastado. Por eso el
#      arranque deriva una desde la otra y las compara.
#
# WALLETS_MASTER_PRIVATE_KEY — la clave que FIRMA cada transferencia, y también
# cada activación cuando WALLETS_ACTIVATION_PAYER=master. Formato: 0x + 64
# hexadecimales, 66 caracteres en total, que es lo que el proveedor exige en
# `fromPrivateKey` para ETH.
#   ⚠️ ES EL ÚNICO SECRETO DE ESTE SISTEMA QUE NO ES UN HASH, y viaja en el
#      CUERPO de cada transferencia al proveedor. Quien la tenga puede vaciar el
#      fondo de gas y mover los activos de todas las direcciones derivadas.
#   ⚠️ Mientras siga aquí y no en un KMS, mainnet está vetada en el arranque.
#   En un despliegue se inyecta como secreto del orquestador. Nunca en el
#   repositorio: el hook de pre-commit escanea todo archivo staged, y `git commit
#   --no-verify` lo salta — la red real es gitleaks en CI.
#
# ⚠️ LAS TRES VAN COMENTADAS Y SIN VALOR a propósito, igual que JWT_SECRET.
#    Descomentar una dejándola vacía IMPIDE EL ARRANQUE: para el validador, vacía
#    es un valor de cero caracteres, no una variable ausente.
#    Y si defines solo una o dos, las tres se ignoran y se usan los placeholders:
#    mezclar una API key real con una clave que no puede firmar gastaría créditos
#    para acabar en un error. El aviso de arranque nombra las que faltan.
# TATUM_API_KEY=
# WALLETS_MASTER_ADDRESS=
# WALLETS_MASTER_PRIVATE_KEY=

# TATUM_API_URL — origen del proveedor. Solo se cambia para apuntar a un stub
# local; la suite E2E lo hace por su cuenta y no lee este valor.
TATUM_API_URL=https://api.tatum.io

# TATUM_TIMEOUT_MS — corte de cada llamada al proveedor.
#   ⚠️ DEBE SER ESTRICTAMENTE MENOR QUE REQUEST_TIMEOUT_MS, y el validador lo
#      exige: si el corte global llega primero, el interceptor responde 408 con la
#      llamada al proveedor todavía en vuelo, y la fila del libro de
#      transferencias se queda en `submitting` — el único estado del que nadie
#      sabe salir — en lugar de en `unknown`, que es lo que de verdad sabemos.
#      El empate también se rechaza: dos temporizadores compitiendo dan un
#      resultado que depende del orden de los timers.
TATUM_TIMEOUT_MS=10000

# WALLETS_ACTIVATION_PAYER — tatum | master. Quién paga la comisión de la
# transacción que activa una dirección, que es lo mismo que decir cuál de los dos
# cuerpos de POST /v3/gas-pump/activate se envía.
#   tatum  : cuerpo `ActivateGasPumpTatum` con `feesCovered: true`. La comisión se
#            cobra contra la cuota de créditos — 1 crédito en testnet — y NO toca
#            el saldo en ETH de la master.
#   master : cuerpo `ActivateGasPump` con `fromPrivateKey`. La comisión sale del
#            ETH de la master, y entonces su saldo pasa a ser un punto único de
#            fallo que hoy nadie vigila.
#   ⚠️ No hay un tercer valor: son los dos únicos esquemas del proveedor
#      aplicables a ETH.
WALLETS_ACTIVATION_PAYER=tatum

# WALLETS_NETWORK — testnet | mainnet. Declara en qué red crees que está tu API
# key; la red efectiva la decide ella, no esto.
#   ⚠️ `mainnet` IMPIDE EL ARRANQUE, a propósito y con mensaje propio. La clave
#      privada de la master vive en configuración en claro y viaja en el cuerpo de
#      cada transferencia: con dinero real, cualquiera de las fugas que hoy están
#      tapadas a mano pasa de incidente a robo. La condición de salida es el
#      sistema de gestión de claves del proveedor, que además cambia lo que
#      devuelve un envío (un identificador de firma en vez de un hash).
WALLETS_NETWORK=testnet
```

En el README, la tabla de «Qué poner en tu `.env`» recibe una fila —las tres van juntas porque se
descomentan juntas— justo debajo de la de `ADMIN_EMAIL · ADMIN_PASSWORD`:

```md
| `TATUM_API_KEY` · `WALLETS_MASTER_ADDRESS` · `WALLETS_MASTER_PRIVATE_KEY` | vayas a usar los endpoints de `/wallets`, y **siempre** en `staging`/`production` | **las tres o ninguna**: con una o dos, se ignoran y se usan los placeholders. Dirección `0x` + 40 hex, clave `0x` + 64 hex, y las dos de la **misma** cuenta o el arranque falla |
```

Y una sección nueva de inventario, detrás de `### PostgreSQL` y antes del `---` que cierra el
bloque de variables:

```md
### Wallets (Ethereum · Tatum Gas Pump)

| Variable                             | Default                          | ¿Tocarla?    | Notas                                                                                                                                                                                                                                                                                           |
| ------------------------------------ | -------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TATUM_API_KEY`                      | _(sin valor)_                    | **Prod: sí** | Cabecera `x-api-key` de todas las llamadas. **Es la key la que decide la red**: no hay campo de red en ninguno de los 32 esquemas del proveedor. Sin ella se usan los placeholders de desarrollo y `/wallets` falla en la primera llamada.                                                      |
| `WALLETS_MASTER_ADDRESS`             | _(sin valor)_                    | **Prod: sí** | La cuenta del admin, bajo la que se derivan todas las de los usuarios. `0x` + 40 hex, se acepta con checksum EIP-55. **No está en la tabla `wallets`**: para saber qué direcciones controlamos hay que mirar la tabla **y** esta variable.                                                      |
| `WALLETS_MASTER_PRIVATE_KEY`         | _(sin valor)_                    | **Prod: sí** | Firma cada transferencia, y cada activación si `WALLETS_ACTIVATION_PAYER=master`; `0x` + 64 hex. **El único secreto del sistema que no es un hash**, y viaja en el cuerpo de cada transferencia. Debe ser la clave de `WALLETS_MASTER_ADDRESS`: el arranque deriva una desde la otra y compara. |
| `TATUM_API_URL` / `TATUM_TIMEOUT_MS` | `https://api.tatum.io` / `10000` | Opcional     | `TATUM_TIMEOUT_MS` debe ser **estrictamente menor** que `REQUEST_TIMEOUT_MS`, y el validador lo exige: si no, el 408 global llega primero y la fila del libro queda en `submitting` con la llamada en vuelo. La URL solo se cambia para apuntar a un stub local.                                |
| `WALLETS_ACTIVATION_PAYER`           | `tatum`                          | Opcional     | Elige el cuerpo de `POST /v3/gas-pump/activate`: `tatum` cobra la comisión contra la cuota de créditos (`feesCovered: true`), `master` la paga en ETH firmando con la clave (`fromPrivateKey`). Con `master`, el saldo de la master pasa a ser un punto único de fallo que nadie vigila.        |
| `WALLETS_NETWORK`                    | `testnet`                        | No           | **`mainnet` impide el arranque**, a propósito: la clave de la master vive en configuración en claro. La condición de salida es el KMS del proveedor, que cambia lo que devuelve un envío.                                                                                                       |
```

⚠️ Las tres credenciales son **obligatorias fuera de `development`/`test`**, igual que
`JWT_SECRET`. Si esa frase no aparece en la tabla tal y como está escrita arriba, añádela: es la
única de estas seis filas que puede tumbar un despliegue.

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm exec secretlint --maskSecrets .env.example`
Expected: PASS — sin hallazgos. ⚠️ Y **eso no demuestra nada por sí solo**: medido ejecutándolo,
este `.secretlintrc.json` da cero avisos ante una clave privada de Ethereum, tanto de ceros como
con aspecto realista. Es la comprobación barata, no el gate.

Run: `pnpm test src/__tests__/secretlint.spec.ts`
Expected: PASS — «debería aceptar el contenido actual de .env.example» en verde. Es el mismo
motor, ejecutado por CI en cada PR.

Run: `docker run --rm -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:v8.30.1 dir /repo --redact --verbose`
Expected: PASS — `no leaks found`. Éste **sí** es el gate: su regla genérica combina palabra clave
y entropía, que es lo que caza una clave privada. La versión es la misma que fija
`.github/workflows/security.yml` (`GITLEAKS_VERSION: '8.30.1'`).
⚠️ **No se ejecutó al redactar el plan** — no hay medición que enseñar aquí. Dos cosas que
comprobar al correrlo: `--redact` evita que el propio hallazgo se imprima en claro, y si la imagen
responde `unknown command "dir"`, la forma antigua es
`detect --no-git --source /repo --redact --verbose`.
⚠️ Y una advertencia que hay que tener escrita: este barrido mira el **árbol de trabajo**. El
barrido del **historial** solo corre en el cron semanal de `security.yml` y en un
`workflow_dispatch`, nunca en el PR — así que si una clave llega a entrar en un commit, esta
orden ya no la ve.

Run: `pnpm format:check`
Expected: PASS. Si falla por las tablas del README, `pnpm format` las realinea: Prettier cubre
`*.md` en la raíz y `.env.example` no entra en sus globs.

Run: los tres `grep -cE` del Step 1
Expected: 40 activas, 11 comentadas, 51 en total — las cuatro asignaciones activas y las tres
comentadas de la sección nueva, sobre los 36 / 8 / 44 medidos en el Step 1. Con esos números,
actualiza en el README la frase «De las 43 variables…» y las dos menciones a «las 8 líneas
comentadas» a lo que hayas medido, no a lo que dice este plan: el 43 sale de restar
`DB_DATABASE_TEST` del total, así que pasa a ser 50, y el 8 pasa a ser 11.

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: PASS los tres. Ninguno debería verse afectado por esta tarea; se corren para dejarlo
comprobado y no supuesto.

---

### Task 16: Fakes de puertos, factorías de entidades, arbitrarios de paginación y el actor de sistema de la reconciliación

**Layer:** common
**Rule codes to honor:** `test-mock-external-services`, `di-use-interfaces-tokens`, `arch-single-responsibility`

Esta tarea es el andamio de las cinco siguientes: los cinco fakes escritos A MANO que las suites de
`application/` usan en lugar de `jest.mock`, las dos factorías de entidades que evitan copiar el
mismo constructor en seis specs, los dos arbitrarios de paginación que faltan en el catálogo del
módulo, y la constante `SYSTEM_ACTORS.ACTIVATION_RECONCILIATION` que las tareas 19 y 20 necesitan
para atribuir la curación de la activación a quien de verdad la hizo.

**Contrato consumido de las tareas anteriores.** Estos fakes implementan los cinco puertos tal y
como los declaran las tareas del dominio, firma por firma:

```ts
// domain/ports/owner.directory.ts
export abstract class OwnerDirectory {
  abstract exists(ownerId: string): Promise<boolean>;
}

// domain/ports/wallet.repository.ts
export type WalletSaveOutcome = 'saved' | 'owner-conflict';
export abstract class WalletRepository {
  abstract findByOwnerId(ownerId: string): Promise<Wallet | null>;
  abstract save(wallet: Wallet): Promise<WalletSaveOutcome>;
}

// domain/ports/wallet-transfer.repository.ts
export type FindTransfersCriteria = { ownerId: string; page: number; limit: number };
export type TransferPage = { items: readonly WalletTransfer[]; total: number };
export abstract class WalletTransferRepository {
  abstract save(transfer: WalletTransfer): Promise<void>;
  abstract findByOwner(criteria: FindTransfersCriteria): Promise<TransferPage>;
}

// domain/ports/address-index.allocator.ts
export abstract class AddressIndexAllocator {
  abstract next(): Promise<AddressIndex>;
}

// domain/ports/custodial-address.gateway.ts
export type SendCommand = {
  from: EthereumAddress;
  recipient: EthereumAddress;
  asset: TransferAsset;
};
export abstract class CustodialAddressGateway {
  abstract masterAddress(): EthereumAddress;
  abstract deriveAddress(index: AddressIndex): Promise<EthereumAddress>;
  abstract enableSending(index: AddressIndex): Promise<TransactionHash>;
  abstract isSendingEnabled(index: AddressIndex): Promise<boolean>;
  abstract send(command: SendCommand): Promise<TransactionHash>;
}
```

⚠️ **`save` del repositorio de wallets devuelve un desenlace y no `void`, y esa es la decisión de
diseño que hace verdadera la frase del spec «`WalletAlreadyAssignedError` no existe: no tiene
productor posible».** El `23505` de `user_id` es la carrera normal de dos altas del mismo usuario,
no una violación de invariante, así que viaja como RESULTADO —la misma regla que
`docs/module-blueprint.md` §4 escribe para los fallos de negocio que cruzan una frontera— y no como
excepción. Si fuese una clase de error existiría un 409 publicable que `POST /wallets` no declara;
con el desenlace, el único que puede leerlo es `AssignWalletUseCase`, que relee y responde 200. Los
otros dos `23505` (`address_index`, `address`) sí son violaciones de invariante y siguen lanzando
sus errores ruidosos de 500.

⚠️ **`enableSending` e `isSendingEnabled` reciben un ÍNDICE, no una dirección**, y `deriveAddress`
recibe solo el índice: la master la aporta el adaptador desde la configuración. Lo arbitra la API
del proveedor —`POST /v3/gas-pump/activate` toma índices y
`GET /v3/gas-pump/activated/{chain}/{owner}/{index}` lo lleva en la ruta—, no el gusto. Por eso las
listas de llamadas de la pasarela de mentira guardan `AddressIndex` y no `EthereumAddress`.

Además, del dominio y de los errores se consume esta superficie:

```ts
Wallet.assign({ id, ownerId, ownerAddress, addressIndex, address, now, createdBy }): Wallet
wallet.assertOwnedBy(master: EthereumAddress): void   // lanza WalletOwnerMismatchError
wallet.assertCanSend(): void                          // lanza WalletNotActivatedError(status)
wallet.markActivationRequested(txId: TransactionHash, now: Date, by: string | null): void
wallet.confirmActivated(now: Date, by: string | null): void
wallet.status: WalletStatus                           // 'receive-only' | 'activating' | 'active'
wallet.canSend: boolean
wallet.id / ownerId / ownerAddress / addressIndex / address / activationTxId
wallet.toSnapshot(): WalletSnapshot

WalletTransfer.start({ id, ownerId, from, recipient, asset, now, createdBy }): WalletTransfer
transfer.markSubmitted(txId: TransactionHash, now: Date, by: string | null): void
transfer.markRejected(reason: ProviderFailureReason, now: Date, by: string | null): void
transfer.markUnknown(reason: ProviderFailureReason, now: Date, by: string | null): void
transfer.status: TransferStatus                       // 'submitting' | 'submitted' | 'rejected' | 'unknown'
transfer.id / ownerId / from / recipient / asset / txId
transfer.toSnapshot(): WalletTransferSnapshot

TransferAsset.fromParts(parts: TransferAssetParts): TransferAsset
export type TransferAssetParts = { kind: string; tokenAddress?: string; amount?: string; tokenId?: string };

// domain/errors/wallet.errors.ts — los que consumen los casos de uso
new AdminUsesMasterAddressError()
new WalletOwnerGoneError(ownerId: string)
new WalletNotFoundError(ownerId: string)
new WalletAssignmentLostError(ownerId: string)
new WalletNotActivatedError(status: WalletStatus)
new WalletActivationInProgressError()
new WalletAlreadyActivatedError()
abstract class WalletProviderError extends WalletDomainError {
  readonly reason: ProviderFailureReason;
  readonly providerStatus: number | null;
}
new WalletProviderRejectedError(reason: ProviderFailureReason, providerStatus: number | null)
new WalletProviderUnreachableError(reason: ProviderFailureReason, providerStatus: number | null)
new WalletProviderUnavailableError(reason: ProviderFailureReason, providerStatus: number | null)
```

`WalletProviderError` es el padre abstracto de las tres clases del proveedor y lleva el `reason`: el
caso de uso de la transferencia necesita copiar ese código al libro con UN solo `instanceof`, y el
padre no ensancha el mapeo del filtro, que discrimina las clases concretas. Es el mismo patrón que
`WalletDomainError` como marcador del contexto.

⚠️ **`toSnapshot()` lo tienen las DOS entidades.** Los fakes del libro registran el snapshot y no la
referencia, y sin ese método no habría forma de guardar el estado del instante del guardado.

**Archivos que esta tarea NO toca.** `eslint.config.mjs` lo edita **solo la Task 41**, con la lista
cerrada final de datos que acompañan a un puerto (`WalletSaveOutcome`, `FindTransfersCriteria`,
`TransferPage`, `SendCommand`); `test/setup-env.ts` lo edita **solo la Task 43**. Los fakes y las
factorías viven en `__tests__/`, que `boundaries/ignore` excluye del gate de fronteras, así que
ninguno de los dos archivos hace falta aquí.

**Casos acordados** (solo la parte de `src/shared/domain/`; los fakes, las factorías y los
arbitrarios son andamio de pruebas y quedan exentos por la regla ya escrita — se ejercitan enteros
en las tareas 17-21):

| #   | Caso (se vuelve el `it`)                                               | Entrada / estado inicial                          | Resultado esperado                                                                   |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| S1  | debería nombrar los cuatro orígenes automáticos que hoy escriben filas | `Object.keys(SYSTEM_ACTORS)` tras añadir el nuevo | `['ACTIVATION_RECONCILIATION', 'ADMIN_SEED', 'OUTBOX_RELAY', 'PUBLIC_REGISTRATION']` |

Los dos `it.each` que ya viven en `system-actor.spec.ts` —«no tener forma de UUID v4» y «llevar el
prefijo»— recorren `Object.values(SYSTEM_ACTORS)`, así que el actor nuevo entra en ellos sin declarar
un `it` más: la tabla no gana fila porque no se escribe ningún `it` nuevo, y la cobertura del actor
nuevo sí crece. Es la única fila de la tabla porque es el único `it` que esta tarea escribe.

**Files:**

- Modify: `src/shared/domain/system-actor.ts`
- Test: `src/shared/__tests__/domain/system-actor.spec.ts`
- Create: `src/modules/wallets/__tests__/helpers/in-memory-wallet.repository.ts`
- Create: `src/modules/wallets/__tests__/helpers/in-memory-wallet-transfer.repository.ts`
- Create: `src/modules/wallets/__tests__/helpers/fake-custodial-address.gateway.ts`
- Create: `src/modules/wallets/__tests__/helpers/fake-address-index.allocator.ts`
- Create: `src/modules/wallets/__tests__/helpers/fake-owner.directory.ts`
- Create: `src/modules/wallets/__tests__/helpers/wallet.factory.ts`
- Create: `src/modules/wallets/__tests__/helpers/wallet-transfer.factory.ts`
- Modify: `src/modules/wallets/__tests__/helpers/arbitraries.ts` (lo crea la Task 1 con los
  arbitrarios del dominio; aquí solo se le añaden los dos de paginación)

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/shared/__tests__/domain/system-actor.spec.ts
import { SYSTEM_ACTOR_PREFIX, SYSTEM_ACTORS } from '../../domain/system-actor';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const actors = Object.values(SYSTEM_ACTORS);

describe('SYSTEM_ACTORS', () => {
  describe('la garantía que hace seguro compartir columna con los ids de usuario', () => {
    // `created_by` es una sola columna `varchar` para actores humanos y automáticos. Si un
    // actor de sistema pudiera tener forma de UUID v4, una consulta de auditoría por id de
    // usuario podría atribuirle a una persona lo que hizo un proceso.
    it.each(actors)('debería no tener forma de UUID v4: %s', (actor) => {
      // Arrange & Act
      const looksLikeUserId = UUID_V4.test(actor);

      // Assert
      expect(looksLikeUserId).toBe(false);
    });

    it.each(actors)('debería llevar el prefijo que lo identifica como automático: %s', (actor) => {
      // Arrange & Act
      const prefixed = actor.startsWith(SYSTEM_ACTOR_PREFIX);

      // Assert
      expect(prefixed).toBe(true);
    });

    it('debería no repetir ningún valor entre actores distintos', () => {
      // Arrange & Act
      const unique = new Set(actors);

      // Assert
      // Dos claves con el mismo valor harían indistinguibles dos orígenes en la traza, que es
      // exactamente lo que este catálogo existe para evitar.
      expect(unique.size).toBe(actors.length);
    });
  });

  describe('el catálogo', () => {
    it('debería nombrar los cuatro orígenes automáticos que hoy escriben filas', () => {
      // Arrange & Act
      const names = Object.keys(SYSTEM_ACTORS).sort();

      // Assert
      // Cerrado a propósito: un origen nuevo añade su constante Y esta lista, en el mismo
      // cambio. Sin la lista, un actor añadido a medias pasaría inadvertido.
      expect(names).toEqual([
        'ACTIVATION_RECONCILIATION',
        'ADMIN_SEED',
        'OUTBOX_RELAY',
        'PUBLIC_REGISTRATION',
      ]);
    });
  });
});
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/shared/__tests__/domain/system-actor.spec.ts`
Expected: FAIL — `debería nombrar los cuatro orígenes automáticos que hoy escriben filas`, con
`Received: ["ADMIN_SEED", "OUTBOX_RELAY", "PUBLIC_REGISTRATION"]` frente a los cuatro esperados.

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/shared/domain/system-actor.ts
/**
 * Prefijo de todo actor automático. Es lo que hace que `created_by` pueda ser UNA columna
 * para personas y procesos sin ambigüedad: un id de usuario es un UUID v4, y `system:` no
 * puede serlo (un UUID no lleva `:`). Lo fija un caso del spec, no la buena intención.
 */
export const SYSTEM_ACTOR_PREFIX = 'system:';

/**
 * Catálogo de actores automáticos de la traza de auditoría.
 *
 * **Por qué existe: `null` significaba dos cosas.** Antes de este catálogo, `createdBy: null`
 * cubría a la vez «lo escribió un proceso, no una persona» y «no se sabe quién lo escribió»
 * —que es lo que legítimamente vale `null` en las filas anteriores a `AddAuditActorColumns`—.
 * Con las dos colapsadas, la pregunta que una traza existe para responder («¿quién creó esta
 * cuenta?») no tenía respuesta distinguible: un alta pública y una fila histórica sin datos se
 * leían igual.
 *
 * `null` NO desaparece, y es importante que no lo haga: sigue siendo la respuesta correcta
 * para «no se sabe». Lo que cambia es que deja de ser la respuesta para «fue el sistema»,
 * porque ahí sí se sabe — y ahora se dice cuál.
 *
 * **Son `string` sin más envoltura.** No hay VO: `AuditTrail.createdBy` es `string | null` en
 * `shared/domain/entity.base.ts`, y estos valores encajan sin ensanchar el tipo, así que
 * adoptarlos costó cero cambios de firma. Es también el motivo de que la columna sea `varchar`
 * y no `uuid`, decisión anterior a este catálogo y tomada exactamente para dejarle sitio (ver
 * la cabecera de `user.orm-entity.ts`).
 *
 * **Cómo crece:** un origen automático nuevo añade su constante aquí Y la lista cerrada del
 * spec, en el mismo cambio. Nunca se reutiliza uno existente «porque se parece»: dos orígenes
 * con el mismo nombre son otra vez dos cosas indistinguibles, que es el defecto que este
 * archivo cierra.
 */
export const SYSTEM_ACTORS = {
  /** Alta por `POST /auth/register`, que es `@Public()`: no hay token, luego no hay persona. */
  PUBLIC_REGISTRATION: `${SYSTEM_ACTOR_PREFIX}public-registration`,
  /** `pnpm seed:admin`: la cuenta administradora inicial y sus promociones posteriores. */
  ADMIN_SEED: `${SYSTEM_ACTOR_PREFIX}admin-seed`,
  /** `pnpm outbox:relay`. Reservado: hoy el relay solo marca `processed_at`, sin traza. */
  OUTBOX_RELAY: `${SYSTEM_ACTOR_PREFIX}outbox-relay`,
  /**
   * Curación perezosa de la activación de una gas pump address (`wallets`, spec §5.4): el
   * proveedor dice que la dirección ya puede enviar y nuestra fila seguía en `receive-only` o
   * `activating`, así que se pasa a `active` sin que nadie lo haya pedido.
   *
   * ⚠️ **NO se atribuye al dueño que hizo la petición.** Él no activó nada: su transacción de
   * activación se perdió o la respuesta no llegó, y quien decide el cambio es la reconciliación.
   * Ponerle su id dejaría la traza afirmando que activó una wallet que ya estaba activada por
   * un intento anterior — y esa traza es lo único que queda para reconstruir qué pasó en el
   * fallo parcial que esta curación existe para tapar.
   */
  ACTIVATION_RECONCILIATION: `${SYSTEM_ACTOR_PREFIX}activation-reconciliation`,
} as const;

export type SystemActor = (typeof SYSTEM_ACTORS)[keyof typeof SYSTEM_ACTORS];
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/shared/__tests__/domain/system-actor.spec.ts`
Expected: PASS — 10 passed (los dos `it.each` pasan de 3 a 4 casos cada uno: 8 + el de valores
únicos + el del catálogo).

- [ ] **Step 5: Escribe los cinco fakes de puertos**

```ts
// src/modules/wallets/__tests__/helpers/fake-owner.directory.ts
import type { OwnerDirectory } from '../../domain/ports/owner.directory';

/**
 * Directorio de mentira: conoce los ids con los que se construye y REGISTRA cada consulta.
 * El registro no es adorno — es lo que deja afirmar el orden «directorio antes que asignador»
 * y, en las dos lecturas, que este puerto no se inyecta siquiera.
 */
export class FakeOwnerDirectory implements OwnerDirectory {
  readonly existsCalls: string[] = [];

  constructor(private readonly knownIds: readonly string[] = []) {}

  exists(ownerId: string): Promise<boolean> {
    this.existsCalls.push(ownerId);
    return Promise.resolve(this.knownIds.includes(ownerId));
  }
}
```

```ts
// src/modules/wallets/__tests__/helpers/in-memory-wallet.repository.ts
import type { Wallet } from '../../domain/entities/wallet.entity';
import type { WalletRepository, WalletSaveOutcome } from '../../domain/ports/wallet.repository';

/**
 * Fake escrito a mano del puerto, no un mock generado.
 *
 * `programOwnerConflict()` reproduce la ÚNICA carrera que el alta puede perder: otro proceso
 * insertó la wallet de este dueño entre nuestra lectura de idempotencia y nuestro INSERT, así
 * que el `23505` de `user_id` salta y la fila del ganador ya es visible para la relectura. Se
 * modela con el ganador apareciendo DESPUÉS del conflicto y no antes, porque si estuviera antes
 * el caso de uso habría salido por la idempotencia y no se probaría nada.
 *
 * Pasar `null` como ganador es el otro extremo real: el ganador hizo `ROLLBACK` entre el
 * conflicto y la relectura, que es el único productor de `WalletAssignmentLostError`.
 */
export class InMemoryWalletRepository implements WalletRepository {
  readonly findByOwnerIdCalls: string[] = [];
  readonly saveCalls: Wallet[] = [];

  private readonly byOwner = new Map<string, Wallet>();
  private readonly programmedOutcomes: WalletSaveOutcome[] = [];
  private winnerAfterConflict: Wallet | null = null;

  constructor(seed: readonly Wallet[] = []) {
    seed.forEach((wallet) => this.byOwner.set(wallet.ownerId, wallet));
  }

  /** El próximo `save` choca; `winner` es lo que la relectura encontrará (o no, con `null`). */
  programOwnerConflict(winner: Wallet | null): void {
    this.programmedOutcomes.push('owner-conflict');
    this.winnerAfterConflict = winner;
  }

  findByOwnerId(ownerId: string): Promise<Wallet | null> {
    this.findByOwnerIdCalls.push(ownerId);
    return Promise.resolve(this.byOwner.get(ownerId) ?? null);
  }

  save(wallet: Wallet): Promise<WalletSaveOutcome> {
    this.saveCalls.push(wallet);
    const outcome = this.programmedOutcomes.shift() ?? 'saved';

    if (outcome === 'saved') {
      this.byOwner.set(wallet.ownerId, wallet);
      return Promise.resolve(outcome);
    }

    if (this.winnerAfterConflict) {
      this.byOwner.set(this.winnerAfterConflict.ownerId, this.winnerAfterConflict);
    }
    return Promise.resolve(outcome);
  }
}
```

```ts
// src/modules/wallets/__tests__/helpers/in-memory-wallet-transfer.repository.ts
import type {
  WalletTransfer,
  WalletTransferSnapshot,
} from '../../domain/entities/wallet-transfer.entity';
import type {
  FindTransfersCriteria,
  TransferPage,
  WalletTransferRepository,
} from '../../domain/ports/wallet-transfer.repository';

/**
 * Fake escrito a mano del libro de transferencias.
 *
 * ⚠️ **`saveCalls` guarda el SNAPSHOT del instante del guardado, no la referencia.** La entidad
 * es mutable y el caso de uso la muta después de escribirla, así que una lista de referencias
 * diría que la primera escritura ya iba en `submitted` — y con eso la escritura por delante, que
 * es la razón de existir del libro, quedaría sin probar. `toSnapshot()` es el mismo método que
 * usa el mapper, así que el fake no inventa ninguna forma nueva.
 *
 * `programSaveFailures()` acepta la cola completa (`null` = éxito) porque el caso que importa
 * necesita que falle el SEGUNDO guardado y no el primero: el reintento único del spec §3.2 solo
 * se puede ejercitar así.
 *
 * La paginación se calcula aquí igual que en el adaptador real: el criterio viaja en `page` y
 * `limit` —el vocabulario del cliente— y quien traduce a desplazamiento es quien consulta.
 */
export class InMemoryWalletTransferRepository implements WalletTransferRepository {
  readonly saveCalls: WalletTransferSnapshot[] = [];
  readonly findByOwnerCalls: FindTransfersCriteria[] = [];

  private readonly store = new Map<string, WalletTransfer>();
  private readonly failures: (Error | null)[] = [];

  constructor(seed: readonly WalletTransfer[] = []) {
    seed.forEach((transfer) => this.store.set(transfer.id.value, transfer));
  }

  programSaveFailures(...failures: readonly (Error | null)[]): void {
    this.failures.push(...failures);
  }

  save(transfer: WalletTransfer): Promise<void> {
    this.saveCalls.push(transfer.toSnapshot());

    const failure = this.failures.shift();
    if (failure) {
      return Promise.reject(failure);
    }

    this.store.set(transfer.id.value, transfer);
    return Promise.resolve();
  }

  findByOwner(criteria: FindTransfersCriteria): Promise<TransferPage> {
    this.findByOwnerCalls.push(criteria);
    const owned = [...this.store.values()].filter(
      (transfer) => transfer.ownerId === criteria.ownerId,
    );
    const skip = (criteria.page - 1) * criteria.limit;

    return Promise.resolve({
      items: owned.slice(skip, skip + criteria.limit),
      total: owned.length,
    });
  }
}
```

```ts
// src/modules/wallets/__tests__/helpers/fake-address-index.allocator.ts
import { AddressIndex } from '../../domain/value-objects/address-index.vo';

import type { AddressIndexAllocator } from '../../domain/ports/address-index.allocator';

/**
 * Secuencia de mentira. `allocated` guarda cada índice entregado, que es lo que permite afirmar
 * las dos caras del spec §5.2: que un alta idempotente NO consume índice, y que un fallo de la
 * pasarela SÍ deja el índice consumido y sin compensación.
 */
export class FakeAddressIndexAllocator implements AddressIndexAllocator {
  readonly allocated: number[] = [];

  private cursor: number;
  private failure: Error | null = null;

  constructor(start = 0) {
    this.cursor = start;
  }

  programFailure(error: Error): void {
    this.failure = error;
  }

  next(): Promise<AddressIndex> {
    if (this.failure) {
      return Promise.reject(this.failure);
    }

    const value = this.cursor;
    this.cursor += 1;
    this.allocated.push(value);
    return Promise.resolve(AddressIndex.from(value));
  }
}
```

```ts
// src/modules/wallets/__tests__/helpers/fake-custodial-address.gateway.ts
import type { AddressIndex } from '../../domain/value-objects/address-index.vo';
import type {
  CustodialAddressGateway,
  SendCommand,
} from '../../domain/ports/custodial-address.gateway';
import type { EthereumAddress } from '../../domain/value-objects/ethereum-address.vo';
import type { TransactionHash } from '../../domain/value-objects/transaction-hash.vo';

/**
 * Pasarela de mentira, con la misma política que el stub HTTP del E2E (spec §8): **no responde
 * por defecto**. Las tres operaciones que devuelven algo del proveedor rechazan con un error que
 * dice qué faltó programar, en vez de inventar una respuesta plausible — un valor por defecto
 * dejaría verde un caso que nunca programó la llamada que dice estar probando.
 *
 * `isSendingEnabled` sí tiene un defecto (`false`), porque «todavía no puede enviar» es el estado
 * inicial real de toda gas pump address recién derivada, no una respuesta inventada.
 *
 * ⚠️ **Las tres primeras listas guardan ÍNDICES, no direcciones**, porque eso es lo que reciben
 * los métodos del puerto: la API del proveedor toma índices en `activate` y en la ruta de
 * `activated/{chain}/{owner}/{index}`. `sendCalls` guarda el `SendCommand` entero, cuyo campo de
 * destinatario se llama `recipient`.
 *
 * Cada lista existe para una aserción concreta: `deriveCalls` para comprobar que se deriva el
 * índice reservado y solo una vez; `isSendingEnabledCalls` para comprobar que una wallet ya
 * `active` NO vuelve a preguntar; `enableSendingCalls` para comprobar que una activación en curso
 * NO emite una segunda transacción; y `sendCalls` para comprobar que el origen es la dirección de
 * la wallet y jamás la master.
 */
export class FakeCustodialAddressGateway implements CustodialAddressGateway {
  readonly deriveCalls: AddressIndex[] = [];
  readonly enableSendingCalls: AddressIndex[] = [];
  readonly isSendingEnabledCalls: AddressIndex[] = [];
  readonly sendCalls: SendCommand[] = [];

  private derived: EthereumAddress | Error | null = null;
  private activation: TransactionHash | Error | null = null;
  private sent: TransactionHash | Error | null = null;
  private sendingEnabled = false;

  constructor(private readonly master: EthereumAddress) {}

  programDeriveAddress(result: EthereumAddress | Error): void {
    this.derived = result;
  }

  programEnableSending(result: TransactionHash | Error): void {
    this.activation = result;
  }

  programSendingEnabled(enabled: boolean): void {
    this.sendingEnabled = enabled;
  }

  programSend(result: TransactionHash | Error): void {
    this.sent = result;
  }

  masterAddress(): EthereumAddress {
    return this.master;
  }

  deriveAddress(index: AddressIndex): Promise<EthereumAddress> {
    this.deriveCalls.push(index);
    const programmed = this.derived;
    if (programmed === null) {
      return Promise.reject(new Error('FakeCustodialAddressGateway: deriveAddress sin programar'));
    }
    if (programmed instanceof Error) {
      return Promise.reject(programmed);
    }
    return Promise.resolve(programmed);
  }

  enableSending(index: AddressIndex): Promise<TransactionHash> {
    this.enableSendingCalls.push(index);
    const programmed = this.activation;
    if (programmed === null) {
      return Promise.reject(new Error('FakeCustodialAddressGateway: enableSending sin programar'));
    }
    if (programmed instanceof Error) {
      return Promise.reject(programmed);
    }
    return Promise.resolve(programmed);
  }

  isSendingEnabled(index: AddressIndex): Promise<boolean> {
    this.isSendingEnabledCalls.push(index);
    return Promise.resolve(this.sendingEnabled);
  }

  send(command: SendCommand): Promise<TransactionHash> {
    this.sendCalls.push(command);
    const programmed = this.sent;
    if (programmed === null) {
      return Promise.reject(new Error('FakeCustodialAddressGateway: send sin programar'));
    }
    if (programmed instanceof Error) {
      return Promise.reject(programmed);
    }
    return Promise.resolve(programmed);
  }
}
```

- [ ] **Step 6: Escribe las dos factorías de entidades**

```ts
// src/modules/wallets/__tests__/helpers/wallet.factory.ts
import { AddressIndex } from '../../domain/value-objects/address-index.vo';
import { EthereumAddress } from '../../domain/value-objects/ethereum-address.vo';
import { TransactionHash } from '../../domain/value-objects/transaction-hash.vo';
import { Wallet } from '../../domain/entities/wallet.entity';
import { WalletId } from '../../domain/value-objects/wallet-id.vo';

import type { WalletStatus } from '../../domain/wallet-status';

/**
 * Constructor de wallets para las suites del módulo. Existe porque el mismo `Wallet.assign()` de
 * siete campos aparecía copiado en seis specs: la convención del repo («nunca copiar un builder
 * en varios specs») lo prohíbe, y la copia además hacía que cambiar la firma del agregado
 * costase seis ediciones.
 *
 * ⚠️ **`status` se alcanza EJECUTANDO las transiciones del agregado**, nunca inyectando el campo:
 * una wallet `activating` fabricada a mano podría tener un estado que el dominio no sabe
 * producir, y entonces la suite probaría un mundo que no existe. El precio es que la traza de una
 * wallet `active` lleva las marcas de las dos transiciones, que es exactamente lo que pasa en
 * producción.
 */
export const WALLET_OWNER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
export const WALLET_MASTER_ADDRESS = '0x9f2e6c1b4a8d3f5e7c0b9a2d4e6f8a1c3b5d7e90';
export const WALLET_OTHER_MASTER_ADDRESS = '0x0000c1b4a8d3f5e7c0b9a2d4e6f8a1c3b5d7e901';
export const WALLET_ADDRESS = '0x1c3b5d7e90a2d4e6f8a19f2e6c1b4a8d3f5e7c0b';
export const WALLET_ACTIVATION_TX =
  '0x1111111111111111111111111111111111111111111111111111111111111111';

const ASSIGNED_AT = new Date('2026-08-27T10:00:00.000Z');
const ACTIVATION_REQUESTED_AT = new Date('2026-08-27T11:00:00.000Z');
const ACTIVATED_AT = new Date('2026-08-27T12:00:00.000Z');
const DEFAULT_ADDRESS_INDEX = 3;

export type WalletOverrides = {
  ownerId?: string;
  ownerAddress?: string;
  addressIndex?: number;
  address?: string;
  status?: WalletStatus;
  activationTxId?: string;
  now?: Date;
  createdBy?: string | null;
};

export const buildWallet = (overrides: WalletOverrides = {}): Wallet => {
  const ownerId = overrides.ownerId ?? WALLET_OWNER_ID;
  const createdBy = overrides.createdBy === undefined ? ownerId : overrides.createdBy;

  const wallet = Wallet.assign({
    id: WalletId.generate(),
    ownerId,
    ownerAddress: EthereumAddress.from(overrides.ownerAddress ?? WALLET_MASTER_ADDRESS),
    addressIndex: AddressIndex.from(overrides.addressIndex ?? DEFAULT_ADDRESS_INDEX),
    address: EthereumAddress.from(overrides.address ?? WALLET_ADDRESS),
    now: overrides.now ?? ASSIGNED_AT,
    createdBy,
  });

  const status = overrides.status ?? 'receive-only';
  if (status === 'receive-only') {
    return wallet;
  }

  wallet.markActivationRequested(
    TransactionHash.from(overrides.activationTxId ?? WALLET_ACTIVATION_TX),
    ACTIVATION_REQUESTED_AT,
    createdBy,
  );
  if (status === 'active') {
    wallet.confirmActivated(ACTIVATED_AT, createdBy);
  }
  return wallet;
};
```

```ts
// src/modules/wallets/__tests__/helpers/wallet-transfer.factory.ts
import { EthereumAddress } from '../../domain/value-objects/ethereum-address.vo';
import { TransactionHash } from '../../domain/value-objects/transaction-hash.vo';
import { TransferAsset } from '../../domain/transfer-asset';
import { TransferId } from '../../domain/value-objects/transfer-id.vo';
import { WalletTransfer } from '../../domain/entities/wallet-transfer.entity';

import type { ProviderFailureReason } from '../../domain/errors/wallet.errors';
import type { TransferAssetKind, TransferAssetParts } from '../../domain/transfer-asset';
import type { TransferStatus } from '../../domain/transfer-status';

/**
 * Constructor de filas del libro para las suites del módulo, hermano de `buildWallet`.
 *
 * ⚠️ **La clase de activo se nombra `'multi-token'`, CON GUION**, igual que en el dominio, en la
 * columna y en el DTO. `multiToken` (camelCase) solo existe como clave del matcher de
 * `TransferAsset`, que es un identificador de TypeScript y no vocabulario.
 *
 * Igual que en `buildWallet`, `status` se alcanza EJECUTANDO los mutadores: una fila `rejected`
 * fabricada a mano podría llevar un `reasonCode` que el agregado nunca escribiría.
 */
export const TRANSFER_OWNER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
export const TRANSFER_FROM_ADDRESS = '0x1c3b5d7e90a2d4e6f8a19f2e6c1b4a8d3f5e7c0b';
export const TRANSFER_RECIPIENT_ADDRESS = '0x5d7e90a2d4e6f8a19f2e6c1b4a8d3f5e7c0b1c3b';
export const TRANSFER_TOKEN_ADDRESS = '0x782919afc85eea2cb736874225456bb5d3e242ba';
export const TRANSFER_TX = '0x9c1b4a8d3f5e7c0b9a2d4e6f8a1c3b5d7e901c3b5d7e90a2d4e6f8a19f2e6c1b';

const STARTED_AT = new Date('2026-08-27T10:00:00.000Z');
const SETTLED_AT = new Date('2026-08-27T10:00:05.000Z');
const DEFAULT_AMOUNT = '1000000000000000000';
const DEFAULT_TOKEN_ID = '7';

export type TransferOverrides = {
  ownerId?: string;
  from?: string;
  recipient?: string;
  assetKind?: TransferAssetKind;
  tokenAddress?: string;
  amount?: string;
  tokenId?: string;
  status?: TransferStatus;
  txId?: string;
  reasonCode?: ProviderFailureReason;
  now?: Date;
  createdBy?: string | null;
};

const partsFor = (overrides: TransferOverrides): TransferAssetParts => {
  const kind = overrides.assetKind ?? 'native';
  const tokenAddress = overrides.tokenAddress ?? TRANSFER_TOKEN_ADDRESS;
  const amount = overrides.amount ?? DEFAULT_AMOUNT;
  const tokenId = overrides.tokenId ?? DEFAULT_TOKEN_ID;

  if (kind === 'native') {
    return { kind, amount };
  }
  if (kind === 'fungible') {
    return { kind, tokenAddress, amount };
  }
  if (kind === 'nft') {
    return { kind, tokenAddress, tokenId };
  }
  return { kind, tokenAddress, amount, tokenId };
};

export const buildTransfer = (overrides: TransferOverrides = {}): WalletTransfer => {
  const ownerId = overrides.ownerId ?? TRANSFER_OWNER_ID;
  const createdBy = overrides.createdBy === undefined ? ownerId : overrides.createdBy;

  const transfer = WalletTransfer.start({
    id: TransferId.generate(),
    ownerId,
    from: EthereumAddress.from(overrides.from ?? TRANSFER_FROM_ADDRESS),
    recipient: EthereumAddress.from(overrides.recipient ?? TRANSFER_RECIPIENT_ADDRESS),
    asset: TransferAsset.fromParts(partsFor(overrides)),
    now: overrides.now ?? STARTED_AT,
    createdBy,
  });

  const status = overrides.status ?? 'submitting';
  if (status === 'submitted') {
    transfer.markSubmitted(
      TransactionHash.from(overrides.txId ?? TRANSFER_TX),
      SETTLED_AT,
      createdBy,
    );
  }
  if (status === 'rejected') {
    transfer.markRejected(overrides.reasonCode ?? 'body-rejected', SETTLED_AT, createdBy);
  }
  if (status === 'unknown') {
    transfer.markUnknown(overrides.reasonCode ?? 'timeout', SETTLED_AT, createdBy);
  }
  return transfer;
};
```

- [ ] **Step 7: Añade los dos arbitrarios de paginación al catálogo del módulo**

El archivo lo creó la Task 1 con los arbitrarios del dominio (`ethereumAddressArb`,
`transactionHashArb`, `addressIndexArb`, `tokenAmountArb`, `tokenIdArb`, `providerFailureReasonArb`
y los tres de valores inválidos). Aquí solo se le añaden, al final, los dos que necesitan las
propiedades de la tarea 21; ningún arbitrario existente se toca.

```ts
// src/modules/wallets/__tests__/helpers/arbitraries.ts — se AÑADE al final del archivo

/**
 * Página y tamaño **ya validados por `PaginationDto`**: base 1 y tope 100. Generar fuera de ese
 * rango probaría una entrada que el borde HTTP no deja pasar, y el caso de uso no es quien la
 * rechaza.
 */
export const pageArb = fc.integer({ min: 1, max: 1_000_000 });
export const limitArb = fc.integer({ min: 1, max: 100 });
```

- [ ] **Step 8: Comprueba que los fakes y las factorías satisfacen los puertos y el dominio**

Run: `pnpm typecheck`
Expected: PASS — sin salida de error. Es la verificación que corresponde a esta mitad de la tarea:
los fakes y las factorías no tienen suite propia (son andamio), y lo único que se les exige aquí es
que `implements` compile contra los cinco puertos y que las factorías compilen contra la superficie
de las dos entidades. Su comportamiento lo ejercitan las tareas 17-21.

---

### Task 17: `AssignWalletUseCase` — alta idempotente con relectura única

**Layer:** application
**Rule codes to honor:** `arch-single-responsibility`, `arch-use-repository-pattern`, `di-prefer-constructor-injection`, `di-use-interfaces-tokens`, `error-handle-async-errors`

**Casos acordados:**

| #   | Caso (se vuelve el `it`)                                                                        | Entrada / estado inicial                                                               | Resultado esperado                                                                                        |
| --- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| A1  | debería asignar una wallet derivada bajo la master cuando el dueño no tiene ninguna             | rol `user`; directorio conoce al dueño; asignador entrega 7; pasarela deriva `0x1c3b…` | devuelve la wallet con `addressIndex` 7, `address` derivada y `ownerAddress` = master; un solo `save`     |
| A2  | debería devolver la wallet existente sin reservar índice ni llamar a la pasarela                | el repositorio ya tiene la wallet del dueño                                            | devuelve esa misma instancia; `allocated` vacío, `deriveCalls` vacío y `saveCalls` vacío                  |
| A3  | debería rechazar con `WalletOwnerGoneError` cuando el directorio ya no conoce al dueño          | directorio vacío                                                                       | lanza; ni índice reservado, ni derivación, ni guardado                                                    |
| A4  | debería consultar el directorio antes de reservar el índice y antes de derivar                  | todo en verde, se registra el orden de llamadas                                        | `['exists', 'findByOwnerId', 'next', 'deriveAddress', 'save']`                                            |
| A5  | debería propagar el fallo de la pasarela sin guardar nada y sin devolver el índice reservado    | `deriveAddress` rechaza                                                                | lanza ese mismo error; `saveCalls` vacío; `allocated` == `[7]` — el índice se pierde, no hay compensación |
| A6  | debería devolver la wallet del ganador tras UNA sola relectura cuando el alta pierde la carrera | `save` responde `owner-conflict` y el ganador ya es visible                            | devuelve la del ganador; exactamente 2 `findByOwnerId`; un solo `save` y un solo índice reservado         |
| A7  | debería lanzar `WalletAssignmentLostError` cuando la relectura vuelve vacía                     | `save` responde `owner-conflict` sin ganador visible                                   | lanza; 2 `findByOwnerId`; NO se reintenta el alta (un `save`, un índice)                                  |
| A8  | debería anotar al dueño como autor de la fila                                                   | alta normal                                                                            | `createdBy` y `updatedBy` de la wallet valen el `ownerId`                                                 |
| A9  | debería rechazar con `AdminUsesMasterAddressError` cuando el rol es `admin`, sin consultar nada | `ownerRole` = `'admin'`, con el directorio y el repositorio llenos                     | lanza; `existsCalls`, `findByOwnerIdCalls`, `allocated` y `deriveCalls` vacíos                            |
| P1  | debería reservar un índice y derivar exactamente una vez por alta nueva _(propiedad)_           | arbitrario: índice de `addressIndexArb`, dirección de `ethereumAddressArb`             | siempre un `next`, un `deriveAddress` con ESE índice, y la wallet guardada lleva el índice y la master    |

**El 409 al rol `admin` vive AQUÍ y no en el controlador** (caso A9). La entrada del caso de uso
lleva `ownerRole`, que sale del `role` del token vía `@CurrentUser()` y nunca del cuerpo, y el
rechazo es `AdminUsesMasterAddressError` — un error de dominio que el filtro del contexto traduce a
409, como cualquier otro. Construir una `ConflictException` con string en el controlador dejaba la
regla «el admin ya tiene la master» escrita en el borde HTTP, donde ni el caso de uso ni sus tests
la ven: bastaba con que un segundo llamante —el E2E de otro endpoint, un comando futuro— invocase el
caso de uso para saltársela. La comprobación va **primero**, antes del directorio, porque es la
única que no cuesta E/S.

La defensa en profundidad que además vive dentro del dominio es `Wallet.assign()` rechazando una
dirección igual a la master (`WalletAddressIsMasterError`), y esa está en la tabla de la entidad.

**Files:**

- Create: `src/modules/wallets/application/use-cases/assign-wallet.use-case.ts`
- Test: `src/modules/wallets/__tests__/application/use-cases/assign-wallet.use-case.spec.ts`

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/modules/wallets/__tests__/application/use-cases/assign-wallet.use-case.spec.ts
import { test as fcTest } from '@fast-check/jest';

import { AddressIndex } from '../../../domain/value-objects/address-index.vo';
import { AssignWalletUseCase } from '../../../application/use-cases/assign-wallet.use-case';
import { EthereumAddress } from '../../../domain/value-objects/ethereum-address.vo';
import { FakeAddressIndexAllocator } from '../../helpers/fake-address-index.allocator';
import { FakeCustodialAddressGateway } from '../../helpers/fake-custodial-address.gateway';
import { FakeOwnerDirectory } from '../../helpers/fake-owner.directory';
import { InMemoryWalletRepository } from '../../helpers/in-memory-wallet.repository';
import {
  AdminUsesMasterAddressError,
  WalletAssignmentLostError,
  WalletOwnerGoneError,
} from '../../../domain/errors/wallet.errors';
import {
  WALLET_ADDRESS,
  WALLET_MASTER_ADDRESS,
  WALLET_OWNER_ID,
  buildWallet,
} from '../../helpers/wallet.factory';
import { addressIndexArb, ethereumAddressArb } from '../../helpers/arbitraries';

import type { Wallet } from '../../../domain/entities/wallet.entity';

const OWNER_ID = WALLET_OWNER_ID;
const MASTER = WALLET_MASTER_ADDRESS;
const DERIVED = WALLET_ADDRESS;
const FIRST_INDEX = 7;

describe('AssignWalletUseCase', () => {
  describe('execute()', () => {
    it('debería asignar una wallet derivada bajo la master cuando el dueño no tiene ninguna', async () => {
      // Arrange
      const { useCase, repository, gateway } = buildUseCase({ knownOwners: [OWNER_ID] });

      // Act
      const wallet = await useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' });

      // Assert
      expect(wallet.ownerId).toBe(OWNER_ID);
      expect(wallet.addressIndex.value).toBe(FIRST_INDEX);
      expect(wallet.address.value).toBe(DERIVED);
      expect(wallet.ownerAddress.value).toBe(MASTER);
      expect(repository.saveCalls).toEqual([wallet]);
      expect(gateway.deriveCalls).toHaveLength(1);
    });

    it('debería devolver la wallet existente sin reservar índice ni llamar a la pasarela', async () => {
      // Arrange
      const existing = buildWallet({ ownerId: OWNER_ID });
      const { useCase, repository, allocator, gateway } = buildUseCase({
        knownOwners: [OWNER_ID],
        existing: [existing],
      });

      // Act
      const wallet = await useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' });

      // Assert: idempotencia barata — repetir el alta no gasta ni un crédito del proveedor.
      expect(wallet).toBe(existing);
      expect(allocator.allocated).toEqual([]);
      expect(gateway.deriveCalls).toEqual([]);
      expect(repository.saveCalls).toEqual([]);
    });

    it('debería rechazar con WalletOwnerGoneError cuando el directorio ya no conoce al dueño', async () => {
      // Arrange: el JWT sigue firmado y vigente, pero su dueño se desactivó.
      const { useCase, repository, allocator, gateway } = buildUseCase({ knownOwners: [] });

      // Act + Assert
      await expect(useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' })).rejects.toThrow(
        WalletOwnerGoneError,
      );
      expect(allocator.allocated).toEqual([]);
      expect(gateway.deriveCalls).toEqual([]);
      expect(repository.saveCalls).toEqual([]);
    });

    it('debería consultar el directorio antes de reservar el índice y antes de derivar', async () => {
      // Arrange
      const { useCase, repository, allocator, gateway, directory } = buildUseCase({
        knownOwners: [OWNER_ID],
      });
      const calls: string[] = [];
      jest.spyOn(directory, 'exists').mockImplementation(() => {
        calls.push('exists');
        return Promise.resolve(true);
      });
      jest.spyOn(repository, 'findByOwnerId').mockImplementation(() => {
        calls.push('findByOwnerId');
        return Promise.resolve(null);
      });
      jest.spyOn(allocator, 'next').mockImplementation(() => {
        calls.push('next');
        return Promise.resolve(AddressIndex.from(FIRST_INDEX));
      });
      jest.spyOn(gateway, 'deriveAddress').mockImplementation(() => {
        calls.push('deriveAddress');
        return Promise.resolve(EthereumAddress.from(DERIVED));
      });
      jest.spyOn(repository, 'save').mockImplementation(() => {
        calls.push('save');
        return Promise.resolve('saved');
      });

      // Act
      await useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' });

      // Assert: el directorio va PRIMERO porque es lo único gratis; detrás van un índice
      // irrecuperable y dos créditos del proveedor.
      expect(calls).toEqual(['exists', 'findByOwnerId', 'next', 'deriveAddress', 'save']);
    });

    it('debería propagar el fallo de la pasarela sin guardar nada y sin devolver el índice reservado', async () => {
      // Arrange
      const failure = new Error('provider down');
      const { useCase, repository, allocator, gateway } = buildUseCase({ knownOwners: [OWNER_ID] });
      gateway.programDeriveAddress(failure);

      // Act + Assert
      await expect(useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' })).rejects.toThrow(
        failure,
      );
      expect(repository.saveCalls).toEqual([]);
      // El índice queda consumido y NO se compensa: lo huérfano es un número, no una fila, y
      // el intento siguiente pide el siguiente índice (spec §5.2).
      expect(allocator.allocated).toEqual([FIRST_INDEX]);
    });

    it('debería devolver la wallet del ganador tras UNA sola relectura cuando el alta pierde la carrera', async () => {
      // Arrange
      const winner = buildWallet({ ownerId: OWNER_ID });
      const { useCase, repository, allocator } = buildUseCase({ knownOwners: [OWNER_ID] });
      repository.programOwnerConflict(winner);

      // Act
      const wallet = await useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' });

      // Assert
      expect(wallet).toBe(winner);
      expect(repository.findByOwnerIdCalls).toEqual([OWNER_ID, OWNER_ID]);
      expect(repository.saveCalls).toHaveLength(1);
      expect(allocator.allocated).toEqual([FIRST_INDEX]);
    });

    it('debería lanzar WalletAssignmentLostError cuando la relectura vuelve vacía', async () => {
      // Arrange: el ganador hizo ROLLBACK entre el conflicto y la relectura.
      const { useCase, repository, allocator } = buildUseCase({ knownOwners: [OWNER_ID] });
      repository.programOwnerConflict(null);

      // Act + Assert
      await expect(useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' })).rejects.toThrow(
        WalletAssignmentLostError,
      );
      // Una relectura, no un bucle: reintentar gastaría otros dos créditos y otro índice para
      // volver a arriesgar la misma carrera (spec §5).
      expect(repository.findByOwnerIdCalls).toEqual([OWNER_ID, OWNER_ID]);
      expect(repository.saveCalls).toHaveLength(1);
      expect(allocator.allocated).toEqual([FIRST_INDEX]);
    });

    it('debería anotar al dueño como autor de la fila', async () => {
      // Arrange
      const { useCase } = buildUseCase({ knownOwners: [OWNER_ID] });

      // Act
      const wallet = await useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' });

      // Assert: el único camino es el dueño pidiéndose su propia dirección, así que la traza
      // lo nombra a él y no a un actor de sistema.
      expect(wallet.createdBy).toBe(OWNER_ID);
      expect(wallet.updatedBy).toBe(OWNER_ID);
    });

    it('debería rechazar con AdminUsesMasterAddressError cuando el rol es admin, sin consultar nada', async () => {
      // Arrange: el admin YA tiene dirección —la master— y darle además una derivada le dejaría
      // dos, que es la invariante «una sola EOA en el sistema» del spec §3.1.1.
      const { useCase, directory, repository, allocator, gateway } = buildUseCase({
        knownOwners: [OWNER_ID],
      });

      // Act + Assert
      await expect(useCase.execute({ ownerId: OWNER_ID, ownerRole: 'admin' })).rejects.toThrow(
        AdminUsesMasterAddressError,
      );
      // El corte es lo PRIMERO: no cuesta E/S, así que va antes que el directorio.
      expect(directory.existsCalls).toEqual([]);
      expect(repository.findByOwnerIdCalls).toEqual([]);
      expect(allocator.allocated).toEqual([]);
      expect(gateway.deriveCalls).toEqual([]);
    });
  });

  describe('execute() (property-based)', () => {
    fcTest.prop([addressIndexArb, ethereumAddressArb])(
      'debería reservar un índice y derivar exactamente una vez por alta nueva (propiedad)',
      async (index, derived) => {
        // Arrange
        const { useCase, repository, allocator, gateway } = buildUseCase({
          knownOwners: [OWNER_ID],
          firstIndex: index,
          derivedAddress: derived,
        });

        // Act
        const wallet = await useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' });

        // Assert
        expect(allocator.allocated).toEqual([index]);
        expect(gateway.deriveCalls).toHaveLength(1);
        expect(gateway.deriveCalls[0]?.value).toBe(index);
        expect(wallet.addressIndex.value).toBe(index);
        // La master sale de la pasarela, no del caso de uso: `deriveAddress` ya no la recibe.
        expect(wallet.ownerAddress.value).toBe(MASTER);
        expect(repository.saveCalls).toEqual([wallet]);
      },
    );
  });
});

// Helpers

type BuildOptions = {
  knownOwners?: readonly string[];
  existing?: readonly Wallet[];
  firstIndex?: number;
  derivedAddress?: string;
};

const buildUseCase = (options: BuildOptions = {}) => {
  const directory = new FakeOwnerDirectory(options.knownOwners ?? []);
  const repository = new InMemoryWalletRepository(options.existing ?? []);
  const allocator = new FakeAddressIndexAllocator(options.firstIndex ?? FIRST_INDEX);
  const gateway = new FakeCustodialAddressGateway(EthereumAddress.from(MASTER));
  gateway.programDeriveAddress(EthereumAddress.from(options.derivedAddress ?? DERIVED));

  return {
    useCase: new AssignWalletUseCase(directory, repository, allocator, gateway),
    directory,
    repository,
    allocator,
    gateway,
  };
};
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/modules/wallets/__tests__/application/use-cases/assign-wallet.use-case.spec.ts`
Expected: FAIL — `Cannot find module '../../../application/use-cases/assign-wallet.use-case'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/modules/wallets/application/use-cases/assign-wallet.use-case.ts
import { Injectable } from '@nestjs/common';

import { AddressIndexAllocator } from '../../domain/ports/address-index.allocator';
import { CustodialAddressGateway } from '../../domain/ports/custodial-address.gateway';
import { OwnerDirectory } from '../../domain/ports/owner.directory';
import { Wallet } from '../../domain/entities/wallet.entity';
import {
  AdminUsesMasterAddressError,
  WalletAssignmentLostError,
  WalletOwnerGoneError,
} from '../../domain/errors/wallet.errors';
import { WalletId } from '../../domain/value-objects/wallet-id.vo';
import { WalletRepository } from '../../domain/ports/wallet.repository';

export type AssignWalletInput = {
  ownerId: string;
  ownerRole: string;
};

/**
 * Rol que ya posee la master. Es un literal y no `USER_ROLES` de `users` a propósito: la regla 2
 * del gate de fronteras prohíbe a `application/` importar nada de otro módulo, y `common` tampoco
 * lo publica —`AuthenticatedUser.role` es un `string` laxo por ese mismo motivo—. El contenido lo
 * garantiza el token; aquí solo se compara.
 */
const ADMIN_ROLE = 'admin';

/**
 * Alta de la dirección custodiada, **idempotente y sin compensación**.
 *
 * El orden —rol → directorio → wallet existente → índice → derivar → guardar— no es estético:
 * cada paso es más caro e irreversible que el anterior. El rol viaja en el token y no cuesta E/S;
 * el directorio es una consulta local; la lectura de la wallet ahorra los dos créditos del
 * proveedor cuando el alta se repite; el índice sale de una secuencia y **consumirlo es
 * irreversible por diseño**; y solo después se gasta la llamada.
 *
 * ⚠️ **El 409 al rol `admin` vive AQUÍ, no en el controlador.** El admin ya tiene dirección —la
 * master, que vive en la configuración y no en la tabla—, y darle además una derivada le dejaría
 * dos, rompiendo la invariante «una sola EOA en el sistema» del spec §3.1.1. Escrita en el borde
 * HTTP, la regla se saltaba con solo llamar al caso de uso desde otro sitio; escrita aquí, el
 * único camino pasa por ella y el filtro del contexto la publica como 409 igual que cualquier
 * otro error de dominio.
 *
 * **Si la pasarela falla, lo que queda huérfano es un NÚMERO, no una fila** — por eso no hay
 * compensación y escribirla sería ceremonia (spec §5.2). La compensación existe para desbloquear
 * un reintento, y aquí el reintento no está bloqueado: pide el índice siguiente. Los huecos son
 * gratis porque derivar no escribe en la cadena, así que un índice perdido es una dirección que
 * nadie posee y a la que nadie va a mandar nada.
 *
 * **La carrera se resuelve con UNA relectura, no con un bucle.** El `23505` de `user_id` llega
 * como el desenlace `owner-conflict` y no como excepción, precisamente para que no exista un
 * error publicable de «ya tienes wallet»: el endpoint responde 200 con la wallet del ganador. Si
 * la relectura vuelve vacía —el ganador hizo `ROLLBACK` entre el conflicto y la lectura— se lanza
 * `WalletAssignmentLostError` y NO se reintenta el alta: reintentar gastaría otro índice y otros
 * dos créditos para volver a arriesgar exactamente la misma carrera.
 */
@Injectable()
export class AssignWalletUseCase {
  constructor(
    private readonly owners: OwnerDirectory,
    private readonly wallets: WalletRepository,
    private readonly indexes: AddressIndexAllocator,
    private readonly gateway: CustodialAddressGateway,
  ) {}

  async execute(input: AssignWalletInput): Promise<Wallet> {
    if (input.ownerRole === ADMIN_ROLE) {
      throw new AdminUsesMasterAddressError();
    }

    const exists = await this.owners.exists(input.ownerId);
    if (!exists) {
      throw new WalletOwnerGoneError(input.ownerId);
    }

    const existing = await this.wallets.findByOwnerId(input.ownerId);
    if (existing) {
      return existing;
    }

    const addressIndex = await this.indexes.next();
    // La master la aporta la pasarela desde la configuración; `deriveAddress` solo recibe el
    // índice, así que este es el único sitio donde el caso de uso la nombra.
    const ownerAddress = this.gateway.masterAddress();
    const address = await this.gateway.deriveAddress(addressIndex);

    const now = new Date();
    const wallet = Wallet.assign({
      id: WalletId.generate(),
      ownerId: input.ownerId,
      ownerAddress,
      addressIndex,
      address,
      now,
      // Mismo criterio que `PlaceOrderUseCase`: quién es el actor lo sabe la aplicación, no el
      // dominio. Hoy el único camino es el dueño pidiéndose su propia dirección.
      createdBy: input.ownerId,
    });

    const outcome = await this.wallets.save(wallet);
    if (outcome === 'saved') {
      return wallet;
    }

    const winner = await this.wallets.findByOwnerId(input.ownerId);
    if (!winner) {
      throw new WalletAssignmentLostError(input.ownerId);
    }
    return winner;
  }
}
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/modules/wallets/__tests__/application/use-cases/assign-wallet.use-case.spec.ts`
Expected: PASS — 10 passed

---

### Task 18: `FindWalletByOwnerUseCase` — la lectura que no consulta el directorio

**Layer:** application
**Rule codes to honor:** `arch-single-responsibility`, `arch-use-repository-pattern`, `di-prefer-constructor-injection`, `perf-optimize-database`

**Casos acordados:**

| #   | Caso (se vuelve el `it`)                                                    | Entrada / estado inicial                                     | Resultado esperado                                                        |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| F1  | debería devolver la wallet del dueño                                        | rol `user`; el repositorio tiene la wallet de `OWNER_ID`     | devuelve esa misma instancia; una sola consulta al repositorio            |
| F2  | debería lanzar `WalletNotFoundError` cuando el dueño no tiene wallet        | rol `user`; repositorio vacío                                | lanza                                                                     |
| F3  | debería depender solo del repositorio, sin directorio de dueños ni pasarela | la clase construida                                          | `FindWalletByOwnerUseCase.length` es 1                                    |
| F4  | debería no ejecutar `assertOwnedBy` sobre la wallet devuelta                | wallet derivada bajo una master distinta de la configurada   | devuelve la wallet; `assertOwnedBy` no se llamó ni una vez                |
| F5  | debería devolver `null` al rol `admin` sin consultar el repositorio         | `ownerRole` = `'admin'`, con la wallet del dueño en la tabla | devuelve `null`; `findByOwnerIdCalls` vacío                               |
| P1  | debería devolver siempre la wallet del dueño consultado _(propiedad)_       | arbitrario: índice y dirección                               | la wallet devuelta es la del dueño, con su índice y su dirección intactos |

Los casos F3 y F4 existen por mandato explícito del spec §5: «los dos casos de lectura NO consultan
el directorio» y «`assertOwnedBy(master)` corre en los tres que llaman al proveedor, y NO en las dos
lecturas». Son la clase de omisión que alguien «arregla» por simetría, y sin caso que la fije el
arreglo pasa el DoD entero: añade una consulta al endpoint más llamado —la gente consulta
repetidamente esperando la activación— y convierte una rotación de master en un 500 en la lectura,
cuando lo que se quiere es que la lectura siga respondiendo y el intento de USARLA sea lo que falle.

F5 es la otra mitad del `ownerRole`: aquí el admin **no** recibe un 409 sino `null`, porque
`GET /wallets/me` sí responde para él. El caso de uso devuelve `Wallet | null` y es el controlador
quien compone la respuesta `kind: 'master'` con `index` nulo — un 404 ahí sería mentira a medias,
porque el admin sí tiene dirección y es la que sostiene todo. La decisión de QUÉ dirección publicar
es de transporte y necesita la configuración; la de «este rol no tiene fila» es de negocio y vive
aquí.

**Files:**

- Create: `src/modules/wallets/application/use-cases/find-wallet-by-owner.use-case.ts`
- Test: `src/modules/wallets/__tests__/application/use-cases/find-wallet-by-owner.use-case.spec.ts`

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/modules/wallets/__tests__/application/use-cases/find-wallet-by-owner.use-case.spec.ts
import { test as fcTest } from '@fast-check/jest';

import { FindWalletByOwnerUseCase } from '../../../application/use-cases/find-wallet-by-owner.use-case';
import { InMemoryWalletRepository } from '../../helpers/in-memory-wallet.repository';
import { WalletNotFoundError } from '../../../domain/errors/wallet.errors';
import {
  WALLET_ADDRESS,
  WALLET_OTHER_MASTER_ADDRESS,
  WALLET_OWNER_ID,
  buildWallet,
} from '../../helpers/wallet.factory';
import { addressIndexArb, ethereumAddressArb } from '../../helpers/arbitraries';

const OWNER_ID = WALLET_OWNER_ID;

describe('FindWalletByOwnerUseCase', () => {
  describe('execute()', () => {
    it('debería devolver la wallet del dueño', async () => {
      // Arrange
      const existing = buildWallet({ ownerId: OWNER_ID, address: WALLET_ADDRESS });
      const repository = new InMemoryWalletRepository([existing]);
      const useCase = new FindWalletByOwnerUseCase(repository);

      // Act
      const wallet = await useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' });

      // Assert
      expect(wallet).toBe(existing);
      expect(repository.findByOwnerIdCalls).toEqual([OWNER_ID]);
    });

    it('debería lanzar WalletNotFoundError cuando el dueño no tiene wallet', async () => {
      // Arrange
      const useCase = new FindWalletByOwnerUseCase(new InMemoryWalletRepository());

      // Act + Assert
      await expect(useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' })).rejects.toThrow(
        WalletNotFoundError,
      );
    });

    it('debería depender solo del repositorio, sin directorio de dueños ni pasarela', () => {
      // Arrange & Act
      const dependencies = FindWalletByOwnerUseCase.length;

      // Assert
      // La aridad del constructor ES la lista de puertos inyectados: `@Injectable()` no envuelve
      // la clase. Inyectar el directorio «por simetría» con los otros tres casos añadiría una
      // consulta al endpoint más llamado del módulo, y este caso se pone rojo al hacerlo.
      expect(dependencies).toBe(1);
    });

    it('debería no ejecutar assertOwnedBy sobre la wallet devuelta', async () => {
      // Arrange: wallet derivada bajo OTRA master, la que quedaría tras una rotación.
      const existing = buildWallet({
        ownerId: OWNER_ID,
        ownerAddress: WALLET_OTHER_MASTER_ADDRESS,
      });
      const guard = jest.spyOn(existing, 'assertOwnedBy');
      const useCase = new FindWalletByOwnerUseCase(new InMemoryWalletRepository([existing]));

      // Act
      const wallet = await useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' });

      // Assert: la lectura sigue respondiendo la dirección vieja; lo que debe fallar es
      // cualquier intento de OPERAR con ella, no la consulta (spec §5).
      expect(wallet).toBe(existing);
      expect(guard).not.toHaveBeenCalled();
    });

    it('debería devolver null al rol admin sin consultar el repositorio', async () => {
      // Arrange: aunque hubiera una fila con ese id, la del admin es la master y no está en la
      // tabla — la respuesta la compone el controlador con `kind: 'master'`.
      const repository = new InMemoryWalletRepository([buildWallet({ ownerId: OWNER_ID })]);
      const useCase = new FindWalletByOwnerUseCase(repository);

      // Act
      const wallet = await useCase.execute({ ownerId: OWNER_ID, ownerRole: 'admin' });

      // Assert
      expect(wallet).toBeNull();
      expect(repository.findByOwnerIdCalls).toEqual([]);
    });
  });

  describe('execute() (property-based)', () => {
    fcTest.prop([addressIndexArb, ethereumAddressArb])(
      'debería devolver siempre la wallet del dueño consultado (propiedad)',
      async (index, address) => {
        // Arrange
        const existing = buildWallet({ ownerId: OWNER_ID, address, addressIndex: index });
        const useCase = new FindWalletByOwnerUseCase(new InMemoryWalletRepository([existing]));

        // Act
        const wallet = await useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' });

        // Assert: `EthereumAddress` normaliza a minúsculas, así que se compara contra el valor
        // normalizado y no contra la cadena generada.
        expect(wallet?.ownerId).toBe(OWNER_ID);
        expect(wallet?.addressIndex.value).toBe(index);
        expect(wallet?.address.value).toBe(address.toLowerCase());
      },
    );
  });
});
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/modules/wallets/__tests__/application/use-cases/find-wallet-by-owner.use-case.spec.ts`
Expected: FAIL — `Cannot find module '../../../application/use-cases/find-wallet-by-owner.use-case'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/modules/wallets/application/use-cases/find-wallet-by-owner.use-case.ts
import { Injectable } from '@nestjs/common';

import { WalletNotFoundError } from '../../domain/errors/wallet.errors';
import { WalletRepository } from '../../domain/ports/wallet.repository';

import type { Wallet } from '../../domain/entities/wallet.entity';

export type FindWalletByOwnerInput = {
  ownerId: string;
  ownerRole: string;
};

/**
 * Rol cuya dirección es la master. Literal y no `USER_ROLES` de `users`: la regla 2 del gate de
 * fronteras prohíbe a `application/` importar de otro módulo, y `common` publica el rol como
 * `string` por ese mismo motivo.
 */
const ADMIN_ROLE = 'admin';

/**
 * Lectura de «mi wallet». Un solo puerto, y las tres decisiones son deliberadas:
 *
 * **Al rol `admin` le devuelve `null`, no un error.** Su dirección es la master, que vive en la
 * configuración y no en la tabla, así que aquí no hay fila que buscar; el controlador compone la
 * respuesta con `kind: 'master'` e `index` nulo. Un 404 sería mentira a medias —el admin sí tiene
 * dirección, y es la que sostiene todo—, y componerla aquí obligaría a inyectar la configuración
 * en un caso de uso que solo lee.
 *
 * **No consulta el directorio de dueños.** El token ya probó el `sub`; un 403 aquí sería
 * cosmético a cambio de una consulta extra en el endpoint más llamado del módulo — la gente
 * consulta repetidamente esperando la activación. Los tres casos que cuestan dinero o crean
 * estado sí lo consultan (spec §5).
 *
 * **No ejecuta `assertOwnedBy`.** Esa comprobación existe para impedir OPERAR con una wallet
 * derivada por otra master, no para censurar una lectura; meterla aquí obligaría además a
 * inyectar la pasarela solo para leer un dato de configuración. La consecuencia asumida está
 * escrita: tras una rotación de la master, este endpoint sigue devolviendo la dirección vieja
 * mientras cualquier intento de usarla da 500 con nombre — que es el orden de descubrimiento
 * que se quiere.
 *
 * ⚠️ El estado que publica puede ir POR DETRÁS de la cadena: la reconciliación vive en activar y
 * en transferir, no aquí. Es deuda escrita, y la `description` del endpoint lo dice.
 */
@Injectable()
export class FindWalletByOwnerUseCase {
  constructor(private readonly wallets: WalletRepository) {}

  async execute(input: FindWalletByOwnerInput): Promise<Wallet | null> {
    if (input.ownerRole === ADMIN_ROLE) {
      return null;
    }

    const wallet = await this.wallets.findByOwnerId(input.ownerId);
    if (!wallet) {
      throw new WalletNotFoundError(input.ownerId);
    }
    return wallet;
  }
}
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/modules/wallets/__tests__/application/use-cases/find-wallet-by-owner.use-case.spec.ts`
Expected: PASS — 6 passed

---

### Task 19: `ActivateWalletUseCase` — activación con reconciliación perezosa

**Layer:** application
**Rule codes to honor:** `arch-single-responsibility`, `di-prefer-constructor-injection`, `di-use-interfaces-tokens`, `error-handle-async-errors`, `test-mock-external-services`

**Casos acordados:**

| #   | Caso (se vuelve el `it`)                                                                                      | Entrada / estado inicial                                          | Resultado esperado                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| V1  | debería solicitar la activación y guardar el hash cuando la dirección todavía no puede enviar                 | wallet `receive-only`; proveedor responde `false`; activa `0x7a…` | devuelve la wallet en `activating` con `activationTxId`; un `enableSending`; un `save`             |
| V2  | debería curar la wallet a `active` sin volver a activar cuando el proveedor dice que ya puede enviar          | wallet `activating`; el proveedor responde `true`                 | lanza `WalletAlreadyActivatedError`; la wallet guardada queda `active`; `enableSendingCalls` vacío |
| V3  | debería atribuir la curación al actor de reconciliación y no al dueño                                         | igual que V2                                                      | la wallet guardada lleva `updatedBy` = `SYSTEM_ACTORS.ACTIVATION_RECONCILIATION`                   |
| V4  | debería rechazar con `WalletActivationInProgressError` sin emitir una segunda transacción                     | wallet `activating`; el proveedor responde `false`                | lanza; `enableSendingCalls` vacío; `saveCalls` vacío                                               |
| V5  | debería rechazar con `WalletAlreadyActivatedError` sin preguntar al proveedor cuando la wallet ya está activa | wallet `active`                                                   | lanza; `isSendingEnabledCalls` vacío; `saveCalls` vacío                                            |
| V6  | debería rechazar con `WalletOwnerGoneError` cuando el directorio ya no conoce al dueño                        | directorio vacío                                                  | lanza; ninguna llamada al proveedor                                                                |
| V7  | debería lanzar `WalletNotFoundError` cuando el dueño no tiene wallet                                          | repositorio vacío                                                 | lanza; ninguna llamada al proveedor                                                                |
| V8  | debería lanzar `WalletOwnerMismatchError` cuando la wallet se derivó bajo otra master                         | wallet con `ownerAddress` distinta de la de la pasarela           | lanza; ninguna llamada al proveedor                                                                |
| V9  | debería propagar el fallo del proveedor sin guardar nada                                                      | `enableSending` rechaza                                           | lanza ese error; `saveCalls` vacío                                                                 |
| V10 | debería anotar al dueño como autor de la solicitud de activación                                              | igual que V1                                                      | la wallet guardada lleva `updatedBy` = `ownerId`                                                   |
| V11 | debería rechazar con `AdminUsesMasterAddressError` cuando el rol es `admin`, sin consultar nada               | `ownerRole` = `'admin'`, con la wallet en la tabla                | lanza; `existsCalls` vacío y ninguna llamada al proveedor                                          |

⚠️ **V2 devuelve un 409 y no un 202, y es una decisión, no un descuido.** El 202 del endpoint
significa «la transacción de activación está enviada, no minada»; en esta rama no se envió nada
—la cadena ya lo dice—, así que publicar 202 sería exactamente la ficción que el guardián del
contrato existe para impedir. La curación se guarda ANTES de lanzar: el cliente recibe el 409 y su
siguiente `GET /wallets/me` ya ve `active`. Es también el único productor de
`WalletAlreadyActivatedError` junto con V5, y sin él ese error sería dominio inalcanzable.

⚠️ **`WalletAlreadyActivatedError` y `WalletActivationInProgressError` se construyen SIN
argumentos.** Sus mensajes son fijos y no nombran la wallet: el 409 lo lee el dueño de esa wallet,
que no necesita que se la identifiquen, y un identificador interno en un cuerpo publicado es
superficie regalada.

⚠️ **El 409 al rol `admin` («no hay nada que activar») vive AQUÍ**, por lo mismo que en la tarea 17:
el rol llega en la entrada del caso de uso, no se queda en el borde HTTP.

**Files:**

- Create: `src/modules/wallets/application/use-cases/activate-wallet.use-case.ts`
- Test: `src/modules/wallets/__tests__/application/use-cases/activate-wallet.use-case.spec.ts`

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/modules/wallets/__tests__/application/use-cases/activate-wallet.use-case.spec.ts
import { SYSTEM_ACTORS } from '@shared/domain/system-actor';

import { ActivateWalletUseCase } from '../../../application/use-cases/activate-wallet.use-case';
import { EthereumAddress } from '../../../domain/value-objects/ethereum-address.vo';
import { FakeCustodialAddressGateway } from '../../helpers/fake-custodial-address.gateway';
import { FakeOwnerDirectory } from '../../helpers/fake-owner.directory';
import { InMemoryWalletRepository } from '../../helpers/in-memory-wallet.repository';
import { TransactionHash } from '../../../domain/value-objects/transaction-hash.vo';
import {
  AdminUsesMasterAddressError,
  WalletActivationInProgressError,
  WalletAlreadyActivatedError,
  WalletNotFoundError,
  WalletOwnerGoneError,
  WalletOwnerMismatchError,
} from '../../../domain/errors/wallet.errors';
import {
  WALLET_MASTER_ADDRESS,
  WALLET_OTHER_MASTER_ADDRESS,
  WALLET_OWNER_ID,
  buildWallet,
} from '../../helpers/wallet.factory';

import type { Wallet } from '../../../domain/entities/wallet.entity';

const OWNER_ID = WALLET_OWNER_ID;
const MASTER = WALLET_MASTER_ADDRESS;
const ACTIVATION_TX = '0x7a1c3b5d7e90a2d4e6f8a19f2e6c1b4a8d3f5e7c0b9a2d4e6f8a1c3b5d7e9012';

describe('ActivateWalletUseCase', () => {
  describe('execute()', () => {
    it('debería solicitar la activación y guardar el hash cuando la dirección todavía no puede enviar', async () => {
      // Arrange
      const { useCase, repository, gateway } = buildUseCase([buildWallet()]);
      gateway.programSendingEnabled(false);
      gateway.programEnableSending(TransactionHash.from(ACTIVATION_TX));

      // Act
      const wallet = await useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' });

      // Assert
      expect(wallet.status).toBe('activating');
      expect(wallet.activationTxId?.value).toBe(ACTIVATION_TX);
      expect(gateway.enableSendingCalls).toHaveLength(1);
      // El proveedor toma el ÍNDICE, no la dirección: `POST /v3/gas-pump/activate` recibe
      // `{chain, owner, from, to}` y los dos últimos son índices.
      expect(gateway.enableSendingCalls[0]?.value).toBe(wallet.addressIndex.value);
      expect(repository.saveCalls).toEqual([wallet]);
    });

    it('debería curar la wallet a active sin volver a activar cuando el proveedor dice que ya puede enviar', async () => {
      // Arrange: nuestra fila se quedó en `activating` porque perdimos la respuesta.
      const stored = buildWallet({ status: 'activating' });
      const { useCase, repository, gateway } = buildUseCase([stored]);
      gateway.programSendingEnabled(true);

      // Act + Assert
      await expect(useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' })).rejects.toThrow(
        WalletAlreadyActivatedError,
      );
      expect(repository.saveCalls).toEqual([stored]);
      expect(stored.status).toBe('active');
      // Una segunda activación se ACEPTA y quema el gas: el proveedor responde 200 con un hash
      // nuevo y el fallo solo sería visible en una operación que este ciclo no lee (spec §3.1).
      expect(gateway.enableSendingCalls).toEqual([]);
    });

    it('debería atribuir la curación al actor de reconciliación y no al dueño', async () => {
      // Arrange
      const stored = buildWallet({ status: 'activating' });
      const { useCase, gateway } = buildUseCase([stored]);
      gateway.programSendingEnabled(true);

      // Act
      await expect(useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' })).rejects.toThrow(
        WalletAlreadyActivatedError,
      );

      // Assert: el dueño no activó nada — su transacción anterior lo hizo, o se perdió.
      expect(stored.updatedBy).toBe(SYSTEM_ACTORS.ACTIVATION_RECONCILIATION);
    });

    it('debería rechazar con WalletActivationInProgressError sin emitir una segunda transacción', async () => {
      // Arrange
      const { useCase, repository, gateway } = buildUseCase([
        buildWallet({ status: 'activating' }),
      ]);
      gateway.programSendingEnabled(false);

      // Act + Assert
      await expect(useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' })).rejects.toThrow(
        WalletActivationInProgressError,
      );
      expect(gateway.enableSendingCalls).toEqual([]);
      expect(repository.saveCalls).toEqual([]);
    });

    it('debería rechazar con WalletAlreadyActivatedError sin preguntar al proveedor cuando la wallet ya está activa', async () => {
      // Arrange
      const { useCase, repository, gateway } = buildUseCase([buildWallet({ status: 'active' })]);

      // Act + Assert
      await expect(useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' })).rejects.toThrow(
        WalletAlreadyActivatedError,
      );
      // El estado es monótono: una dirección activada no se des-activa, así que el `active`
      // cacheado ahorra el crédito de la comprobación (spec §5.4).
      expect(gateway.isSendingEnabledCalls).toEqual([]);
      expect(repository.saveCalls).toEqual([]);
    });

    it('debería rechazar con WalletOwnerGoneError cuando el directorio ya no conoce al dueño', async () => {
      // Arrange
      const { useCase, gateway } = buildUseCase([buildWallet()], []);

      // Act + Assert
      await expect(useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' })).rejects.toThrow(
        WalletOwnerGoneError,
      );
      expect(gateway.isSendingEnabledCalls).toEqual([]);
      expect(gateway.enableSendingCalls).toEqual([]);
    });

    it('debería lanzar WalletNotFoundError cuando el dueño no tiene wallet', async () => {
      // Arrange
      const { useCase, gateway } = buildUseCase([]);

      // Act + Assert
      await expect(useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' })).rejects.toThrow(
        WalletNotFoundError,
      );
      expect(gateway.isSendingEnabledCalls).toEqual([]);
    });

    it('debería lanzar WalletOwnerMismatchError cuando la wallet se derivó bajo otra master', async () => {
      // Arrange: la master rotó y esta dirección ya no la controlamos.
      const { useCase, gateway } = buildUseCase([
        buildWallet({ ownerAddress: WALLET_OTHER_MASTER_ADDRESS }),
      ]);

      // Act + Assert
      await expect(useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' })).rejects.toThrow(
        WalletOwnerMismatchError,
      );
      expect(gateway.isSendingEnabledCalls).toEqual([]);
    });

    it('debería propagar el fallo del proveedor sin guardar nada', async () => {
      // Arrange
      const failure = new Error('provider down');
      const { useCase, repository, gateway } = buildUseCase([buildWallet()]);
      gateway.programSendingEnabled(false);
      gateway.programEnableSending(failure);

      // Act + Assert
      await expect(useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' })).rejects.toThrow(
        failure,
      );
      expect(repository.saveCalls).toEqual([]);
    });

    it('debería anotar al dueño como autor de la solicitud de activación', async () => {
      // Arrange
      const { useCase, gateway } = buildUseCase([buildWallet()]);
      gateway.programSendingEnabled(false);
      gateway.programEnableSending(TransactionHash.from(ACTIVATION_TX));

      // Act
      const wallet = await useCase.execute({ ownerId: OWNER_ID, ownerRole: 'user' });

      // Assert: esta transición SÍ la pidió él, a diferencia de la curación.
      expect(wallet.updatedBy).toBe(OWNER_ID);
    });

    it('debería rechazar con AdminUsesMasterAddressError cuando el rol es admin, sin consultar nada', async () => {
      // Arrange: la master no es una gas pump address, así que no hay nada que activar.
      const { useCase, directory, gateway } = buildUseCase([buildWallet()]);

      // Act + Assert
      await expect(useCase.execute({ ownerId: OWNER_ID, ownerRole: 'admin' })).rejects.toThrow(
        AdminUsesMasterAddressError,
      );
      expect(directory.existsCalls).toEqual([]);
      expect(gateway.isSendingEnabledCalls).toEqual([]);
      expect(gateway.enableSendingCalls).toEqual([]);
    });
  });
});

// Helpers

const buildUseCase = (wallets: readonly Wallet[], knownOwners: readonly string[] = [OWNER_ID]) => {
  const directory = new FakeOwnerDirectory(knownOwners);
  const repository = new InMemoryWalletRepository(wallets);
  const gateway = new FakeCustodialAddressGateway(EthereumAddress.from(MASTER));

  return {
    useCase: new ActivateWalletUseCase(directory, repository, gateway),
    directory,
    repository,
    gateway,
  };
};
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/modules/wallets/__tests__/application/use-cases/activate-wallet.use-case.spec.ts`
Expected: FAIL — `Cannot find module '../../../application/use-cases/activate-wallet.use-case'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/modules/wallets/application/use-cases/activate-wallet.use-case.ts
import { Injectable } from '@nestjs/common';

import { SYSTEM_ACTORS } from '@shared/domain/system-actor';

import { CustodialAddressGateway } from '../../domain/ports/custodial-address.gateway';
import { OwnerDirectory } from '../../domain/ports/owner.directory';
import {
  AdminUsesMasterAddressError,
  WalletActivationInProgressError,
  WalletAlreadyActivatedError,
  WalletNotFoundError,
  WalletOwnerGoneError,
} from '../../domain/errors/wallet.errors';
import { WalletRepository } from '../../domain/ports/wallet.repository';

import type { Wallet } from '../../domain/entities/wallet.entity';

export type ActivateWalletInput = {
  ownerId: string;
  ownerRole: string;
};

/**
 * Rol cuya dirección es la master, que no es una gas pump address y no se activa. Literal y no
 * `USER_ROLES` de `users`: la regla 2 del gate de fronteras prohíbe a `application/` importar de
 * otro módulo.
 */
const ADMIN_ROLE = 'admin';

/**
 * Activación de la gas pump address, con la reconciliación perezosa del spec §5.4 dentro.
 *
 * **El orden de las cinco decisiones no es intercambiable, y cada una evita un gasto distinto:**
 *
 *   0. Rol `admin` ⇒ 409 sin tocar nada. La master no es una gas pump address: no hay nada que
 *      activar, y el rol viaja en el token, así que la comprobación no cuesta E/S.
 *   1. `active` guardado ⇒ 409 sin llamar a nadie. El estado es MONÓTONO —el contrato está
 *      desplegado y no se des-despliega—, así que el `active` cacheado es información completa y
 *      preguntar otra vez sería pagar un crédito por saber lo que ya sabemos.
 *   2. El proveedor dice que ya puede enviar ⇒ **curación**, guardado y 409. La transición
 *      directa `receive-only → active` es la salida del fallo parcial: el proveedor aceptó una
 *      activación anterior y perdimos su respuesta. Sin ella esa wallet quedaría colgada para
 *      siempre y el intento siguiente **volvería a activar** — que no falla de forma visible: el
 *      proveedor responde 200 con un hash nuevo y el gas se quema (medido sobre `openapi.json`,
 *      spec §3.1).
 *   3. `activating` guardado ⇒ 409 sin activar. Misma razón que el punto anterior, vista desde el
 *      otro lado: hay una transacción en vuelo y emitir la segunda la paga dos veces.
 *   4. Solo entonces se activa de verdad.
 *
 * ⚠️ **La curación se ATRIBUYE a `ACTIVATION_RECONCILIATION`, nunca al dueño que hizo la
 * petición.** Él no activó nada; su activación anterior o la de otro intento sí. Ponerle su id
 * dejaría la traza afirmando algo falso justo sobre el fallo parcial que esta rama existe para
 * tapar, y esa traza es lo único que queda para reconstruirlo.
 *
 * ⚠️ **Se guarda ANTES de lanzar el 409.** Si se lanzara primero, la curación se perdería y la
 * wallet volvería a preguntar al proveedor en cada intento, para siempre.
 *
 * ⚠️ **La pasarela recibe el ÍNDICE**, no la dirección: `activate` toma índices y la ruta de
 * `activated/{chain}/{owner}/{index}` también. La dirección no aparece en ninguna de las dos.
 *
 * ⚠️ **No escribe por delante**, a diferencia de la transferencia: si el proceso muere entre la
 * respuesta del proveedor y el guardado, el reintento vuelve a activar. Es asimetría aceptada
 * —la ventana cuesta créditos de testnet, no ETH— y está anotada en el backlog como bloqueante
 * para mainnet.
 */
@Injectable()
export class ActivateWalletUseCase {
  constructor(
    private readonly owners: OwnerDirectory,
    private readonly wallets: WalletRepository,
    private readonly gateway: CustodialAddressGateway,
  ) {}

  async execute(input: ActivateWalletInput): Promise<Wallet> {
    if (input.ownerRole === ADMIN_ROLE) {
      throw new AdminUsesMasterAddressError();
    }

    const exists = await this.owners.exists(input.ownerId);
    if (!exists) {
      throw new WalletOwnerGoneError(input.ownerId);
    }

    const wallet = await this.wallets.findByOwnerId(input.ownerId);
    if (!wallet) {
      throw new WalletNotFoundError(input.ownerId);
    }

    // Aquí sí corre: este caso de uso va a OPERAR con la dirección, y operar bajo una master que
    // ya no controlamos quema gas para nada.
    wallet.assertOwnedBy(this.gateway.masterAddress());

    if (wallet.canSend) {
      throw new WalletAlreadyActivatedError();
    }

    const alreadyEnabled = await this.gateway.isSendingEnabled(wallet.addressIndex);
    if (alreadyEnabled) {
      wallet.confirmActivated(new Date(), SYSTEM_ACTORS.ACTIVATION_RECONCILIATION);
      await this.wallets.save(wallet);
      throw new WalletAlreadyActivatedError();
    }

    if (wallet.status === 'activating') {
      throw new WalletActivationInProgressError();
    }

    const txId = await this.gateway.enableSending(wallet.addressIndex);
    wallet.markActivationRequested(txId, new Date(), input.ownerId);
    // El desenlace de `save` solo distingue algo en el INSERT del alta: aquí la fila existe y se
    // actualiza por id, así que no hay `user_id` con el que chocar.
    await this.wallets.save(wallet);
    return wallet;
  }
}
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/modules/wallets/__tests__/application/use-cases/activate-wallet.use-case.spec.ts`
Expected: PASS — 11 passed

---

### Task 20: `TransferAssetUseCase` — libro por delante y tres desenlaces

**Layer:** application
**Rule codes to honor:** `arch-single-responsibility`, `di-prefer-constructor-injection`, `di-interface-segregation`, `error-handle-async-errors`, `security-validate-all-input`, `test-mock-external-services`

**Casos acordados:**

| #   | Caso (se vuelve el `it`)                                                                          | Entrada / estado inicial                                               | Resultado esperado                                                                                     |
| --- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| T1  | debería registrar la transferencia como `submitted` con el hash devuelto por el proveedor         | wallet `active`; `send` devuelve `0x9c…`                               | devuelve la transferencia `submitted` con ese `txId`; dos guardados                                    |
| T2  | debería escribir la fila del libro ANTES de llamar al proveedor                                   | igual que T1, registrando el orden                                     | `['save:submitting', 'send', 'save:submitted']`                                                        |
| T3  | debería enviar desde la dirección de la wallet y nunca desde la master                            | igual que T1                                                           | `sendCalls[0].from` es `wallet.address`, distinta de la master; `recipient` es el pedido               |
| T4  | debería registrar `rejected` con el código del proveedor y propagar el error                      | `send` rechaza con `WalletProviderRejectedError('body-rejected', 400)` | lanza ese mismo error; la última fila guardada está en `rejected` con `reasonCode` ese                 |
| T5  | debería registrar `unknown` cuando la llamada no deja saber el resultado                          | `send` rechaza con `WalletProviderUnreachableError('timeout', null)`   | lanza; la última fila guardada está en `unknown` con `reasonCode` `'timeout'`                          |
| T6  | debería rechazar un destinatario mal formado sin tocar la red ni escribir en el libro             | `recipient` = `'0x123'`                                                | lanza `InvalidEthereumAddressError`; `sendCalls` vacío; `saveCalls` del libro vacío                    |
| T7  | debería rechazar un activo con campos excluyentes sin tocar la red ni escribir en el libro        | activo nativo con `tokenId`                                            | lanza `AssetFieldNotAllowedError`; `sendCalls` vacío; `saveCalls` del libro vacío                      |
| T8  | debería rechazar con `WalletNotActivatedError` cuando el proveedor dice que aún no puede enviar   | wallet `receive-only`; proveedor responde `false`                      | lanza; `sendCalls` vacío; `saveCalls` del libro vacío                                                  |
| T9  | debería curar la wallet a `active` atribuyéndolo al actor de reconciliación y seguir adelante     | wallet `receive-only`; proveedor responde `true`                       | la wallet guardada queda `active` con `updatedBy` = `ACTIVATION_RECONCILIATION`; sale la transferencia |
| T10 | debería no preguntar al proveedor por la activación cuando la wallet ya está activa               | wallet `active`                                                        | `isSendingEnabledCalls` vacío; la transferencia sale                                                   |
| T11 | debería rechazar con `WalletOwnerGoneError` cuando el directorio ya no conoce al dueño            | directorio vacío                                                       | lanza; ninguna llamada al proveedor; libro vacío                                                       |
| T12 | debería lanzar `WalletNotFoundError` cuando el dueño no tiene wallet                              | repositorio vacío                                                      | lanza; ninguna llamada al proveedor                                                                    |
| T13 | debería lanzar `WalletOwnerMismatchError` cuando la wallet se derivó bajo otra master             | wallet bajo otra master                                                | lanza; ninguna llamada al proveedor                                                                    |
| T14 | debería reintentar UNA vez el guardado posterior del libro                                        | el segundo guardado falla, el tercero pasa                             | devuelve la transferencia `submitted`; tres guardados en total                                         |
| T15 | debería devolver la transferencia enviada aunque el reintento del guardado también falle          | los dos guardados posteriores fallan                                   | devuelve la transferencia con su `txId`, sin lanzar; tres guardados en total                           |
| T16 | debería rechazar con `AdminUsesMasterAddressError` cuando el rol es `admin`, sin consultar nada   | `ownerRole` = `'admin'`, con la wallet en la tabla                     | lanza; `existsCalls` vacío; `sendCalls` vacío; libro vacío                                             |
| T17 | debería dejar la fila en `submitting` y propagar cuando el fallo no viene traducido del proveedor | `send` rechaza con un `Error` corriente                                | lanza ese error; un solo guardado, en `submitting` y con `reasonCode` nulo                             |
| P1  | debería escribir siempre la primera fila en `submitting`, sea cual sea el desenlace _(propiedad)_ | arbitrario: los tres desenlaces del proveedor                          | la PRIMERA llamada a `save` siempre lleva estado `submitting`                                          |

⚠️ **T4 y T5 usan motivos de `PROVIDER_FAILURE_REASONS` y de ninguna otra lista.** El `reasonCode`
del libro reutiliza el mismo tipo que los errores del proveedor: es la misma información vista desde
otro sitio, y tener dos catálogos garantizaba que uno acabara con un valor que el otro no sabe leer.

⚠️ **T17 fija por qué NO hay un motivo «error inesperado».** Un fallo que no venga traducido del
adaptador es un defecto nuestro, y la lista cerrada no tiene código para eso: inventarle uno
publicaría en `GET /wallets/me/transfers` una causa falsa. La fila se queda en `submitting`, que es
literalmente lo que sabemos y que la regla escrita manda leer como `unknown` (spec §3.2).

⚠️ **El 409 al rol `admin` («la master no envía por Gas Pump») vive AQUÍ**, por lo mismo que en las
tareas 17 y 19.

**Files:**

- Create: `src/modules/wallets/application/use-cases/transfer-asset.use-case.ts`
- Test: `src/modules/wallets/__tests__/application/use-cases/transfer-asset.use-case.spec.ts`

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/modules/wallets/__tests__/application/use-cases/transfer-asset.use-case.spec.ts
import { fc, test as fcTest } from '@fast-check/jest';

import { SYSTEM_ACTORS } from '@shared/domain/system-actor';

import { EthereumAddress } from '../../../domain/value-objects/ethereum-address.vo';
import { FakeCustodialAddressGateway } from '../../helpers/fake-custodial-address.gateway';
import { FakeOwnerDirectory } from '../../helpers/fake-owner.directory';
import { InMemoryWalletRepository } from '../../helpers/in-memory-wallet.repository';
import { InMemoryWalletTransferRepository } from '../../helpers/in-memory-wallet-transfer.repository';
import { TransactionHash } from '../../../domain/value-objects/transaction-hash.vo';
import { TransferAssetUseCase } from '../../../application/use-cases/transfer-asset.use-case';
import {
  AdminUsesMasterAddressError,
  AssetFieldNotAllowedError,
  InvalidEthereumAddressError,
  WalletNotActivatedError,
  WalletNotFoundError,
  WalletOwnerGoneError,
  WalletOwnerMismatchError,
  WalletProviderRejectedError,
  WalletProviderUnreachableError,
} from '../../../domain/errors/wallet.errors';
import {
  WALLET_ADDRESS,
  WALLET_MASTER_ADDRESS,
  WALLET_OTHER_MASTER_ADDRESS,
  WALLET_OWNER_ID,
  buildWallet,
} from '../../helpers/wallet.factory';
import { TRANSFER_RECIPIENT_ADDRESS, TRANSFER_TX } from '../../helpers/wallet-transfer.factory';

import type { TransferAssetParts } from '../../../domain/transfer-asset';
import type { Wallet } from '../../../domain/entities/wallet.entity';

const OWNER_ID = WALLET_OWNER_ID;
const MASTER = WALLET_MASTER_ADDRESS;
const DERIVED = WALLET_ADDRESS;
const RECIPIENT = TRANSFER_RECIPIENT_ADDRESS;
const NATIVE_ASSET: TransferAssetParts = { kind: 'native', amount: '1000000000000000000' };

describe('TransferAssetUseCase', () => {
  describe('execute()', () => {
    it('debería registrar la transferencia como submitted con el hash devuelto por el proveedor', async () => {
      // Arrange
      const { useCase, ledger, gateway } = buildUseCase([buildWallet({ status: 'active' })]);
      gateway.programSend(TransactionHash.from(TRANSFER_TX));

      // Act
      const transfer = await useCase.execute({
        ownerId: OWNER_ID,
        ownerRole: 'user',
        recipient: RECIPIENT,
        asset: NATIVE_ASSET,
      });

      // Assert
      expect(transfer.status).toBe('submitted');
      expect(transfer.txId?.value).toBe(TRANSFER_TX);
      expect(ledger.saveCalls).toHaveLength(2);
    });

    it('debería escribir la fila del libro ANTES de llamar al proveedor', async () => {
      // Arrange
      const { useCase, ledger, gateway } = buildUseCase([buildWallet({ status: 'active' })]);
      gateway.programSend(TransactionHash.from(TRANSFER_TX));
      const calls: string[] = [];
      jest.spyOn(ledger, 'save').mockImplementation((transfer) => {
        calls.push(`save:${transfer.status}`);
        return Promise.resolve();
      });
      jest.spyOn(gateway, 'send').mockImplementation(() => {
        calls.push('send');
        return Promise.resolve(TransactionHash.from(TRANSFER_TX));
      });

      // Act
      await useCase.execute({
        ownerId: OWNER_ID,
        ownerRole: 'user',
        recipient: RECIPIENT,
        asset: NATIVE_ASSET,
      });

      // Assert: con la escritura posterior, un timeout no dejaría rastro — que es justo el caso
      // para el que el libro existe (spec §3.2).
      expect(calls).toEqual(['save:submitting', 'send', 'save:submitted']);
    });

    it('debería enviar desde la dirección de la wallet y nunca desde la master', async () => {
      // Arrange
      const { useCase, gateway } = buildUseCase([buildWallet({ status: 'active' })]);
      gateway.programSend(TransactionHash.from(TRANSFER_TX));

      // Act
      await useCase.execute({
        ownerId: OWNER_ID,
        ownerRole: 'user',
        recipient: RECIPIENT,
        asset: NATIVE_ASSET,
      });

      // Assert: la master FIRMA, no envía. Enviar desde ella movería el fondo de gas.
      expect(gateway.sendCalls[0]?.from.value).toBe(DERIVED);
      expect(gateway.sendCalls[0]?.from.value).not.toBe(MASTER);
      expect(gateway.sendCalls[0]?.recipient.value).toBe(RECIPIENT);
    });

    it('debería registrar rejected con el código del proveedor y propagar el error', async () => {
      // Arrange
      const rejection = new WalletProviderRejectedError('body-rejected', 400);
      const { useCase, ledger, gateway } = buildUseCase([buildWallet({ status: 'active' })]);
      gateway.programSend(rejection);

      // Act + Assert
      await expect(
        useCase.execute({
          ownerId: OWNER_ID,
          ownerRole: 'user',
          recipient: RECIPIENT,
          asset: NATIVE_ASSET,
        }),
      ).rejects.toThrow(rejection);
      expect(ledger.saveCalls.at(-1)?.status).toBe('rejected');
      expect(ledger.saveCalls.at(-1)?.reasonCode).toBe('body-rejected');
    });

    it('debería registrar unknown cuando la llamada no deja saber el resultado', async () => {
      // Arrange: un timeout NO es «no se ejecutó» — pudo minarse o no.
      const failure = new WalletProviderUnreachableError('timeout', null);
      const { useCase, ledger, gateway } = buildUseCase([buildWallet({ status: 'active' })]);
      gateway.programSend(failure);

      // Act + Assert
      await expect(
        useCase.execute({
          ownerId: OWNER_ID,
          ownerRole: 'user',
          recipient: RECIPIENT,
          asset: NATIVE_ASSET,
        }),
      ).rejects.toThrow(failure);
      expect(ledger.saveCalls.at(-1)?.status).toBe('unknown');
      expect(ledger.saveCalls.at(-1)?.reasonCode).toBe('timeout');
    });

    it('debería rechazar un destinatario mal formado sin tocar la red ni escribir en el libro', async () => {
      // Arrange
      const { useCase, ledger, gateway } = buildUseCase([buildWallet({ status: 'active' })]);

      // Act + Assert
      await expect(
        useCase.execute({
          ownerId: OWNER_ID,
          ownerRole: 'user',
          recipient: '0x123',
          asset: NATIVE_ASSET,
        }),
      ).rejects.toThrow(InvalidEthereumAddressError);
      expect(gateway.sendCalls).toEqual([]);
      expect(ledger.saveCalls).toEqual([]);
    });

    it('debería rechazar un activo con campos excluyentes sin tocar la red ni escribir en el libro', async () => {
      // Arrange: el nativo no admite `tokenId`; el DTO deja pasar el campo de más a propósito y
      // la invariante real vive aquí (spec §6.1).
      const { useCase, ledger, gateway } = buildUseCase([buildWallet({ status: 'active' })]);

      // Act + Assert
      await expect(
        useCase.execute({
          ownerId: OWNER_ID,
          ownerRole: 'user',
          recipient: RECIPIENT,
          asset: { kind: 'native', amount: '1', tokenId: '7' },
        }),
      ).rejects.toThrow(AssetFieldNotAllowedError);
      expect(gateway.sendCalls).toEqual([]);
      expect(ledger.saveCalls).toEqual([]);
    });

    it('debería rechazar con WalletNotActivatedError cuando el proveedor dice que aún no puede enviar', async () => {
      // Arrange
      const { useCase, ledger, gateway } = buildUseCase([buildWallet()]);
      gateway.programSendingEnabled(false);

      // Act + Assert
      await expect(
        useCase.execute({
          ownerId: OWNER_ID,
          ownerRole: 'user',
          recipient: RECIPIENT,
          asset: NATIVE_ASSET,
        }),
      ).rejects.toThrow(WalletNotActivatedError);
      expect(gateway.sendCalls).toEqual([]);
      // El libro se llenaría de rechazos que nunca salieron del proceso (spec §3.2).
      expect(ledger.saveCalls).toEqual([]);
    });

    it('debería curar la wallet a active atribuyéndolo al actor de reconciliación y seguir adelante', async () => {
      // Arrange
      const stored = buildWallet();
      const { useCase, repository, gateway } = buildUseCase([stored]);
      gateway.programSendingEnabled(true);
      gateway.programSend(TransactionHash.from(TRANSFER_TX));

      // Act
      const transfer = await useCase.execute({
        ownerId: OWNER_ID,
        ownerRole: 'user',
        recipient: RECIPIENT,
        asset: NATIVE_ASSET,
      });

      // Assert
      expect(stored.status).toBe('active');
      expect(stored.updatedBy).toBe(SYSTEM_ACTORS.ACTIVATION_RECONCILIATION);
      expect(repository.saveCalls).toEqual([stored]);
      expect(transfer.status).toBe('submitted');
    });

    it('debería no preguntar al proveedor por la activación cuando la wallet ya está activa', async () => {
      // Arrange
      const { useCase, gateway } = buildUseCase([buildWallet({ status: 'active' })]);
      gateway.programSend(TransactionHash.from(TRANSFER_TX));

      // Act
      const transfer = await useCase.execute({
        ownerId: OWNER_ID,
        ownerRole: 'user',
        recipient: RECIPIENT,
        asset: NATIVE_ASSET,
      });

      // Assert: el estado es monótono, así que el `active` cacheado ahorra el crédito.
      expect(gateway.isSendingEnabledCalls).toEqual([]);
      expect(transfer.status).toBe('submitted');
    });

    it('debería rechazar con WalletOwnerGoneError cuando el directorio ya no conoce al dueño', async () => {
      // Arrange
      const { useCase, ledger, gateway } = buildUseCase([buildWallet({ status: 'active' })], []);

      // Act + Assert
      await expect(
        useCase.execute({
          ownerId: OWNER_ID,
          ownerRole: 'user',
          recipient: RECIPIENT,
          asset: NATIVE_ASSET,
        }),
      ).rejects.toThrow(WalletOwnerGoneError);
      expect(gateway.sendCalls).toEqual([]);
      expect(ledger.saveCalls).toEqual([]);
    });

    it('debería lanzar WalletNotFoundError cuando el dueño no tiene wallet', async () => {
      // Arrange
      const { useCase, gateway } = buildUseCase([]);

      // Act + Assert
      await expect(
        useCase.execute({
          ownerId: OWNER_ID,
          ownerRole: 'user',
          recipient: RECIPIENT,
          asset: NATIVE_ASSET,
        }),
      ).rejects.toThrow(WalletNotFoundError);
      expect(gateway.sendCalls).toEqual([]);
    });

    it('debería lanzar WalletOwnerMismatchError cuando la wallet se derivó bajo otra master', async () => {
      // Arrange
      const { useCase, gateway } = buildUseCase([
        buildWallet({ status: 'active', ownerAddress: WALLET_OTHER_MASTER_ADDRESS }),
      ]);

      // Act + Assert
      await expect(
        useCase.execute({
          ownerId: OWNER_ID,
          ownerRole: 'user',
          recipient: RECIPIENT,
          asset: NATIVE_ASSET,
        }),
      ).rejects.toThrow(WalletOwnerMismatchError);
      expect(gateway.sendCalls).toEqual([]);
    });

    it('debería reintentar UNA vez el guardado posterior del libro', async () => {
      // Arrange: el guardado del desenlace falla una vez y pasa a la segunda.
      const { useCase, ledger, gateway } = buildUseCase([buildWallet({ status: 'active' })]);
      gateway.programSend(TransactionHash.from(TRANSFER_TX));
      ledger.programSaveFailures(null, new Error('connection reset'));

      // Act
      const transfer = await useCase.execute({
        ownerId: OWNER_ID,
        ownerRole: 'user',
        recipient: RECIPIENT,
        asset: NATIVE_ASSET,
      });

      // Assert: la escritura posterior no toca la cadena y es idempotente, así que reintentarla
      // es gratis (spec §3.2).
      expect(transfer.status).toBe('submitted');
      expect(ledger.saveCalls).toHaveLength(3);
    });

    it('debería devolver la transferencia enviada aunque el reintento del guardado también falle', async () => {
      // Arrange
      const { useCase, ledger, gateway } = buildUseCase([buildWallet({ status: 'active' })]);
      gateway.programSend(TransactionHash.from(TRANSFER_TX));
      ledger.programSaveFailures(null, new Error('down'), new Error('down'));

      // Act
      const transfer = await useCase.execute({
        ownerId: OWNER_ID,
        ownerRole: 'user',
        recipient: RECIPIENT,
        asset: NATIVE_ASSET,
      });

      // Assert: el dinero ya se movió. Convertir el fallo del guardado en un 500 borraría el
      // único sitio donde el cliente puede leer el hash de una transacción que SÍ existe; la fila
      // sobrevive en `submitting`, que la regla escrita manda leer como `unknown`.
      expect(transfer.txId?.value).toBe(TRANSFER_TX);
      expect(ledger.saveCalls).toHaveLength(3);
    });

    it('debería rechazar con AdminUsesMasterAddressError cuando el rol es admin, sin consultar nada', async () => {
      // Arrange: la master no envía por Gas Pump — firma, que es otra cosa.
      const { useCase, directory, ledger, gateway } = buildUseCase([
        buildWallet({ status: 'active' }),
      ]);

      // Act + Assert
      await expect(
        useCase.execute({
          ownerId: OWNER_ID,
          ownerRole: 'admin',
          recipient: RECIPIENT,
          asset: NATIVE_ASSET,
        }),
      ).rejects.toThrow(AdminUsesMasterAddressError);
      expect(directory.existsCalls).toEqual([]);
      expect(gateway.sendCalls).toEqual([]);
      expect(ledger.saveCalls).toEqual([]);
    });

    it('debería dejar la fila en submitting y propagar cuando el fallo no viene traducido del proveedor', async () => {
      // Arrange: un `Error` corriente escapando de la pasarela es un defecto NUESTRO.
      const bug = new Error('mapper exploded');
      const { useCase, ledger, gateway } = buildUseCase([buildWallet({ status: 'active' })]);
      gateway.programSend(bug);

      // Act + Assert
      await expect(
        useCase.execute({
          ownerId: OWNER_ID,
          ownerRole: 'user',
          recipient: RECIPIENT,
          asset: NATIVE_ASSET,
        }),
      ).rejects.toThrow(bug);
      // No se le inventa un motivo: la lista cerrada no tiene código para un fallo nuestro, y
      // publicar uno falso en `GET /wallets/me/transfers` es peor que no publicar ninguno.
      expect(ledger.saveCalls).toHaveLength(1);
      expect(ledger.saveCalls[0]?.status).toBe('submitting');
      expect(ledger.saveCalls[0]?.reasonCode).toBeNull();
    });
  });

  describe('execute() (property-based)', () => {
    fcTest.prop([
      fc.constantFrom<'submitted' | 'rejected' | 'unknown'>('submitted', 'rejected', 'unknown'),
    ])(
      'debería escribir siempre la primera fila en submitting, sea cual sea el desenlace (propiedad)',
      async (outcome) => {
        // Arrange
        const { useCase, ledger, gateway } = buildUseCase([buildWallet({ status: 'active' })]);
        gateway.programSend(programmedOutcome(outcome));

        // Act
        await useCase
          .execute({
            ownerId: OWNER_ID,
            ownerRole: 'user',
            recipient: RECIPIENT,
            asset: NATIVE_ASSET,
          })
          .catch(() => undefined);

        // Assert
        expect(ledger.saveCalls[0]?.status).toBe('submitting');
      },
    );
  });
});

// Helpers

const buildUseCase = (wallets: readonly Wallet[], knownOwners: readonly string[] = [OWNER_ID]) => {
  const directory = new FakeOwnerDirectory(knownOwners);
  const repository = new InMemoryWalletRepository(wallets);
  const ledger = new InMemoryWalletTransferRepository();
  const gateway = new FakeCustodialAddressGateway(EthereumAddress.from(MASTER));

  return {
    useCase: new TransferAssetUseCase(directory, repository, ledger, gateway),
    directory,
    repository,
    ledger,
    gateway,
  };
};

const programmedOutcome = (outcome: 'submitted' | 'rejected' | 'unknown') => {
  if (outcome === 'submitted') {
    return TransactionHash.from(TRANSFER_TX);
  }
  return outcome === 'rejected'
    ? new WalletProviderRejectedError('body-rejected', 400)
    : new WalletProviderUnreachableError('timeout', null);
};
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/modules/wallets/__tests__/application/use-cases/transfer-asset.use-case.spec.ts`
Expected: FAIL — `Cannot find module '../../../application/use-cases/transfer-asset.use-case'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/modules/wallets/application/use-cases/transfer-asset.use-case.ts
import { Injectable } from '@nestjs/common';

import { SYSTEM_ACTORS } from '@shared/domain/system-actor';

import { CustodialAddressGateway } from '../../domain/ports/custodial-address.gateway';
import { EthereumAddress } from '../../domain/value-objects/ethereum-address.vo';
import { OwnerDirectory } from '../../domain/ports/owner.directory';
import { TransferAsset, type TransferAssetParts } from '../../domain/transfer-asset';
import { TransferId } from '../../domain/value-objects/transfer-id.vo';
import { WalletTransfer } from '../../domain/entities/wallet-transfer.entity';
import {
  AdminUsesMasterAddressError,
  WalletNotFoundError,
  WalletOwnerGoneError,
  WalletProviderError,
  WalletProviderRejectedError,
} from '../../domain/errors/wallet.errors';
import { WalletRepository } from '../../domain/ports/wallet.repository';
import { WalletTransferRepository } from '../../domain/ports/wallet-transfer.repository';

import type { Wallet } from '../../domain/entities/wallet.entity';

export type TransferAssetInput = {
  ownerId: string;
  ownerRole: string;
  recipient: string;
  asset: TransferAssetParts;
};

/**
 * Rol que posee la master. La master FIRMA las transferencias de las gas pump addresses, pero no
 * envía por Gas Pump: no tiene índice, así que la operación no existe para ella. Literal y no
 * `USER_ROLES` de `users` porque la regla 2 del gate de fronteras prohíbe a `application/`
 * importar de otro módulo.
 */
const ADMIN_ROLE = 'admin';

/**
 * Transferencia custodiada. El orden de los siete pasos es la mitad del diseño:
 *
 *   1. Rol `admin` ⇒ 409 sin tocar nada: la master no envía por Gas Pump.
 *   2. Directorio, wallet y `assertOwnedBy`: lo que decide si esta operación puede existir.
 *   3. **Construir el dominio ANTES de tocar la red.** Destinatario y activo se validan aquí, así
 *      que todo 400 muere sin gastar un crédito. Es también el único sitio donde la exclusión
 *      mutua del activo se comprueba: el DTO valida transporte —formatos y presencia— y con
 *      `forbidNonWhitelisted` un campo DECLARADO pero prohibido en esa clase pasa igualmente.
 *   4. Precondición de activación, con la reconciliación perezosa dentro (spec §5.4).
 *   5. **Escritura por delante del libro**, justo antes de la llamada y no antes: si se escribiera
 *      al principio, el libro se llenaría de rechazos que nunca salieron del proceso.
 *   6. La llamada. ⚠️ El origen es `wallet.address`, **nunca la master**: la master firma, no
 *      envía; enviar desde ella movería el fondo de gas de la plataforma. El campo del
 *      destinatario del `SendCommand` se llama `recipient`, igual que la columna y que el DTO.
 *   7. El desenlace, que son tres y ninguno se inventa: `submitted` con hash, `rejected` solo
 *      cuando el proveedor rechazó el CUERPO, y `unknown` para todo lo que el adaptador tradujo
 *      —timeout, 5xx, un fallo de nuestra cuenta—, que es literalmente lo que sabemos.
 *
 * ⚠️ **Un error que NO venga traducido del adaptador no se anota, se propaga.** El `reasonCode`
 * del libro reutiliza `ProviderFailureReason`, una lista cerrada donde no hay —ni debe haber— un
 * código para «defecto nuestro»: inventarlo publicaría una causa falsa en
 * `GET /wallets/me/transfers`. La fila se queda en `submitting`, que es exactamente lo que
 * sabemos, y la regla escrita manda leerla como `unknown` (spec §3.2).
 */
@Injectable()
export class TransferAssetUseCase {
  constructor(
    private readonly owners: OwnerDirectory,
    private readonly wallets: WalletRepository,
    private readonly transfers: WalletTransferRepository,
    private readonly gateway: CustodialAddressGateway,
  ) {}

  async execute(input: TransferAssetInput): Promise<WalletTransfer> {
    if (input.ownerRole === ADMIN_ROLE) {
      throw new AdminUsesMasterAddressError();
    }

    const exists = await this.owners.exists(input.ownerId);
    if (!exists) {
      throw new WalletOwnerGoneError(input.ownerId);
    }

    const wallet = await this.wallets.findByOwnerId(input.ownerId);
    if (!wallet) {
      throw new WalletNotFoundError(input.ownerId);
    }

    wallet.assertOwnedBy(this.gateway.masterAddress());

    const recipient = EthereumAddress.from(input.recipient);
    const asset = TransferAsset.fromParts(input.asset);

    await this.ensureCanSend(wallet);

    const transfer = WalletTransfer.start({
      id: TransferId.generate(),
      ownerId: input.ownerId,
      from: wallet.address,
      recipient,
      asset,
      now: new Date(),
      createdBy: input.ownerId,
    });
    await this.transfers.save(transfer);

    try {
      const txId = await this.gateway.send({ from: wallet.address, recipient, asset });
      transfer.markSubmitted(txId, new Date(), input.ownerId);
      await this.recordOutcome(transfer);
      return transfer;
    } catch (error) {
      if (error instanceof WalletProviderRejectedError) {
        // Solo el 400 de validación del cuerpo es un rechazo. Un 401 o un 403 no rechazaron
        // nada: la petición ni se procesó como transferencia, así que van a `unknown`.
        transfer.markRejected(error.reason, new Date(), input.ownerId);
      } else if (error instanceof WalletProviderError) {
        transfer.markUnknown(error.reason, new Date(), input.ownerId);
      } else {
        // Sin motivo que anotar: se propaga y la fila se queda en `submitting`.
        throw error;
      }
      await this.recordOutcome(transfer);
      throw error;
    }
  }

  /**
   * Precondición y reconciliación son **el mismo dato**, y por eso no hay planificador: la propia
   * documentación del proveedor dice que esta llamada es la que se hace «when a customer initiates
   * a fund transfer». Con la wallet ya `active` se salta, porque el estado es monótono —el
   * contrato está desplegado— y volver a preguntar sería pagar un crédito por lo que ya sabemos.
   *
   * Quien rechaza es el agregado con `assertCanSend()`, que lleva su propio estado dentro del
   * error: si la curación no ocurrió, la wallet sigue en `receive-only` o en `activating` y el
   * error lo dice; si ocurrió, ya está `active` y la comprobación pasa sin más.
   *
   * ⚠️ La curación se atribuye a `ACTIVATION_RECONCILIATION` y no al dueño: él no activó nada,
   * solo intentó transferir. Y la pasarela recibe el ÍNDICE, no la dirección.
   */
  private async ensureCanSend(wallet: Wallet): Promise<void> {
    if (wallet.canSend) {
      return;
    }

    const enabled = await this.gateway.isSendingEnabled(wallet.addressIndex);
    if (enabled) {
      wallet.confirmActivated(new Date(), SYSTEM_ACTORS.ACTIVATION_RECONCILIATION);
      await this.wallets.save(wallet);
    }

    wallet.assertCanSend();
  }

  /**
   * ⚠️ **Un fallo aquí NO puede tumbar la respuesta.** Cuando el proveedor ya contestó, el dinero
   * está movido: convertir un fallo de escritura en un 500 borraría el único sitio donde el
   * cliente puede leer el hash de una transacción que existe. La escritura no toca la cadena y es
   * idempotente, así que se reintenta una vez; si aun así falla, la fila sobrevive en
   * `submitting`, y la regla escrita manda leerla como `unknown` (spec §3.2).
   */
  private async recordOutcome(transfer: WalletTransfer): Promise<void> {
    const saved = await this.trySave(transfer);
    if (!saved) {
      await this.trySave(transfer);
    }
  }

  private async trySave(transfer: WalletTransfer): Promise<boolean> {
    try {
      await this.transfers.save(transfer);
      return true;
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/modules/wallets/__tests__/application/use-cases/transfer-asset.use-case.spec.ts`
Expected: PASS — 18 passed

---

### Task 21: `ListWalletTransfersUseCase` — la segunda lectura, paginada

**Layer:** application
**Rule codes to honor:** `arch-use-repository-pattern`, `di-prefer-constructor-injection`, `perf-optimize-database`, `db-avoid-n-plus-one`

**Casos acordados:**

| #   | Caso (se vuelve el `it`)                                                        | Entrada / estado inicial                        | Resultado esperado                                           |
| --- | ------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------ |
| L1  | debería devolver la página del dueño con su total                               | 3 transferencias del dueño; `page` 1, `limit` 2 | 2 elementos y `total` 3                                      |
| L2  | debería pasar al repositorio un solo criterio con `ownerId`, `page` y `limit`   | `page` 3, `limit` 20                            | el criterio recibido es `{ ownerId, page: 3, limit: 20 }`    |
| L3  | debería devolver una página vacía cuando el dueño no tiene transferencias       | libro vacío                                     | `items` vacío y `total` 0                                    |
| L4  | debería pedir solo las transferencias del dueño del token                       | el libro tiene también filas de otro dueño      | el criterio lleva el `ownerId` del token; ninguna fila ajena |
| L5  | debería depender solo del repositorio, sin directorio de dueños                 | la clase construida                             | `ListWalletTransfersUseCase.length` es 1                     |
| P1  | debería trasladar `page` y `limit` al criterio sin transformarlos _(propiedad)_ | arbitrario: `pageArb` y `limitArb`              | el criterio lleva exactamente esa `page` y ese `limit`       |

L5 es el gemelo de F3 en la tarea 18, y por el mismo motivo: el spec §5 declara que **los dos** casos
de lectura no consultan el directorio, y sin un caso que lo fije alguien lo «arregla» por simetría
con los tres que sí lo hacen.

⚠️ **El criterio viaja en `page`/`limit`, no en `skip`/`take`, y eso es contrato del puerto.** Quien
traduce a desplazamiento es el adaptador, que es el único que sabe cómo pagina su motor; publicarlo
en el puerto ataría el dominio a la aritmética de un `OFFSET`. Este caso de uso, por tanto, no
transforma nada — su valor es el otro: **no consulta el directorio de dueños** y el `ownerId` sale
del `sub` del token, nunca del cuerpo ni de la ruta.

⚠️ `TransferPage` es un dato que acompaña al puerto y viaja con `type` inline
(`import { WalletTransferRepository, type TransferPage }`). Ese nombre está en la lista cerrada de
`eslint.config.mjs`, que **edita solo la Task 41** con la lista final completa; esta tarea no toca
ese archivo.

**Files:**

- Create: `src/modules/wallets/application/use-cases/list-wallet-transfers.use-case.ts`
- Test: `src/modules/wallets/__tests__/application/use-cases/list-wallet-transfers.use-case.spec.ts`

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/modules/wallets/__tests__/application/use-cases/list-wallet-transfers.use-case.spec.ts
import { test as fcTest } from '@fast-check/jest';

import { InMemoryWalletTransferRepository } from '../../helpers/in-memory-wallet-transfer.repository';
import { ListWalletTransfersUseCase } from '../../../application/use-cases/list-wallet-transfers.use-case';
import { TRANSFER_OWNER_ID, buildTransfer } from '../../helpers/wallet-transfer.factory';
import { limitArb, pageArb } from '../../helpers/arbitraries';

const OWNER_ID = TRANSFER_OWNER_ID;
const OTHER_OWNER_ID = '4b8e2f1a-5c3d-4e7f-8a9b-0c1d2e3f4a5b';

describe('ListWalletTransfersUseCase', () => {
  describe('execute()', () => {
    it('debería devolver la página del dueño con su total', async () => {
      // Arrange
      const ledger = new InMemoryWalletTransferRepository([
        buildTransfer({ ownerId: OWNER_ID }),
        buildTransfer({ ownerId: OWNER_ID }),
        buildTransfer({ ownerId: OWNER_ID }),
      ]);
      const useCase = new ListWalletTransfersUseCase(ledger);

      // Act
      const page = await useCase.execute({ ownerId: OWNER_ID, page: 1, limit: 2 });

      // Assert
      expect(page.items).toHaveLength(2);
      expect(page.total).toBe(3);
    });

    it('debería pasar al repositorio un solo criterio con ownerId, page y limit', async () => {
      // Arrange
      const ledger = new InMemoryWalletTransferRepository();
      const useCase = new ListWalletTransfersUseCase(ledger);

      // Act
      await useCase.execute({ ownerId: OWNER_ID, page: 3, limit: 20 });

      // Assert: el desplazamiento lo calcula el adaptador, que es quien sabe cómo pagina su
      // motor; el puerto habla el vocabulario del cliente.
      expect(ledger.findByOwnerCalls).toEqual([{ ownerId: OWNER_ID, page: 3, limit: 20 }]);
    });

    it('debería devolver una página vacía cuando el dueño no tiene transferencias', async () => {
      // Arrange
      const useCase = new ListWalletTransfersUseCase(new InMemoryWalletTransferRepository());

      // Act
      const page = await useCase.execute({ ownerId: OWNER_ID, page: 1, limit: 20 });

      // Assert
      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
    });

    it('debería pedir solo las transferencias del dueño del token', async () => {
      // Arrange
      const own = buildTransfer({ ownerId: OWNER_ID });
      const ledger = new InMemoryWalletTransferRepository([
        own,
        buildTransfer({ ownerId: OTHER_OWNER_ID }),
      ]);
      const useCase = new ListWalletTransfersUseCase(ledger);

      // Act
      const page = await useCase.execute({ ownerId: OWNER_ID, page: 1, limit: 20 });

      // Assert: el dueño sale del `sub` del token y llega hasta el criterio sin pasar por el
      // cuerpo ni por la ruta.
      expect(ledger.findByOwnerCalls[0]?.ownerId).toBe(OWNER_ID);
      expect(page.items).toEqual([own]);
      expect(page.total).toBe(1);
    });

    it('debería depender solo del repositorio, sin directorio de dueños', () => {
      // Arrange & Act
      const dependencies = ListWalletTransfersUseCase.length;

      // Assert
      // Igual que la lectura de la wallet: el token ya probó el `sub`, y un 403 aquí sería
      // cosmético a cambio de una consulta extra (spec §5).
      expect(dependencies).toBe(1);
    });
  });

  describe('execute() (property-based)', () => {
    fcTest.prop([pageArb, limitArb])(
      'debería trasladar page y limit al criterio sin transformarlos (propiedad)',
      async (page, limit) => {
        // Arrange
        const ledger = new InMemoryWalletTransferRepository();
        const useCase = new ListWalletTransfersUseCase(ledger);

        // Act
        await useCase.execute({ ownerId: OWNER_ID, page, limit });

        // Assert
        expect(ledger.findByOwnerCalls).toEqual([{ ownerId: OWNER_ID, page, limit }]);
      },
    );
  });
});
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/modules/wallets/__tests__/application/use-cases/list-wallet-transfers.use-case.spec.ts`
Expected: FAIL — `Cannot find module '../../../application/use-cases/list-wallet-transfers.use-case'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/modules/wallets/application/use-cases/list-wallet-transfers.use-case.ts
import { Injectable } from '@nestjs/common';

import {
  WalletTransferRepository,
  type TransferPage,
} from '../../domain/ports/wallet-transfer.repository';

export type ListWalletTransfersInput = {
  ownerId: string;
  page: number;
  limit: number;
};

/**
 * Listado del libro del dueño. Recibe `page`/`limit` —el vocabulario del cliente, el mismo que
 * publica `PaginationDto`— y los entrega tal cual en el criterio del puerto: la aritmética del
 * desplazamiento vive en el adaptador, que es el único que sabe cómo pagina su motor. Meterla
 * aquí ataría un caso de uso al `OFFSET` de PostgreSQL.
 *
 * **No consulta el directorio de dueños**, igual que `FindWalletByOwnerUseCase`: el token ya probó
 * el `sub`, y los dos endpoints de lectura son los más llamados del módulo (spec §5). El
 * `ownerId` llega del `sub` y nunca del cuerpo ni de la ruta, así que nadie puede listar el libro
 * de otro.
 *
 * **No lleva `ownerRole`**, a diferencia de los otros cuatro casos de uso, y no es un olvido: el
 * admin no tiene gas pump address, luego no tiene filas en el libro, luego la consulta normal ya
 * le devuelve una página vacía. Un caso especial para él sería código que solo puede divergir.
 */
@Injectable()
export class ListWalletTransfersUseCase {
  constructor(private readonly transfers: WalletTransferRepository) {}

  async execute(input: ListWalletTransfersInput): Promise<TransferPage> {
    return this.transfers.findByOwner({
      ownerId: input.ownerId,
      page: input.page,
      limit: input.limit,
    });
  }
}
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/modules/wallets/__tests__/application/use-cases/list-wallet-transfers.use-case.spec.ts`
Expected: PASS — 6 passed

---

### Task 22: El mapper del activo — `tatum-asset.mapper.ts`

**Layer:** infrastructure
**Rule codes to honor:** `arch-single-responsibility`, `test-mock-external-services`

**Contrato que esta tarea consume** (lo publica la tarea de `domain/transfer-asset.ts`):

```ts
export const TRANSFER_ASSET_KINDS = ['native', 'fungible', 'nft', 'multi-token'] as const;
export type TransferAssetKind = (typeof TRANSFER_ASSET_KINDS)[number];

export type TransferAssetMatchers<T> = {
  native: (amount: TokenAmount) => T;
  fungible: (token: EthereumAddress, amount: TokenAmount) => T;
  nft: (token: EthereumAddress, tokenId: TokenId) => T;
  multiToken: (token: EthereumAddress, amount: TokenAmount, tokenId: TokenId) => T;
};

export class TransferAsset {
  static native(p: { amount: TokenAmount }): TransferAsset;
  static fungible(p: { token: EthereumAddress; amount: TokenAmount }): TransferAsset;
  static nft(p: { token: EthereumAddress; tokenId: TokenId }): TransferAsset;
  static multiToken(p: {
    token: EthereumAddress;
    amount: TokenAmount;
    tokenId: TokenId;
  }): TransferAsset;
  get kind(): TransferAssetKind;
  match<T>(matchers: TransferAssetMatchers<T>): T;
}
```

⚠️ **Las dos escrituras del multi-token son distintas y las dos son correctas en su sitio.** El
literal del vocabulario es `'multi-token'` CON GUION —es lo que devuelve `kind`, lo que viaja a la
columna y lo que se publica en OpenAPI— y la clave del matcher es `multiToken`, porque es un
identificador de TypeScript. En este archivo aparecen las dos: la clave del objeto que recibe
`match()` es `multiToken`, y la clave del mapa `CONTRACT_TYPE`, que está indexado por
`TransferAssetKind`, es `'multi-token'`.

⚠️ **`match()` es POSICIONAL**: cada rama recibe sus value objects como argumentos sueltos, no un
objeto con campos. Escribir `fungible: ({ token, amount }) => …` no compila.

**Casos acordados** (Tabla T22 — el spec §8 declara explícitamente que el mapper lleva tabla propia
aunque viva en `infrastructure/`, por ser una decisión con consecuencia y no cableado):

| #   | Caso (se vuelve el `it`)                                                                                | Entrada / estado inicial                                            | Resultado esperado                                                                       |
| --- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| M1  | debería traducir un token fungible a contractType 0 con tokenAddress y amount, y sin tokenId            | `TransferAsset.fungible({ token, amount })`                         | `{ contractType: 0, tokenAddress, amount }` — igualdad EXACTA del cuerpo, sin `tokenId`  |
| M2  | debería traducir un NFT a contractType 1 con tokenAddress y tokenId, y sin amount                       | `TransferAsset.nft({ token, tokenId })`                             | `{ contractType: 1, tokenAddress, tokenId }` — sin `amount`                              |
| M3  | debería traducir un multi-token a contractType 2 con los tres campos                                    | `TransferAsset.multiToken({ token, amount, tokenId })`              | `{ contractType: 2, tokenAddress, amount, tokenId }`                                     |
| M4  | debería traducir la moneda nativa a contractType 3 con solo amount, sin tokenAddress ni tokenId         | `TransferAsset.native({ amount })`                                  | `{ contractType: 3, amount }`                                                            |
| P1  | debería producir siempre el contractType y el juego exacto de claves que su clase permite _(propiedad)_ | arbitrario `transferAssetArb`: una de las cuatro clases, construida | `contractType` es el de su clase y `Object.keys()` es EXACTAMENTE el juego de la §3.4    |
| P2  | debería copiar los valores tal cual los rinde cada value object, sin reformatearlos _(propiedad)_       | arbitrario `transferAssetArb`, que arrastra los strings de origen   | el multiconjunto de valores del cuerpo (sin `contractType`) es el de los VO, sin cambios |

**Files:**

- Create: `src/modules/wallets/infrastructure/gateways/tatum-asset.mapper.ts`
- Test: `src/modules/wallets/__tests__/infrastructure/gateways/tatum-asset.mapper.spec.ts`

⚠️ **Esta tarea NO crea ni edita ningún archivo de `__tests__/helpers/`.** El arbitrario
`transferAssetArb` que consumen P1 y P2 vive en `src/modules/wallets/__tests__/helpers/arbitraries.ts`,
que crea la Task 1 y amplían las tareas 8 y 16; aquí solo se importa. Rinde
`{ asset: TransferAsset; kind: TransferAssetKind; values: readonly string[] }` — el activo, la clase
con la que se construyó y los strings exactos que se le dieron, porque sin `values` la propiedad P2
tendría que reconstruir el valor esperado leyendo el activo, que es reimplementar el mapper dentro
del test. El arbitrario tiene que vivir en un archivo APARTE del spec y no bajo `// Helpers`:
`it.prop([...])` se evalúa cuando se carga el `describe`, así que un `const` declarado al final del
archivo cae en su zona muerta temporal — medido: `ReferenceError: Cannot access 'assetArb' before
initialization`, suite entera sin ejecutar. Por eso el repo importa sus arbitrarios
(`orders/__tests__/helpers/arbitraries.ts`) en vez de declararlos abajo.

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/modules/wallets/__tests__/infrastructure/gateways/tatum-asset.mapper.spec.ts
import { it as itProp } from '@fast-check/jest';

import { TransferAsset, type TransferAssetKind } from '../../../domain/transfer-asset';
import { EthereumAddress } from '../../../domain/value-objects/ethereum-address.vo';
import { TokenAmount } from '../../../domain/value-objects/token-amount.vo';
import { TokenId } from '../../../domain/value-objects/token-id.vo';
import { mapAssetToTatumFields } from '../../../infrastructure/gateways/tatum-asset.mapper';
import { transferAssetArb } from '../../helpers/arbitraries';

const TOKEN = '0x782919afc85eea2cb736874225456bb5d3e242ba';
const AMOUNT = '100000';
const TOKEN_ID = '42';

describe('mapAssetToTatumFields', () => {
  it('debería traducir un token fungible a contractType 0 con tokenAddress y amount, y sin tokenId', () => {
    // Arrange
    const asset = TransferAsset.fungible({
      token: EthereumAddress.from(TOKEN),
      amount: TokenAmount.from(AMOUNT),
    });

    // Act
    const fields = mapAssetToTatumFields(asset);

    // Assert
    expect(fields).toEqual({ contractType: 0, tokenAddress: TOKEN, amount: AMOUNT });
  });

  it('debería traducir un NFT a contractType 1 con tokenAddress y tokenId, y sin amount', () => {
    // Arrange
    const asset = TransferAsset.nft({
      token: EthereumAddress.from(TOKEN),
      tokenId: TokenId.from(TOKEN_ID),
    });

    // Act
    const fields = mapAssetToTatumFields(asset);

    // Assert
    expect(fields).toEqual({ contractType: 1, tokenAddress: TOKEN, tokenId: TOKEN_ID });
  });

  it('debería traducir un multi-token a contractType 2 con los tres campos', () => {
    // Arrange
    const asset = TransferAsset.multiToken({
      token: EthereumAddress.from(TOKEN),
      amount: TokenAmount.from(AMOUNT),
      tokenId: TokenId.from(TOKEN_ID),
    });

    // Act
    const fields = mapAssetToTatumFields(asset);

    // Assert
    expect(fields).toEqual({
      contractType: 2,
      tokenAddress: TOKEN,
      amount: AMOUNT,
      tokenId: TOKEN_ID,
    });
  });

  it('debería traducir la moneda nativa a contractType 3 con solo amount, sin tokenAddress ni tokenId', () => {
    // Arrange
    const asset = TransferAsset.native({ amount: TokenAmount.from(AMOUNT) });

    // Act
    const fields = mapAssetToTatumFields(asset);

    // Assert
    expect(fields).toEqual({ contractType: 3, amount: AMOUNT });
  });

  itProp.prop([transferAssetArb])(
    'debería producir siempre el contractType y el juego exacto de claves que su clase permite',
    ({ asset, kind }) => {
      // Arrange
      const expected = TATUM_CONTRACT[kind];

      // Act
      const fields = mapAssetToTatumFields(asset);

      // Assert
      expect(fields.contractType).toBe(expected.contractType);
      expect(Object.keys(fields).sort()).toEqual([...expected.keys].sort());
    },
  );

  itProp.prop([transferAssetArb])(
    'debería copiar los valores tal cual los rinde cada value object, sin reformatearlos',
    ({ asset, values }) => {
      // Arrange
      const expected = [...values].sort();

      // Act
      const fields = mapAssetToTatumFields(asset);

      // Assert
      const copied = Object.entries(fields)
        .filter(([key]) => key !== 'contractType')
        .map(([, value]) => String(value))
        .sort();
      expect(copied).toEqual(expected);
    },
  );
});

// Helpers

/**
 * La tabla de exclusión mutua de la §3.4 del spec, escrita como DATO y no como código: es la
 * expectativa, y tenerla aquí es lo que impide que la propiedad se vuelva tautológica leyendo
 * el `contractType` que el propio mapper devolvió para decidir qué claves esperar.
 *
 * Está indexada por `TransferAssetKind`, así que la entrada del multi-token se escribe con el
 * literal del vocabulario, `'multi-token'` con guion, y NO con la clave `multiToken` del matcher.
 */
const TATUM_CONTRACT = {
  native: { contractType: 3, keys: ['contractType', 'amount'] },
  fungible: { contractType: 0, keys: ['contractType', 'tokenAddress', 'amount'] },
  nft: { contractType: 1, keys: ['contractType', 'tokenAddress', 'tokenId'] },
  'multi-token': {
    contractType: 2,
    keys: ['contractType', 'tokenAddress', 'amount', 'tokenId'],
  },
} as const satisfies Record<TransferAssetKind, { contractType: number; keys: readonly string[] }>;
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/modules/wallets/__tests__/infrastructure/gateways/tatum-asset.mapper.spec.ts`
Expected: FAIL — `Cannot find module '../../../infrastructure/gateways/tatum-asset.mapper' from 'src/modules/wallets/__tests__/infrastructure/gateways/tatum-asset.mapper.spec.ts'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/modules/wallets/infrastructure/gateways/tatum-asset.mapper.ts
import type { TransferAsset, TransferAssetKind } from '../../domain/transfer-asset';

/**
 * Los cuatro números del `contractType` de Tatum. Son un enum del contrato del PROVEEDOR y no
 * un concepto del negocio, por eso el dominio no los conoce y viven aquí (spec §3.4).
 */
export type TatumContractType = 0 | 1 | 2 | 3;

/**
 * Las cuatro formas EXCLUYENTES del cuerpo, una por clase de activo, y no un objeto con tres
 * campos opcionales.
 *
 * Con campos opcionales, `{ contractType: 3, amount, tokenId }` compilaría: la exclusión mutua
 * que el proveedor exige (§3.4) volvería a depender de que nadie se equivoque. Con la unión, la
 * rama de la moneda nativa NO TIENE dónde escribir un `tokenId`.
 */
export type TatumAssetFields =
  | { contractType: 0; tokenAddress: string; amount: string }
  | { contractType: 1; tokenAddress: string; tokenId: string }
  | { contractType: 2; tokenAddress: string; amount: string; tokenId: string }
  | { contractType: 3; amount: string };

/**
 * ⚠️ El `satisfies Record<TransferAssetKind, …>` es el gate de una quinta clase de activo, y
 * está MEDIDO: añadiendo `'bond'` a `TRANSFER_ASSET_KINDS` y corriendo `tsc --noEmit`, la
 * compilación se rompe AQUÍ y no en producción:
 *
 *     tatum-asset.mapper.ts(…): error TS1360: Type '{ readonly native: 3; readonly fungible: 0;
 *     readonly nft: 1; readonly "multi-token": 2; }' does not satisfy the expected type
 *     'Record<TransferAssetKind, TatumContractType>'. Property 'bond' is missing …
 *
 * Sin el `satisfies` el mapa seguiría compilando con cuatro entradas y la clase nueva habría
 * llegado al proveedor sin `contractType`, que es un 400 con los créditos ya gastados.
 * El `as const` va ANTES: sin él los valores se ensanchan a `number` y `TatumAssetFields`
 * deja de aceptarlos.
 *
 * La clave del multi-token es `'multi-token'` porque el mapa se indexa por `TransferAssetKind`,
 * que es el vocabulario del dominio. `multiToken`, la otra escritura, es la clave del matcher de
 * `match()` y aparece ocho líneas más abajo: son cosas distintas y las dos son correctas.
 */
const CONTRACT_TYPE = {
  native: 3,
  fungible: 0,
  nft: 1,
  'multi-token': 2,
} as const satisfies Record<TransferAssetKind, TatumContractType>;

/**
 * Traduce el vocabulario del dominio al cuerpo del proveedor. Función PURA: no ve la clave
 * privada, no ve la de API y no hace red — por eso se puede probar con igualdad exacta del
 * cuerpo entero y con propiedades, sin levantar nada.
 *
 * La exclusión mutua se cumple POR CONSTRUCCIÓN, no por validación: cada rama de `match()`
 * recibe solo los value objects de su clase, así que no hay forma de escribir un `amount` en la
 * rama del NFT — ese `amount` no existe ahí. Es el motivo por el que `TransferAsset` es una clase
 * con factorías y `match()` en vez de una unión discriminada suelta (§3.4).
 */
export const mapAssetToTatumFields = (asset: TransferAsset): TatumAssetFields =>
  asset.match<TatumAssetFields>({
    native: (amount) => ({
      contractType: CONTRACT_TYPE.native,
      amount: amount.value,
    }),
    fungible: (token, amount) => ({
      contractType: CONTRACT_TYPE.fungible,
      tokenAddress: token.value,
      amount: amount.value,
    }),
    nft: (token, tokenId) => ({
      contractType: CONTRACT_TYPE.nft,
      tokenAddress: token.value,
      tokenId: tokenId.value,
    }),
    multiToken: (token, amount, tokenId) => ({
      contractType: CONTRACT_TYPE['multi-token'],
      tokenAddress: token.value,
      amount: amount.value,
      tokenId: tokenId.value,
    }),
  });
```

⚠️ `import type` AQUÍ es obligatorio y no contradice la regla de los puertos: este archivo no
tiene decoradores, `TransferAsset` no es inyectable y no vive en `ports/`, así que
`consistent-type-imports` EXIGE la forma `type` — medido: con el import de valor, `eslint`
responde `All imports in the declaration are only used as types. Use 'import type'`.

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/modules/wallets/__tests__/infrastructure/gateways/tatum-asset.mapper.spec.ts`
Expected: PASS — 6 passed

- [ ] **Step 5: Mide que una quinta clase rompe la compilación**

Añade temporalmente `'bond'` a `TRANSFER_ASSET_KINDS` en
`src/modules/wallets/domain/transfer-asset.ts`, ejecuta `pnpm typecheck`, comprueba el `TS1360` que
cita el JSDoc **nombrando `bond`**, y revierte.

Run: `pnpm typecheck`
Expected: FAIL — `error TS1360: … Property 'bond' is missing … but required in type 'Record<TransferAssetKind, TatumContractType>'`; tras revertir, `pnpm typecheck` en verde.

---

### Task 23: El transporte y la traducción de errores — `tatum-http.client.ts`

**Layer:** infrastructure
**Rule codes to honor:** `error-handle-async-errors`, `test-mock-external-services`, `security-sanitize-output`, `devops-use-config-module`

**Contrato que esta tarea consume** (lo publican la tarea de `domain/errors/wallet.errors.ts` y la
de `src/config/wallets.config.ts`): la lista ÚNICA de motivos, las tres clases de fallo del
proveedor y los nombres de los campos de configuración.

```ts
export const PROVIDER_FAILURE_REASONS = [
  'body-rejected', // 400 del proveedor en la TRANSFERENCIA (culpa del cliente)
  'misconfigured', // 400 del proveedor al derivar o activar (culpa nuestra)
  'unauthorized', // 401
  'forbidden', // 403
  'undocumented-4xx', // 404, 429, 402, 409… nada de esto está en su contrato
  'upstream-error', // 5xx
  'unreachable', // DNS / TCP / TLS
  'timeout',
  'malformed-response', // cuerpo no-JSON, o 200 que no satisface el esquema
] as const;
export type ProviderFailureReason = (typeof PROVIDER_FAILURE_REASONS)[number];

// Las tres llevan `readonly reason: ProviderFailureReason` y `readonly providerStatus: number | null`,
// mensaje FIJO y NINGUNA `cause`. Nada del cuerpo entra en ellas (§7.1).
new WalletProviderRejectedError(reason, providerStatus); // 400, solo en la transferencia
new WalletProviderUnavailableError(reason, providerStatus); // 503
new WalletProviderUnreachableError(reason, providerStatus); // 502

// src/config/wallets.config.ts
export const TATUM_CHAIN = 'ETH';
export type WalletsConfig = {
  apiUrl: string; // TATUM_API_URL
  apiKey: string; // TATUM_API_KEY
  timeoutMs: number; // TATUM_TIMEOUT_MS
  masterAddress: string; // WALLETS_MASTER_ADDRESS
  masterPrivateKey: string; // WALLETS_MASTER_PRIVATE_KEY
  activationPayer: 'tatum' | 'master'; // WALLETS_ACTIVATION_PAYER
  network: string; // WALLETS_NETWORK
};
```

⚠️ **La lista de motivos es una sola y es cerrada.** No hay un `TransferFailureReason` aparte ni
motivos con prefijo `provider-`: el `reasonCode` del libro de transferencias reutiliza este mismo
tipo. Un motivo que no esté en `PROVIDER_FAILURE_REASONS` no compila.

**Casos acordados** (Tabla T23 — el spec §8 declara explícitamente que la traducción de errores del
proveedor lleva tabla propia aunque viva en `infrastructure/`):

| #   | Caso (se vuelve el `it`)                                                                         | Entrada / estado inicial                              | Resultado esperado                                                            |
| --- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| E1  | debería devolver el cuerpo JSON ya parseado de una respuesta 200                                 | `fetch` responde `200 {"txId":"abc"}`                 | la llamada resuelve con `{ txId: 'abc' }`                                     |
| E2  | debería enviar la clave de API, el content-type, el cuerpo serializado y la señal de timeout     | petición POST con cuerpo                              | url, `x-api-key`, `content-type`, `body` serializado y `signal` `AbortSignal` |
| E3  | debería traducir el 400 de una petición con entrada del cliente a WalletProviderRejectedError    | `badRequestBlame: 'client-input'`, respuesta 400      | `WalletProviderRejectedError`, `body-rejected`, status 400                    |
| E4  | debería traducir el 400 de una petición que construimos enteros a WalletProviderUnavailableError | `badRequestBlame: 'our-configuration'`, respuesta 400 | `WalletProviderUnavailableError`, `misconfigured`, status 400                 |
| E5  | debería traducir un 401 a WalletProviderUnavailableError sin reintentar                          | petición reintentable, respuesta 401                  | `unauthorized`, status 401, y **una sola** llamada a `fetch`                  |
| E6  | debería traducir un 403 a WalletProviderUnavailableError                                         | respuesta 403                                         | `forbidden`, status 403                                                       |
| E7  | debería traducir el %i, que el proveedor no declara, a WalletProviderUnavailableError            | respuestas 402, 404, 409 y 429                        | `undocumented-4xx` con el status recibido                                     |
| E8  | debería traducir un 5xx a WalletProviderUnreachableError                                         | respuesta 500                                         | `upstream-error`, status 500                                                  |
| E9  | debería traducir la expiración real de AbortSignal.timeout al motivo timeout                     | `fetch` que no responde nunca y `timeoutMs: 5`        | `WalletProviderUnreachableError`, `timeout`, status `null`                    |
| E10 | debería tratar un AbortError ajeno como fallo de red y no como timeout                           | `fetch` rechaza con `DOMException('…','AbortError')`  | `unreachable`, status `null`                                                  |
| E11 | debería traducir un cuerpo que no es JSON al motivo malformed-response                           | `200` con cuerpo `<html>bad gateway</html>`           | `malformed-response`, status 200                                              |
| E12 | debería reintentar una vez la petición reintentable que falló con 5xx                            | `retryable: true`; primera llamada 500, segunda 200   | dos llamadas a `fetch` y el cuerpo de la segunda                              |
| E13 | debería intentar una sola vez la petición no reintentable que falló con 5xx                      | `retryable: false`, respuesta 500                     | `upstream-error` y **una sola** llamada a `fetch`                             |

**Files:**

- Create: `src/modules/wallets/infrastructure/gateways/tatum-http.client.ts`
- Test: `src/modules/wallets/__tests__/infrastructure/gateways/tatum-http.client.spec.ts`

⚠️ **La aserción es `rejects.toMatchObject({ name, reason, providerStatus })`, nunca
`rejects.toEqual(new …Error(...))`, y esto está medido.** `toEqual` sobre errores compara el
mensaje y NADA MÁS: dos `WalletProviderUnreachableError` con motivos distintos se consideran
IGUALES, y dos errores de CLASES distintas con el mismo mensaje también. Comprobado con
`expect@30.4.1` en este repo: el caso `expect(a).not.toEqual(b)` con `timeout` frente a
`unreachable` **falla**. Con `toMatchObject` los dos casos se distinguen —comprobado en los dos
sentidos— y `name` es lo que sujeta la clase.

⚠️ **El cliente lee su configuración de `ConfigService`, no de un objeto de opciones**, porque
`wallets.module.ts` lo registra como provider de clase a secas (`TatumHttpClient`, sin puerto
detrás). El `fetch` sí entra por constructor, para que el test pueda darle un doble sin
`jest.mock`.

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/modules/wallets/__tests__/infrastructure/gateways/tatum-http.client.spec.ts
import { ConfigService } from '@nestjs/config';

import {
  TatumHttpClient,
  type FetchLike,
  type TatumRequest,
} from '../../../infrastructure/gateways/tatum-http.client';

const API_URL = 'http://127.0.0.1:9';
const API_KEY = 'clave-de-prueba';

describe('TatumHttpClient', () => {
  describe('request()', () => {
    it('debería devolver el cuerpo JSON ya parseado de una respuesta 200', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(200, { txId: 'abc' })));
      const client = new TatumHttpClient(walletsConfig(), fetcher.impl);

      // Act
      const body = await client.request(derivationRequest());

      // Assert
      expect(body).toEqual({ txId: 'abc' });
    });

    it('debería enviar la clave de API, el content-type, el cuerpo serializado y la señal de timeout', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(200, [])));
      const client = new TatumHttpClient(walletsConfig(), fetcher.impl);

      // Act
      await client.request(derivationRequest());

      // Assert
      const [call] = fetcher.calls;
      expect(call?.url).toBe(`${API_URL}/v3/gas-pump`);
      expect(call?.init.headers).toEqual({
        accept: 'application/json',
        'content-type': 'application/json',
        'x-api-key': API_KEY,
      });
      expect(call?.init.body).toBe('{"chain":"ETH"}');
      expect(call?.init.signal).toBeInstanceOf(AbortSignal);
    });

    it('debería traducir el 400 de una petición con entrada del cliente a WalletProviderRejectedError', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(400, {})));
      const client = new TatumHttpClient(walletsConfig(), fetcher.impl);

      // Act + Assert
      await expect(client.request(transferRequest())).rejects.toMatchObject({
        name: 'WalletProviderRejectedError',
        reason: 'body-rejected',
        providerStatus: 400,
      });
    });

    it('debería traducir el 400 de una petición que construimos enteros a WalletProviderUnavailableError', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(400, {})));
      const client = new TatumHttpClient(walletsConfig(), fetcher.impl);

      // Act + Assert
      await expect(client.request(derivationRequest())).rejects.toMatchObject({
        name: 'WalletProviderUnavailableError',
        reason: 'misconfigured',
        providerStatus: 400,
      });
    });

    it('debería traducir un 401 a WalletProviderUnavailableError sin reintentar', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(401, {})));
      const client = new TatumHttpClient(walletsConfig(), fetcher.impl);

      // Act + Assert
      await expect(client.request(derivationRequest())).rejects.toMatchObject({
        name: 'WalletProviderUnavailableError',
        reason: 'unauthorized',
        providerStatus: 401,
      });
      expect(fetcher.calls).toHaveLength(1);
    });

    it('debería traducir un 403 a WalletProviderUnavailableError', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(403, {})));
      const client = new TatumHttpClient(walletsConfig(), fetcher.impl);

      // Act + Assert
      await expect(client.request(transferRequest())).rejects.toMatchObject({
        name: 'WalletProviderUnavailableError',
        reason: 'forbidden',
        providerStatus: 403,
      });
    });

    it.each([402, 404, 409, 429])(
      'debería traducir el %i, que el proveedor no declara, a WalletProviderUnavailableError',
      async (status) => {
        // Arrange
        const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(status, {})));
        const client = new TatumHttpClient(walletsConfig(), fetcher.impl);

        // Act + Assert
        await expect(client.request(transferRequest())).rejects.toMatchObject({
          name: 'WalletProviderUnavailableError',
          reason: 'undocumented-4xx',
          providerStatus: status,
        });
      },
    );

    it('debería traducir un 5xx a WalletProviderUnreachableError', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(500, {})));
      const client = new TatumHttpClient(walletsConfig(), fetcher.impl);

      // Act + Assert
      await expect(client.request(transferRequest())).rejects.toMatchObject({
        name: 'WalletProviderUnreachableError',
        reason: 'upstream-error',
        providerStatus: 500,
      });
    });

    it('debería traducir la expiración real de AbortSignal.timeout al motivo timeout', async () => {
      // Arrange
      const fetcher = fetchThatNeverAnswers();
      const client = new TatumHttpClient(walletsConfig(5), fetcher.impl);

      // Act + Assert
      await expect(client.request(transferRequest())).rejects.toMatchObject({
        name: 'WalletProviderUnreachableError',
        reason: 'timeout',
        providerStatus: null,
      });
    });

    it('debería tratar un AbortError ajeno como fallo de red y no como timeout', async () => {
      // Arrange
      const aborted = new DOMException('cancelada por el consumidor', 'AbortError');
      const fetcher = fakeFetch(() => Promise.reject(aborted));
      const client = new TatumHttpClient(walletsConfig(), fetcher.impl);

      // Act + Assert
      await expect(client.request(transferRequest())).rejects.toMatchObject({
        name: 'WalletProviderUnreachableError',
        reason: 'unreachable',
        providerStatus: null,
      });
    });

    it('debería traducir un cuerpo que no es JSON al motivo malformed-response', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(new Response('<html>bad gateway</html>')));
      const client = new TatumHttpClient(walletsConfig(), fetcher.impl);

      // Act + Assert
      await expect(client.request(transferRequest())).rejects.toMatchObject({
        name: 'WalletProviderUnreachableError',
        reason: 'malformed-response',
        providerStatus: 200,
      });
    });

    it('debería reintentar una vez la petición reintentable que falló con 5xx', async () => {
      // Arrange
      const fetcher = fakeFetch((call) =>
        Promise.resolve(call === 1 ? jsonResponse(500, {}) : jsonResponse(200, ['0xabc'])),
      );
      const client = new TatumHttpClient(walletsConfig(), fetcher.impl);

      // Act
      const body = await client.request(derivationRequest());

      // Assert
      expect(fetcher.calls).toHaveLength(2);
      expect(body).toEqual(['0xabc']);
    });

    it('debería intentar una sola vez la petición no reintentable que falló con 5xx', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(500, {})));
      const client = new TatumHttpClient(walletsConfig(), fetcher.impl);

      // Act + Assert
      await expect(client.request(transferRequest())).rejects.toMatchObject({
        name: 'WalletProviderUnreachableError',
        reason: 'upstream-error',
      });
      expect(fetcher.calls).toHaveLength(1);
    });
  });
});

// Helpers

type Call = { url: string; init: RequestInit };

/**
 * Los nombres de los campos son los del contrato de configuración —`apiUrl`, `apiKey`,
 * `timeoutMs`—, no `baseUrl` ni `requestTimeoutMs`: `getOrThrow<WalletsConfig>('wallets')` es un
 * cast, así que un nombre equivocado aquí no rompería la compilación y sí dejaría al cliente
 * llamando a `undefined/v3/gas-pump`.
 */
const walletsConfig = (timeoutMs = 1_000): ConfigService =>
  new ConfigService({ wallets: { apiUrl: API_URL, apiKey: API_KEY, timeoutMs } });

/** Reintentable y con el 400 imputado a NUESTRA configuración: la derivación (§7.2). */
const derivationRequest = (): TatumRequest => ({
  method: 'POST',
  path: '/v3/gas-pump',
  body: { chain: 'ETH' },
  retryable: true,
  badRequestBlame: 'our-configuration',
});

/** No reintentable —mueve dinero— y con el 400 imputable al cliente: la transferencia. */
const transferRequest = (): TatumRequest => ({
  method: 'POST',
  path: '/v3/blockchain/sc/custodial/transfer',
  body: { chain: 'ETH' },
  retryable: false,
  badRequestBlame: 'client-input',
});

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * `fetch` escrito a mano, inyectado por constructor. NO `jest.mock('node:…')`: el doble es un
 * parámetro del SUT, así que no hay módulo que interceptar y el test no depende del cargador.
 */
const fakeFetch = (
  answer: (call: number) => Promise<Response>,
): { impl: FetchLike; calls: Call[] } => {
  const calls: Call[] = [];
  const impl: FetchLike = (url, init) => {
    calls.push({ url, init });
    return answer(calls.length);
  };
  return { impl, calls };
};

/** El proveedor que acepta la conexión y no contesta: el único que ejerce el timeout de verdad. */
const fetchThatNeverAnswers = (): { impl: FetchLike; calls: Call[] } => {
  const calls: Call[] = [];
  const impl: FetchLike = (url, init) => {
    calls.push({ url, init });
    const signal = init.signal;
    return new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => {
        reject(abortReason(signal));
      });
    });
  };
  return { impl, calls };
};

/**
 * `AbortSignal.reason` está tipado `any` y `prefer-promise-reject-errors` exige un `Error`, así
 * que hay un cast — y NO un `instanceof Error`, que aquí sería un falso negativo.
 *
 * Medido bajo `jest-environment-node` (jest 30.4.1, Node 24.19.0): el motivo es un
 * `DOMException` con `name === 'TimeoutError'`, `instanceof DOMException === true` y
 * **`instanceof Error === false`** — el `Error` del realm del test no es el del host, aunque
 * ejecutado fuera de jest ese mismo `instanceof Error` dé `true`. Con el estrechamiento puesto,
 * este doble rechazaba con un `Error` fabricado y el caso del timeout pasaba a `unreachable`:
 * 1 fallido de 16. Es exactamente la razón por la que el cliente discrimina por `err.name`.
 */
const abortReason = (signal: AbortSignal): Error => signal.reason as Error;
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/modules/wallets/__tests__/infrastructure/gateways/tatum-http.client.spec.ts`
Expected: FAIL — `Cannot find module '../../../infrastructure/gateways/tatum-http.client' from 'src/modules/wallets/__tests__/infrastructure/gateways/tatum-http.client.spec.ts'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/modules/wallets/infrastructure/gateways/tatum-http.client.ts
import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { WalletsConfig } from '@config/wallets.config';

import {
  WalletProviderRejectedError,
  WalletProviderUnavailableError,
  WalletProviderUnreachableError,
  type ProviderFailureReason,
} from '../../domain/errors/wallet.errors';

/**
 * La rendija de `fetch` que este cliente usa, y nada más. Se inyecta por constructor para que
 * el test pueda darle un doble sin `jest.mock`, y para que este archivo no dependa de un global
 * que en un test no se puede sustituir sin tocar `globalThis`.
 */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * A quién culpa un 400 del proveedor. NO tiene default a propósito, igual que `retryable`: el
 * mismo status significa cosas distintas según el endpoint (§7.2) —en el alta de la wallet y en
 * la activación el cuerpo lo construimos NOSOTROS enteros, así que su 400 es configuración rota
 * nuestra y sale 503; solo la transferencia lleva entrada del cliente a la que culpar— y un
 * default habría hecho que la operación nueva heredara una decisión en silencio.
 */
export type BadRequestBlame = 'client-input' | 'our-configuration';

/**
 * `retryable` es OBLIGATORIO, no opcional con default. Reintentar la derivación solo cuesta
 * créditos («does not make any changes on the blockchain itself… no gas fee is applied»,
 * doc 01); reintentar la activación paga su comisión dos veces —ETH de la master o créditos del
 * plan, según quién pague (doc 02, y §7.1)— y reintentar la transferencia mueve el dinero dos
 * veces. Un campo con default habría dejado que una operación nueva heredara la política de otra
 * sin que nadie lo decidiera.
 *
 * ⚠️ El argumento del primero es «no cuesta gas», NO «es determinista»: la documentación no
 * promete en ningún sitio que derivar `(owner, índice)` sea determinista, y por eso la fuente
 * de verdad de la dirección es la fila guardada y no una rederivación.
 */
export type TatumRequest = {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  retryable: boolean;
  badRequestBlame: BadRequestBlame;
};

const ATTEMPTS_WHEN_RETRYABLE = 2;

/** El `fetch` de verdad, envuelto en la firma estrecha que este archivo declara. */
const globalFetch: FetchLike = (input, init) => fetch(input, init);

/**
 * Transporte contra Tatum: cabeceras, timeout, reintentos y traducción de errores. No conoce
 * el dominio de wallets ni la clave privada de la master: recibe un cuerpo ya construido, lo
 * serializa y lo entrega a `fetch`. Ese string es local, no se guarda, no se loguea y no se
 * adjunta a ningún error — que es la mitad transporte de la invariante de §7.1.
 *
 * Devuelve `unknown` y no un genérico `<T>`: un `<T>` sería un cast sin comprobar, y este
 * cliente no puede validar la forma de la respuesta de cada operación. Normalizarla es trabajo
 * del gateway (§6.2), y forzarlo a estrechar es lo que impide que un `{}` del proveedor entre
 * al dominio disfrazado de respuesta buena.
 *
 * Es `@Injectable` y lee su configuración del `ConfigService` porque `wallets.module.ts` lo
 * registra como provider de clase a secas: no está detrás de un puerto, así que no hay `provide`
 * ni `useFactory` que le pasara un objeto de opciones.
 *
 * ⚠️ `@Optional()` en el segundo parámetro NO es adorno: `emitDecoratorMetadata` escribe
 * `Function` como paramtype de `fetchImpl`, y sin él Nest buscaría un provider con ese token al
 * arrancar. Con `@Optional()` inyecta `undefined` y entra el `globalFetch` de arriba. **No lo he
 * medido**: el momento en que se ejercita es el arranque del módulo, que es la Task 41.
 */
@Injectable()
export class TatumHttpClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(configService: ConfigService, @Optional() fetchImpl?: FetchLike) {
    const config = configService.getOrThrow<WalletsConfig>('wallets');
    this.apiUrl = config.apiUrl;
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs;
    this.fetchImpl = fetchImpl ?? globalFetch;
  }

  /**
   * El bucle recorre los intentos MENOS UNO y el último va fuera: así el fallo del intento
   * final se propaga solo, sin guardar el error en una variable ni cerrar con un `throw
   * lastError ?? …` cuya rama derecha sería inalcanzable. Con `retryable: false` el cuerpo del
   * bucle no se ejecuta ni una vez.
   *
   * Solo se reintenta `WalletProviderUnreachableError` —5xx, red, timeout, cuerpo ilegible—.
   * Un 401 o un 403 no mejoran repitiéndolos: la clave está muerta o el permiso no está, y
   * reintentar solo duplica el gasto de créditos. Lo fija el caso E5.
   */
  async request(request: TatumRequest): Promise<unknown> {
    const attempts = request.retryable ? ATTEMPTS_WHEN_RETRYABLE : 1;
    for (let attempt = 1; attempt < attempts; attempt += 1) {
      try {
        return await this.attempt(request);
      } catch (error) {
        if (!(error instanceof WalletProviderUnreachableError)) {
          throw error;
        }
      }
    }
    return this.attempt(request);
  }

  private async attempt(request: TatumRequest): Promise<unknown> {
    const response = await this.call(request);
    if (!response.ok) {
      throw translateStatus(response.status, request.badRequestBlame);
    }
    return parseJson(response);
  }

  /**
   * `AbortSignal.timeout` y no un `setTimeout` con `AbortController`: es nativo desde Node 17
   * y no deja el temporizador vivo cuando la respuesta llega antes.
   *
   * ⚠️ El error que atrapa este `catch` NUNCA se adjunta como `cause`. El serializador de pino
   * concatena mensajes y stacks de las causas, y el mensaje de un fallo de `fetch` puede llevar
   * la URL entera; el nuestro es fijo y lo único que viaja es el código de motivo (§7.1).
   */
  private async call(request: TatumRequest): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.apiUrl}${request.path}`, {
        method: request.method,
        headers: this.buildHeaders(request),
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new WalletProviderUnreachableError(transportReason(error), null);
    }
  }

  private buildHeaders(request: TatumRequest): Record<string, string> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-api-key': this.apiKey,
    };
    if (request.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    return headers;
  }
}

/**
 * ⚠️ Se discrimina por `err.name` y NUNCA por `instanceof`, y no es estilo.
 *
 * `AbortSignal.timeout` rechaza con un `DOMException` cuyo `name` es **`TimeoutError`**, no
 * `AbortError` —ese es el de un `AbortController.abort()`—, así que un `instanceof
 * DOMException` no distingue los dos casos que aquí importan. Y el `instanceof` tampoco es
 * fiable a secas: medido bajo `jest-environment-node` (jest 30.4.1, Node 24.19.0), ese mismo
 * `DOMException` da `instanceof Error === false` porque el `Error` del realm del test no es el
 * del host, mientras que ejecutado fuera de jest da `true`. Una implementación apoyada en
 * `instanceof` se comportaría distinto en la suite y en producción.
 */
const errorName = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string'
    ? error.name
    : '';

const transportReason = (error: unknown): ProviderFailureReason =>
  errorName(error) === 'TimeoutError' ? 'timeout' : 'unreachable';

/**
 * La tabla de §7.2, en el orden en que hay que leerla. Lo único que sale como 400 nuestro es el
 * 400 de la transferencia: publicar como 400 el de la derivación o el de la activación
 * escondería del `ErrorReporter` —que solo ve 5xx— una configuración rota NUESTRA, y de paso
 * culparía al cliente.
 *
 * El 401 del proveedor no puede salir como 401 nuestro: el nuestro tiene un significado
 * publicado y estrecho («Token ausente, inválido o expirado») y devolverlo haría que el cliente
 * borrara su sesión, se reautenticara y volviera a fallar por algo que es enteramente nuestro.
 *
 * ⚠️ Límite reconocido y no cerrado en este ciclo: el 403 de Tatum es literalmente «logical
 * error or invalid permissions», así que una precondición de negocio suya sale publicada como
 * caída de la integración; y su 400 no distingue «dirección destino inválida» de «la master no
 * tiene fondos», así que algún 503 saldrá como 400. Afinarlo exige clasificar el cuerpo (§9).
 */
const translateStatus = (status: number, blame: BadRequestBlame): Error => {
  if (status === 400) {
    return blame === 'client-input'
      ? new WalletProviderRejectedError('body-rejected', status)
      : new WalletProviderUnavailableError('misconfigured', status);
  }
  if (status === 401) {
    return new WalletProviderUnavailableError('unauthorized', status);
  }
  if (status === 403) {
    return new WalletProviderUnavailableError('forbidden', status);
  }
  if (status >= 500) {
    return new WalletProviderUnreachableError('upstream-error', status);
  }
  // Medido sobre `docs/tatum/gas-pump/openapi.json`: las SIETE operaciones declaran exactamente
  // `200, 400, 401, 403, 500`. Un 404, un 429, un 402 o un 409 no forman parte de su contrato
  // publicado, así que no se les inventa una fila propia: son `undocumented-4xx` y 503.
  return new WalletProviderUnavailableError('undocumented-4xx', status);
};

/**
 * El error de `json()` se descarta ENTERO, sin `cause` y sin interpolarlo: su mensaje lleva un
 * fragmento del cuerpo recibido (`Unexpected token '<' …`), y este código no puede saber qué hay
 * en ese cuerpo. Lo que queda es el código de motivo y el status, que es lo que §7.1 permite.
 */
const parseJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    throw new WalletProviderUnreachableError('malformed-response', response.status);
  }
};
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/modules/wallets/__tests__/infrastructure/gateways/tatum-http.client.spec.ts`
Expected: PASS — 16 passed (13 `it` declarados; E7 es un `it.each` de cuatro status)

---

### Task 24: El adaptador del puerto — `tatum-custodial-address.gateway.ts`

**Layer:** infrastructure
**Rule codes to honor:** `di-use-interfaces-tokens`, `di-prefer-constructor-injection`, `devops-use-config-module`, `error-handle-async-errors`, `test-mock-external-services`

**Contrato que esta tarea consume:**

```ts
// domain/ports/custodial-address.gateway.ts (tarea de puertos)
export type SendCommand = {
  from: EthereumAddress; // la gas pump address del usuario, NUNCA la master
  recipient: EthereumAddress;
  asset: TransferAsset;
};

export abstract class CustodialAddressGateway {
  abstract masterAddress(): EthereumAddress;
  abstract deriveAddress(index: AddressIndex): Promise<EthereumAddress>;
  abstract enableSending(index: AddressIndex): Promise<TransactionHash>;
  abstract isSendingEnabled(index: AddressIndex): Promise<boolean>;
  abstract send(command: SendCommand): Promise<TransactionHash>;
}

// src/config/wallets.config.ts (tarea de configuración)
export const TATUM_CHAIN = 'ETH';
export type WalletsConfig = {
  apiUrl: string;
  apiKey: string;
  timeoutMs: number;
  masterAddress: string;
  masterPrivateKey: string;
  activationPayer: 'tatum' | 'master'; // default 'tatum'
  network: string;
};

// domain/errors/wallet.errors.ts (tarea de errores)
new WalletAddressIsMasterError(address); // recibe LA DIRECCIÓN, un string
new WalletProviderUnreachableError(reason, providerStatus); // reason ∈ PROVIDER_FAILURE_REASONS
```

⚠️ **`activationPayer` es una UNIÓN cerrada y no un `string`, y esta tarea es la única que lo lee.**
Con `string` la comparación `payer === 'tatum'` seguiría compilando, pero un valor mal escrito solo
se descubriría en producción cayendo por la rama contraria; con la unión, la validación de
`env.schema.ts` y el compilador dicen lo mismo. La tarea de configuración lo publica ya así
(`Env['WALLETS_ACTIVATION_PAYER']`).

⚠️ **`deriveAddress`, `enableSending` e `isSendingEnabled` reciben un ÍNDICE y nada más.** Lo
arbitra la API del proveedor: `POST /v3/gas-pump/activate` toma `{chain, owner, from, to}` —índices—
y `GET /v3/gas-pump/activated/{chain}/{owner}/{index}` lo lleva en la ruta. La master la aporta este
adaptador desde la configuración; pasársela desde el caso de uso duplicaría `masterAddress()`.

⚠️ **No existe un campo `chain` en la configuración.** La cadena es la constante `TATUM_CHAIN` de
`wallets.config.ts`, importada como VALOR — mismo precedente que `ARGON2_PARAMS` en
`auth/infrastructure/security/argon2-password-hasher.ts`.

⚠️ **El cuerpo de la activación tiene DOS formas y la elige `activationPayer`.** Son las dos ramas
del `oneOf` de `POST /v3/gas-pump/activate` aplicables a ETH (doc 02):

| `activationPayer`   | Esquema del proveedor  | Cuerpo                                          | Quién paga la comisión                                                                  |
| ------------------- | ---------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| `'tatum'` (default) | `ActivateGasPumpTatum` | `{ chain, owner, from, to, feesCovered: true }` | Tatum, contra la cuota de créditos: **1 crédito en testnet, y sin exigir plan de pago** |
| `'master'`          | `ActivateGasPump`      | `{ chain, owner, from, to, fromPrivateKey }`    | La master, en ETH                                                                       |

**No es una asimetría estética, y por eso lleva dos casos propios.** Sin la rama, el default de la
configuración mentiría: con `WALLETS_ACTIVATION_PAYER=tatum` la activación pagaría igualmente en ETH
de la master. Y quedaría falso el cálculo que sostiene la entrada #4 del backlog —se acepta que la
activación no escriba por delante porque una activación duplicada cuesta **3 créditos** (2 de llamada

- 1 de comisión) y **ningún ETH**—, que solo es cierto si el cuerpo lleva `feesCovered`. Con la rama
  sin implementar, la master de Sepolia necesitaría ETH de faucet para activar.

⚠️ En la rama `'tatum'` el cuerpo **no puede llevar `fromPrivateKey`**: los dos esquemas son
excluyentes, y es la ÚNICA operación del módulo que no toca el secreto. Mandarlo «por si acaso»
sería sacar la clave a la red en una petición que no la necesita.

⚠️ **Esta tarea NO toca `eslint.config.mjs`.** `SendCommand` es un DATO que viaja con el puerto, así
que su `type` inline es correcto y su nombre tiene que estar en la lista cerrada del segundo
selector de `no-restricted-syntax`; ese archivo lo edita ÚNICAMENTE la Task 41, que escribe la lista
final completa de los cuatro nombres del contexto (`FindTransfersCriteria`, `SendCommand`,
`TransferPage`, `WalletSaveOutcome`). Hasta que esa tarea corra, `pnpm lint:check` marca este import
y es lo esperado. El puerto en sí —`CustodialAddressGateway`— se importa como VALOR: este archivo
tiene `@Injectable()`, y un `import type` del puerto borraría la referencia del emit y Nest fallaría
EN RUNTIME con `lint:check` y `typecheck` en verde.

**Files:**

- Create: `src/modules/wallets/infrastructure/gateways/tatum-custodial-address.gateway.ts`
- Test: `src/modules/wallets/__tests__/infrastructure/gateways/tatum-custodial-address.gateway.spec.ts`

⚠️ `MasterPrivateKey` se declara EN ESTE ARCHIVO y no en uno propio: la regla 1:1 spec↔archivo lo
dejaría con un spec nominal que repetiría las cuatro superficies que la Task 25 ya mide de verdad.
Y no puede vivir en `src/config/`: la matriz de fronteras solo permite `config → config`, así que
desde ahí no se alcanza el kernel compartido. La configuración guarda un string plano y **el
adaptador lo envuelve en su constructor** (§7.1).

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/modules/wallets/__tests__/infrastructure/gateways/tatum-custodial-address.gateway.spec.ts
import { ConfigService } from '@nestjs/config';

import { TransferAsset } from '../../../domain/transfer-asset';
import { AddressIndex } from '../../../domain/value-objects/address-index.vo';
import { EthereumAddress } from '../../../domain/value-objects/ethereum-address.vo';
import { TokenAmount } from '../../../domain/value-objects/token-amount.vo';
import { TatumCustodialAddressGateway } from '../../../infrastructure/gateways/tatum-custodial-address.gateway';
import {
  TatumHttpClient,
  type FetchLike,
} from '../../../infrastructure/gateways/tatum-http.client';

const MASTER = '0x2b5a0be5940b63de1eddccca7bd977357e2488ed';
const DERIVED = '0x687422eea2cb73b5d3e242ba5456b782919afc85';
const RECIPIENT = '0xe242ba5456b782919afc85687422eea2cb73b5d3';
const FAKE_KEY = `0x${'ab'.repeat(32)}`;
const BARE_TX_ID = 'c83f8818db43d9ba4accfe454aa44fc33123d47a4f89d47b314d6748eb0e9bc9';

describe('TatumCustodialAddressGateway', () => {
  describe('deriveAddress()', () => {
    it('debería derivar la dirección del índice pidiendo el rango de un solo elemento', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(200, [DERIVED])));
      const gateway = buildGateway(fetcher.impl);

      // Act
      const address = await gateway.deriveAddress(AddressIndex.from(7));

      // Assert
      expect(address.value).toBe(DERIVED);
      expect(bodyOf(fetcher.calls[0])).toEqual({ chain: 'ETH', owner: MASTER, from: 7, to: 7 });
    });

    it('debería exigir exactamente un elemento en la respuesta de derivación', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(200, [DERIVED, RECIPIENT])));
      const gateway = buildGateway(fetcher.impl);

      // Act + Assert
      await expect(gateway.deriveAddress(AddressIndex.from(7))).rejects.toMatchObject({
        name: 'WalletProviderUnreachableError',
        reason: 'malformed-response',
      });
    });

    it('debería rechazar con nombre una derivación que devuelve la propia master', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(200, [MASTER])));
      const gateway = buildGateway(fetcher.impl);

      // Act + Assert
      await expect(gateway.deriveAddress(AddressIndex.from(7))).rejects.toMatchObject({
        name: 'WalletAddressIsMasterError',
        address: MASTER,
      });
    });
  });

  /**
   * Los dos casos de las ramas comparan el cuerpo COMPLETO con `toEqual` y no campo a campo:
   * lo que hay que cazar es una clave DE MÁS. Un `toMatchObject` daría verde a un cuerpo que
   * llevara `feesCovered` **y** `fromPrivateKey` a la vez —el defecto exacto: sacar el secreto
   * a la red en la petición que no lo necesita—, y el proveedor lo rechazaría con un 400 que
   * este adaptador publica como 503, ya con los créditos gastados.
   */
  describe('enableSending()', () => {
    it('debería prefijar 0x al txId pelado que devuelve la activación', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(200, { txId: BARE_TX_ID })));
      const gateway = buildGateway(fetcher.impl);

      // Act
      const hash = await gateway.enableSending(AddressIndex.from(7));

      // Assert
      expect(hash.value).toBe(`0x${BARE_TX_ID}`);
    });

    it('debería activar con feesCovered y sin la clave privada cuando paga tatum', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(200, { txId: BARE_TX_ID })));
      const gateway = buildGateway(fetcher.impl, 'tatum');

      // Act
      await gateway.enableSending(AddressIndex.from(7));

      // Assert
      expect(bodyOf(fetcher.calls[0])).toEqual({
        chain: 'ETH',
        owner: MASTER,
        from: 7,
        to: 7,
        feesCovered: true,
      });
    });

    it('debería firmar la activación con la clave privada de la master cuando paga la master', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(200, { txId: BARE_TX_ID })));
      const gateway = buildGateway(fetcher.impl, 'master');

      // Act
      await gateway.enableSending(AddressIndex.from(7));

      // Assert
      expect(bodyOf(fetcher.calls[0])).toEqual({
        chain: 'ETH',
        owner: MASTER,
        from: 7,
        to: 7,
        fromPrivateKey: FAKE_KEY,
      });
    });

    it('debería tratar una respuesta sin txId como respuesta que no satisface el esquema', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(200, {})));
      const gateway = buildGateway(fetcher.impl);

      // Act + Assert
      await expect(gateway.enableSending(AddressIndex.from(7))).rejects.toMatchObject({
        name: 'WalletProviderUnreachableError',
        reason: 'malformed-response',
      });
    });
  });

  describe('isSendingEnabled()', () => {
    it('debería consultar la ruta con cadena, master e índice y devolver el booleano', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(200, { activated: true })));
      const gateway = buildGateway(fetcher.impl);

      // Act
      const enabled = await gateway.isSendingEnabled(AddressIndex.from(7));

      // Assert
      expect(enabled).toBe(true);
      expect(fetcher.calls[0]?.url).toBe(`${API_URL}/v3/gas-pump/activated/ETH/${MASTER}/7`);
    });

    it('debería tratar un activated ausente como respuesta que no satisface el esquema y no como false', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(200, {})));
      const gateway = buildGateway(fetcher.impl);

      // Act + Assert
      await expect(gateway.isSendingEnabled(AddressIndex.from(7))).rejects.toMatchObject({
        name: 'WalletProviderUnreachableError',
        reason: 'malformed-response',
      });
    });
  });

  describe('send()', () => {
    it('debería enviar desde la dirección de la wallet y firmar con la clave de la master', async () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.resolve(jsonResponse(200, { txId: BARE_TX_ID })));
      const gateway = buildGateway(fetcher.impl);

      // Act
      await gateway.send({
        from: EthereumAddress.from(DERIVED),
        recipient: EthereumAddress.from(RECIPIENT),
        asset: TransferAsset.native({ amount: TokenAmount.from('100000') }),
      });

      // Assert
      expect(bodyOf(fetcher.calls[0])).toEqual({
        chain: 'ETH',
        custodialAddress: DERIVED,
        recipient: RECIPIENT,
        contractType: 3,
        amount: '100000',
        fromPrivateKey: FAKE_KEY,
      });
    });
  });

  describe('masterAddress()', () => {
    it('debería devolver la master de la configuración sin llamar al proveedor', () => {
      // Arrange
      const fetcher = fakeFetch(() => Promise.reject(new Error('no debería llamarse')));
      const gateway = buildGateway(fetcher.impl);

      // Act
      const master = gateway.masterAddress();

      // Assert
      expect(master.value).toBe(MASTER);
      expect(fetcher.calls).toHaveLength(0);
    });
  });
});

// Helpers

type Call = { url: string; init: RequestInit };

const API_URL = 'http://127.0.0.1:9';

/**
 * El gateway recibe un `TatumHttpClient` REAL con un `fetch` de mentira, no un doble del
 * cliente: así el caso ejercita también las cabeceras, el timeout y la traducción de errores.
 * Un doble del cliente dejaría sin ejecutar justo el archivo más propenso a defectos.
 *
 * Un solo `ConfigService` para los dos: el cliente lee `apiUrl`, `apiKey` y `timeoutMs`, y el
 * gateway lee `masterAddress`, `masterPrivateKey` y `activationPayer`. Los nombres son los del
 * contrato de configuración; no hay campo `chain`, que es la constante `TATUM_CHAIN`.
 *
 * `activationPayer` es un PARÁMETRO y su default es `'tatum'`, el mismo de `env.schema.ts`: los
 * casos que no hablan de quién paga se ejecutan con la configuración que va a estar puesta de
 * verdad, y los dos que sí lo dicen lo pasan explícito. Dejarlo ausente del objeto haría que el
 * adaptador leyera `undefined` y la rama que se ejercitara dependiera de un descuido.
 */
const buildGateway = (
  impl: FetchLike,
  activationPayer: 'tatum' | 'master' = 'tatum',
): TatumCustodialAddressGateway => {
  const configService = new ConfigService({
    wallets: {
      apiUrl: API_URL,
      apiKey: 'clave-de-prueba',
      timeoutMs: 1_000,
      masterAddress: MASTER,
      masterPrivateKey: FAKE_KEY,
      activationPayer,
    },
  });
  const client = new TatumHttpClient(configService, impl);
  return new TatumCustodialAddressGateway(configService, client);
};

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const bodyOf = (call: Call | undefined): unknown => {
  const body = call?.init.body;
  return typeof body === 'string' ? (JSON.parse(body) as unknown) : null;
};

const fakeFetch = (
  answer: (call: number) => Promise<Response>,
): { impl: FetchLike; calls: Call[] } => {
  const calls: Call[] = [];
  const impl: FetchLike = (url, init) => {
    calls.push({ url, init });
    return answer(calls.length);
  };
  return { impl, calls };
};
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/modules/wallets/__tests__/infrastructure/gateways/tatum-custodial-address.gateway.spec.ts`
Expected: FAIL — `Cannot find module '../../../infrastructure/gateways/tatum-custodial-address.gateway' from 'src/modules/wallets/__tests__/infrastructure/gateways/tatum-custodial-address.gateway.spec.ts'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/modules/wallets/infrastructure/gateways/tatum-custodial-address.gateway.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SecretValueObject } from '@shared/domain/secret-value-object.base';

import { TATUM_CHAIN, type WalletsConfig } from '@config/wallets.config';

import {
  WalletAddressIsMasterError,
  WalletProviderUnreachableError,
} from '../../domain/errors/wallet.errors';
import {
  CustodialAddressGateway,
  type SendCommand,
} from '../../domain/ports/custodial-address.gateway';
import { AddressIndex } from '../../domain/value-objects/address-index.vo';
import { EthereumAddress } from '../../domain/value-objects/ethereum-address.vo';
import { TransactionHash } from '../../domain/value-objects/transaction-hash.vo';

import { mapAssetToTatumFields } from './tatum-asset.mapper';
import { TatumHttpClient } from './tatum-http.client';

/**
 * La clave privada de la master, envuelta para que no se rinda a texto por accidente.
 * `SecretValueObject` tapa las TRES superficies que escriben sin que nadie las escriba:
 * `toString()`, `toJSON()` —la que usa pino— y `util.inspect`.
 *
 * Vive aquí y no en `src/config/` porque la matriz de fronteras solo permite `config → config`:
 * desde la configuración no se alcanza el kernel compartido. La config guarda un string plano y
 * este adaptador lo envuelve en su constructor (§7.1).
 *
 * ⚠️ No es una caja fuerte: `.value` sigue devolviendo el original, porque el cuerpo que va a
 * `fetch` lo necesita. Protege del `console.log` y del logger, no de quien va a buscar el dato.
 */
export class MasterPrivateKey extends SecretValueObject<string> {
  static from(raw: string): MasterPrivateKey {
    return new MasterPrivateKey(raw);
  }
}

/**
 * Implementa el puerto que `wallets` definió componiendo el transporte (`TatumHttpClient`) y el
 * mapper puro (`tatum-asset.mapper`), y aportando lo único que ninguno de los dos conoce: la
 * master y su clave.
 *
 * `implements` y no `extends`: `useClass` funciona igual con las dos, pero `extends` quemaría el
 * único hueco de herencia y exigiría un `super()` vacío, y `implements` es lo ÚNICO que
 * comprueba la conformidad — `ClassProvider.provide` está tipado `any`, así que el archivo del
 * module no verifica nada.
 *
 * ⚠️ **La clave se lee en EXACTAMENTE DOS sitios de todo el módulo**, los dos de este archivo y
 * los dos construyendo el objeto que va directo a `fetch`: `send`, y `enableSending` **solo en su
 * rama `'master'`**. La rama `'tatum'` de la activación es la única operación del módulo que no
 * toca el secreto, porque su cuerpo (`ActivateGasPumpTatum`) no lo lleva. Ese objeto no se
 * guarda, no se loguea y no se adjunta a ningún error. La comprobación es greppable y está en el
 * plan como paso propio; si algún día aparece un tercer `masterPrivateKey.value`, hay que
 * justificarlo o hay una fuga.
 *
 * ⚠️ **No medido:** la master viaja a las rutas en minúsculas, tal como la normaliza
 * `EthereumAddress`, mientras que los ejemplos de Tatum la muestran con checksum EIP-55. No hay
 * API key en el repo para comprobar si el proveedor distingue; quien haga la prueba de humo
 * contra testnet (§8) es quien lo va a descubrir.
 */
@Injectable()
export class TatumCustodialAddressGateway implements CustodialAddressGateway {
  private readonly master: EthereumAddress;
  private readonly masterPrivateKey: MasterPrivateKey;
  private readonly activationPayer: WalletsConfig['activationPayer'];

  constructor(
    configService: ConfigService,
    private readonly client: TatumHttpClient,
  ) {
    const config = configService.getOrThrow<WalletsConfig>('wallets');
    this.master = EthereumAddress.from(config.masterAddress);
    this.masterPrivateKey = MasterPrivateKey.from(config.masterPrivateKey);
    this.activationPayer = config.activationPayer;
  }

  masterAddress(): EthereumAddress {
    return this.master;
  }

  /**
   * `from == to`: se pide UN índice, así que la respuesta tiene que traer UNA dirección. Y la
   * dirección derivada no puede ser la master: sería entregarle a un usuario el fondo de gas de
   * la plataforma, y al siguiente el mismo (§3.1.1). El error lleva la dirección devuelta y sale
   * 500 al `ErrorReporter`, no 400: el cliente no ha hecho nada mal.
   */
  async deriveAddress(index: AddressIndex): Promise<EthereumAddress> {
    const body = await this.client.request({
      method: 'POST',
      path: '/v3/gas-pump',
      body: {
        chain: TATUM_CHAIN,
        owner: this.master.value,
        from: index.value,
        to: index.value,
      },
      retryable: true,
      badRequestBlame: 'our-configuration',
    });
    const address = EthereumAddress.from(readSingleAddress(body));
    if (address.equals(this.master)) {
      throw new WalletAddressIsMasterError(address.value);
    }
    return address;
  }

  /**
   * No reintentable: un segundo intento es una segunda transacción y la comisión se paga dos
   * veces —en ETH o en créditos, según quién pague—.
   *
   * ⚠️ El cuerpo tiene DOS formas EXCLUYENTES, y lo decide `activationPayer`. Son las dos ramas
   * del `oneOf` de `POST /v3/gas-pump/activate` aplicables a ETH (doc 02):
   *
   * - `'tatum'` → esquema `ActivateGasPumpTatum`, con `feesCovered: true` y **sin
   *   `fromPrivateKey`**. La comisión sale de la cuota de créditos; en testnet es 1 crédito y no
   *   exige plan de pago. Es la ÚNICA operación de este módulo que no lee la clave privada, y
   *   añadírsela «por simetría» sería mandar el secreto a la red en la petición que no lo pide.
   * - `'master'` → esquema `ActivateGasPump`, con `fromPrivateKey` y **sin `feesCovered`**. El gas
   *   sale en ETH de la master.
   *
   * Lo que se rompería sin la rama: el default de la configuración es `'tatum'`, así que un
   * cuerpo fijo con `fromPrivateKey` pagaría en ETH contradiciendo lo configurado, y dejaría
   * falso el cálculo de coste de la entrada #4 del backlog —que acepta la ventana de la
   * activación duplicada porque en testnet cuesta 3 créditos y ningún ETH—.
   */
  async enableSending(index: AddressIndex): Promise<TransactionHash> {
    const range = {
      chain: TATUM_CHAIN,
      owner: this.master.value,
      from: index.value,
      to: index.value,
    };
    const body = await this.client.request({
      method: 'POST',
      path: '/v3/gas-pump/activate',
      body:
        this.activationPayer === 'tatum'
          ? { ...range, feesCovered: true }
          : // Lectura 1 de 2 de la clave, y SOLO en esta rama. Va directa al cuerpo de `fetch` y
            // no se guarda en ningún sitio.
            { ...range, fromPrivateKey: this.masterPrivateKey.value },
      retryable: false,
      badRequestBlame: 'our-configuration',
    });
    return TransactionHash.from(readTxId(body));
  }

  /** `GET` que no escribe en la cadena: reintentable, 1 crédito por intento. */
  async isSendingEnabled(index: AddressIndex): Promise<boolean> {
    const body = await this.client.request({
      method: 'GET',
      path: `/v3/gas-pump/activated/${TATUM_CHAIN}/${this.master.value}/${index.value}`,
      retryable: true,
      badRequestBlame: 'our-configuration',
    });
    return readActivated(body);
  }

  /**
   * El origen es `command.from` —la dirección de la WALLET—, nunca la master: la master FIRMA,
   * no envía. Los campos excluyentes del activo los pone el mapper, así que aquí no hay forma de
   * escribir un `amount` en un NFT.
   */
  async send(command: SendCommand): Promise<TransactionHash> {
    const body = await this.client.request({
      method: 'POST',
      path: '/v3/blockchain/sc/custodial/transfer',
      body: {
        chain: TATUM_CHAIN,
        custodialAddress: command.from.value,
        recipient: command.recipient.value,
        ...mapAssetToTatumFields(command.asset),
        // Lectura 2 de 2 de la clave. Misma regla: directa al cuerpo, y nada más.
        fromPrivateKey: this.masterPrivateKey.value,
      },
      retryable: false,
      badRequestBlame: 'client-input',
    });
    return TransactionHash.from(readTxId(body));
  }
}

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/**
 * Normalización 1 de 3 (§6.2): el esquema de la derivación declara `array` SIN cardinalidad, y
 * con `noUncheckedIndexedAccess` el `[0]` es `string | undefined`. Se exige exactamente uno
 * porque se pidió un rango de uno; cero o dos es un 200 que no satisface el esquema —el motivo
 * `malformed-response` de la lista cerrada—, no entrada inválida del cliente, y por eso sale 502
 * y va al APM.
 *
 * El `providerStatus` es `null` y no 200: el cliente devuelve el CUERPO de una respuesta que ya
 * dio por buena, así que aquí el status exacto no está disponible. Inventarlo sería un dato
 * falso en el log.
 *
 * El `only === undefined` no es una rama alcanzable —`isStringArray` ya garantiza que todos los
 * elementos son strings—: es lo que exige `noUncheckedIndexedAccess` para poder devolverlo.
 */
const readSingleAddress = (body: unknown): string => {
  const addresses = isStringArray(body) ? body : [];
  const [only] = addresses;
  if (addresses.length !== 1 || only === undefined) {
    throw new WalletProviderUnreachableError('malformed-response', null);
  }
  return only;
};

/**
 * Normalización 2 de 3 (§6.2): el `txId` del proveedor viene SIN prefijo `0x` —su ejemplo son
 * 64 hexadecimales pelados y el esquema es `type: string` sin `pattern`—, mientras que
 * `TransactionHash` lo exige. Sin este prefijo, el camino feliz moriría en un
 * `InvalidTransactionHashError` publicado como 400 CON EL GAS YA PAGADO.
 *
 * Un 200 sin `txId` —la respuesta de KMS trae `signatureId`, que este ciclo no usa— es un cuerpo
 * que no satisface el esquema: 502 con `malformed-response`, no un hash inventado.
 */
const readTxId = (body: unknown): string => {
  if (
    typeof body === 'object' &&
    body !== null &&
    'txId' in body &&
    typeof body.txId === 'string'
  ) {
    return body.txId.startsWith('0x') ? body.txId : `0x${body.txId}`;
  }
  throw new WalletProviderUnreachableError('malformed-response', null);
};

/**
 * Normalización 3 de 3 (§6.2): el esquema `Activated` NO declara `required`, así que `{}` es un
 * 200 válido. Las dos lecturas por defecto son destructivas y el estado es monótono: leerlo como
 * `false` quema gas activando una dirección quizá ya activa, y leerlo como `true` cura a un
 * estado del que no se retrocede. La ausencia no es un booleano: es un cuerpo que no satisface
 * el esquema.
 */
const readActivated = (body: unknown): boolean => {
  if (
    typeof body === 'object' &&
    body !== null &&
    'activated' in body &&
    typeof body.activated === 'boolean'
  ) {
    return body.activated;
  }
  throw new WalletProviderUnreachableError('malformed-response', null);
};
```

⚠️ Los tres motivos de normalización son el mismo, `malformed-response`, y eso es una consecuencia
buscada de que `PROVIDER_FAILURE_REASONS` sea una lista ÚNICA y cerrada: el `reasonCode` que se
guarda en `wallet_transfers` es de ese mismo tipo, así que un motivo nuevo por cada forma de
respuesta rota ensancharía la columna del libro con distinciones que el cliente no puede usar. Lo
que se pierde —saber si fue la cardinalidad o el `txId` ausente— se recupera en el log, que lleva la
operación y la ruta.

**Cableado** (lo escribe la Task 41, dueña de `wallets.module.ts`): `TatumHttpClient` se registra
como provider de clase a secas y este gateway detrás de su puerto,
`{ provide: CustodialAddressGateway, useClass: TatumCustodialAddressGateway }`. Esta tarea no toca
ese archivo.

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/modules/wallets/__tests__/infrastructure/gateways/tatum-custodial-address.gateway.spec.ts`
Expected: PASS — 11 passed

- [ ] **Step 5: Comprueba la invariante greppable de la clave privada**

Run:

```bash
rg -n "masterPrivateKey\.value" src/modules/wallets
rg -n "masterPrivateKey|fromPrivateKey|feesCovered" src/modules/wallets --stats
```

Expected:

- El primero devuelve **exactamente dos líneas**, las dos en
  `src/modules/wallets/infrastructure/gateways/tatum-custodial-address.gateway.ts`, y las dos
  dentro del literal del cuerpo que se pasa a `client.request(...)` — una en `send`, y otra en la
  rama `'master'` de `enableSending`. **Siguen siendo dos, no tres**: la rama `'tatum'` no lee la
  clave, así que ramificar la activación no abrió una tercera lectura.
- En el segundo, fuera de ese archivo solo aparecen: la declaración del campo y su lectura de la
  configuración, y en los tests el `FAKE_KEY` de la config falsa y las aserciones sobre el cuerpo
  enviado. `feesCovered` aparece **una sola vez** en producción —la rama `'tatum'`— y nunca en la
  misma expresión que `fromPrivateKey`: los dos esquemas son excluyentes. **Cero apariciones** de
  la clave en DTOs, en el filtro, en el controller, en un `console.*` o en la construcción de
  cualquier error.

---

### Task 25: La medición de la fuga — `tatum-secret-surface.spec.ts`

**Layer:** infrastructure
**Rule codes to honor:** `security-sanitize-output`, `devops-use-logging`, `test-mock-external-services`

Esta tarea NO añade código de producción: añade el único test que mide que la clave privada de la
master no sale por ninguna de las cuatro superficies por las que un valor llega a un log. Es el
gate de la sección §7.1 del spec, y es el único que caza el `for (const key in err)` del
serializador de pino — que copia **toda** propiedad enumerable del error, así que un error al que
alguien adjunte la petición escribe el cuerpo entero, clave incluida.

⚠️ **Es un spec sin archivo 1:1 a propósito**, igual que `openapi-contract.e2e-spec.ts`: su sujeto
no es un archivo sino una propiedad del módulo entero. El spec §8 lo declara («Fuga del secreto |
unitaria dedicada»).

⚠️ **No depende de las rutas de redacción de la Task 26 para pasar.** Pasa porque los errores no
llevan nada dentro; la redacción es la red por debajo, no el arreglo. El último caso lo demuestra
midiendo qué pasa cuando la invariante se rompe.

**Files:**

- Test: `src/modules/wallets/__tests__/infrastructure/gateways/tatum-secret-surface.spec.ts`

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/modules/wallets/__tests__/infrastructure/gateways/tatum-secret-surface.spec.ts
import { Writable } from 'node:stream';
import { inspect } from 'node:util';

import { ConfigService } from '@nestjs/config';
import pino from 'pino';

import { DEFAULT_REDACT_PATHS } from '@common/logger/pino-options';

import { WalletProviderUnreachableError } from '../../../domain/errors/wallet.errors';
import { TransferAsset } from '../../../domain/transfer-asset';
import { AddressIndex } from '../../../domain/value-objects/address-index.vo';
import { EthereumAddress } from '../../../domain/value-objects/ethereum-address.vo';
import { TokenAmount } from '../../../domain/value-objects/token-amount.vo';
import {
  MasterPrivateKey,
  TatumCustodialAddressGateway,
} from '../../../infrastructure/gateways/tatum-custodial-address.gateway';
import {
  TatumHttpClient,
  type FetchLike,
} from '../../../infrastructure/gateways/tatum-http.client';

const MASTER = '0x2b5a0be5940b63de1eddccca7bd977357e2488ed';
const DERIVED = '0x687422eea2cb73b5d3e242ba5456b782919afc85';
const RECIPIENT = '0xe242ba5456b782919afc85687422eea2cb73b5d3';

/**
 * Clave de mentira con entropía NULA —`ab` repetido 32 veces— y longitud real (66 con el
 * prefijo). No es celo: el gate de secretos del repo es gitleaks, cuya regla genérica combina
 * palabra clave y entropía, y `secretlint` con el `.secretlintrc.json` de este repo da cero
 * avisos ante una clave privada de Ethereum (medido en el spec §7.1). Un patrón repetido no
 * dispara la regla de entropía y sigue sirviendo de centinela dentro del test.
 */
const FAKE_MASTER_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
const FAKE_API_KEY = 'fake-tatum-api-key-0000';
const SECRETS = [FAKE_MASTER_PRIVATE_KEY, FAKE_API_KEY];

/**
 * Los modos de fallo del adaptador, como DATO. Va arriba y no bajo `// Helpers` porque `it.each`
 * lo consume cuando se carga el `describe`: declarado abajo caería en su zona muerta temporal y
 * la suite entera no llegaría a ejecutarse. Las funciones que guarda sí llaman a los helpers de
 * abajo, y eso es legal: se invocan dentro del caso, no al declararlo.
 */
const SCENARIOS = [
  {
    label: 'la derivación responde 400',
    respond: () => Promise.resolve(jsonResponse(400, { message: 'bad request' })),
    act: (gateway: TatumCustodialAddressGateway) => gateway.deriveAddress(AddressIndex.from(7)),
  },
  {
    label: 'la activación responde 401 interpolando la clave de API',
    respond: () =>
      Promise.resolve(
        jsonResponse(401, { message: `Unable to find valid subscription for '${FAKE_API_KEY}'` }),
      ),
    act: (gateway: TatumCustodialAddressGateway) => gateway.enableSending(AddressIndex.from(7)),
  },
  {
    label: 'la transferencia responde 400',
    respond: () => Promise.resolve(jsonResponse(400, { message: 'bad request' })),
    act: (gateway: TatumCustodialAddressGateway) => gateway.send(transferCommand()),
  },
  {
    label: 'la transferencia responde 500',
    respond: () => Promise.resolve(jsonResponse(500, { message: 'boom' })),
    act: (gateway: TatumCustodialAddressGateway) => gateway.send(transferCommand()),
  },
  {
    label: 'la transferencia devuelve un cuerpo que no es JSON',
    respond: () => Promise.resolve(new Response('<html>bad gateway</html>')),
    act: (gateway: TatumCustodialAddressGateway) => gateway.send(transferCommand()),
  },
  {
    label: 'la activación devuelve un cuerpo sin txId',
    respond: () => Promise.resolve(jsonResponse(200, {})),
    act: (gateway: TatumCustodialAddressGateway) => gateway.enableSending(AddressIndex.from(7)),
  },
  {
    label: 'la comprobación de envío devuelve un cuerpo vacío',
    respond: () => Promise.resolve(jsonResponse(200, {})),
    act: (gateway: TatumCustodialAddressGateway) => gateway.isSendingEnabled(AddressIndex.from(7)),
  },
  {
    label: 'la derivación devuelve más de una dirección',
    respond: () => Promise.resolve(jsonResponse(200, [DERIVED, RECIPIENT])),
    act: (gateway: TatumCustodialAddressGateway) => gateway.deriveAddress(AddressIndex.from(7)),
  },
  {
    label: 'la transferencia expira por timeout',
    respond: (_call: number, init: RequestInit) => neverAnswer(init),
    act: (gateway: TatumCustodialAddressGateway) => gateway.send(transferCommand()),
  },
];

describe('fuga de la clave privada de la master', () => {
  it.each(SCENARIOS)(
    'debería no filtrar la clave ni la API key en ninguna superficie cuando $label',
    async ({ respond, act }) => {
      // Arrange
      const gateway = buildGateway(fakeFetch(respond));

      // Act
      const error = await captureRejection(act(gateway));

      // Assert
      expect(leakingSurfaces(error)).toEqual([]);
    },
  );

  it('debería redactar la clave en las cuatro superficies del propio value object', () => {
    // Arrange
    const key = MasterPrivateKey.from(FAKE_MASTER_PRIVATE_KEY);

    // Act
    const surfaces = leakingSurfaces(key);

    // Assert
    expect(surfaces).toEqual([]);
  });

  /**
   * El caso que demuestra que los otros no pasan por casualidad. Un error al que se le adjunta
   * la petición filtra por TRES de las cuatro superficies —`String()` no, porque el `toString`
   * de `Error` solo rinde nombre y mensaje— y la de pino es la que de verdad escribe en disco.
   *
   * También fija el límite de las rutas de redacción: `*.fromPrivateKey` casa a profundidad DOS
   * (`err.fromPrivateKey`), no a la tres de `err.request.body.fromPrivateKey`. Medido con
   * pino 10.3.1. Por eso la defensa de verdad es que el error no lleve nada, y la redacción es
   * la red por debajo.
   */
  it('debería cazar un error que sí arrastrara la petición dentro', () => {
    // Arrange
    const contaminated = Object.assign(new WalletProviderUnreachableError('upstream-error', 500), {
      request: { body: { fromPrivateKey: FAKE_MASTER_PRIVATE_KEY } },
    });

    // Act
    const surfaces = leakingSurfaces(contaminated);

    // Assert
    expect(surfaces).toEqual(['JSON.stringify', 'util.inspect', 'pino']);
  });
});

// Helpers

/** Los tres campos de `SendCommand`, con el destinatario en `recipient` y no en `to`. */
const transferCommand = () => ({
  from: EthereumAddress.from(DERIVED),
  recipient: EthereumAddress.from(RECIPIENT),
  asset: TransferAsset.native({ amount: TokenAmount.from('100000') }),
});

/**
 * ⚠️ `activationPayer: 'master'` a propósito, y no el default `'tatum'`: es la rama de la
 * activación que SÍ mete la clave privada en el cuerpo, o sea el peor caso de este spec. Con
 * `'tatum'` los dos escenarios de la activación no llevarían la clave en la petición y pasarían
 * por no tener nada que filtrar — verde por vacío, que es justo lo que este archivo existe para
 * no ser. La rama `'tatum'` está medida donde toca, en el spec del gateway.
 */
const buildGateway = (impl: FetchLike): TatumCustodialAddressGateway => {
  const configService = new ConfigService({
    wallets: {
      apiUrl: 'http://127.0.0.1:9',
      apiKey: FAKE_API_KEY,
      timeoutMs: 20,
      masterAddress: MASTER,
      masterPrivateKey: FAKE_MASTER_PRIVATE_KEY,
      activationPayer: 'master',
    },
  });
  const client = new TatumHttpClient(configService, impl);
  return new TatumCustodialAddressGateway(configService, client);
};

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const fakeFetch =
  (respond: (call: number, init: RequestInit) => Promise<Response>): FetchLike =>
  (_url, init) =>
    respond(1, init);

const neverAnswer = (init: RequestInit): Promise<Response> => {
  const signal = init.signal;
  return new Promise((_resolve, reject) => {
    // Cast y no `instanceof Error`: bajo jest el `DOMException` del host da `false` contra el
    // `Error` del realm del test (medido, jest 30.4.1 / Node 24.19.0).
    signal?.addEventListener('abort', () => {
      reject(signal.reason as Error);
    });
  });
};

const captureRejection = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('se esperaba un fallo del proveedor y la promesa se resolvió');
};

/**
 * UNA LÍNEA REAL de pino, con la configuración de redacción de la app, escrita a un `Writable`
 * en memoria. No es simetría con las otras tres superficies: es la única que ejercita el
 * serializador de errores de `pino-std-serializers`, que recorre toda propiedad enumerable del
 * error. Las otras tres no lo tocan.
 */
const logLine = (value: unknown): string => {
  const chunks: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString('utf8'));
      callback();
    },
  });
  const logger = pino(
    {
      level: 'fatal',
      redact: { paths: DEFAULT_REDACT_PATHS, censor: '[REDACTED]', remove: false },
    },
    destination,
  );
  logger.fatal({ err: value }, 'fallo del proveedor de direcciones custodiadas');
  return chunks.join('');
};

/** Devuelve el NOMBRE de cada superficie que filtró, para que el fallo diga cuál y no solo que. */
const leakingSurfaces = (value: unknown): string[] => {
  const surfaces: [string, string][] = [
    ['JSON.stringify', JSON.stringify(value) ?? ''],
    ['String()', String(value)],
    ['util.inspect', inspect(value, { depth: null })],
    ['pino', logLine(value)],
  ];
  return surfaces
    .filter(([, rendered]) => SECRETS.some((secret) => rendered.includes(secret)))
    .map(([surface]) => surface);
};
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/modules/wallets/__tests__/infrastructure/gateways/tatum-secret-surface.spec.ts`
Expected: FAIL antes de la Task 24 — `Cannot find module '../../../infrastructure/gateways/tatum-custodial-address.gateway'`. Con la Task 24 ya hecha, el rojo que hay que provocar a mano es el del Step 3.

- [ ] **Step 3: Rompe el adaptador a propósito y comprueba que el test lo caza**

No hay implementación nueva que escribir: lo que esta tarea aporta es la medición. Para verificar
que el test no pasa por casualidad, adjunta temporalmente la petición al error en
`tatum-http.client.ts` —lo que haría cualquiera «para diagnosticar mejor»—:

```ts
// src/modules/wallets/infrastructure/gateways/tatum-http.client.ts (CAMBIO TEMPORAL)
    } catch (error) {
      throw Object.assign(new WalletProviderUnreachableError(transportReason(error), null), {
        request: { path: request.path, body: request.body },
      });
    }
```

Run: `pnpm test src/modules/wallets/__tests__/infrastructure/gateways/tatum-secret-surface.spec.ts`
Expected: FAIL — el caso «cuando la transferencia expira por timeout» falla con
`expect(received).toEqual(expected)` y `Received: ["JSON.stringify", "util.inspect", "pino"]`.
Revierte el cambio antes de seguir.

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/modules/wallets/__tests__/infrastructure/gateways/tatum-secret-surface.spec.ts`
Expected: PASS — 11 passed (9 escenarios + el value object + el caso que caza la contaminación)

---

### Task 26: Las tres rutas de redacción de la clave privada

**Layer:** common
**Rule codes to honor:** `devops-use-logging`, `security-sanitize-output`

`DEFAULT_REDACT_PATHS` tapa contraseñas, tokens, claves de API y secretos, y **ninguna clave
privada** (§7.1, medido leyendo la lista). Esta tarea añade las tres rutas que faltan y su caso
contra un pino real, en el spec que ya existe.

⚠️ **La red, no el arreglo.** La defensa real es que los errores del proveedor no lleven el cuerpo
dentro (Task 25). Estas rutas cubren lo que se escape por otro lado —un `logger.info({ tatum })`
futuro, un error de librería que traiga el campo—, y solo a profundidad dos.

**Files:**

- Modify: `src/common/logger/pino-options.ts`
- Test: `src/common/__tests__/logger/pino-options.spec.ts`

- [ ] **Step 1: Escribe el test que falla**

Añade este `describe` a `src/common/__tests__/logger/pino-options.spec.ts`, justo detrás del
existente `describe('DEFAULT_REDACT_PATHS (contra un pino real)')`. Reutiliza el helper
`captureFatal` que ya vive al final de ese archivo, sin tocarlo.

```ts
// src/common/__tests__/logger/pino-options.spec.ts
/**
 * La clave privada de la master viaja en el CUERPO de cada transferencia y es el único secreto
 * del ciclo que no es un hash. Estos casos no leen la lista de rutas: montan un pino real y
 * comprueban que la redacción llega, que es la parte que la sintaxis de comodines decide.
 *
 * La defensa de verdad está en que los errores del adaptador no lleven el cuerpo dentro
 * (`tatum-secret-surface.spec.ts`); esto es la red por debajo.
 */
describe('DEFAULT_REDACT_PATHS (la clave privada de la master)', () => {
  it.each(['privateKey', 'masterPrivateKey', 'fromPrivateKey'])(
    'debería tapar err.%s',
    (property) => {
      // Arrange
      const error = Object.assign(new Error('fallo del proveedor'), {
        [property]: FAKE_MASTER_PRIVATE_KEY,
      });

      // Act
      const line = captureFatal(error);

      // Assert
      expect(line).not.toContain(FAKE_MASTER_PRIVATE_KEY);
      expect(JSON.parse(line)).toMatchObject({ err: { [property]: '[REDACTED]' } });
    },
  );

  // El límite, escrito en vez de descubierto: el comodín `*.x` casa a profundidad DOS y nada
  // más. Medido con pino 10.3.1: `{ a: { b: { privateKey } } }` sale del logger sin tapar. Es la
  // misma limitación que ya tienen `*.password` y compañía, y el motivo por el que un error que
  // arrastre la petición dentro NO queda cubierto por esta lista.
  it('debería NO tapar la clave anidada a un nivel más, que es el límite del comodín', () => {
    // Arrange
    const error = Object.assign(new Error('fallo del proveedor'), {
      request: { fromPrivateKey: FAKE_MASTER_PRIVATE_KEY },
    });

    // Act
    const line = captureFatal(error);

    // Assert
    expect(line).toContain(FAKE_MASTER_PRIVATE_KEY);
  });
});
```

Y junto a `FAKE_ARGON2_HASH`, bajo `// Helpers` de ese mismo archivo:

```ts
// src/common/__tests__/logger/pino-options.spec.ts
/** Entropía nula a propósito: gitleaks no debe disparar sobre un archivo de test. */
const FAKE_MASTER_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/common/__tests__/logger/pino-options.spec.ts`
Expected: FAIL — tres casos rojos, uno por ruta:
`expect(received).not.toContain(expected)` con `Received: {"level":60,…,"err":{…,"privateKey":"0xabab…"}}`.
El cuarto caso, el del límite, pasa desde el principio: es la documentación de un hueco, no de un
arreglo.

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/common/logger/pino-options.ts
export const DEFAULT_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
  '*.apiKey',
  '*.secret',
  // Las tres de la clave privada de la master (spec de wallets, §7.1). `privateKey` es el
  // nombre genérico; `masterPrivateKey` es como la nombra la configuración; `fromPrivateKey`
  // es como la nombra el CUERPO que Tatum exige, y por tanto la que aparecería si alguien
  // logueara la petición. Las tres, y no una: la redacción casa por NOMBRE de propiedad, así
  // que cada renombrado por el camino necesita su ruta.
  //
  // ⚠️ Cubren profundidad DOS —`err.fromPrivateKey`, `tatum.privateKey`— y no más: medido con
  // pino 10.3.1, `{ a: { b: { privateKey } } }` sale sin tapar, igual que `*.password`. Por eso
  // la invariante que de verdad protege es que los errores del adaptador no lleven el cuerpo
  // dentro, y esto es la red por debajo.
  '*.privateKey',
  '*.masterPrivateKey',
  '*.fromPrivateKey',
  'err.parameters[*]',
];
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/common/__tests__/logger/pino-options.spec.ts`
Expected: PASS — la suite entera en verde, con 4 casos nuevos (3 del `it.each` + el del límite)

---

### Task 27: El anti-corruption layer hacia `users` — `users-owner.directory.ts`

**Layer:** infrastructure
**Rule codes to honor:** `arch-avoid-circular-deps`, `arch-module-sharing`, `di-interface-segregation`, `di-prefer-constructor-injection`

Calcado de `orders/infrastructure/gateways/users-customer.directory.ts`, que es el precedente: el
puerto lo define `wallets`, la puerta la publica `users` por su module file, y la traducción es
campo a campo.

**Contrato que esta tarea consume:**

```ts
// domain/ports/owner.directory.ts (tarea de puertos)
export abstract class OwnerDirectory {
  abstract exists(ownerId: string): Promise<boolean>;
}
```

**Files:**

- Create: `src/modules/wallets/infrastructure/gateways/users-owner.directory.ts`
- Test: `src/modules/wallets/__tests__/infrastructure/gateways/users-owner.directory.spec.ts`

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/modules/wallets/__tests__/infrastructure/gateways/users-owner.directory.spec.ts
import type { UsersLookup } from '../../../../users/users.module';
import { UsersOwnerDirectory } from '../../../infrastructure/gateways/users-owner.directory';

const KNOWN_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';

describe('UsersOwnerDirectory', () => {
  describe('exists()', () => {
    it('debería devolver true cuando la puerta de users conoce al dueño', async () => {
      // Arrange
      const directory = new UsersOwnerDirectory(buildLookup([KNOWN_ID]));

      // Act
      const result = await directory.exists(KNOWN_ID);

      // Assert
      expect(result).toBe(true);
    });

    it('debería devolver false cuando la puerta de users no lo conoce', async () => {
      // Arrange
      const directory = new UsersOwnerDirectory(buildLookup([]));

      // Act
      const result = await directory.exists(KNOWN_ID);

      // Assert
      expect(result).toBe(false);
    });
  });
});

// Helpers

/**
 * Fake escrito a mano de la puerta de CONSULTA. Tiene dos métodos, no cuatro: `wallets` inyecta
 * `UsersLookup` y no `UsersProvisioning`, así que `createProfile` y `deleteProfile` no existen
 * en el tipo — un borrado de perfil desde `wallets` no compilaría, que es lo que la segregación
 * por intención compra y lo que la matriz de fronteras, que razona por ruta, no puede ver.
 *
 * `findByEmail` —el otro método de la puerta, que `wallets` no usa— va con `unreachable()` en
 * vez de con un valor plausible: si este adaptador empezara a llamarlo, el test falla nombrando
 * el método en lugar de pasar sobre un doble complaciente.
 *
 * `import type` AQUÍ es lo correcto y no contradice la regla del module file: este archivo no
 * tiene decoradores, así que `consistent-type-imports` lo exige. La asimetría con el adaptador
 * —que la importa como VALOR— es real, y el discriminador es «¿hay un decorador en el archivo?».
 */
const buildLookup = (knownIds: readonly string[]): UsersLookup => ({
  userExists: (id: string) => Promise.resolve(knownIds.includes(id)),
  findByEmail: () => unreachable('findByEmail'),
});

const unreachable = (method: string): never => {
  throw new Error(`UsersOwnerDirectory no debería llamar a UsersLookup.${method}()`);
};
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/modules/wallets/__tests__/infrastructure/gateways/users-owner.directory.spec.ts`
Expected: FAIL — `Cannot find module '../../../infrastructure/gateways/users-owner.directory' from 'src/modules/wallets/__tests__/infrastructure/gateways/users-owner.directory.spec.ts'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/modules/wallets/infrastructure/gateways/users-owner.directory.ts
import { Injectable } from '@nestjs/common';

import { UsersLookup } from '../../../users/users.module';

import { OwnerDirectory } from '../../domain/ports/owner.directory';

/**
 * Anti-corruption layer: implementa el puerto que `wallets` definió inyectando la puerta que
 * `users` publica POR SU MODULE FILE — el único import cross-módulo legal (regla 3 del gate +
 * enmienda G1/G2). Si `users` cambia por dentro, este archivo es la única pieza de `wallets`
 * que puede enterarse.
 *
 * Inyecta `UsersLookup` y NO `UsersProvisioning`: `wallets` solo pregunta si el dueño sigue
 * vivo. Que aquí haya un parámetro y en `UsersUserDirectory` de `auth` haya dos es exactamente
 * el punto de la segregación por intención — el constructor declara el permiso que cada
 * consumidor necesita, y lo comprueba el COMPILADOR.
 *
 * `UsersLookup` es a la vez el tipo del contrato y el token: sin `@Inject`, la referencia a la
 * clase viaja en `design:paramtypes` y Nest la resuelve contra el provider que `users.module.ts`
 * exporta. Por eso se importa como VALOR: un `import type` la borraría del emit y Nest fallaría
 * EN RUNTIME con `lint:check` y `typecheck` en verde.
 *
 * **Por qué existe siquiera.** Un JWT firmado sobrevive a la desactivación de su dueño, y el
 * esquema no tiene ni una sola clave foránea: sin esta comprobación, un usuario desactivado
 * seguiría activando direcciones y moviendo fondos hasta que su token expirara. Los tres casos
 * de uso que cuestan dinero o crean estado la consultan; las dos lecturas NO, y eso es
 * deliberado (§5) — el token ya probó el `sub` y son los endpoints más llamados.
 *
 * La traducción es campo a campo. Hoy es un booleano y no hay campo que copiar, pero el nombre
 * del método cambia —`userExists` fuera, `exists` dentro— y esa frontera es la que impide que un
 * cambio en la puerta de `users` se cuele en el dominio de `wallets` sin que nadie lo decida.
 */
@Injectable()
export class UsersOwnerDirectory implements OwnerDirectory {
  constructor(private readonly users: UsersLookup) {}

  exists(ownerId: string): Promise<boolean> {
    return this.users.userExists(ownerId);
  }
}
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/modules/wallets/__tests__/infrastructure/gateways/users-owner.directory.spec.ts`
Expected: PASS — 2 passed

---

### Task 28: Las dos ORM entities de `wallets`

**Layer:** infrastructure
**Rule codes to honor:** `arch-use-repository-pattern`, `perf-optimize-database`, `db-use-migrations`

**Files:**

- Create: `src/modules/wallets/infrastructure/persistence/wallet.orm-entity.ts`
- Create: `src/modules/wallets/infrastructure/persistence/wallet-transfer.orm-entity.ts`
- Test: `src/modules/wallets/__tests__/infrastructure/persistence/wallet.orm-entity.spec.ts`
- Test: `src/modules/wallets/__tests__/infrastructure/persistence/wallet-transfer.orm-entity.spec.ts`

⚠️ **Tres nombres de columna NO coinciden con el campo del dominio, y los tres son deliberados.**
La tabla `wallets` guarda el dueño en `user_id` —no en `owner_id`—, la tabla `wallet_transfers`
guarda la dirección emisora en `from_address` —`from` es palabra reservada de SQL— y el motivo en
`reason_code`. Como en el repo **ninguna columna lleva `name:`** (lo pone `SnakeNamingStrategy`), la
única forma de conseguir esos tres nombres es que la PROPIEDAD de la ORM entity se llame `userId`,
`fromAddress` y `reasonCode`. El mapper de la Task 29 es el que vuelve a cruzarlos con `ownerId`,
`from` y `reasonCode` del snapshot del dominio: eso es exactamente para lo que existe un mapper.

Las dos entidades se prueban leyendo `getMetadataArgsStorage()`, que es síncrono y no abre ninguna
conexión. No es ceremonia: las cinco reglas que estas clases tienen que cumplir —`@Entity({ name })`
presente, cero `name:` en las columnas, la lista exacta de columnas, cero
`@CreateDateColumn`/`@UpdateDateColumn`, y los índices con el nombre exacto que la traducción del
`23505` compara— son invisibles hasta que alguien mira el esquema en PostgreSQL, y el
`schema-conventions.e2e-spec.ts` solo caza dos de ellas (la del nombre de tabla y la del
snake_case). El nombre de un índice, que es lo que el adaptador de la Task 31 usa como
discriminador, no lo comprueba nadie más.

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/modules/wallets/__tests__/infrastructure/persistence/wallet.orm-entity.spec.ts
import { getMetadataArgsStorage } from 'typeorm';

import { WalletOrmEntity } from '../../../infrastructure/persistence/wallet.orm-entity';

/**
 * Se lee la metadata que los decoradores registran, no una base de datos: lo que se comprueba
 * aquí es la DECLARACIÓN. Que el esquema resultante sea el correcto lo comprueban
 * `schema-conventions.e2e-spec.ts` y `migrations.e2e-spec.ts`, y no se solapan — ninguno de los
 * dos sabe cómo se llama un índice ni si una columna nació de un `@CreateDateColumn`.
 */
describe('WalletOrmEntity', () => {
  describe('@Entity', () => {
    it('debería declarar el nombre de la tabla, que la estrategia de nombres no puede adivinar', () => {
      // Arrange
      const tables = getMetadataArgsStorage().tables;

      // Act
      const table = tables.find((candidate) => candidate.target === WalletOrmEntity);

      // Assert
      // Sin el `name`, `SnakeNamingStrategy` produciría `wallet_orm_entity`: no puede saber que
      // `OrmEntity` es decoración nuestra (lo dice su propia cabecera).
      expect(table?.name).toBe('wallets');
    });
  });

  describe('@Column', () => {
    it('debería no fijar name en ninguna columna, para que el snake_case lo ponga la estrategia', () => {
      // Arrange
      const columns = columnsOf(WalletOrmEntity);

      // Act
      const withExplicitName = columns
        .filter((column) => column.options.name !== undefined)
        .map((column) => column.propertyName);

      // Assert
      expect(withExplicitName).toEqual([]);
    });

    it('debería declarar las once propiedades cuyo snake_case da las columnas de la tabla', () => {
      // Arrange
      const columns = columnsOf(WalletOrmEntity);

      // Act
      const declared = columns.map((column) => column.propertyName).sort();

      // Assert
      // `userId`, no `ownerId`: la columna se llama `user_id` y aquí no hay `name:` que la
      // renombre, así que el nombre de la PROPIEDAD es el único sitio donde se decide. El
      // agregado sigue llamándolo `ownerId` y el mapper es quien cruza los dos vocabularios.
      expect(declared).toEqual([
        'activationTxId',
        'address',
        'addressIndex',
        'createdAt',
        'createdBy',
        'id',
        'ownerAddress',
        'status',
        'updatedAt',
        'updatedBy',
        'userId',
      ]);
    });

    it('debería declarar todas las columnas como regulares, sin fechas automáticas del ORM', () => {
      // Arrange
      const columns = columnsOf(WalletOrmEntity);

      // Act
      const automatic = columns
        .filter((column) => column.mode !== 'regular')
        .map((column) => `${column.propertyName}:${column.mode}`);

      // Assert
      // `@CreateDateColumn`/`@UpdateDateColumn` meterían un segundo reloj en el sistema: el
      // instante lo pone el dominio con el `now` que le inyecta el caso de uso.
      expect(automatic).toEqual([]);
    });

    it('debería dejar nullables exactamente las tres columnas que el dominio tipa como nulas', () => {
      // Arrange
      const columns = columnsOf(WalletOrmEntity);

      // Act
      const nullable = columns
        .filter((column) => column.options.nullable === true)
        .map((column) => column.propertyName)
        .sort();

      // Assert
      // `activationTxId` es `TransactionHash | null` en `Wallet`; los dos actores son
      // `string | null` en `AuditTrail`. Una columna NOT NULL de más rompe el INSERT; una de
      // menos deja pasar un hueco que el dominio no admite.
      expect(nullable).toEqual(['activationTxId', 'createdBy', 'updatedBy']);
    });
  });

  describe('@Index', () => {
    it('debería declarar los tres índices únicos con el nombre que la traducción del 23505 compara', () => {
      // Arrange
      const indices = getMetadataArgsStorage().indices.filter(
        (index) => index.target === WalletOrmEntity,
      );

      // Act
      const declared = indices
        .map((index) => ({ name: index.name, columns: index.columns, unique: index.unique }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));

      // Assert
      // El nombre no es cosmético: `WalletTypeOrmRepository` decide QUÉ hace con cada `23505`
      // mirando `driverError.constraint`, que es exactamente esta cadena. Renombrar un índice
      // aquí sin tocar el adaptador convierte el desenlace `'owner-conflict'` y los dos 500 con
      // nombre en un 500 anónimo.
      expect(declared).toEqual([
        { name: 'idx_wallets_address', columns: ['address'], unique: true },
        { name: 'idx_wallets_address_index', columns: ['addressIndex'], unique: true },
        { name: 'idx_wallets_user_id', columns: ['userId'], unique: true },
      ]);
    });
  });

  describe('@Check', () => {
    it('debería declarar el CHECK que impide entregar la master como dirección de un usuario', () => {
      // Arrange
      const checks = getMetadataArgsStorage().checks.filter(
        (check) => check.target === WalletOrmEntity,
      );

      // Act
      const declared = checks.map((check) => ({ name: check.name, expression: check.expression }));

      // Assert
      // Es el único de los cinco controles de §3.1.1 que ve una escritura por SQL crudo —un
      // seed, una consola, otra migración— porque es el único que vive en el motor.
      expect(declared).toEqual([
        {
          name: 'ck_wallets_address_not_master',
          expression: '"address" <> "owner_address"',
        },
      ]);
    });
  });
});

// Helpers

const columnsOf = (target: unknown) =>
  getMetadataArgsStorage().columns.filter((column) => column.target === target);
```

```ts
// src/modules/wallets/__tests__/infrastructure/persistence/wallet-transfer.orm-entity.spec.ts
import { getMetadataArgsStorage } from 'typeorm';

import { WalletTransferOrmEntity } from '../../../infrastructure/persistence/wallet-transfer.orm-entity';

describe('WalletTransferOrmEntity', () => {
  describe('@Entity', () => {
    it('debería declarar el nombre de la tabla en plural, como las otras cuatro del esquema', () => {
      // Arrange
      const tables = getMetadataArgsStorage().tables;

      // Act
      const table = tables.find((candidate) => candidate.target === WalletTransferOrmEntity);

      // Assert
      expect(table?.name).toBe('wallet_transfers');
    });
  });

  describe('@Column', () => {
    it('debería no fijar name en ninguna columna, para que el snake_case lo ponga la estrategia', () => {
      // Arrange
      const columns = columnsOf(WalletTransferOrmEntity);

      // Act
      const withExplicitName = columns
        .filter((column) => column.options.name !== undefined)
        .map((column) => column.propertyName);

      // Assert
      expect(withExplicitName).toEqual([]);
    });

    it('debería declarar las quince propiedades del libro, con la emisora y el código de motivo', () => {
      // Arrange
      const columns = columnsOf(WalletTransferOrmEntity);

      // Act
      const declared = columns.map((column) => column.propertyName).sort();

      // Assert
      // Dos nombres se leen mal si no se sabe de dónde salen. `fromAddress` da `from_address`
      // porque `from` es palabra reservada de SQL y una columna así obligaría a citarla en cada
      // consulta cruda. `reasonCode` da `reason_code` y dice lo que guarda: un código de una
      // lista cerrada, jamás el `message` del proveedor.
      expect(declared).toEqual([
        'amount',
        'assetKind',
        'createdAt',
        'createdBy',
        'fromAddress',
        'id',
        'ownerId',
        'reasonCode',
        'recipient',
        'status',
        'tokenAddress',
        'tokenId',
        'txId',
        'updatedAt',
        'updatedBy',
      ]);
    });

    it('debería declarar todas las columnas como regulares, sin fechas automáticas del ORM', () => {
      // Arrange
      const columns = columnsOf(WalletTransferOrmEntity);

      // Act
      const automatic = columns
        .filter((column) => column.mode !== 'regular')
        .map((column) => `${column.propertyName}:${column.mode}`);

      // Assert
      expect(automatic).toEqual([]);
    });

    it('debería dejar nullables las tres columnas del activo excluyentes y las cuatro que se llenan después', () => {
      // Arrange
      const columns = columnsOf(WalletTransferOrmEntity);

      // Act
      const nullable = columns
        .filter((column) => column.options.nullable === true)
        .map((column) => column.propertyName)
        .sort();

      // Assert
      // `tokenAddress`, `amount` y `tokenId` son nulos en las clases de activo que los prohíben
      // (§3.4: el nativo no lleva contrato, el NFT no lleva importe). `txId` y `reasonCode` nacen
      // nulos porque la fila se escribe ANTES de llamar al proveedor, que es lo que hace útil el
      // libro: sin esa nulabilidad no habría escritura por delante que valiera.
      expect(nullable).toEqual([
        'amount',
        'createdBy',
        'reasonCode',
        'tokenAddress',
        'tokenId',
        'txId',
        'updatedBy',
      ]);
    });
  });

  describe('@Index', () => {
    it('debería declarar un único índice, por dueño y fecha, y NO único', () => {
      // Arrange
      const indices = getMetadataArgsStorage().indices.filter(
        (index) => index.target === WalletTransferOrmEntity,
      );

      // Act
      const declared = indices.map((index) => ({
        name: index.name,
        columns: index.columns,
        unique: index.unique,
      }));

      // Assert
      // Un dueño tiene MUCHAS transferencias: marcarlo único rompería el segundo envío de
      // cualquier usuario. Y el orden de las columnas es el del listado paginado
      // (`WHERE owner_id = $1 ORDER BY created_at DESC`), no al revés.
      expect(declared).toEqual([
        {
          name: 'idx_wallet_transfers_owner_id_created_at',
          columns: ['ownerId', 'createdAt'],
          unique: false,
        },
      ]);
    });
  });
});

// Helpers

const columnsOf = (target: unknown) =>
  getMetadataArgsStorage().columns.filter((column) => column.target === target);
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/modules/wallets/__tests__/infrastructure/persistence/`
Expected: FAIL — `Cannot find module '../../../infrastructure/persistence/wallet.orm-entity' from 'src/modules/wallets/__tests__/infrastructure/persistence/wallet.orm-entity.spec.ts'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/modules/wallets/infrastructure/persistence/wallet.orm-entity.ts
import { Check, Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Modelo de persistencia de la dirección custodiada. Deliberadamente distinto de `Wallet` —dos
 * modelos, un mapper—: aquí viven los decoradores del ORM y la forma de la tabla.
 *
 * **`@Entity({ name })` es obligatorio.** Sin él, `SnakeNamingStrategy` derivaría
 * `wallet_orm_entity` del nombre de la clase: la estrategia no puede saber que `OrmEntity` es
 * decoración nuestra. Lo dice su propia cabecera y lo fija un caso del spec de este archivo.
 *
 * **Ninguna columna lleva `name:`, y todas nacen en snake_case.** Lo pone la estrategia, que
 * `buildTypeOrmOptions` registra en el único sitio que comparten la CLI de TypeORM y el runtime
 * de Nest. Escribirlo a mano era la puerta por la que el esquema acabó mezclando las dos
 * convenciones hasta el 2026-08-24.
 *
 * ⚠️ **Por eso la propiedad se llama `userId` y no `ownerId`: la columna es `user_id`.** Sin
 * `name:` disponible, el nombre de la propiedad ES el nombre de la columna una vez pasada la
 * estrategia, así que `ownerId` daría `owner_id` y el índice único de la migración
 * (`idx_wallets_user_id`) apuntaría a una columna que no existe. El agregado sigue llamándolo
 * `ownerId`; cruzarlos es trabajo del mapper, que es el único sitio que conoce los dos lados.
 *
 * **Ninguna es `@CreateDateColumn`/`@UpdateDateColumn`.** El instante lo pone el dominio con el
 * `now` que le inyecta el caso de uso; dejarlo a la base metería un segundo reloj en el sistema.
 * Y hay un modo de fallo concreto además del argumento de diseño, ya medido en
 * `user.orm-entity.ts`: con `@UpdateDateColumn`, un `repository.update()` parcial hace que
 * TypeORM añada por su cuenta `updated_at = CURRENT_TIMESTAMP` y `updated_by` se quede con el
 * actor anterior — una fila afirmando que quien la escribió por última vez es alguien que no la
 * escribió.
 *
 * **`created_by` / `updated_by` son NULLABLES, y aquí el motivo NO es el de `orders`.** Allí lo
 * eran porque `AddAuditActorColumns` las añadía a una tabla viva y un `NOT NULL` sin `DEFAULT`
 * habría roto los INSERT del código anterior. Esta tabla nace entera en su migración, así que ese
 * argumento no aplica: son nullables porque `AuditTrail` las tipa `string | null`
 * (`shared/domain/entity.base.ts`), y `null` significa «no se sabe quién». Hoy `POST /wallets`
 * siempre trae un actor —sale del `sub` del token— así que la columna no vería NULL por ese
 * camino; ponerla `NOT NULL` la haría mentir el día que escriba un proceso. La columna es más
 * permisiva que el dato, que es el lado seguro del error.
 *
 * **Los tres índices son ÚNICOS y sus NOMBRES son parte del contrato.**
 * `WalletTypeOrmRepository` distingue los tres `23505` mirando `driverError.constraint`, que vale
 * exactamente estas cadenas; sin el nombre no hay forma de saber cuál de las tres restricciones
 * se violó, y las tres significan cosas completamente distintas (§6.3 del spec): la de `user_id`
 * es una carrera normal que el caso de uso absorbe, las otras dos son invariantes rotas.
 *
 * **El `CHECK` es el primero del esquema** —las cuatro migraciones anteriores solo declaran
 * claves primarias— y no es simetría con el dominio: es el único de los cinco controles de
 * §3.1.1 que ve una escritura que NO pasa por el agregado. Qué se rompe sin él: un seed, una
 * consola o una migración que escriba la master como dirección de un usuario le entrega el fondo
 * de gas de la plataforma, y al siguiente usuario también, en silencio.
 *
 * `varchar(42)` = `0x` + 40 hexadecimales; `varchar(66)` = `0x` + 64. Son las longitudes que
 * `EthereumAddress` y `TransactionHash` ya garantizan: la columna no valida, acota.
 */
@Entity({ name: 'wallets' })
@Check('ck_wallets_address_not_master', '"address" <> "owner_address"')
export class WalletOrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Index('idx_wallets_user_id', { unique: true })
  @Column({ type: 'uuid' })
  userId!: string;

  /**
   * La master bajo la que se derivó `address`. Va en la fila y no solo en la configuración
   * porque sin ella el `CHECK` no tendría con qué comparar y `assertOwnedBy()` no podría saber
   * que una rotación de la master dejó esta dirección fuera de nuestro control.
   */
  @Column({ type: 'varchar', length: 42 })
  ownerAddress!: string;

  @Index('idx_wallets_address_index', { unique: true })
  @Column({ type: 'int' })
  addressIndex!: number;

  @Index('idx_wallets_address', { unique: true })
  @Column({ type: 'varchar', length: 42 })
  address!: string;

  @Column({ type: 'varchar', length: 16 })
  status!: string;

  @Column({ type: 'varchar', length: 66, nullable: true })
  activationTxId!: string | null;

  @Column({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'varchar', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'varchar', nullable: true })
  updatedBy!: string | null;
}
```

```ts
// src/modules/wallets/infrastructure/persistence/wallet-transfer.orm-entity.ts
import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Modelo de persistencia del libro de transferencias. Las mismas cuatro reglas que
 * `wallet.orm-entity.ts` —`@Entity({ name })` obligatorio, cero `name:` en las columnas, cero
 * fechas automáticas del ORM, actores nullables— y ahí vive el razonamiento largo.
 *
 * ⚠️ **`fromAddress`, no `from`.** `FROM` es palabra reservada de SQL: una columna llamada así
 * obligaría a citarla con comillas dobles en cada consulta cruda —y este repo escribe SQL crudo
 * en las migraciones, en los E2E de repositorio y en los guardianes de esquema—, donde olvidar
 * las comillas no da un error de columna sino un error de sintaxis a diez líneas de distancia. El
 * snapshot del dominio la llama `from`; el mapper cruza los dos nombres.
 *
 * **La dirección emisora se guarda, y no se deriva de la wallet actual.** Es estado del hecho, no
 * de la cuenta: el día que una wallet cambie de dirección —rotación de la master, migración de
 * índice—, el libro tiene que seguir diciendo desde dónde salió CADA envío. Derivarla al leer
 * reescribiría el pasado.
 *
 * **El activo viaja DESPLEGADO en cuatro columnas y no en un `jsonb`.** `TransferAsset` hace
 * imposibles las cuatro combinaciones excluyentes en TypeScript (§3.4), pero eso no llega al
 * esquema: lo que la tabla guarda son los datos ya desplegados por el snapshot del agregado. Un
 * `jsonb` habría ahorrado tres columnas a cambio de no poder consultar ni indexar por clase de
 * activo, y de que un cambio de forma pasara desapercibido hasta el primer `fromParts()`.
 *
 * **Las tres columnas del activo son nullables por construcción, no por comodidad:** el activo
 * nativo no lleva contrato, el NFT no lleva importe, y el fungible no lleva `tokenId`. La
 * exclusión mutua NO se declara en el esquema con un `CHECK`: la garantía real la da el dominio,
 * que es el único camino de escritura, y un `CHECK` de cuatro ramas aquí duplicaría esa regla en
 * un sitio donde nadie la lee al cambiarla.
 *
 * **`txId` y `reasonCode` nacen nulos porque la fila se escribe ANTES de llamar al proveedor.** Es
 * lo que convierte el libro en algo útil: con la escritura posterior, un timeout no dejaría rastro
 * — que es justo el caso para el que existe (§3.2). Si estas dos fueran `NOT NULL`, la escritura
 * por delante sería imposible y el libro solo registraría lo que ya sabemos que salió bien.
 *
 * **`reason_code` es un código de `PROVIDER_FAILURE_REASONS`, JAMÁS el `message` del proveedor.**
 * No es purismo: el mensaje del 401 de Tatum interpola la clave de API —medido sobre su
 * `openapi.json`, `"Unable to find valid subscription for '${apiKey}'"`— así que guardarlo
 * escribiría un secreto en una tabla que además se publica por `GET /wallets/me/transfers`. El
 * nombre de la columna lo dice y `varchar(40)` lo acota: no cabe un mensaje.
 *
 * `amount` es `varchar(79)` y `tokenId` `varchar(78)`: son las cotas que `TokenAmount` y `TokenId`
 * validan. Van como texto y no como número porque un token de 18 decimales no pasa por un
 * flotante, y `numeric` obligaría a decidir precisión y escala para un valor cuya canonicidad ya
 * garantiza el VO como string.
 *
 * El índice compuesto no lleva `DESC` aunque el listado ordene descendente: PostgreSQL recorre un
 * btree en los dos sentidos, y TypeORM no modela el sentido en su metadata — un `DESC` que solo
 * existiera en el SQL sería una divergencia gratuita entre entidad y esquema. No lo he medido
 * contra `migration:generate`; lo que sí es seguro es que no aporta nada a la consulta.
 */
@Entity({ name: 'wallet_transfers' })
@Index('idx_wallet_transfers_owner_id_created_at', ['ownerId', 'createdAt'])
export class WalletTransferOrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'uuid' })
  ownerId!: string;

  @Column({ type: 'varchar', length: 42 })
  fromAddress!: string;

  @Column({ type: 'varchar', length: 42 })
  recipient!: string;

  @Column({ type: 'varchar', length: 16 })
  assetKind!: string;

  @Column({ type: 'varchar', length: 42, nullable: true })
  tokenAddress!: string | null;

  @Column({ type: 'varchar', length: 79, nullable: true })
  amount!: string | null;

  @Column({ type: 'varchar', length: 78, nullable: true })
  tokenId!: string | null;

  @Column({ type: 'varchar', length: 16 })
  status!: string;

  @Column({ type: 'varchar', length: 66, nullable: true })
  txId!: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  reasonCode!: string | null;

  @Column({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'varchar', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'varchar', nullable: true })
  updatedBy!: string | null;
}
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/modules/wallets/__tests__/infrastructure/persistence/`
Expected: PASS — 13 passed (7 de `WalletOrmEntity`, 6 de `WalletTransferOrmEntity`)

---

### Task 29: Los dos mappers, campo a campo

**Layer:** infrastructure
**Rule codes to honor:** `arch-use-repository-pattern`, `arch-single-responsibility`

**Files:**

- Create: `src/modules/wallets/infrastructure/persistence/wallet.mapper.ts`
- Create: `src/modules/wallets/infrastructure/persistence/wallet-transfer.mapper.ts`
- Test: `src/modules/wallets/__tests__/infrastructure/persistence/wallet.mapper.spec.ts`
- Test: `src/modules/wallets/__tests__/infrastructure/persistence/wallet-transfer.mapper.spec.ts`

⚠️ **Objeto literal con `toDomain` y `toPersistence`, campo a campo, NUNCA un spread.** El spread
copiaría la forma del snapshot sobre la fila, así que un campo nuevo del dominio aparecería en la
tabla sin que nadie lo decidiera —y uno renombrado dejaría de escribirse en silencio, con la
columna quedándose en `undefined`, que TypeORM traduce a «no toques esta columna» y no a NULL—.
Escribir las asignaciones una a una es lo que obliga a pasar por aquí cuando el modelo cambia, y es
lo único que puede cruzar los tres nombres que NO coinciden: `ownerId` ↔ `userId` en `wallets`, y
`from` ↔ `fromAddress` en `wallet_transfers`.

**`toPersistence` parte de `toSnapshot()`**, como `OrderMapper`: el agregado publica su estado ya
desplegado en primitivas —incluido el activo, que el snapshot da en sus cuatro campos— y el mapper
solo lo coloca en columnas. Así el despliegue del activo se decide UNA vez, dentro del agregado, y
no dos.

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/modules/wallets/__tests__/infrastructure/persistence/wallet.mapper.spec.ts
import { test as fcTest, fc } from '@fast-check/jest';

import { Wallet } from '../../../domain/entities/wallet.entity';
import { AddressIndex } from '../../../domain/value-objects/address-index.vo';
import { EthereumAddress } from '../../../domain/value-objects/ethereum-address.vo';
import { TransactionHash } from '../../../domain/value-objects/transaction-hash.vo';
import { WalletId } from '../../../domain/value-objects/wallet-id.vo';
import type { WalletStatus } from '../../../domain/wallet-status';
import { WalletMapper } from '../../../infrastructure/persistence/wallet.mapper';
import { WalletOrmEntity } from '../../../infrastructure/persistence/wallet.orm-entity';

const OWNER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const MASTER = '0x1111111111111111111111111111111111111111';
const ADDRESS = '0xa0b1c2d3e4f5061728394a5b6c7d8e9f00112233';
const TX_ID = '0x' + 'ab'.repeat(32);
// Distintas entre sí a propósito: si coincidieran, un mapper que confundiera las dos marcas
// pasaría igual.
const CREATED_AT = new Date('2026-08-27T09:00:00.000Z');
const UPDATED_AT = new Date('2026-08-27T11:30:00.500Z');
// Distintos entre sí y distintos de `OWNER_ID`: con valores repetidos, un mapper que derivase los
// actores del dueño pasaría igual.
const CREATED_BY = '3f1a9b2c-8d4e-4f6a-9b1c-2e5d7a0f3b48';
const UPDATED_BY = '5b7c2d4e-9a1f-4c3b-8e6d-0f2a4b6c8d1e';

describe('WalletMapper', () => {
  describe('toPersistence()', () => {
    it('debería volcar el agregado a columnas primitivas, con el dueño en la columna user_id', () => {
      // Arrange
      const wallet = buildWallet();

      // Act
      const row = WalletMapper.toPersistence(wallet);

      // Assert
      // `row.userId` y no `row.ownerId`: la tabla guarda el dueño en `user_id`, y esta línea es
      // el único sitio del módulo donde los dos vocabularios se tocan.
      expect(row).toBeInstanceOf(WalletOrmEntity);
      expect(row.id).toBe(wallet.id.value);
      expect(row.userId).toBe(OWNER_ID);
      expect(row.ownerAddress).toBe(MASTER);
      expect(row.addressIndex).toBe(7);
      expect(row.address).toBe(ADDRESS);
      expect(row.status).toBe('activating');
      expect(row.activationTxId).toBe(TX_ID);
    });

    it('debería escribir las dos marcas de tiempo y los dos actores de la traza', () => {
      // Arrange — las cuatro salen de `Entity`, no del estado de negocio, y son justo las que un
      // mapper escrito a ojo se deja: las dos primeras son NOT NULL y reventarían el INSERT, pero
      // las dos de actor son nullables y se escribirían NULL en silencio. Este caso las nombra.
      const wallet = buildWallet();

      // Act
      const row = WalletMapper.toPersistence(wallet);

      // Assert
      expect(row.createdAt).toEqual(CREATED_AT);
      expect(row.updatedAt).toEqual(UPDATED_AT);
      expect(row.createdBy).toBe(CREATED_BY);
      expect(row.updatedBy).toBe(UPDATED_BY);
    });

    it('debería escribir null en activation_tx_id cuando la wallet todavía no tiene transacción', () => {
      // Arrange
      const wallet = buildWallet({ status: 'receive-only', activationTxId: null });

      // Act
      const row = WalletMapper.toPersistence(wallet);

      // Assert
      // Es el estado con el que nace toda wallet, así que un `?.value` mal escrito aquí
      // rompería el alta entera y no un caso de borde.
      expect(row.activationTxId).toBeNull();
    });
  });

  describe('toDomain()', () => {
    it('debería reconstruir el agregado desde la fila sin volver a comprobar la invariante del alta', () => {
      // Arrange
      const row = buildRow();

      // Act
      const wallet = WalletMapper.toDomain(row);

      // Assert
      // `rehydrate`, no `assign`: los datos persistidos ya eran válidos al guardarse, y `assign`
      // volvería a ejercer la comprobación «la dirección no es la master», que en una fila que ya
      // existe no es una invariante que reimponer sino una corrupción que hay que poder LEER
      // para diagnosticarla.
      expect(wallet.toSnapshot()).toEqual({
        id: row.id,
        ownerId: OWNER_ID,
        ownerAddress: MASTER,
        addressIndex: 7,
        address: ADDRESS,
        status: 'activating',
        activationTxId: TX_ID,
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
        createdBy: CREATED_BY,
        updatedBy: UPDATED_BY,
      });
    });

    it('debería reconstruir una fila cuyo activation_tx_id y cuyos actores son null', () => {
      // Arrange
      const row = buildRow();
      row.status = 'receive-only';
      row.activationTxId = null;
      row.createdBy = null;
      row.updatedBy = null;

      // Act
      const wallet = WalletMapper.toDomain(row);

      // Assert
      // Los tres viajan tal cual, sin coalescer: `null` en un actor significa «no se sabe quién»
      // y es un valor legítimo del dominio, no un hueco que rellenar.
      expect(wallet.activationTxId).toBeNull();
      expect(wallet.createdBy).toBeNull();
      expect(wallet.updatedBy).toBeNull();
    });
  });

  describe('toDomain() ∘ toPersistence() (property-based)', () => {
    fcTest.prop([
      fc.record({
        addressIndex: fc.integer({ min: 0, max: 2_147_483_647 }),
        address: derivedAddressArb,
        lifecycle: lifecycleArb,
        createdAt: timestampArb,
        updatedAt: timestampArb,
        // Arbitrarios CONSTRUIDOS: los dos únicos valores que la columna puede tener son «un id»
        // y «NULL», y ambos tienen que sobrevivir la ida y vuelta.
        createdBy: fc.constantFrom<string | null>(CREATED_BY, null),
        updatedBy: fc.constantFrom<string | null>(UPDATED_BY, null),
      }),
    ])('debería preservar todos los campos para cualquier wallet del dominio', (props) => {
      // Arrange
      const original = Wallet.rehydrate({
        id: WalletId.generate(),
        ownerId: OWNER_ID,
        ownerAddress: EthereumAddress.from(MASTER),
        addressIndex: AddressIndex.from(props.addressIndex),
        address: EthereumAddress.from(props.address),
        status: props.lifecycle.status,
        activationTxId:
          props.lifecycle.activationTxId === null
            ? null
            : TransactionHash.from(props.lifecycle.activationTxId),
        createdAt: props.createdAt,
        updatedAt: props.updatedAt,
        createdBy: props.createdBy,
        updatedBy: props.updatedBy,
      });

      // Act
      const restored = WalletMapper.toDomain(WalletMapper.toPersistence(original));

      // Assert
      // Es lo único que ata las once asignaciones de ida con las once de vuelta: cruzar dos
      // columnas del mismo tipo —`created_by` con `updated_by`, `address` con `owner_address`—
      // pasa los casos puntuales y muere aquí.
      expect(restored.toSnapshot()).toEqual(original.toSnapshot());
    });
  });
});

// Helpers

/**
 * Los arbitrarios son locales y no viven en `__tests__/helpers/arbitraries.ts` porque son las
 * combinaciones que necesita la ida y vuelta de ESTE mapper. Construidos, nunca filtrados de un
 * `fc.string()`: la dirección derivada empieza siempre por `a` y la master por `1`, así que
 * jamás coinciden y el caso no depende de que el generador tenga suerte.
 */
const hexArb = (length: number) =>
  fc
    .array(fc.constantFrom(...'0123456789abcdef'.split('')), {
      minLength: length,
      maxLength: length,
    })
    .map((chars) => chars.join(''));

const derivedAddressArb = hexArb(39).map((tail) => `0xa${tail}`);
const txHashArb = hexArb(64).map((body) => `0x${body}`);
const timestampArb = fc.date({
  min: new Date('2000-01-01T00:00:00.000Z'),
  max: new Date('2100-01-01T00:00:00.000Z'),
  noInvalidDate: true,
});

/**
 * Estado y transacción de activación viajan JUNTOS y no como dos arbitrarios sueltos: una wallet
 * `receive-only` con hash de activación es una combinación que el dominio no produce, y generarla
 * probaría el mapper contra filas que no existen.
 */
const lifecycleArb: fc.Arbitrary<{ status: WalletStatus; activationTxId: string | null }> =
  fc.oneof(
    fc.constant<{ status: WalletStatus; activationTxId: string | null }>({
      status: 'receive-only',
      activationTxId: null,
    }),
    txHashArb.map((activationTxId) => ({ status: 'activating' as WalletStatus, activationTxId })),
    txHashArb.map((activationTxId) => ({ status: 'active' as WalletStatus, activationTxId })),
  );

const buildWallet = (
  overrides: { status?: WalletStatus; activationTxId?: string | null } = {},
): Wallet =>
  Wallet.rehydrate({
    id: WalletId.generate(),
    ownerId: OWNER_ID,
    ownerAddress: EthereumAddress.from(MASTER),
    addressIndex: AddressIndex.from(7),
    address: EthereumAddress.from(ADDRESS),
    status: overrides.status ?? 'activating',
    activationTxId:
      overrides.activationTxId === undefined
        ? TransactionHash.from(TX_ID)
        : overrides.activationTxId === null
          ? null
          : TransactionHash.from(overrides.activationTxId),
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    createdBy: CREATED_BY,
    updatedBy: UPDATED_BY,
  });

const buildRow = (): WalletOrmEntity => {
  const row = new WalletOrmEntity();
  row.id = WalletId.generate().value;
  row.userId = OWNER_ID;
  row.ownerAddress = MASTER;
  row.addressIndex = 7;
  row.address = ADDRESS;
  row.status = 'activating';
  row.activationTxId = TX_ID;
  row.createdAt = CREATED_AT;
  row.updatedAt = UPDATED_AT;
  row.createdBy = CREATED_BY;
  row.updatedBy = UPDATED_BY;
  return row;
};
```

```ts
// src/modules/wallets/__tests__/infrastructure/persistence/wallet-transfer.mapper.spec.ts
import { test as fcTest, fc } from '@fast-check/jest';

import { WalletTransfer } from '../../../domain/entities/wallet-transfer.entity';
import { PROVIDER_FAILURE_REASONS } from '../../../domain/errors/wallet.errors';
import type { ProviderFailureReason } from '../../../domain/errors/wallet.errors';
import type { TransferStatus } from '../../../domain/transfer-status';
import { EthereumAddress } from '../../../domain/value-objects/ethereum-address.vo';
import { TransactionHash } from '../../../domain/value-objects/transaction-hash.vo';
import { TransferId } from '../../../domain/value-objects/transfer-id.vo';
import { WalletTransferMapper } from '../../../infrastructure/persistence/wallet-transfer.mapper';
import { WalletTransferOrmEntity } from '../../../infrastructure/persistence/wallet-transfer.orm-entity';

const OWNER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const FROM = '0xa0b1c2d3e4f5061728394a5b6c7d8e9f00112233';
const RECIPIENT = '0xb1c2d3e4f5061728394a5b6c7d8e9f0011223344';
const TOKEN = '0xc2d3e4f5061728394a5b6c7d8e9f001122334455';
const TX_ID = '0x' + 'cd'.repeat(32);
const CREATED_AT = new Date('2026-08-27T09:00:00.000Z');
const UPDATED_AT = new Date('2026-08-27T09:00:02.250Z');
const ACTOR = '5b7c2d4e-9a1f-4c3b-8e6d-0f2a4b6c8d1e';

describe('WalletTransferMapper', () => {
  describe('toPersistence()', () => {
    it('debería escribir contrato e importe del activo fungible, dejando token_id nulo', () => {
      // Arrange
      const transfer = buildTransfer({
        assetKind: 'fungible',
        tokenAddress: TOKEN,
        amount: '1500000000000000000',
        tokenId: null,
      });

      // Act
      const row = WalletTransferMapper.toPersistence(transfer);

      // Assert
      expect(row).toBeInstanceOf(WalletTransferOrmEntity);
      expect(row.assetKind).toBe('fungible');
      expect(row.tokenAddress).toBe(TOKEN);
      expect(row.amount).toBe('1500000000000000000');
      expect(row.tokenId).toBeNull();
    });

    it('debería escribir contrato e identificador del NFT, dejando amount nulo', () => {
      // Arrange
      const transfer = buildTransfer({
        assetKind: 'nft',
        tokenAddress: TOKEN,
        amount: null,
        tokenId: '42',
      });

      // Act
      const row = WalletTransferMapper.toPersistence(transfer);

      // Assert
      expect(row.assetKind).toBe('nft');
      expect(row.tokenAddress).toBe(TOKEN);
      expect(row.amount).toBeNull();
      expect(row.tokenId).toBe('42');
    });

    it('debería escribir las tres columnas del activo multi-token', () => {
      // Arrange
      const transfer = buildTransfer({
        assetKind: 'multi-token',
        tokenAddress: TOKEN,
        amount: '3',
        tokenId: '0',
      });

      // Act
      const row = WalletTransferMapper.toPersistence(transfer);

      // Assert
      // El literal lleva GUION: `'multi-token'` es el vocabulario del dominio, del DTO y de la
      // columna. `multiToken` en camelCase existe solo como clave del matcher de `TransferAsset`,
      // que es un identificador de TypeScript y no un valor.
      // `tokenId` es `'0'` a propósito: el token 0 existe y es la asimetría deliberada con
      // `TokenAmount`, que sí rechaza el cero. Un mapper que escribiera `tokenId || null` lo
      // convertiría en NULL y `fromParts()` fallaría al releer con «falta el tokenId».
      expect(row.assetKind).toBe('multi-token');
      expect(row.tokenAddress).toBe(TOKEN);
      expect(row.amount).toBe('3');
      expect(row.tokenId).toBe('0');
    });

    it('debería escribir solo el importe del activo nativo, sin contrato ni token_id', () => {
      // Arrange
      const transfer = buildTransfer({
        assetKind: 'native',
        tokenAddress: null,
        amount: '0.5',
        tokenId: null,
      });

      // Act
      const row = WalletTransferMapper.toPersistence(transfer);

      // Assert
      expect(row.assetKind).toBe('native');
      expect(row.tokenAddress).toBeNull();
      expect(row.amount).toBe('0.5');
      expect(row.tokenId).toBeNull();
    });

    it('debería escribir la dirección emisora en from_address y la destinataria en recipient', () => {
      // Arrange — las dos son direcciones de 42 caracteres y del mismo tipo: cruzarlas no rompe
      // ningún tipo ni ninguna longitud, y deja el libro diciendo que el usuario se mandó el
      // dinero a sí mismo. Este caso es lo único que las distingue.
      const transfer = buildTransfer({
        assetKind: 'native',
        tokenAddress: null,
        amount: '1',
        tokenId: null,
      });

      // Act
      const row = WalletTransferMapper.toPersistence(transfer);

      // Assert
      expect(row.fromAddress).toBe(FROM);
      expect(row.recipient).toBe(RECIPIENT);
    });

    it('debería escribir las dos marcas de tiempo y los dos actores de la traza', () => {
      // Arrange
      const transfer = buildTransfer({
        assetKind: 'native',
        tokenAddress: null,
        amount: '1',
        tokenId: null,
      });

      // Act
      const row = WalletTransferMapper.toPersistence(transfer);

      // Assert
      expect(row.createdAt).toEqual(CREATED_AT);
      expect(row.updatedAt).toEqual(UPDATED_AT);
      expect(row.createdBy).toBe(ACTOR);
      expect(row.updatedBy).toBe(ACTOR);
    });
  });

  describe('toDomain()', () => {
    it('debería reconstruir la transferencia desde las quince columnas', () => {
      // Arrange
      const row = buildRow();

      // Act
      const transfer = WalletTransferMapper.toDomain(row);

      // Assert
      expect(transfer.toSnapshot()).toEqual({
        id: row.id,
        ownerId: OWNER_ID,
        from: FROM,
        recipient: RECIPIENT,
        assetKind: 'fungible',
        tokenAddress: TOKEN,
        amount: '1500000000000000000',
        tokenId: null,
        status: 'submitted',
        txId: TX_ID,
        reasonCode: null,
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
        createdBy: ACTOR,
        updatedBy: ACTOR,
      });
    });

    it('debería reconstruir una fila en submitting, sin txId y sin código de motivo', () => {
      // Arrange
      const row = buildRow();
      row.status = 'submitting';
      row.txId = null;
      row.reasonCode = null;

      // Act
      const transfer = WalletTransferMapper.toDomain(row);

      // Assert
      // Es el estado con el que TODA transferencia nace, por la escritura por delante: si el
      // mapper no supiera releerlo, el libro no podría reconstruir precisamente las filas que
      // justifican su existencia.
      const snapshot = transfer.toSnapshot();
      expect(snapshot.status).toBe('submitting');
      expect(snapshot.txId).toBeNull();
      expect(snapshot.reasonCode).toBeNull();
    });

    it('debería reconstruir una fila rechazada, con su código de motivo y sin txId', () => {
      // Arrange
      const row = buildRow();
      row.status = 'rejected';
      row.txId = null;
      row.reasonCode = 'body-rejected';

      // Act
      const transfer = WalletTransferMapper.toDomain(row);

      // Assert
      // `'body-rejected'` sale de `PROVIDER_FAILURE_REASONS`, la única lista de motivos del
      // módulo: el libro y la pasarela hablan del mismo suceso visto desde dos sitios.
      const snapshot = transfer.toSnapshot();
      expect(snapshot.status).toBe('rejected');
      expect(snapshot.reasonCode).toBe('body-rejected');
    });
  });

  describe('toDomain() ∘ toPersistence() (property-based)', () => {
    fcTest.prop([
      fc.record({
        asset: assetPartsArb,
        outcome: outcomeArb,
        createdAt: timestampArb,
        updatedAt: timestampArb,
        actor: fc.constantFrom<string | null>(ACTOR, null),
      }),
    ])('debería preservar todos los campos para cualquier transferencia del dominio', (props) => {
      // Arrange
      const original = WalletTransfer.rehydrate({
        id: TransferId.generate(),
        ownerId: OWNER_ID,
        from: EthereumAddress.from(FROM),
        recipient: EthereumAddress.from(RECIPIENT),
        assetKind: props.asset.assetKind,
        tokenAddress: props.asset.tokenAddress,
        amount: props.asset.amount,
        tokenId: props.asset.tokenId,
        status: props.outcome.status,
        txId: props.outcome.txId === null ? null : TransactionHash.from(props.outcome.txId),
        reasonCode: props.outcome.reasonCode,
        createdAt: props.createdAt,
        updatedAt: props.updatedAt,
        createdBy: props.actor,
        updatedBy: props.actor,
      });

      // Act
      const restored = WalletTransferMapper.toDomain(WalletTransferMapper.toPersistence(original));

      // Assert
      // Es lo único que ata los cuatro literales de `assetKind` que salen del snapshot con los
      // cuatro que `TransferAsset.fromParts` acepta al releer: cambiar uno sin el otro pone esta
      // propiedad en rojo, porque `fromParts` lanzaría `UnknownAssetKindError`.
      expect(restored.toSnapshot()).toEqual(original.toSnapshot());
    });
  });
});

// Helpers

/** Las cuatro columnas en las que el snapshot despliega el activo. */
type AssetParts = {
  assetKind: string;
  tokenAddress: string | null;
  amount: string | null;
  tokenId: string | null;
};

const hexArb = (length: number) =>
  fc
    .array(fc.constantFrom(...'0123456789abcdef'.split('')), {
      minLength: length,
      maxLength: length,
    })
    .map((chars) => chars.join(''));

const txHashArb = hexArb(64).map((body) => `0x${body}`);
const timestampArb = fc.date({
  min: new Date('2000-01-01T00:00:00.000Z'),
  max: new Date('2100-01-01T00:00:00.000Z'),
  noInvalidDate: true,
});

/** Importe canónico CONSTRUIDO: primer dígito no cero, así que nunca es «todo ceros». */
const amountArb = fc
  .tuple(
    fc.constantFrom(...'123456789'.split('')),
    fc.array(fc.constantFrom(...'0123456789'.split('')), { maxLength: 20 }),
  )
  .map(([head, tail]) => `${head}${tail.join('')}`);

/** `TokenId` SÍ acepta el cero: es la asimetría deliberada con `TokenAmount`. */
const tokenIdArb = fc.oneof(fc.constant('0'), amountArb);

/**
 * Las cuatro combinaciones que el dominio produce, y ninguna más. Generar los cuatro campos por
 * separado fabricaría filas imposibles —un NFT con importe— que `fromParts` rechaza: el caso
 * moriría por una fila que la tabla nunca puede contener, no por un defecto del mapper.
 */
const assetPartsArb: fc.Arbitrary<AssetParts> = fc.oneof(
  amountArb.map((amount) => ({
    assetKind: 'native',
    tokenAddress: null,
    amount,
    tokenId: null,
  })),
  amountArb.map((amount) => ({
    assetKind: 'fungible',
    tokenAddress: TOKEN,
    amount,
    tokenId: null,
  })),
  tokenIdArb.map((tokenId) => ({
    assetKind: 'nft',
    tokenAddress: TOKEN,
    amount: null,
    tokenId,
  })),
  fc.tuple(amountArb, tokenIdArb).map(([amount, tokenId]) => ({
    assetKind: 'multi-token',
    tokenAddress: TOKEN,
    amount,
    tokenId,
  })),
);

/**
 * Estado, hash y motivo viajan juntos por el mismo motivo que el activo: `submitted` sin hash o
 * `rejected` sin motivo son filas que el agregado no escribe. Los motivos salen de
 * `PROVIDER_FAILURE_REASONS`, que es la ÚNICA lista del módulo.
 */
const outcomeArb: fc.Arbitrary<{
  status: TransferStatus;
  txId: string | null;
  reasonCode: ProviderFailureReason | null;
}> = fc.oneof(
  fc.constant<{
    status: TransferStatus;
    txId: string | null;
    reasonCode: ProviderFailureReason | null;
  }>({ status: 'submitting', txId: null, reasonCode: null }),
  txHashArb.map((txId) => ({
    status: 'submitted' as TransferStatus,
    txId,
    reasonCode: null,
  })),
  fc.constantFrom(...PROVIDER_FAILURE_REASONS).map((reasonCode) => ({
    status: 'rejected' as TransferStatus,
    txId: null,
    reasonCode,
  })),
  fc.constantFrom(...PROVIDER_FAILURE_REASONS).map((reasonCode) => ({
    status: 'unknown' as TransferStatus,
    txId: null,
    reasonCode,
  })),
);

const buildTransfer = (asset: AssetParts): WalletTransfer =>
  WalletTransfer.rehydrate({
    id: TransferId.generate(),
    ownerId: OWNER_ID,
    from: EthereumAddress.from(FROM),
    recipient: EthereumAddress.from(RECIPIENT),
    assetKind: asset.assetKind,
    tokenAddress: asset.tokenAddress,
    amount: asset.amount,
    tokenId: asset.tokenId,
    status: 'submitted',
    txId: TransactionHash.from(TX_ID),
    reasonCode: null,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    createdBy: ACTOR,
    updatedBy: ACTOR,
  });

const buildRow = (): WalletTransferOrmEntity => {
  const row = new WalletTransferOrmEntity();
  row.id = TransferId.generate().value;
  row.ownerId = OWNER_ID;
  row.fromAddress = FROM;
  row.recipient = RECIPIENT;
  row.assetKind = 'fungible';
  row.tokenAddress = TOKEN;
  row.amount = '1500000000000000000';
  row.tokenId = null;
  row.status = 'submitted';
  row.txId = TX_ID;
  row.reasonCode = null;
  row.createdAt = CREATED_AT;
  row.updatedAt = UPDATED_AT;
  row.createdBy = ACTOR;
  row.updatedBy = ACTOR;
  return row;
};
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/modules/wallets/__tests__/infrastructure/persistence/wallet.mapper.spec.ts src/modules/wallets/__tests__/infrastructure/persistence/wallet-transfer.mapper.spec.ts`
Expected: FAIL — `Cannot find module '../../../infrastructure/persistence/wallet.mapper'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/modules/wallets/infrastructure/persistence/wallet.mapper.ts
import { Wallet } from '../../domain/entities/wallet.entity';
import { AddressIndex } from '../../domain/value-objects/address-index.vo';
import { EthereumAddress } from '../../domain/value-objects/ethereum-address.vo';
import { TransactionHash } from '../../domain/value-objects/transaction-hash.vo';
import { WalletId } from '../../domain/value-objects/wallet-id.vo';
import type { WalletStatus } from '../../domain/wallet-status';

import { WalletOrmEntity } from './wallet.orm-entity';

/**
 * Única frontera entre la fila y el agregado. Once asignaciones explícitas y ni un spread: con
 * `{ ...snapshot }` un campo nuevo del dominio aparecería en la fila sin que nadie lo decidiera,
 * y uno renombrado dejaría de escribirse dejando la columna en `undefined` — que TypeORM
 * traduce a «no toques esta columna», no a NULL, así que el UPDATE conservaría el valor viejo.
 *
 * ⚠️ **Aquí es donde `ownerId` se convierte en `userId`.** El agregado llama al dueño `ownerId`;
 * la tabla lo guarda en `user_id`, y como ninguna columna del repo lleva `name:`, la propiedad de
 * la ORM entity tiene que llamarse `userId`. Ese cruce vive en estas dos líneas y en ningún otro
 * sitio del módulo: es exactamente el trabajo para el que existe un mapper. Un `{ ...snapshot }`
 * no podría hacerlo — dejaría `user_id` sin escribir y añadiría un `owner_id` que no existe.
 *
 * **Reconstituye con `rehydrate`, nunca con `assign`.** No es simetría con `orders`: `assign()`
 * comprueba que la dirección no sea la master (§3.1.1), y volver a ejercer esa comprobación al
 * LEER convertiría una fila corrupta en una excepción al cargarla, justo cuando lo que hace falta
 * es poder leerla para diagnosticarla. La invariante se impone al escribir —dominio, `CHECK` y
 * traducción del `23514`—, no al leer.
 *
 * **`row.status as WalletStatus` es un cast consciente y acotado.** La columna solo la escriben
 * este mapper y las migraciones; un valor ajeno no eleva ningún privilegio, porque el estado solo
 * gobierna precondiciones que fallan cerradas. Mismo criterio, ya escrito, que `role` en
 * `UserMapper`.
 */
export const WalletMapper = {
  toDomain(row: WalletOrmEntity): Wallet {
    return Wallet.rehydrate({
      id: WalletId.from(row.id),
      ownerId: row.userId,
      ownerAddress: EthereumAddress.from(row.ownerAddress),
      addressIndex: AddressIndex.from(row.addressIndex),
      address: EthereumAddress.from(row.address),
      status: row.status as WalletStatus,
      activationTxId: row.activationTxId === null ? null : TransactionHash.from(row.activationTxId),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
    });
  },

  toPersistence(wallet: Wallet): WalletOrmEntity {
    const snapshot = wallet.toSnapshot();
    const row = new WalletOrmEntity();
    row.id = snapshot.id;
    row.userId = snapshot.ownerId;
    row.ownerAddress = snapshot.ownerAddress;
    row.addressIndex = snapshot.addressIndex;
    row.address = snapshot.address;
    row.status = snapshot.status;
    // El snapshot ya publica `string | null`, así que no hace falta `?? null`: lo que NO puede
    // pasar es que llegue `undefined`, porque en TypeORM significa «no toques esta columna» y una
    // wallet que perdiera su txId conservaría el anterior en la fila.
    row.activationTxId = snapshot.activationTxId;
    row.createdAt = snapshot.createdAt;
    row.updatedAt = snapshot.updatedAt;
    row.createdBy = snapshot.createdBy;
    row.updatedBy = snapshot.updatedBy;
    return row;
  },
};
```

```ts
// src/modules/wallets/infrastructure/persistence/wallet-transfer.mapper.ts
import { WalletTransfer } from '../../domain/entities/wallet-transfer.entity';
import type { ProviderFailureReason } from '../../domain/errors/wallet.errors';
import type { TransferStatus } from '../../domain/transfer-status';
import { EthereumAddress } from '../../domain/value-objects/ethereum-address.vo';
import { TransactionHash } from '../../domain/value-objects/transaction-hash.vo';
import { TransferId } from '../../domain/value-objects/transfer-id.vo';

import { WalletTransferOrmEntity } from './wallet-transfer.orm-entity';

/**
 * Frontera fila ↔ libro. Mismas reglas que `WalletMapper`: campo a campo, sin spread, y
 * `rehydrate` al reconstituir. Aquí son quince asignaciones en cada sentido, tantas como campos
 * tiene `WalletTransferSnapshot`.
 *
 * ⚠️ **Aquí es donde `from` se convierte en `fromAddress`**, por lo mismo que `ownerId` se
 * convierte en `userId` en `WalletMapper`: `FROM` es palabra reservada de SQL y la columna se
 * llama `from_address`. Cruzar los dos nombres es trabajo del mapper y de nadie más.
 *
 * **El activo NO se despliega aquí.** El snapshot del agregado ya lo publica en sus cuatro campos
 * (`assetKind`, `tokenAddress`, `amount`, `tokenId`), que es donde `TransferAsset.match()` decide
 * qué lleva cada clase. Desplegarlo otra vez en el mapper duplicaría esa decisión en un sitio
 * donde nadie la lee al añadir una quinta clase de activo, y las dos copias podrían divergir sin
 * que nada lo dijera.
 *
 * **Al releer, los cuatro campos vuelven como STRINGS y el agregado los rearma con
 * `fromParts()`**, que es exactamente el caso para el que `fromParts` existe (§3.4: su `kind` es
 * `string`, no `TransferAssetKind`). Una fila con una clase que el dominio no conoce —una
 * migración a medias, una escritura manual— sale como `UnknownAssetKindError` con nombre, no como
 * un `undefined` cayéndose por un `switch` sin `default`.
 *
 * `row.status as TransferStatus` y `row.reasonCode as ProviderFailureReason | null` son casts
 * conscientes y acotados, con el mismo criterio que el `status` de `WalletMapper`: las dos
 * columnas solo las escriben este mapper y las migraciones, y ninguno de los dos valores gobierna
 * un privilegio — el estado solo decide qué se puede publicar y el motivo solo se muestra.
 */
export const WalletTransferMapper = {
  toDomain(row: WalletTransferOrmEntity): WalletTransfer {
    return WalletTransfer.rehydrate({
      id: TransferId.from(row.id),
      ownerId: row.ownerId,
      from: EthereumAddress.from(row.fromAddress),
      recipient: EthereumAddress.from(row.recipient),
      assetKind: row.assetKind,
      tokenAddress: row.tokenAddress,
      amount: row.amount,
      tokenId: row.tokenId,
      status: row.status as TransferStatus,
      txId: row.txId === null ? null : TransactionHash.from(row.txId),
      reasonCode: row.reasonCode as ProviderFailureReason | null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
    });
  },

  toPersistence(transfer: WalletTransfer): WalletTransferOrmEntity {
    const snapshot = transfer.toSnapshot();
    const row = new WalletTransferOrmEntity();
    row.id = snapshot.id;
    row.ownerId = snapshot.ownerId;
    row.fromAddress = snapshot.from;
    row.recipient = snapshot.recipient;
    row.assetKind = snapshot.assetKind;
    row.tokenAddress = snapshot.tokenAddress;
    row.amount = snapshot.amount;
    row.tokenId = snapshot.tokenId;
    row.status = snapshot.status;
    row.txId = snapshot.txId;
    row.reasonCode = snapshot.reasonCode;
    row.createdAt = snapshot.createdAt;
    row.updatedAt = snapshot.updatedAt;
    row.createdBy = snapshot.createdBy;
    row.updatedBy = snapshot.updatedBy;
    return row;
  },
};
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/modules/wallets/__tests__/infrastructure/persistence/wallet.mapper.spec.ts src/modules/wallets/__tests__/infrastructure/persistence/wallet-transfer.mapper.spec.ts`
Expected: PASS — 16 passed (6 de `WalletMapper`, 10 de `WalletTransferMapper`)

---

### Task 30: La migración — dos tablas, la secuencia y el primer `CHECK` del esquema

**Layer:** infrastructure
**Rule codes to honor:** `db-use-migrations`, `perf-optimize-database`

⚠️ **Esta tarea va delante de los tres adaptadores a propósito, y no en el orden del reparto.**
Los repositorios y el asignador se prueban contra PostgreSQL real —es la regla del repo, no una
preferencia—, así que ninguno de sus E2E puede ponerse verde antes de que existan las tablas y la
secuencia. Colocarla después habría dejado tres tareas cuyo «Step 4» era imposible de cumplir.

**Files:**

- Create: `src/database/migrations/1787900000000-create-wallets.ts`
- Modify: `src/database/__tests__/schema-conventions.e2e-spec.ts`

- [ ] **Step 1: Escribe el test que falla**

El rojo de esta tarea es el guardián de convenciones del esquema: se le añaden las dos tablas
nuevas a la lista de las que llevan traza de auditoría completa. Falla porque las tablas no
existen; se pone verde cuando la migración corre. Reemplaza el `it` entero de
`describe('la traza de auditoría')`:

```ts
// src/database/__tests__/schema-conventions.e2e-spec.ts
describe('la traza de auditoría', () => {
  it('debería estar completa en las cinco tablas que llevan agregado', () => {
    // Arrange
    const AUDIT = ['created_at', 'updated_at', 'created_by', 'updated_by'];
    const byTable = new Map<string, string[]>();
    for (const column of columns) {
      byTable.set(column.table_name, [
        ...(byTable.get(column.table_name) ?? []),
        column.column_name,
      ]);
    }

    // Act
    const missing = ['users', 'auth_credentials', 'orders', 'wallets', 'wallet_transfers'].flatMap(
      (table) =>
        AUDIT.filter((audit) => !byTable.get(table)?.includes(audit)).map(
          (audit) => `${table}.${audit}`,
        ),
    );

    // Assert
    // `orders_outbox` queda fuera a propósito: no es un agregado, es una cola. Sus filas no
    // tienen autor ni ciclo de vida — tienen `occurred_at` y `processed_at`, que son otra cosa.
    expect(missing).toEqual([]);
  });
});
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test:e2e src/database/__tests__/schema-conventions.e2e-spec.ts`
Expected: FAIL — `expect(received).toEqual(expected)` con las ocho entradas
`wallets.created_at … wallet_transfers.updated_by`: ninguna de las dos tablas existe todavía en
`information_schema`.

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/database/migrations/1787900000000-create-wallets.ts
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Crea el esquema del bounded context `wallets`: la tabla de direcciones custodiadas, la
 * secuencia de la que salen sus índices, y el libro de transferencias.
 *
 * ## Por qué el `NOT NULL` es legal aquí, y por qué no hay expand/contract
 *
 * «Destructive migrations» de `CLAUDE.md` no prohíbe el `NOT NULL`: prohíbe **estrenarlo sobre una
 * tabla en la que alguna versión desplegada ya inserta sin nombrar la columna**. Esa condición no
 * se cumple aquí y no puede cumplirse: **las dos tablas NACEN en esta migración**, así que no
 * existe ni existió código que inserte en ellas — el `INSERT` más antiguo posible es el del
 * adaptador que entra en la misma release. Es exactamente la excepción que `CLAUDE.md` escribe, y
 * el mismo argumento con el que `CreateOrdersAndOutbox` pudo dar `NOT NULL` a sus tres marcas de
 * tiempo mientras que dárselas DESPUÉS habría sido un paso destructivo disfrazado.
 *
 * Consecuencia práctica: no hay nada que partir en expand y contract, y `DB_MIGRATIONS_RUN=true`
 * es seguro. Una réplica antigua que corra durante el rodado no conoce estas tablas y no las toca;
 * ninguna de sus consultas cambia, porque TypeORM enumera columnas de las tablas que sus entidades
 * mapean y estas dos no están entre ellas.
 *
 * ## Por qué NO llevan `DEFAULT now()`
 *
 * Porque metería un segundo reloj en el sistema. El instante lo pone el dominio con el `now` que
 * le inyecta el caso de uso, y por eso las columnas tampoco son `@CreateDateColumn` /
 * `@UpdateDateColumn` en las ORM entities. Con `DEFAULT now()` habría dos fuentes del mismo dato y
 * la de la base ganaría en silencio cada vez que alguien escribiera por SQL crudo — un seed, una
 * migración de datos, una consola— sellando una fila con la hora del mantenimiento en vez de con
 * la del hecho. Mismo razonamiento, ya escrito, en `1786076763455-create-orders-and-outbox.ts`.
 *
 * ## Tres nombres de columna que no copian al dominio, y por qué
 *
 * `wallets.user_id` guarda lo que el agregado llama `ownerId`: la columna dice a QUIÉN de `users`
 * pertenece la dirección, con el mismo vocabulario que `auth_credentials.user_id`. En
 * `wallet_transfers`, `from_address` se llama así porque `FROM` es palabra reservada de SQL —una
 * columna `from` habría que citarla en cada consulta cruda— y `reason_code` dice que guarda un
 * código de una lista cerrada y no el `message` del proveedor, que interpola la clave de API. Los
 * dos mappers cruzan los tres nombres; ningún otro archivo los ve.
 *
 * ## La secuencia, y el riesgo residual que hay que tener escrito
 *
 * El índice sale de una secuencia y NO de `max(address_index) + 1`. Dos razones, y la segunda es
 * la decisiva (§5.1): `max()` mira la tabla, así que reciclaría el índice de una fila borrada —dos
 * usuarios sobre la misma dirección—; y obligaría al orden «leer el máximo → derivar en el
 * proveedor → insertar», de modo que cada colisión tiraría los créditos de una llamada ya hecha.
 *
 * ⚠️ **Reiniciar la secuencia devuelve índices ya usados, y eso son dos usuarios sobre la misma
 * dirección con los fondos mezclados.** Las tres formas de hacerlo son un
 * `TRUNCATE … RESTART IDENTITY` (el `OWNED BY` de abajo hace que la secuencia entre en ese
 * reinicio), un `setval` a mano y una restauración parcial. El índice único
 * `idx_wallets_address_index` es lo que convierte ese desastre silencioso en un 500 con nombre
 * (`AddressIndexAlreadyUsedError`), y por eso el `TRUNCATE` de los E2E de este módulo va
 * deliberadamente SIN `RESTART IDENTITY`.
 *
 * `NO CYCLE` es explícito aunque sea el valor por defecto: con `CYCLE`, agotar el rango
 * reiniciaría en `MINVALUE` y volvería a repartir índices ya entregados — el mismo desastre, esta
 * vez sin que nadie lo hubiera pedido. `AS integer` acota el máximo al del `integer` de la
 * columna, así que el agotamiento es un error del motor y no un desbordamiento silencioso.
 * `START WITH 0` con `MINVALUE 0` porque los índices arrancan en 0: el mínimo por defecto de una
 * secuencia ascendente es 1.
 *
 * ## El `CHECK` es el primero del esquema
 *
 * Las cuatro migraciones anteriores solo declaran claves primarias — ni un `CHECK` ni una clave
 * foránea. Es un mecanismo nuevo y está escrito aquí en vez de colado: es el único de los cinco
 * controles de §3.1.1 que ve una escritura por SQL crudo, que es precisamente la que no pasa por
 * `Wallet.assign()`. Qué se rompe sin él: alguien escribe la master como dirección de un usuario y
 * ese usuario «tiene» el fondo de gas de la plataforma, en silencio y sin que nada lo diga.
 *
 * **Sin claves foráneas, como el resto del esquema.** No es olvido: los dos contextos pueden dejar
 * de compartir base, y `user_id` apunta a `users` desde otro bounded context. La comprobación de
 * que el dueño existe la hace `OwnerDirectory` en cada operación que cuesta dinero.
 *
 * Sin cualificar el schema, como todas las migraciones del repo: ambos sentidos heredan el
 * `search_path` de la conexión, que sale de `DB_SCHEMA`.
 */
export class CreateWallets1787900000000 implements MigrationInterface {
  name = 'CreateWallets1787900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "wallets" (
        "id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "owner_address" character varying(42) NOT NULL,
        "address_index" integer NOT NULL,
        "address" character varying(42) NOT NULL,
        "status" character varying(16) NOT NULL,
        "activation_tx_id" character varying(66),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_by" character varying,
        "updated_by" character varying,
        CONSTRAINT "pk_wallets" PRIMARY KEY ("id"),
        CONSTRAINT "ck_wallets_address_not_master" CHECK ("address" <> "owner_address")
      )
    `);

    // Los TRES índices son únicos y los tres significan cosas distintas, que es justo por lo que
    // `WalletTypeOrmRepository` mira la restricción violada y no solo el código `23505`:
    //   - user_id       → carrera normal entre dos altas del mismo usuario. El adaptador la
    //                     devuelve como desenlace `'owner-conflict'`, sin lanzar: el caso de uso
    //                     relee y responde 200 con la wallet del ganador.
    //   - address_index → la secuencia repitió un índice. Dos usuarios sobre la misma dirección.
    //   - address       → el proveedor devolvió la misma dirección para índices distintos.
    // Los dos últimos SÍ lanzan y son 500 ruidosos: una restricción sin traducción es una
    // restricción sin diagnóstico.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_wallets_user_id" ON "wallets" ("user_id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_wallets_address_index" ON "wallets" ("address_index")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_wallets_address" ON "wallets" ("address")
    `);

    // `OWNED BY` va después del `CREATE TABLE` porque la columna tiene que existir. Lo que compra
    // es que la secuencia caiga con la tabla: sin él quedaría suelta tras el `down()` y el
    // siguiente `up()` moriría con «relation "wallets_address_index_seq" already exists».
    // Lo fija un caso de `migrations.e2e-spec.ts`, que reaplica esta migración tras revertirla.
    await queryRunner.query(`
      CREATE SEQUENCE "wallets_address_index_seq"
        AS integer
        START WITH 0
        MINVALUE 0
        INCREMENT BY 1
        NO CYCLE
        OWNED BY "wallets"."address_index"
    `);

    await queryRunner.query(`
      CREATE TABLE "wallet_transfers" (
        "id" uuid NOT NULL,
        "owner_id" uuid NOT NULL,
        "from_address" character varying(42) NOT NULL,
        "recipient" character varying(42) NOT NULL,
        "asset_kind" character varying(16) NOT NULL,
        "token_address" character varying(42),
        "amount" character varying(79),
        "token_id" character varying(78),
        "status" character varying(16) NOT NULL,
        "tx_id" character varying(66),
        "reason_code" character varying(40),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_by" character varying,
        "updated_by" character varying,
        CONSTRAINT "pk_wallet_transfers" PRIMARY KEY ("id")
      )
    `);

    // Compuesto y en este orden: el listado filtra por dueño y ordena por fecha
    // (`WHERE owner_id = $1 ORDER BY created_at DESC`). Al revés no serviría para el filtro.
    // Sin `DESC`: PostgreSQL recorre un btree en los dos sentidos.
    await queryRunner.query(`
      CREATE INDEX "idx_wallet_transfers_owner_id_created_at"
        ON "wallet_transfers" ("owner_id", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Sin `DROP SEQUENCE` propio y sin `DROP INDEX` propios: los índices, el `CHECK` y la
    // secuencia `OWNED BY` son dependencias de la tabla y caen con ella. Un `DROP SEQUENCE`
    // escrito después del `DROP TABLE "wallets"` fallaría con «sequence does not exist», y
    // escrito antes sería igual de innecesario.
    await queryRunner.query(`DROP TABLE "wallet_transfers"`);
    await queryRunner.query(`DROP TABLE "wallets"`);
  }
}
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm migration:run && pnpm db:migrate:test && pnpm test:e2e src/database/__tests__/schema-conventions.e2e-spec.ts`
Expected: PASS — 4 passed. Las dos bases quedan migradas; sin `db:migrate:test`, el resto de E2E
de este plan moriría con `relation "wallets" does not exist`.

---

### Task 31: `wallet.typeorm.repository.ts` — un desenlace, dos `23505` que lanzan y el `CHECK`

**Layer:** infrastructure
**Rule codes to honor:** `arch-use-repository-pattern`, `di-use-interfaces-tokens`, `di-prefer-constructor-injection`, `error-handle-async-errors`

**Files:**

- Create: `src/modules/wallets/infrastructure/persistence/wallet.typeorm.repository.ts`
- Test: `src/modules/wallets/__tests__/infrastructure/persistence/wallet.typeorm.repository.e2e-spec.ts`

⚠️ **`save()` devuelve `WalletSaveOutcome` (`'saved' | 'owner-conflict'`), y el choque de
`idx_wallets_user_id` NO lanza.** Dos altas simultáneas del mismo usuario son una carrera normal,
no una invariante rota: el adaptador la devuelve como desenlace y `AssignWalletUseCase` relee y
responde con la wallet del ganador. Por eso **`WalletAlreadyAssignedError` no existe** —no hay
ningún camino por el que llegue a HTTP, porque no hay error— y por eso este adaptador no añade
ninguna clase a `wallet.errors.ts`. Los otros dos `23505` (`address_index`, `address`) y la
violación del `CHECK` **sí lanzan**: son invariantes rotas y tienen que ser 500 ruidosos.

⚠️ **Los cuatro casos de traducción FUERZAN el choque insertando antes la fila rival.** En este
repo ya pasó lo contrario y quedó escrito: el test de dos `POST /users` concurrentes lo cazaba el
pre-check del caso de uso, nunca llegaba al `23505`, y bastaba con desactivar la traducción para
comprobar que seguía verde. Aquí se va por el repositorio, se salta cualquier pre-check y se choca
contra el índice a propósito, que es lo que ocurre en producción cuando dos peticiones se cruzan
de verdad.

⚠️ **Este archivo importa `WalletRepository` como valor y `WalletSaveOutcome` como `type` en
línea**, y ese `type` solo pasa el gate cuando su nombre está en la lista cerrada del segundo
bloque `no-restricted-syntax` de `eslint.config.mjs`. **Ese archivo tiene un único dueño: la
Task 41**, que escribe la lista final completa. Hasta que esa tarea corra, `pnpm lint:check`
señalará este import — no lo arregles aquí y no toques `eslint.config.mjs`.

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/modules/wallets/__tests__/infrastructure/persistence/wallet.typeorm.repository.e2e-spec.ts
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { DataSource, QueryFailedError } from 'typeorm';

import { createTestApp } from '@test/helpers/create-test-app';

import { Wallet } from '../../../domain/entities/wallet.entity';
import {
  AddressIndexAlreadyUsedError,
  WalletAddressAlreadyUsedError,
  WalletAddressIsMasterError,
  WalletDomainError,
} from '../../../domain/errors/wallet.errors';
import { AddressIndex } from '../../../domain/value-objects/address-index.vo';
import { EthereumAddress } from '../../../domain/value-objects/ethereum-address.vo';
import { TransactionHash } from '../../../domain/value-objects/transaction-hash.vo';
import { WalletId } from '../../../domain/value-objects/wallet-id.vo';
import { WalletOrmEntity } from '../../../infrastructure/persistence/wallet.orm-entity';
import { WalletTypeOrmRepository } from '../../../infrastructure/persistence/wallet.typeorm.repository';

const MASTER = '0x1111111111111111111111111111111111111111';
const OWNER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const RIVAL_OWNER_ID = '2c8f5a11-3d4e-4b6a-9f7c-1e0d5b8a3c24';
const ADDRESS = '0xa0b1c2d3e4f5061728394a5b6c7d8e9f00112233';
const RIVAL_ADDRESS = '0xa9887766554433221100ffeeddccbbaa99887766';
const TX_ID = '0x' + 'ab'.repeat(32);
const ACTOR = '5b7c2d4e-9a1f-4c3b-8e6d-0f2a4b6c8d1e';

/**
 * Contra PostgreSQL real, nunca con `jest.mock('typeorm')`: lo que hay que verificar es
 * exactamente el comportamiento del motor —los tres índices únicos, el `CHECK`, y el nombre de la
 * restricción que llega en `driverError.constraint`—, y un doble lo sustituiría por lo que uno
 * cree que hace.
 *
 * El repositorio se construye con `new` y no resolviendo `WalletRepository` del contenedor: el
 * binding no existe hasta que se cablea `wallets.module.ts`, y el sujeto aquí es el adaptador, no
 * el wiring. Es la misma divergencia deliberada, con el mismo motivo, que el E2E de
 * `OrderTypeOrmRepository`.
 */
describe('WalletTypeOrmRepository (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let repository: WalletTypeOrmRepository;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    dataSource = app.get(DataSource);
    repository = new WalletTypeOrmRepository(dataSource.getRepository(WalletOrmEntity));
  });

  beforeEach(async () => {
    // ⚠️ SIN `RESTART IDENTITY`. Con él, `wallets_address_index_seq` se reiniciaría —es propiedad
    // de `wallets.address_index` por el `OWNED BY`— y volvería a repartir índices ya entregados,
    // que es el desastre que §5.1 describe: dos usuarios sobre la misma dirección. Estos casos no
    // se romperían por ello (las filas se van con el TRUNCATE), y por eso conviene decirlo aquí:
    // lo que se evita es dejar escrito en el repo el gesto exacto que nunca debe ejecutarse.
    await dataSource.query('TRUNCATE TABLE wallets, wallet_transfers');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('save()', () => {
    it('debería persistir la wallet en sus columnas crudas y devolver el desenlace saved', async () => {
      // Arrange
      const wallet = buildWallet();

      // Act
      const outcome = await repository.save(wallet);

      // Assert: SQL crudo y no `find()` — es lo único que demuestra que las columnas existen en
      // PostgreSQL con el nombre snake_case que la ORM entity declara, `user_id` incluido.
      expect(outcome).toBe('saved');
      const rows = await dataSource.query<
        {
          user_id: string;
          owner_address: string;
          address_index: number;
          address: string;
          status: string;
          created_by: string | null;
        }[]
      >(
        `SELECT user_id, owner_address, address_index, address, status, created_by
           FROM wallets WHERE id = $1`,
        [wallet.id.value],
      );
      expect(rows[0]).toEqual({
        user_id: OWNER_ID,
        owner_address: MASTER,
        address_index: 0,
        address: ADDRESS,
        status: 'receive-only',
        created_by: ACTOR,
      });
    });

    it('debería sobrescribir la wallet existente cuando avanza su estado de activación', async () => {
      // Arrange
      const wallet = buildWallet();
      await repository.save(wallet);
      wallet.markActivationRequested(
        TransactionHash.from(TX_ID),
        new Date('2026-08-27T12:00:00.000Z'),
        ACTOR,
      );

      // Act
      const outcome = await repository.save(wallet);

      // Assert
      expect(outcome).toBe('saved');
      const rows = await dataSource.query<{ status: string; activation_tx_id: string | null }[]>(
        'SELECT status, activation_tx_id FROM wallets WHERE id = $1',
        [wallet.id.value],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ status: 'activating', activation_tx_id: TX_ID });
    });
  });

  describe('findByOwnerId()', () => {
    it('debería reconstruir la wallet guardada (ida y vuelta)', async () => {
      // Arrange
      const wallet = buildWallet();
      await repository.save(wallet);

      // Act
      const found = await repository.findByOwnerId(OWNER_ID);

      // Assert
      // La consulta filtra por la columna `user_id` con el `ownerId` del dominio: si el `where`
      // del adaptador nombrara una propiedad que la ORM entity no tiene, TypeORM devolvería
      // TODAS las filas en vez de fallar, y este caso pasaría igual con una sola fila. Por eso el
      // caso siguiente pide una wallet que no existe.
      expect(found?.toSnapshot()).toMatchObject({
        id: wallet.id.value,
        ownerId: OWNER_ID,
        ownerAddress: MASTER,
        addressIndex: 0,
        address: ADDRESS,
        status: 'receive-only',
      });
    });

    it('debería devolver null cuando el dueño todavía no tiene wallet', async () => {
      // Arrange
      await repository.save(buildWallet());

      // Act
      const found = await repository.findByOwnerId(RIVAL_OWNER_ID);

      // Assert
      // Con una fila de OTRO dueño ya guardada: es lo que distingue «filtra de verdad» de
      // «devuelve lo primero que encuentra».
      expect(found).toBeNull();
    });
  });

  describe('traducción de los errores del driver', () => {
    it('debería devolver el desenlace owner-conflict cuando el dueño ya tiene wallet', async () => {
      // Arrange: la fila rival se inserta primero, así que el segundo `save` choca de verdad
      // contra `idx_wallets_user_id`. Es la carrera normal entre dos altas del mismo usuario.
      await repository.save(buildWallet());
      const loser = buildWallet({
        id: WalletId.generate(),
        addressIndex: 1,
        address: RIVAL_ADDRESS,
      });

      // Act
      const outcome = await repository.save(loser);

      // Assert
      // Desenlace, NO excepción: si esto lanzara, el alta idempotente respondería un error
      // precisamente en la carrera que existe para absorber, y quien perdió por milisegundos
      // vería un 4xx donde el contrato promete 200 con su dirección.
      expect(outcome).toBe('owner-conflict');
    });

    it('debería traducir el choque de address_index a AddressIndexAlreadyUsedError', async () => {
      // Arrange
      await repository.save(buildWallet());
      const collision = buildWallet({
        id: WalletId.generate(),
        ownerId: RIVAL_OWNER_ID,
        address: RIVAL_ADDRESS,
      });

      // Act + Assert
      // Significa que la secuencia repitió un índice: dos usuarios sobre la MISMA dirección. Es
      // un 500 ruidoso a propósito — el `ErrorReporter` solo ve 5xx.
      await expect(repository.save(collision)).rejects.toBeInstanceOf(AddressIndexAlreadyUsedError);
    });

    it('debería traducir el choque de address a WalletAddressAlreadyUsedError', async () => {
      // Arrange
      await repository.save(buildWallet());
      const collision = buildWallet({
        id: WalletId.generate(),
        ownerId: RIVAL_OWNER_ID,
        addressIndex: 1,
      });

      // Act + Assert
      // Sin esta traducción el `23505` saldría como un 500 anónimo, perdiendo justo el
      // diagnóstico por el que ese tercer índice existe: el proveedor devolvió la misma dirección
      // para dos índices distintos.
      await expect(repository.save(collision)).rejects.toBeInstanceOf(
        WalletAddressAlreadyUsedError,
      );
    });

    it('debería traducir la violación del CHECK a WalletAddressIsMasterError', async () => {
      // Arrange: se construye con `rehydrate` porque `Wallet.assign()` rechaza esta wallet en el
      // dominio y jamás llegaría al INSERT. Eso es lo que hace el caso honesto: reproduce la única
      // forma real de llegar al `CHECK` —una fila que no pasó por el agregado— y comprueba que el
      // motor la para y que el adaptador le pone nombre.
      const impostor = Wallet.rehydrate({
        id: WalletId.generate(),
        ownerId: RIVAL_OWNER_ID,
        ownerAddress: EthereumAddress.from(MASTER),
        addressIndex: AddressIndex.from(9),
        address: EthereumAddress.from(MASTER),
        status: 'receive-only',
        activationTxId: null,
        createdAt: new Date('2026-08-27T09:00:00.000Z'),
        updatedAt: new Date('2026-08-27T09:00:00.000Z'),
        createdBy: ACTOR,
        updatedBy: ACTOR,
      });

      // Act + Assert
      await expect(repository.save(impostor)).rejects.toBeInstanceOf(WalletAddressIsMasterError);
    });

    it('debería propagar sin traducir los errores que no son de unicidad ni del CHECK', async () => {
      // Arrange: `user_id` es `uuid` en la tabla y `string` en el dominio, así que un dueño con
      // forma inválida llega al motor y sale como 22P02, no como 23505.
      const malformed = buildWallet({ ownerId: 'no-soy-un-uuid' });

      // Act
      const error = await repository.save(malformed).catch((caught: unknown) => caught);

      // Assert
      // Solo las cuatro restricciones nombradas se tratan: cualquier otro fallo del motor tiene
      // que seguir subiendo tal cual, o se estarían disfrazando errores de infraestructura de
      // errores de invariante — y peor, un `catch` demasiado ancho los devolvería como
      // `'owner-conflict'`, que el caso de uso interpreta como «alguien se me adelantó».
      expect(error).toBeInstanceOf(QueryFailedError);
      expect(error).not.toBeInstanceOf(WalletDomainError);
    });

    it('debería dejar una sola fila tras la carrera perdida por el dueño', async () => {
      // Arrange
      await repository.save(buildWallet());

      // Act
      await repository.save(
        buildWallet({ id: WalletId.generate(), addressIndex: 1, address: RIVAL_ADDRESS }),
      );

      // Assert
      // El desenlace `'owner-conflict'` no puede esconder una escritura parcial: la fila rival no
      // entró, y el caso de uso va a releer la del ganador.
      const rows = await dataSource.query<{ count: number }[]>(
        'SELECT COUNT(*)::int AS count FROM wallets',
      );
      expect(rows[0]?.count).toBe(1);
    });
  });
});

// Helpers

type WalletOverrides = {
  id?: WalletId;
  ownerId?: string;
  addressIndex?: number;
  address?: string;
};

const buildWallet = (overrides: WalletOverrides = {}): Wallet =>
  Wallet.assign({
    id: overrides.id ?? WalletId.generate(),
    ownerId: overrides.ownerId ?? OWNER_ID,
    ownerAddress: EthereumAddress.from(MASTER),
    addressIndex: AddressIndex.from(overrides.addressIndex ?? 0),
    address: EthereumAddress.from(overrides.address ?? ADDRESS),
    now: new Date('2026-08-27T09:00:00.000Z'),
    createdBy: ACTOR,
  });
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test:e2e src/modules/wallets/__tests__/infrastructure/persistence/wallet.typeorm.repository.e2e-spec.ts`
Expected: FAIL — `Cannot find module '../../../infrastructure/persistence/wallet.typeorm.repository'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/modules/wallets/infrastructure/persistence/wallet.typeorm.repository.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import type { Wallet } from '../../domain/entities/wallet.entity';
import {
  AddressIndexAlreadyUsedError,
  WalletAddressAlreadyUsedError,
  WalletAddressIsMasterError,
} from '../../domain/errors/wallet.errors';
import { WalletRepository, type WalletSaveOutcome } from '../../domain/ports/wallet.repository';

import { WalletMapper } from './wallet.mapper';
import { WalletOrmEntity } from './wallet.orm-entity';

/** https://www.postgresql.org/docs/current/errcodes-appendix.html */
const PG_UNIQUE_VIOLATION = '23505';
const PG_CHECK_VIOLATION = '23514';

/**
 * Los nombres tienen que coincidir EXACTAMENTE con los de `wallet.orm-entity.ts` y los de la
 * migración `CreateWallets`. No hay tipo que lo garantice: lo garantizan los cuatro casos de
 * traducción del E2E, que chocan contra el motor de verdad y se ponen rojos si uno se renombra
 * en un sitio y no en los otros dos.
 */
const USER_ID_INDEX = 'idx_wallets_user_id';
const ADDRESS_INDEX_INDEX = 'idx_wallets_address_index';
const ADDRESS_INDEX = 'idx_wallets_address';
const ADDRESS_NOT_MASTER_CHECK = 'ck_wallets_address_not_master';

type PostgresDriverError = { code?: string; constraint?: string };

const driverErrorOf = (error: unknown): PostgresDriverError | null =>
  error instanceof QueryFailedError ? (error.driverError as PostgresDriverError) : null;

/**
 * Adaptador de salida. Es la única clase del módulo que conoce el `Repository` del ORM; todo lo
 * que sale de aquí ya es dominio.
 *
 * `implements WalletRepository`, NUNCA `extends`: la conformidad la garantiza el `implements` y
 * solo él — `ClassProvider.provide` está tipado como `any`, así que el `useClass` del module no
 * comprueba nada. Y el puerto se importa como VALOR aunque solo aparezca en el `implements`: es
 * su propio token de inyección, y un `import type` lo borraría del emit.
 *
 * ## Un desenlace y dos excepciones: por qué el `23505` de `user_id` NO lanza
 *
 * La tabla tiene tres índices únicos, y los tres `23505` significan cosas radicalmente distintas.
 * El de `user_id` es que otra petición del MISMO usuario ganó la carrera: es el curso normal de un
 * alta idempotente, no un fallo, y por eso `save()` devuelve `'owner-conflict'` y el caso de uso
 * relee. Convertirlo en excepción obligaría al caso de uso a hacer control de flujo con un
 * `catch`, y a cualquiera que añadiera un `catch` más ancho a tragarse los otros dos.
 *
 * Los otros dos SÍ lanzan porque son invariantes rotas que tienen que hacer ruido: `address_index`
 * dice que la secuencia repitió un índice —dos usuarios sobre la misma dirección— y `address` que
 * el proveedor devolvió la misma dirección para índices distintos. Traducir por código y no por
 * restricción los convertiría en el mismo suceso, y el más benigno se comería a los dos graves: un
 * usuario recibiría 200 con la wallet de otro justo cuando la secuencia acaba de repetir un
 * índice.
 *
 * ⚠️ **`WalletAlreadyAssignedError` no existe, y no debe crearse.** No hay ningún camino por el
 * que un choque de dueño llegue a HTTP —`AssignWalletUseCase` lo absorbe releyendo—, así que una
 * clase de error para él sería dominio inalcanzable, y mapearla en el filtro publicaría un 409 que
 * `POST /wallets` no declara.
 *
 * ## Qué NO se toca, y por qué eso también es una decisión
 *
 * Un `23505` sobre una restricción desconocida —o cualquier otro código del motor— se re-lanza tal
 * cual. Sale como un 500 anónimo, que es exactamente lo que es: un fallo de infraestructura que
 * nadie previó. Inventarle un error de dominio lo disfrazaría de invariante de negocio y lo
 * escondería de quien tiene que arreglarlo; devolverlo como `'owner-conflict'` sería peor todavía,
 * porque el caso de uso releería una wallet que no existe.
 *
 * El `where` de la lectura nombra `userId`, la propiedad de la ORM entity, y recibe el `ownerId`
 * del dominio: la columna es `user_id` y el mapper es quien cruza los dos vocabularios.
 */
@Injectable()
export class WalletTypeOrmRepository implements WalletRepository {
  constructor(
    @InjectRepository(WalletOrmEntity)
    private readonly wallets: Repository<WalletOrmEntity>,
  ) {}

  async findByOwnerId(ownerId: string): Promise<Wallet | null> {
    const row = await this.wallets.findOne({ where: { userId: ownerId } });
    return row ? WalletMapper.toDomain(row) : null;
  }

  async save(wallet: Wallet): Promise<WalletSaveOutcome> {
    try {
      await this.wallets.save(WalletMapper.toPersistence(wallet));
      return 'saved';
    } catch (error) {
      const driverError = driverErrorOf(error);
      const snapshot = wallet.toSnapshot();

      if (driverError?.code === PG_UNIQUE_VIOLATION) {
        if (driverError.constraint === USER_ID_INDEX) {
          return 'owner-conflict';
        }
        if (driverError.constraint === ADDRESS_INDEX_INDEX) {
          throw new AddressIndexAlreadyUsedError(snapshot.addressIndex);
        }
        if (driverError.constraint === ADDRESS_INDEX) {
          throw new WalletAddressAlreadyUsedError(snapshot.address);
        }
      }

      if (
        driverError?.code === PG_CHECK_VIOLATION &&
        driverError.constraint === ADDRESS_NOT_MASTER_CHECK
      ) {
        throw new WalletAddressIsMasterError(snapshot.address);
      }

      throw error;
    }
  }
}
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test:e2e src/modules/wallets/__tests__/infrastructure/persistence/wallet.typeorm.repository.e2e-spec.ts`
Expected: PASS — 10 passed. `pnpm lint:check` sigue señalando el `type WalletSaveOutcome` hasta que
la Task 41 escriba la lista cerrada de `eslint.config.mjs`; no lo arregles aquí.

---

### Task 32: `wallet-transfer.typeorm.repository.ts` — escritura y listado paginado

**Layer:** infrastructure
**Rule codes to honor:** `arch-use-repository-pattern`, `perf-optimize-database`, `db-avoid-n-plus-one`

**Files:**

- Create: `src/modules/wallets/infrastructure/persistence/wallet-transfer.typeorm.repository.ts`
- Test: `src/modules/wallets/__tests__/infrastructure/persistence/wallet-transfer.typeorm.repository.e2e-spec.ts`

⚠️ **El método se llama `findByOwner` y recibe UN SOLO objeto**, `FindTransfersCriteria`, con el
dueño dentro: `{ ownerId, page, limit }`. Son `page`/`limit` —lo que llega del cliente por
`PaginationDto`— y no `skip`/`take`: la aritmética la hace el adaptador, que es el único que sabe
qué espera TypeORM. Devuelve `TransferPage`.

⚠️ **Este archivo importa `WalletTransferRepository` como valor y `FindTransfersCriteria` /
`TransferPage` como `type` en línea**, y esos dos nombres tienen que estar en la lista cerrada del
segundo bloque `no-restricted-syntax` de `eslint.config.mjs`. **Ese archivo tiene un único dueño:
la Task 41**, que lo edita una sola vez con la lista final completa. No lo toques aquí; hasta
entonces `pnpm lint:check` señalará estos dos imports.

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/modules/wallets/__tests__/infrastructure/persistence/wallet-transfer.typeorm.repository.e2e-spec.ts
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { createTestApp } from '@test/helpers/create-test-app';

import { WalletTransfer } from '../../../domain/entities/wallet-transfer.entity';
import { TransferAsset } from '../../../domain/transfer-asset';
import { EthereumAddress } from '../../../domain/value-objects/ethereum-address.vo';
import { TokenAmount } from '../../../domain/value-objects/token-amount.vo';
import { TokenId } from '../../../domain/value-objects/token-id.vo';
import { TransactionHash } from '../../../domain/value-objects/transaction-hash.vo';
import { TransferId } from '../../../domain/value-objects/transfer-id.vo';
import { WalletTransferOrmEntity } from '../../../infrastructure/persistence/wallet-transfer.orm-entity';
import { WalletTransferTypeOrmRepository } from '../../../infrastructure/persistence/wallet-transfer.typeorm.repository';

const OWNER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const OTHER_OWNER_ID = '2c8f5a11-3d4e-4b6a-9f7c-1e0d5b8a3c24';
const FROM = '0xa0b1c2d3e4f5061728394a5b6c7d8e9f00112233';
const RECIPIENT = '0xb1c2d3e4f5061728394a5b6c7d8e9f0011223344';
const TOKEN = '0xc2d3e4f5061728394a5b6c7d8e9f001122334455';
const TX_ID = '0x' + 'cd'.repeat(32);
const ACTOR = OWNER_ID;

describe('WalletTransferTypeOrmRepository (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let repository: WalletTransferTypeOrmRepository;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    dataSource = app.get(DataSource);
    repository = new WalletTransferTypeOrmRepository(
      dataSource.getRepository(WalletTransferOrmEntity),
    );
  });

  beforeEach(async () => {
    // Sin `RESTART IDENTITY`, por lo mismo que en el E2E de `WalletTypeOrmRepository`: reiniciar
    // `wallets_address_index_seq` reparte otra vez índices ya entregados.
    await dataSource.query('TRUNCATE TABLE wallets, wallet_transfers');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('save()', () => {
    it('debería persistir la transferencia con las columnas del activo que le tocan', async () => {
      // Arrange
      const transfer = buildTransfer({
        asset: TransferAsset.multiToken({
          token: EthereumAddress.from(TOKEN),
          amount: TokenAmount.from('3'),
          tokenId: TokenId.from('0'),
        }),
      });

      // Act
      await repository.save(transfer);

      // Assert: columnas crudas — es lo único que demuestra que el despliegue del activo llega a
      // PostgreSQL con los nombres snake_case de la ORM entity, `from_address` incluido.
      const rows = await dataSource.query<
        {
          from_address: string;
          recipient: string;
          asset_kind: string;
          token_address: string | null;
          amount: string | null;
          token_id: string | null;
          status: string;
          tx_id: string | null;
          reason_code: string | null;
        }[]
      >(
        `SELECT from_address, recipient, asset_kind, token_address, amount, token_id,
                status, tx_id, reason_code
           FROM wallet_transfers WHERE id = $1`,
        [transfer.id.value],
      );
      expect(rows[0]).toEqual({
        from_address: FROM,
        recipient: RECIPIENT,
        asset_kind: 'multi-token',
        token_address: TOKEN,
        amount: '3',
        token_id: '0',
        status: 'submitting',
        tx_id: null,
        reason_code: null,
      });
    });

    it('debería sobrescribir la fila al pasar de submitting a submitted', async () => {
      // Arrange — es la escritura por delante completa: la fila existe ANTES de llamar al
      // proveedor y se actualiza con su respuesta. Si `save` insertara en vez de actualizar,
      // cada envío dejaría dos filas y el libro contaría el doble.
      const transfer = buildTransfer({});
      await repository.save(transfer);
      transfer.markSubmitted(
        TransactionHash.from(TX_ID),
        new Date('2026-08-27T09:00:02.000Z'),
        ACTOR,
      );

      // Act
      await repository.save(transfer);

      // Assert
      const rows = await dataSource.query<{ status: string; tx_id: string | null }[]>(
        'SELECT status, tx_id FROM wallet_transfers WHERE owner_id = $1',
        [OWNER_ID],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ status: 'submitted', tx_id: TX_ID });
    });
  });

  describe('findByOwner()', () => {
    it('debería devolver la página pedida junto al total sin paginar', async () => {
      // Arrange
      await repository.save(buildTransfer({ at: '2026-08-27T09:00:00.000Z' }));
      await repository.save(buildTransfer({ at: '2026-08-27T10:00:00.000Z' }));
      await repository.save(buildTransfer({ at: '2026-08-27T11:00:00.000Z' }));

      // Act
      const page = await repository.findByOwner({ ownerId: OWNER_ID, page: 2, limit: 2 });

      // Assert
      // Dos cosas a la vez, y las dos son fallos vistos en producción en otros sitios. La
      // aritmética: `page` empieza en 1, así que la segunda página de 2 salta 2 filas — un
      // adaptador que pasara `skip: criteria.page` devolvería DOS elementos y este caso lo caza.
      // Y el `total`: si el filtro por dueño se aplicara solo a la página, la paginación
      // anunciaría una siguiente que no existe. Son dos consultas dentro de `findAndCount`.
      expect(page.items).toHaveLength(1);
      expect(page.total).toBe(3);
    });

    it('debería devolver primero la transferencia más reciente', async () => {
      // Arrange
      const older = buildTransfer({ at: '2026-08-27T09:00:00.000Z' });
      const newer = buildTransfer({ at: '2026-08-27T11:00:00.000Z' });
      await repository.save(older);
      await repository.save(newer);

      // Act
      const page = await repository.findByOwner({ ownerId: OWNER_ID, page: 1, limit: 10 });

      // Assert
      // Un libro que empieza por lo más viejo obliga a paginar hasta el final para ver el envío
      // que se acaba de hacer, que es el único que a alguien le interesa mirar.
      expect(page.items.map((item) => item.id.value)).toEqual([newer.id.value, older.id.value]);
    });

    it('debería excluir las transferencias de otro dueño, del listado y del total', async () => {
      // Arrange
      await repository.save(buildTransfer({}));
      await repository.save(buildTransfer({ ownerId: OTHER_OWNER_ID }));

      // Act
      const page = await repository.findByOwner({ ownerId: OWNER_ID, page: 1, limit: 10 });

      // Assert
      // Los cinco endpoints son «lo mío»: una fuga aquí publicaría el historial financiero de
      // otro usuario.
      expect(page.total).toBe(1);
      expect(page.items[0]?.toSnapshot().ownerId).toBe(OWNER_ID);
    });

    it('debería devolver una página vacía y total cero cuando el dueño no tiene transferencias', async () => {
      // Arrange
      await repository.save(buildTransfer({}));

      // Act
      const page = await repository.findByOwner({ ownerId: OTHER_OWNER_ID, page: 1, limit: 10 });

      // Assert
      // Es la respuesta del rol admin, que no puede enviar por Gas Pump: página vacía, no 404.
      expect(page).toEqual({ items: [], total: 0 });
    });
  });
});

// Helpers

const buildTransfer = (overrides: {
  ownerId?: string;
  asset?: TransferAsset;
  at?: string;
}): WalletTransfer => {
  const now = new Date(overrides.at ?? '2026-08-27T09:00:00.000Z');
  return WalletTransfer.start({
    id: TransferId.generate(),
    ownerId: overrides.ownerId ?? OWNER_ID,
    from: EthereumAddress.from(FROM),
    recipient: EthereumAddress.from(RECIPIENT),
    asset: overrides.asset ?? TransferAsset.native({ amount: TokenAmount.from('1') }),
    now,
    createdBy: overrides.ownerId ?? ACTOR,
  });
};
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test:e2e src/modules/wallets/__tests__/infrastructure/persistence/wallet-transfer.typeorm.repository.e2e-spec.ts`
Expected: FAIL — `Cannot find module '../../../infrastructure/persistence/wallet-transfer.typeorm.repository'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/modules/wallets/infrastructure/persistence/wallet-transfer.typeorm.repository.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { WalletTransfer } from '../../domain/entities/wallet-transfer.entity';
import {
  WalletTransferRepository,
  type FindTransfersCriteria,
  type TransferPage,
} from '../../domain/ports/wallet-transfer.repository';

import { WalletTransferMapper } from './wallet-transfer.mapper';
import { WalletTransferOrmEntity } from './wallet-transfer.orm-entity';

/**
 * Adaptador de salida del libro. `WalletTransferRepository` entra como VALOR —es su propio token
 * de inyección— y los dos `type` que lo acompañan, en línea; por eso sus nombres tienen que estar
 * en la lista cerrada del selector de `eslint.config.mjs`, que falla en cerrado a propósito. Esa
 * lista la escribe entera la tarea que cablea el módulo: aquí no se toca.
 *
 * **El criterio llega en UN objeto, con el dueño dentro.** No es cosmética: `findByOwner(ownerId,
 * criteria)` con dos parámetros del mismo grupo semántico es la firma que produce el bug de
 * argumentos cruzados, y el puerto no puede distinguirlos. Con un solo objeto el compilador exige
 * los tres nombres.
 *
 * **`page`/`limit` entran y `skip`/`take` salen, y la conversión vive aquí.** `page` empieza en 1
 * —lo que manda `PaginationDto`—, así que la primera página salta cero filas. Poner la resta en el
 * caso de uso metería aritmética de paginación en `application/`, y ponerla en el controlador la
 * repetiría en cada endpoint que liste.
 *
 * **Sin traducción de errores del driver, y es una decisión, no un olvido.** La tabla no tiene un
 * solo índice único más allá de la clave primaria: un `23505` aquí solo puede significar que
 * `randomUUID()` repitió un `TransferId`, que no es una invariante de negocio que nombrar sino un
 * fallo del generador. Traducirlo inventaría un error de dominio para un suceso que nadie puede
 * provocar ni corregir. Compárese con `WalletTypeOrmRepository`, donde las cuatro restricciones sí
 * distinguen cuatro situaciones distintas.
 *
 * **`save()` sirve al alta Y a la actualización**, que es lo que hace posible la escritura por
 * delante: la fila se escribe en `submitting` antes de llamar al proveedor y la misma llamada la
 * cierra en `submitted`, `rejected` o `unknown`. `repository.save()` de TypeORM resuelve por
 * clave primaria, así que no hacen falta dos métodos en el puerto — y con dos, el caso de uso
 * tendría que acordarse de cuál usar en cada rama del `catch`.
 */
@Injectable()
export class WalletTransferTypeOrmRepository implements WalletTransferRepository {
  constructor(
    @InjectRepository(WalletTransferOrmEntity)
    private readonly transfers: Repository<WalletTransferOrmEntity>,
  ) {}

  async save(transfer: WalletTransfer): Promise<void> {
    await this.transfers.save(WalletTransferMapper.toPersistence(transfer));
  }

  async findByOwner(criteria: FindTransfersCriteria): Promise<TransferPage> {
    const [rows, total] = await this.transfers.findAndCount({
      where: { ownerId: criteria.ownerId },
      skip: (criteria.page - 1) * criteria.limit,
      take: criteria.limit,
      // `id` como desempate y no solo `createdAt`: dos envíos del mismo milisegundo tienen orden
      // arbitrario entre consultas, y con paginación eso significa que una fila puede aparecer en
      // dos páginas o en ninguna. El índice compuesto sirve igual para el filtro y el orden
      // principal; el desempate solo ordena dentro de un empate exacto.
      order: { createdAt: 'DESC', id: 'DESC' },
    });

    return { items: rows.map((row) => WalletTransferMapper.toDomain(row)), total };
  }
}
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test:e2e src/modules/wallets/__tests__/infrastructure/persistence/wallet-transfer.typeorm.repository.e2e-spec.ts`
Expected: PASS — 6 passed. Igual que en la Task 31, `pnpm lint:check` seguirá señalando los dos
`type` en línea hasta que la Task 41 escriba la lista cerrada de `eslint.config.mjs`.

---

### Task 33: `sequence-address-index.allocator.ts` — el `bigint` que el driver entrega como string

**Layer:** infrastructure
**Rule codes to honor:** `di-interface-segregation`, `di-use-interfaces-tokens`, `arch-single-responsibility`

**Files:**

- Create: `src/modules/wallets/infrastructure/persistence/sequence-address-index.allocator.ts`
- Modify: `jest.config.mjs` y `test/jest-e2e.config.mjs` (el asignador se mide en la suite E2E)
- Test: `src/modules/wallets/__tests__/infrastructure/persistence/sequence-address-index.allocator.e2e-spec.ts`

⚠️ **`nextval` devuelve `bigint` y el driver de PostgreSQL entrega los `int8` como STRING.** Sin la
conversión explícita, el índice viajaría al proveedor como texto y sus campos `from`/`to`, que son
enteros, lo rechazarían — un 400 del proveedor en el alta, que además §7.2 clasifica como
configuración rota NUESTRA y publica como 503. Un caso del E2E lo fija, y lo hace comprobando en el
mismo test que el driver devuelve un string: la afirmación no se escribe en un comentario, se
ejecuta.

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/modules/wallets/__tests__/infrastructure/persistence/sequence-address-index.allocator.e2e-spec.ts
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { createTestApp } from '@test/helpers/create-test-app';

import { SequenceAddressIndexAllocator } from '../../../infrastructure/persistence/sequence-address-index.allocator';

/**
 * Contra PostgreSQL real, y aquí no hay alternativa siquiera discutible: el sujeto ES una
 * secuencia del motor. Un doble devolvería lo que uno cree que devuelve `nextval`, que es
 * exactamente el punto ciego que este spec existe para cerrar.
 */
describe('SequenceAddressIndexAllocator (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let allocator: SequenceAddressIndexAllocator;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    dataSource = app.get(DataSource);
    allocator = new SequenceAddressIndexAllocator(dataSource);
  });

  beforeEach(async () => {
    // ⚠️ SIN `RESTART IDENTITY`: la secuencia es propiedad de `wallets.address_index` por el
    // `OWNED BY`, así que ese flag la reiniciaría y volvería a repartir índices ya entregados —el
    // desastre de §5.1—. Además dejaría sin sentido el tercer caso de este spec, que comprueba
    // precisamente que vaciar la tabla NO recicla.
    await dataSource.query('TRUNCATE TABLE wallets, wallet_transfers');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('next()', () => {
    it('debería entregar índices estrictamente crecientes en llamadas sucesivas', async () => {
      // Arrange
      const first = await allocator.next();

      // Act
      const second = await allocator.next();

      // Assert
      // No se afirma que empiece en 0: la secuencia es global y otras suites la habrán consumido.
      // Lo que no puede pasar nunca es que repita o retroceda.
      expect(second.value).toBeGreaterThan(first.value);
    });

    it('debería devolver el índice como número, no como el string que entrega el driver', async () => {
      // Arrange: se comprueba en el propio test que `nextval` llega como texto, en vez de
      // afirmarlo en un comentario. `int8` es el tipo de retorno de `nextval` y `pg` lo entrega
      // como string para no perder precisión.
      const raw = await dataSource.query<{ nextval: unknown }[]>(
        "SELECT nextval('wallets_address_index_seq') AS nextval",
      );
      expect(typeof raw[0]?.nextval).toBe('string');

      // Act
      const index = await allocator.next();

      // Assert
      // Sin el `Number()` explícito, `index.value` sería la cadena y viajaría así al proveedor,
      // cuyos campos `from`/`to` son enteros y la rechazan.
      expect(typeof index.value).toBe('number');
      expect(Number.isInteger(index.value)).toBe(true);
    });

    it('debería no reciclar un índice después de vaciar la tabla de wallets', async () => {
      // Arrange
      const before = await allocator.next();

      // Act
      await dataSource.query('TRUNCATE TABLE wallets');
      const after = await allocator.next();

      // Assert
      // Es la razón por la que el índice sale de una secuencia y no de `max(address_index) + 1`:
      // `max()` mira la tabla, así que reciclaría el índice de una fila borrada y dos usuarios
      // acabarían sobre la misma dirección con los fondos mezclados.
      expect(after.value).toBeGreaterThan(before.value);
    });
  });
});
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test:e2e src/modules/wallets/__tests__/infrastructure/persistence/sequence-address-index.allocator.e2e-spec.ts`
Expected: FAIL — `Cannot find module '../../../infrastructure/persistence/sequence-address-index.allocator'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/modules/wallets/infrastructure/persistence/sequence-address-index.allocator.ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AddressIndexAllocator } from '../../domain/ports/address-index.allocator';
import { AddressIndex } from '../../domain/value-objects/address-index.vo';

/**
 * Nombre sin cualificar el schema, como todas las migraciones del repo: así hereda el
 * `search_path` de la conexión, que sale de `DB_SCHEMA`. Fijar `public` aquí haría que con
 * `DB_SCHEMA=app` el asignador buscara una secuencia que no existe.
 */
const SEQUENCE = 'wallets_address_index_seq';

/**
 * Reserva el siguiente índice de dirección. Puerto propio y NO un método más del repositorio, y el
 * motivo es que es OTRO ALMACÉN: una secuencia, no la tabla. Tiene otro modo de fallo (agotarse,
 * no chocar), otra semántica (irreversible: consumir un valor no se deshace) y otro fake. Metido
 * en el repositorio obligaría a todo doble que no reserva índices a implementarlo igualmente.
 *
 * ## Por qué una secuencia y no `max(address_index) + 1`
 *
 * Dos razones, y la segunda es la decisiva (§5.1): `max()` mira la tabla, así que reciclaría el
 * índice de una fila borrada —dos usuarios sobre la misma dirección—; y obligaría al orden «leer
 * el máximo → derivar en el proveedor → insertar», de modo que cada colisión tiraría los créditos
 * de una llamada ya hecha. Con la secuencia el índice es nuestro antes de gastar nada.
 *
 * Los huecos son gratis: derivar no escribe en la cadena ni consume gas, así que un índice
 * reservado y no usado es una dirección que nadie posee y a la que nadie va a mandar nada. Por eso
 * un fallo del proveedor tras reservar no necesita compensación — lo que queda huérfano es un
 * número, no una fila (§5.2).
 *
 * ## El `Number()` no es cosmética
 *
 * `nextval` devuelve `bigint` y el driver de PostgreSQL entrega los `int8` como STRING, para no
 * perder precisión con valores mayores que `Number.MAX_SAFE_INTEGER`. Aquí no puede haberlos —la
 * secuencia es `AS integer`— pero el driver no lo sabe. Sin esta conversión, el índice llegaría al
 * proveedor como texto y sus campos de rango, que son enteros, lo rechazarían con un 400 que §7.2
 * clasifica como configuración rota nuestra y publica como 503. Lo fija un caso del E2E, que
 * además comprueba ejecutándolo que el driver devuelve un string.
 *
 * La fila ausente no necesita clase de error propia: `Number(undefined)` es `NaN` y
 * `AddressIndex.from` ya lo rechaza con nombre (`InvalidAddressIndexError`, 500). Inventar una
 * segunda clase para un caso que `nextval` no puede producir sería dominio inalcanzable.
 */
@Injectable()
export class SequenceAddressIndexAllocator implements AddressIndexAllocator {
  constructor(private readonly dataSource: DataSource) {}

  async next(): Promise<AddressIndex> {
    const rows = await this.dataSource.query<{ nextval: string }[]>(
      `SELECT nextval('${SEQUENCE}') AS nextval`,
    );
    return AddressIndex.from(Number(rows[0]?.nextval));
  }
}
```

Y el asignador cambia de suite: no puede medirse en la unitaria, porque su prueba es contra
PostgreSQL real. Añade el patrón a las dos configs, junto a los repositorios TypeORM que ya siguen
esa regla.

```js
// jest.config.mjs — dentro de collectCoverageFrom, junto a '!src/**/*.typeorm.repository.ts'
    '!src/**/*.typeorm.repository.ts',
    //   - `*.allocator.ts`: mismo caso que un repositorio TypeORM. El sujeto es una secuencia del
    //     motor, así que su prueba vive en la suite E2E y medirlo aquí penalizaría por seguir la
    //     convención del propio repo.
    '!src/**/*.allocator.ts',
```

```js
// test/jest-e2e.config.mjs — dentro de collectCoverageFrom, junto a 'src/**/*.typeorm.repository.ts'
    'src/**/*.typeorm.repository.ts',
    'src/**/*.allocator.ts',
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test:e2e src/modules/wallets/__tests__/infrastructure/persistence/sequence-address-index.allocator.e2e-spec.ts`
Expected: PASS — 3 passed

- [ ] **Step 5: Remide los umbrales de cobertura E2E, sin inventar el número**

Run: `pnpm test:e2e --coverage`
Expected: los cuatro umbrales de `test/jest-e2e.config.mjs` en verde. Si alguno cae por debajo, se
ajusta al valor MEDIDO menos ~3 puntos de margen —el criterio que ya usa la cabecera de esa
config— y se escribe la medición al lado. Nunca a ojo: un umbral inventado es un gate que no
guarda nada.

---

### Task 34: La migración de `wallets`, ejercitada de verdad — reversión parcial y guardián entidad ↔ esquema

**Layer:** infrastructure
**Rule codes to honor:** `db-use-migrations`, `test-use-testing-module`

**Files:**

- Modify: `src/database/__tests__/migrations.e2e-spec.ts`

⚠️ **Una reversión TOTAL no puede detectar un `down()` incompleto**, y está medido en este repo:
al quitar a propósito un `DROP COLUMN` de un `down()`, de los cinco casos de esa suite solo cayó el
que rebobina a un punto INTERMEDIO. Los otros cuatro revierten todo, y el `DROP TABLE` final se
lleva por delante el defecto antes de que nadie lo mire. Por eso los casos de esta tarea revierten
**una sola** migración: además es la única reversión que ocurre en producción — nadie revierte
ocho, se revierte la última.

Lo que aquí se caza y ninguna otra prueba puede: la secuencia. Es la primera del esquema, cae por
dependencia del `OWNED BY` y no por un `DROP` escrito, así que un `down()` que la dejara suelta
pasaría todos los demás guardianes y solo reventaría al reaplicar — es decir, en el segundo
despliegue, no en el primero.

- [ ] **Step 1: Escribe el test que falla**

Añade este `describe` al final de `migrations.e2e-spec.ts`, después del de `MoveCredentialsToAuth`:

```ts
// src/database/__tests__/migrations.e2e-spec.ts (nuevo describe, al final del describe raíz)
describe('CreateWallets, la única migración con una secuencia', () => {
  /** Las dos tablas del contexto, que son las únicas que su `down()` puede tirar. */
  const WALLET_TABLES = ['wallet_transfers', 'wallets'];

  beforeEach(async () => {
    await revertAll();
    await probe.runMigrations({ transaction: 'all' });
  }, 90_000);

  it('debería llevarse solo sus dos tablas al revertir la última migración', async () => {
    // Arrange
    const before = await existingTables();

    // Act
    await probe.undoLastMigration({ transaction: 'all' });

    // Assert
    // Una reversión parcial es la única que ocurre en producción, y la única que puede ver un
    // `down()` que se pasa de frenada tirando una tabla de otro contexto.
    expect(await existingTables()).toEqual(
      before.filter((table) => !WALLET_TABLES.includes(table)),
    );
  }, 90_000);

  it('debería tirar la secuencia junto con la tabla que la posee', async () => {
    // Act
    await probe.undoLastMigration({ transaction: 'all' });

    // Assert
    // `to_regclass` devuelve NULL cuando la relación no existe, sin lanzar. Que la secuencia se
    // vaya sin un `DROP SEQUENCE` escrito es EL efecto del `OWNED BY`: sin esa cláusula quedaría
    // huérfana y nada lo diría hasta el siguiente `up()`.
    const rows = await probe.query<{ sequence: string | null }[]>(
      "SELECT to_regclass('wallets_address_index_seq')::text AS sequence",
    );
    expect(rows[0]?.sequence).toBeNull();
  }, 90_000);

  it('debería poder reaplicarse tras revertirla, sin chocar con una secuencia huérfana', async () => {
    // Arrange
    const before = await schemaSnapshot();
    await probe.undoLastMigration({ transaction: 'all' });

    // Act
    await probe.runMigrations({ transaction: 'all' });

    // Assert
    // Este es el caso que justifica los tres: si el `down()` dejara la secuencia suelta, el
    // `CREATE SEQUENCE` del `up()` moriría con «relation "wallets_address_index_seq" already
    // exists» — y no en el despliegue que introduce la migración, sino en el siguiente, que es
    // el peor momento para descubrirlo.
    expect(await schemaSnapshot()).toEqual(before);
  }, 90_000);

  it('debería dejar la secuencia usable y creciente tras el viaje de ida y vuelta', async () => {
    // Arrange
    await probe.undoLastMigration({ transaction: 'all' });
    await probe.runMigrations({ transaction: 'all' });

    // Act
    const first = await probe.query<{ nextval: string }[]>(
      "SELECT nextval('wallets_address_index_seq') AS nextval",
    );
    const second = await probe.query<{ nextval: string }[]>(
      "SELECT nextval('wallets_address_index_seq') AS nextval",
    );

    // Assert
    // El esquema puede ser idéntico columna a columna y la secuencia haber vuelto rota —creada
    // sin `MINVALUE 0`, o con otro tipo—: `schemaSnapshot()` mira `information_schema.columns` y
    // no ve secuencias. Este caso la usa.
    expect(Number(first[0]?.nextval)).toBe(0);
    expect(Number(second[0]?.nextval)).toBe(1);
  }, 90_000);
});
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test:e2e src/database/__tests__/migrations.e2e-spec.ts`
Expected: FAIL — el primer caso rojo es «debería tirar la secuencia junto con la tabla que la
posee» si el `OWNED BY` faltara, y «debería dejar la secuencia usable y creciente…» con
`expected 0, received 1` si faltara `START WITH 0`/`MINVALUE 0`. Con la migración de la Task 30 tal
cual está escrita, los cuatro pasan a la primera: en ese caso **rómpelos a propósito antes de
seguir** —quita el `OWNED BY` y vuelve a correr— y comprueba que el segundo y el tercero se ponen
rojos. Un test de regresión en el que nadie ha visto el rojo no es evidencia de nada, y en este
repo ya han aparecido varios que pasaban con y sin el arreglo.

- [ ] **Step 3: Escribe la implementación mínima**

No hay implementación nueva: la migración de la Task 30 es el sujeto. Lo que sí queda por hacer es
el guardián de deriva entre las ORM entities y el esquema, que ninguna de las dos suites cubre —
`migrations.e2e-spec.ts` compara el esquema consigo mismo, no con la metadata de TypeORM:

Run: `pnpm migration:generate src/database/migrations/WalletsDriftProbe`
Expected: el comando **falla** con `No changes in database schema were found - cannot generate a
migration`. Ese fallo ES el verde: significa que `WalletOrmEntity` y `WalletTransferOrmEntity`
describen exactamente lo que `CreateWallets` creó — los tres nombres que no copian al dominio
incluidos, porque una propiedad `ownerId` donde la migración escribió `user_id` haría que este
comando GENERE un `ADD COLUMN "owner_id"` y un `DROP COLUMN "user_id"`. Si genera un archivo, hay
deriva —un nombre, una longitud, una nulabilidad o un índice que no coinciden—: **lee el archivo
generado, corrige la entidad o la migración según cuál esté mal, y BÓRRALO**. No se commitea: una
migración de deriva sobre una tabla que acaba de nacer es la señal de que una de las dos piezas
está mal escrita, no un paso más.

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test:e2e src/database/__tests__/migrations.e2e-spec.ts`
Expected: PASS — 9 passed (los 5 que ya existían más los 4 de `CreateWallets`)

- [ ] **Step 5: Verificación integral de la rebanada de persistencia**

Run: `pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build`
Expected: los cuatro en verde. ⚠️ La suite E2E necesita las **dos** bases migradas
(`pnpm migration:run` y `pnpm db:migrate:test`, de la Task 30); sobre un clon fresco basta
`pnpm db:reset`, que hace las dos. ⚠️ `pnpm lint:check` y `pnpm format:check` quedan fuera de esta
verificación a propósito: los tres `type` en línea que viajan con los puertos
(`WalletSaveOutcome`, `FindTransfersCriteria`, `TransferPage`) no pasan el gate hasta que la
Task 41 escriba la lista cerrada de `eslint.config.mjs`, que es la única tarea dueña de ese
archivo. El DoD completo se cierra allí. Y ⚠️ **no ejecutes `git commit`**: cuando el conjunto esté
verde, sugiere el commit y espera.

---

### Task 35: Validador de checksum EIP-55 para el borde HTTP

**Layer:** infrastructure
**Rule codes to honor:** `security-validate-all-input`, `api-use-pipes`, `arch-single-responsibility`

⚠️ **Por qué vive aquí y no en el VO.** `domain/` no puede importar librerías externas (regla 1
del gate) y **keccak256 no está en `node:crypto`**: el `sha3-256` de la biblioteca estándar usa
otro padding y da otro hash. `EthereumAddress` seguirá validando forma y normalizando a
minúsculas, sin checksum (§6.1 del spec). La garantía del checksum **solo cubre lo que entra por
HTTP**, y está bien: el único otro origen de direcciones es el proveedor, que las devuelve en
minúsculas.

**Files:**

- Create: `src/modules/wallets/infrastructure/http/validators/is-checksummed-address.validator.ts`
- Test: `src/modules/wallets/__tests__/infrastructure/http/validators/is-checksummed-address.validator.spec.ts`
- Modify: `package.json` (nueva entrada en `dependencies`), `pnpm-lock.yaml`

- [ ] **Step 1: Instala `@noble/hashes` en `dependencies`, no en `devDependencies`**

Run: `pnpm add --save-exact "@noble/hashes@1"`
Expected: `package.json` gana una línea en `dependencies` con la versión **exacta** (sin `^`), y
`pnpm-lock.yaml` cambia.

Tres cosas que no son elección de estilo:

1. **`dependencies` y no `devDependencies`**: el validador se ejecuta en cada petición de
   `POST /wallets/me/transfers`. En `devDependencies` el `pnpm install --prod` de la imagen no lo
   instalaría y el fallo sería `Cannot find module '@noble/hashes/sha3'` en runtime, con build,
   lint y tests en verde.
2. **`--save-exact`**: no hay `.npmrc`, así que `pnpm add` guardaría `^1.x`. Las 30 dependencias
   del manifiesto están pineadas exactas (las pinea Renovate con
   `:pinAllExceptPeerDependencies`); una con rango rompería esa propiedad.
3. **`@1`, fijando la línea mayor**: el subpath sin extensión (`@noble/hashes/sha3`) es el que
   documenta la 1.x, y con `moduleResolution: nodenext` el import se resuelve contra el mapa
   `exports` del paquete. **No se ha comprobado** en este repo cómo lo exporta la 2.x; si alguien
   sube de mayor, el fallo aparece en `pnpm typecheck` como `Cannot find module`.

Comprueba que el paquete quedó donde toca antes de seguir:

Run: `node -e "const p=require('./package.json');console.log(p.dependencies['@noble/hashes'], p.devDependencies['@noble/hashes'])"`
Expected: la versión exacta y `undefined` — en ese orden.

- [ ] **Step 2: Escribe el test que falla**

```ts
// src/modules/wallets/__tests__/infrastructure/http/validators/is-checksummed-address.validator.spec.ts
import { fc, it as itProp } from '@fast-check/jest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  IsChecksummedAddress,
  isChecksummedAddress,
} from '../../../../infrastructure/http/validators/is-checksummed-address.validator';

/**
 * Los cuatro vectores canónicos de la sección «Test cases» del EIP-55, copiados literalmente.
 * **No se recalcularon aquí.** Si alguno no cuadrara, el primer caso de este bloque es el que se
 * pone rojo, y la salida real de `toChecksumAddress` es lo que hay que escribir en su lugar.
 */
const EIP55_VECTORS = [
  '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
  '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
  '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
  '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
] as const;

const LOWERCASE = '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed';

const HEX_DIGITS = [...'0123456789abcdef'];

/**
 * ⚠️ **Los arbitrarios van ARRIBA y no en el bloque `// Helpers` del final, y no es descuido.**
 * `it.prop([arb])` evalúa sus arbitrarios cuando corre el cuerpo del `describe`, que es en cuanto
 * Jest carga el archivo — antes de llegar al final. Con ellos abajo, un `const` está todavía en
 * su zona muerta temporal y la suite entera muere con
 * `ReferenceError: Cannot access 'lowercaseAddress' before initialization`, sin ejecutar un solo
 * caso. Los helpers que solo se usan DENTRO de un `it` sí pueden quedarse al final, porque para
 * entonces ya están inicializados: por eso `Payload` y los de las otras tareas siguen abajo.
 */

/** Construida, nunca filtrada: 40 dígitos hexadecimales en minúscula y el prefijo. */
const lowercaseAddress = (): fc.Arbitrary<string> =>
  fc
    .array(fc.constantFrom(...HEX_DIGITS), { minLength: 40, maxLength: 40 })
    .map((digits) => `0x${digits.join('')}`);

/** Índices de los caracteres que son letras: son los únicos que llevan caja. */
const letterPositions = (address: string): number[] =>
  [...address].flatMap((char, index) => (/[a-fA-F]/.test(char) ? [index] : []));

const flipCaseAt = (address: string, index: number): string => {
  const char = address[index] ?? '';
  const flipped = char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase();
  return `${address.slice(0, index)}${flipped}${address.slice(index + 1)}`;
};

/**
 * Un vector canónico con la caja de una letra cambiada.
 *
 * Se muta la CAJA y no el VALOR del dígito a propósito, y la diferencia importa: cambiar el
 * valor cambia el hash entero, así que el resultado solo falla con probabilidad ~1 − 2^−n
 * (n = número de letras) y la propiedad sería flaky. Cambiar la caja deja intacto el cuerpo en
 * minúsculas del que sale el checksum, así que la forma canónica no se mueve y la comparación
 * falla SIEMPRE — determinista.
 *
 * Los cuatro vectores tienen varias letras de cada caja, así que voltear una nunca produce una
 * dirección toda en minúsculas ni toda en mayúsculas, que son los dos casos que se aceptan sin
 * comprobar nada.
 */
const vectorWithOneFlippedLetter = (): fc.Arbitrary<string> =>
  fc
    .constantFrom(...EIP55_VECTORS)
    .chain((address) =>
      fc.constantFrom(...letterPositions(address)).map((index) => flipCaseAt(address, index)),
    );

describe('isChecksummedAddress', () => {
  it.each(EIP55_VECTORS)('debería aceptar el vector canónico del EIP-55 %s', (address) => {
    // Arrange
    const candidate = address;

    // Act
    const result = isChecksummedAddress(candidate);

    // Assert
    expect(result).toBe(true);
  });

  it('debería aceptar una dirección toda en minúsculas, que no lleva checksum que comprobar', () => {
    // Arrange
    const candidate = LOWERCASE;

    // Act
    const result = isChecksummedAddress(candidate);

    // Assert
    expect(result).toBe(true);
  });

  it('debería aceptar una dirección toda en mayúsculas, que tampoco lleva checksum', () => {
    // Arrange
    const candidate = `0x${LOWERCASE.slice(2).toUpperCase()}`;

    // Act
    const result = isChecksummedAddress(candidate);

    // Assert
    expect(result).toBe(true);
  });

  it('debería rechazar una dirección con la caja cambiada en un solo carácter', () => {
    // Arrange
    // El vector 1 con su tercer carácter ('A') pasado a minúscula: sigue siendo mixta, así que
    // el checksum SÍ se comprueba, y ya no cuadra.
    const candidate = '0x5aaeb6053F3E94C9b9A09f33669435E7Ef1BeAed';

    // Act
    const result = isChecksummedAddress(candidate);

    // Assert
    expect(result).toBe(false);
  });

  it('debería rechazar una dirección sin el prefijo 0x', () => {
    // Arrange
    const candidate = LOWERCASE.slice(2);

    // Act
    const result = isChecksummedAddress(candidate);

    // Assert
    expect(result).toBe(false);
  });

  it.each([
    ['39 hexadecimales', `0x${'a'.repeat(39)}`],
    ['41 hexadecimales', `0x${'a'.repeat(41)}`],
  ])('debería rechazar una dirección de %s', (_caso, candidate) => {
    // Arrange
    const value = candidate;

    // Act
    const result = isChecksummedAddress(value);

    // Assert
    expect(result).toBe(false);
  });

  it('debería rechazar una dirección con un carácter no hexadecimal', () => {
    // Arrange
    const candidate = `0x${'a'.repeat(39)}z`;

    // Act
    const result = isChecksummedAddress(candidate);

    // Assert
    expect(result).toBe(false);
  });

  it('debería rechazar una dirección con espacios alrededor, porque el transporte no recorta', () => {
    // Arrange
    // `EthereumAddress.from()` sí recorta, pero eso pasa DESPUÉS. Si el transporte recortara,
    // el checksum se calcularía sobre una cadena distinta de la que el cliente firmó como suya.
    const candidate = ` ${LOWERCASE} `;

    // Act
    const result = isChecksummedAddress(candidate);

    // Assert
    expect(result).toBe(false);
  });

  it.each([
    ['un número', 42],
    ['null', null],
    ['undefined', undefined],
    ['un objeto', { address: LOWERCASE }],
  ])('debería rechazar %s, que no es una cadena', (_caso, candidate) => {
    // Arrange
    const value: unknown = candidate;

    // Act
    const result = isChecksummedAddress(value);

    // Assert
    expect(result).toBe(false);
  });

  itProp.prop([lowercaseAddress()])(
    'debería aceptar siempre una dirección bien formada en minúsculas (propiedad)',
    (address) => {
      // Arrange
      const candidate = address;

      // Act
      const result = isChecksummedAddress(candidate);

      // Assert
      expect(result).toBe(true);
    },
  );

  itProp.prop([vectorWithOneFlippedLetter()])(
    'debería rechazar siempre un vector canónico con la caja de UN carácter cambiada (propiedad)',
    (address) => {
      // Arrange
      const candidate = address;

      // Act
      const result = isChecksummedAddress(candidate);

      // Assert
      expect(result).toBe(false);
    },
  );
});

describe('IsChecksummedAddress', () => {
  it('debería dar por válida la propiedad cuando el checksum cuadra', () => {
    // Arrange
    const dto = plainToInstance(Payload, { recipient: EIP55_VECTORS[0] });

    // Act
    const errors = validateSync(dto);

    // Assert
    expect(errors).toEqual([]);
  });

  it('debería marcar la propiedad como inválida cuando el checksum no cuadra', () => {
    // Arrange
    const dto = plainToInstance(Payload, {
      recipient: '0x5aaeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    });

    // Act
    const errors = validateSync(dto);

    // Assert
    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('recipient');
  });

  it('debería publicar un mensaje que nombra el checksum EIP-55', () => {
    // Arrange
    const dto = plainToInstance(Payload, { recipient: 'no-es-una-direccion' });

    // Act
    const errors = validateSync(dto);

    // Assert
    // El mensaje viaja en el `message` del 400 junto a los de `class-validator`, así que va en
    // inglés como ellos. Nombra el checksum porque «invalid address» no distingue una dirección
    // mal escrita de una con un carácter cambiado, que es justo lo que este validador caza.
    expect(Object.values(errors[0]?.constraints ?? {}).join()).toContain('EIP-55');
  });
});

// Helpers

class Payload {
  @IsChecksummedAddress()
  recipient!: string;
}
```

- [ ] **Step 3: Ejecuta el test para verificar que falla**

Run: `pnpm test src/modules/wallets/__tests__/infrastructure/http/validators/is-checksummed-address.validator.spec.ts`
Expected: FAIL — `Cannot find module '../../../../infrastructure/http/validators/is-checksummed-address.validator'`

- [ ] **Step 4: Escribe la implementación mínima**

```ts
// src/modules/wallets/infrastructure/http/validators/is-checksummed-address.validator.ts
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { registerDecorator, type ValidationOptions } from 'class-validator';

/** Forma pelada: `0x` y 40 hexadecimales de cualquier caja. Sin esto no hay nada que verificar. */
const ADDRESS_SHAPE = /^0x[0-9a-fA-F]{40}$/;

/**
 * La forma canónica EIP-55 de una dirección: el cuerpo en minúsculas se hashea con keccak256 y
 * cada dígito sube a mayúscula si el nibble correspondiente del hash es >= 8.
 *
 * `keccak_256` y NO el `sha3-256` de `node:crypto`: son algoritmos distintos —distinto padding—
 * y dan hashes distintos. Esa es la razón entera por la que este archivo depende de una librería
 * externa y por la que no puede vivir en `domain/`.
 */
const toChecksumAddress = (address: string): string => {
  const body = address.slice(2).toLowerCase();
  const hash = bytesToHex(keccak_256(utf8ToBytes(body)));
  let checksummed = '0x';
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index] ?? '';
    const nibble = Number.parseInt(hash[index] ?? '0', 16);
    checksummed += nibble >= 8 ? char.toUpperCase() : char;
  }
  return checksummed;
};

/**
 * `class-validator` ya trae `@IsEthereumAddress()`, y comprueba SOLO la forma. Con él, un
 * `0x…BeAed` con un carácter cambiado por el cliente pasa el transporte, llega al proveedor, se
 * paga el gas y el activo acaba en una dirección que no es de nadie — irreversible. Esta función
 * es lo que lo impide, y por eso no se sustituye por la del paquete.
 *
 * Una dirección toda en minúsculas (o toda en mayúsculas) **no lleva checksum**: sus letras no
 * codifican ningún bit del hash, así que verificarla sería rechazar entradas legítimas. Solo se
 * comprueba la caja mezclada, que es lo que el estándar dice.
 */
export const isChecksummedAddress = (value: unknown): boolean => {
  if (typeof value !== 'string' || !ADDRESS_SHAPE.test(value)) {
    return false;
  }
  const body = value.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) {
    return true;
  }
  return value === toChecksumAddress(value);
};

/** Decorador de propiedad para los DTO de este contexto. El mensaje va en inglés, como el resto
 * de los de `class-validator` con los que se concatena en el `message` del 400. */
export const IsChecksummedAddress =
  (options?: ValidationOptions): PropertyDecorator =>
  (object, propertyName): void => {
    registerDecorator({
      name: 'isChecksummedAddress',
      target: object.constructor,
      propertyName: propertyName as string,
      options,
      validator: {
        validate: (value: unknown): boolean => isChecksummedAddress(value),
        defaultMessage: (args) =>
          `${args?.property ?? 'value'} must be an Ethereum address with a valid EIP-55 checksum`,
      },
    });
  };
```

- [ ] **Step 5: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/modules/wallets/__tests__/infrastructure/http/validators/is-checksummed-address.validator.spec.ts`
Expected: PASS — 21 passed

---

### Task 36: Comprobación de arranque — la dirección derivada de la clave maestra

**Layer:** infrastructure
**Rule codes to honor:** `devops-use-config-module`, `security-sanitize-output`, `arch-single-responsibility`

⚠️ **Qué agujero cierra, medido sobre `openapi.json`.** `TransferCustodialWallet` tiene diez
propiedades y **ninguna se llama `owner`**: la master viaja a la transferencia **solo** como
`fromPrivateKey`. Derivar y activar se hacen contra la **dirección** configurada; transferir se
firma con la **clave** configurada; y nada ata las dos. Una configuración en la que dirección y
clave pertenezcan a EOAs distintas pasa `assertOwnedBy` —que compara contra la config, no contra
la clave— y **solo falla al enviar, con el gas ya gastado**. Esta comprobación es el único de los
cinco controles de §3.1.1 que ve esa discrepancia.

⚠️ **Cuenta como TERCER sitio donde se lee la clave privada, y hay que contarlo.** §7.1 del spec
dice «la clave se lee en exactamente dos sitios de todo el módulo»; con esta tarea son tres. El
grep de la invariante es `grep -rn "masterPrivateKey" src/modules/wallets/` y debe devolver
**tres** ocurrencias, no dos. Este sitio es seguro por lo que hace: lee, deriva y no guarda nada
—la clave no sobrevive a `onModuleInit`— y no la interpola en ningún mensaje ni en ninguna causa.

**Files:**

- Create: `src/modules/wallets/infrastructure/security/master-address.derivation.ts`
- Create: `src/modules/wallets/infrastructure/security/master-key-startup.check.ts`
- Test: `src/modules/wallets/__tests__/infrastructure/security/master-address.derivation.spec.ts`
- Test: `src/modules/wallets/__tests__/infrastructure/security/master-key-startup.check.spec.ts`
- Modify: `package.json` (nueva entrada en `dependencies`), `pnpm-lock.yaml`
- Depende de: `src/config/wallets.config.ts` publica `WalletsConfig` con los campos
  `masterAddress: string` (de `WALLETS_MASTER_ADDRESS`) y `masterPrivateKey: string` (de
  `WALLETS_MASTER_PRIVATE_KEY`).
- Depende de: `wallets.module.ts` registra `MasterKeyStartupCheck` en `providers`. Sin ese
  registro Nest nunca instancia la clase y `onModuleInit` **no se ejecuta**: la comprobación
  existiría y no comprobaría nada.

- [ ] **Step 1: Instala `@noble/curves` en `dependencies`**

Run: `pnpm add --save-exact "@noble/curves@1"`
Expected: entrada exacta en `dependencies`. Mismos tres motivos que en la tarea 35 —producción,
pin exacto, línea mayor fijada por el subpath `@noble/curves/secp256k1`—. `@noble/curves` ya
depende de `@noble/hashes`, así que no entra un segundo árbol de criptografía.

- [ ] **Step 2: Escribe los tests que fallan**

```ts
// src/modules/wallets/__tests__/infrastructure/security/master-address.derivation.spec.ts
import {
  assertMasterKeyMatchesAddress,
  deriveAddressFromPrivateKey,
} from '../../../infrastructure/security/master-address.derivation';

/**
 * Pareja clave↔dirección de la cuenta #0 por defecto de Hardhat/Anvil: la más publicada que
 * existe y, por lo mismo, la que nadie usaría con fondos reales. **No se derivó a mano aquí.**
 * Si el par no cuadrara, el primer caso es el que se pone rojo y hay que sustituirlo por la
 * salida de una herramienta que sí derive (`cast wallet address <clave>`).
 */
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ADDRESS = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';

/** Cuenta #1 de la misma lista: sirve de «otra EOA» sin inventar nada. */
const OTHER_ADDRESS = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';

describe('deriveAddressFromPrivateKey', () => {
  it('debería derivar la dirección conocida de su clave privada', () => {
    // Arrange
    const privateKey = KEY;

    // Act
    const derived = deriveAddressFromPrivateKey(privateKey);

    // Assert
    expect(derived).toBe(ADDRESS);
  });

  it('debería devolver la dirección en minúsculas, sin checksum EIP-55', () => {
    // Arrange
    const privateKey = KEY;

    // Act
    const derived = deriveAddressFromPrivateKey(privateKey);

    // Assert
    // La comparación con la configuración se hace en minúsculas por los dos lados: una master
    // escrita con checksum en el `.env` es la MISMA dirección, y hacerla fallar sería un
    // arranque roto por una diferencia de caja.
    expect(derived).toBe(derived.toLowerCase());
  });

  it.each([
    ['sin el prefijo 0x', 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'],
    ['con 63 hexadecimales', `0x${'a'.repeat(63)}`],
    ['con un carácter no hexadecimal', `0x${'a'.repeat(63)}z`],
    ['vacía', ''],
  ])('debería rechazar una clave %s', (_caso, privateKey) => {
    // Arrange
    const candidate = privateKey;

    // Act + Assert
    expect(() => deriveAddressFromPrivateKey(candidate)).toThrow(
      /WALLETS_MASTER_PRIVATE_KEY no tiene la forma/,
    );
  });

  it('debería dejar la clave fuera del mensaje y del cause cuando la rechaza', () => {
    // Arrange
    // El caso que justifica el `try/catch` y la comprobación de forma PROPIA: los errores de la
    // librería pueden llevar el valor recibido dentro del mensaje, y ese valor es la clave. Con
    // `cause`, el serializador de pino concatena mensajes y stacks de las causas (§7.1) y la
    // clave acabaría en disco.
    const privateKey = `0x${'a'.repeat(63)}z`;

    // Act
    const thrown = captureError(() => deriveAddressFromPrivateKey(privateKey));

    // Assert
    expect(thrown.message).not.toContain('aaaa');
    expect(thrown.cause).toBeUndefined();
  });
});

describe('assertMasterKeyMatchesAddress', () => {
  it('debería aceptar la configuración cuando la clave deriva exactamente la dirección', () => {
    // Arrange
    const config = { masterAddress: ADDRESS, masterPrivateKey: KEY };

    // Act + Assert
    expect(() => assertMasterKeyMatchesAddress(config)).not.toThrow();
  });

  it('debería aceptar la dirección escrita con checksum EIP-55', () => {
    // Arrange
    const config = {
      masterAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      masterPrivateKey: KEY,
    };

    // Act + Assert
    expect(() => assertMasterKeyMatchesAddress(config)).not.toThrow();
  });

  it('debería rechazar una configuración cuya dirección y clave son de EOAs distintas', () => {
    // Arrange
    // El agujero de §3.1.1 en su forma exacta: las dos variables son válidas por separado, y el
    // sistema derivaría y activaría contra una EOA mientras firma con otra.
    const config = { masterAddress: OTHER_ADDRESS, masterPrivateKey: KEY };

    // Act + Assert
    expect(() => assertMasterKeyMatchesAddress(config)).toThrow(
      /no corresponde a WALLETS_MASTER_PRIVATE_KEY/,
    );
  });

  it('debería nombrar las dos direcciones y nunca la clave en el error de configuración', () => {
    // Arrange
    const config = { masterAddress: OTHER_ADDRESS, masterPrivateKey: KEY };

    // Act
    const thrown = captureError(() => assertMasterKeyMatchesAddress(config));

    // Assert
    // Una dirección es pública y no revela su clave; sin las dos, el operador no sabe cuál de
    // las variables corregir. La clave, en cambio, no aparece ni entera ni por fragmentos.
    expect(thrown.message).toContain(OTHER_ADDRESS);
    expect(thrown.message).toContain(ADDRESS);
    expect(thrown.message).not.toContain(KEY.slice(2, 12));
  });
});

// Helpers

const captureError = (fn: () => unknown): Error => {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error('Se esperaba que la función lanzara un error y no lo hizo');
};
```

```ts
// src/modules/wallets/__tests__/infrastructure/security/master-key-startup.check.spec.ts
import type { ConfigService } from '@nestjs/config';

import { MasterKeyStartupCheck } from '../../../infrastructure/security/master-key-startup.check';

const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ADDRESS = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const OTHER_ADDRESS = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';

describe('MasterKeyStartupCheck', () => {
  describe('onModuleInit()', () => {
    it('debería dejar arrancar cuando la clave configurada deriva la dirección configurada', () => {
      // Arrange
      const check = new MasterKeyStartupCheck(
        configWith({ masterAddress: ADDRESS, masterPrivateKey: KEY }),
      );

      // Act + Assert
      expect(() => check.onModuleInit()).not.toThrow();
    });

    it('debería impedir el arranque cuando la dirección y la clave son de EOAs distintas', () => {
      // Arrange
      const check = new MasterKeyStartupCheck(
        configWith({ masterAddress: OTHER_ADDRESS, masterPrivateKey: KEY }),
      );

      // Act + Assert
      // Lanzar en `onModuleInit` aborta el arranque: `NestFactory.create` propaga el error. Un
      // proceso que no arranca es exactamente lo que se quiere — la alternativa es un despliegue
      // que funciona hasta la primera transferencia y ahí quema gas sin mover el activo.
      expect(() => check.onModuleInit()).toThrow(/no corresponde a WALLETS_MASTER_PRIVATE_KEY/);
    });
  });
});

// Helpers

const configWith = (wallets: { masterAddress: string; masterPrivateKey: string }): ConfigService =>
  ({ getOrThrow: () => wallets }) as unknown as ConfigService;
```

- [ ] **Step 3: Ejecuta los tests para verificar que fallan**

Run: `pnpm test src/modules/wallets/__tests__/infrastructure/security/`
Expected: FAIL — `Cannot find module '../../../infrastructure/security/master-address.derivation'`
y `Cannot find module '../../../infrastructure/security/master-key-startup.check'`

- [ ] **Step 4: Escribe la implementación mínima**

```ts
// src/modules/wallets/infrastructure/security/master-address.derivation.ts
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex } from '@noble/hashes/utils';

/** `0x` + 64 hexadecimales: la forma que exige el proveedor (`fromPrivateKey`, longitud 66). */
const PRIVATE_KEY_SHAPE = /^0x[0-9a-fA-F]{64}$/;

/**
 * Mensaje FIJO, sin un solo fragmento de la clave. Va en español porque solo lo lee el operador
 * que arranca el proceso: esto nunca llega a una respuesta HTTP.
 */
const MALFORMED_PRIVATE_KEY = 'WALLETS_MASTER_PRIVATE_KEY no tiene la forma 0x + 64 hexadecimales';

export type MasterKeyPair = {
  masterAddress: string;
  masterPrivateKey: string;
};

/**
 * Dirección Ethereum de una clave privada: los 20 últimos bytes del keccak256 de la clave
 * pública sin comprimir, quitándole su byte de prefijo `0x04`.
 *
 * ⚠️ **La comprobación de forma es NUESTRA y el `catch` no lleva `cause`, y las dos cosas tapan
 * el mismo agujero:** un error de la librería puede llevar el valor que recibió dentro del
 * mensaje, y ese valor es la clave privada de la master. Con `cause`, `pino-std-serializers`
 * concatena mensajes y stacks de las causas (§7.1 del spec), así que la clave acabaría escrita
 * en el log de arranque. De ahí que se rechace antes de llamar y que el error se sustituya por
 * uno propio en vez de reenvolverse.
 */
export const deriveAddressFromPrivateKey = (privateKey: string): string => {
  if (!PRIVATE_KEY_SHAPE.test(privateKey)) {
    throw new Error(MALFORMED_PRIVATE_KEY);
  }

  let uncompressedPublicKey: Uint8Array;
  try {
    uncompressedPublicKey = secp256k1.getPublicKey(privateKey.slice(2), false);
  } catch {
    throw new Error(MALFORMED_PRIVATE_KEY);
  }

  const hash = bytesToHex(keccak_256(uncompressedPublicKey.slice(1)));
  return `0x${hash.slice(-40)}`;
};

/**
 * Comprueba, al arrancar, que `WALLETS_MASTER_ADDRESS` es la dirección de
 * `WALLETS_MASTER_PRIVATE_KEY`.
 *
 * Sin esto, dos variables de EOAs distintas conviven sin que nada las contraste: el sistema
 * deriva y activa contra la DIRECCIÓN configurada y firma con la CLAVE configurada, y el
 * desajuste solo se manifiesta en la primera transferencia, con el gas ya pagado. El cuerpo de
 * `TransferCustodialWallet` no tiene ningún campo `owner` que las ate — medido sobre las diez
 * propiedades de su esquema en `openapi.json`.
 *
 * El mensaje nombra las DOS direcciones y jamás la clave. Una dirección es pública —no revela su
 * clave— y sin ellas el operador no sabe cuál de las dos variables está mal; interpolar la clave,
 * en cambio, la escribiría en el log de arranque de cada despliegue.
 */
export const assertMasterKeyMatchesAddress = ({
  masterAddress,
  masterPrivateKey,
}: MasterKeyPair): void => {
  const configured = masterAddress.trim().toLowerCase();
  const derived = deriveAddressFromPrivateKey(masterPrivateKey);

  if (configured !== derived) {
    throw new Error(
      `WALLETS_MASTER_ADDRESS (${configured}) no corresponde a WALLETS_MASTER_PRIVATE_KEY, ` +
        `cuya dirección es ${derived}`,
    );
  }
};
```

```ts
// src/modules/wallets/infrastructure/security/master-key-startup.check.ts
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { WalletsConfig } from '@config/wallets.config';

import { assertMasterKeyMatchesAddress } from './master-address.derivation';

/**
 * Corre la comprobación de coherencia master↔clave en el arranque del módulo.
 *
 * ⚠️ **Solo sirve si `wallets.module.ts` lo declara en `providers`.** Nest no instancia lo que no
 * está registrado, así que sin esa línea esta clase existe y no comprueba nada: el gate no lo ve
 * y ningún test unitario lo notaría. Lo que sí lo notaría es el E2E del módulo arrancando con una
 * configuración incoherente, y por eso ese caso vale más que este archivo.
 *
 * `ConfigService` se importa como VALOR (nunca `import type`): con `emitDecoratorMetadata`, un
 * `import type` se elide, la metadata no se emite y Nest falla en RUNTIME con
 * `can't resolve dependencies`, con lint y typecheck en verde.
 */
@Injectable()
export class MasterKeyStartupCheck implements OnModuleInit {
  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const wallets = this.configService.getOrThrow<WalletsConfig>('wallets');
    assertMasterKeyMatchesAddress(wallets);
  }
}
```

- [ ] **Step 5: Ejecuta los tests para verificar que pasan**

Run: `pnpm test src/modules/wallets/__tests__/infrastructure/security/`
Expected: PASS — 13 passed

---

### Task 37: Los tres DTO del borde HTTP

**Layer:** infrastructure
**Rule codes to honor:** `security-validate-all-input`, `api-use-dto-serialization`, `api-use-pipes`

⚠️ **Contrato con el dominio, para que la reconciliación sea mecánica.** Los dos DTO de respuesta
mapean desde `toSnapshot()` y consumen exactamente estas claves:

| Entidad          | Claves consumidas del snapshot                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `Wallet`         | `id`, `ownerId`, `address`, `addressIndex`, `status`, `activationTxId`                                                              |
| `WalletTransfer` | `id`, `ownerId`, `from`, `recipient`, `assetKind`, `tokenAddress`, `amount`, `tokenId`, `status`, `txId`, `reasonCode`, `createdAt` |

⚠️ La clave del snapshot es **`reasonCode`**, y el campo publicado se llama `reason`: son dos
nombres del mismo dato a propósito, uno en el agregado y otro en el contrato HTTP. El mapeo
`dto.reason = snapshot.reasonCode` es el único punto donde se cruzan.

`Wallet.ownerAddress` **no se publica**: es la master, y sacarla en la respuesta de cada usuario
repartiría la dirección del fondo de gas sin que nadie lo hubiera decidido.

⚠️ **El vocabulario NO se redeclara aquí.** Las tres listas cerradas —clases de activo, estados de
wallet y estados de transferencia— viven en `domain/` y estos DTO las importan. Declararlas otra
vez en el transporte crearía dos fuentes para el mismo enum y la divergencia sería invisible
mientras las dos listas coincidieran por casualidad. La clase de activo sigue viajando al dominio
como `string` —`TransferAssetParts.kind`—, que es lo que hace que una clase desconocida salga
`UnknownAssetKindError` → 400 y no un 500 por un `switch` sin rama.

**Files:**

- Create: `src/modules/wallets/infrastructure/http/dto/transfer-from-wallet.dto.ts`
- Create: `src/modules/wallets/infrastructure/http/dto/wallet-response.dto.ts`
- Create: `src/modules/wallets/infrastructure/http/dto/wallet-transfer-response.dto.ts`
- Test: `src/modules/wallets/__tests__/infrastructure/http/dto/transfer-from-wallet.dto.spec.ts`
- Test: `src/modules/wallets/__tests__/infrastructure/http/dto/wallet-response.dto.spec.ts`
- Test: `src/modules/wallets/__tests__/infrastructure/http/dto/wallet-transfer-response.dto.spec.ts`
- Depende de: `src/modules/wallets/domain/transfer-asset.ts` (`TRANSFER_ASSET_KINDS`,
  `TransferAssetKind`), `src/modules/wallets/domain/wallet-status.ts` (`WALLET_STATUSES`,
  `WalletStatus`), `src/modules/wallets/domain/transfer-status.ts` (`TRANSFER_STATUSES`,
  `TransferStatus`) y `src/modules/wallets/domain/errors/wallet.errors.ts`
  (`PROVIDER_FAILURE_REASONS`, `ProviderFailureReason`).
- Depende de: `src/modules/wallets/__tests__/helpers/wallet.factory.ts` (`buildWallet`) y
  `src/modules/wallets/__tests__/helpers/wallet-transfer.factory.ts` (`buildTransfer`). Los dos
  helpers los **crea la tarea 16**; aquí solo se importan.

- [ ] **Step 1: Escribe los tests que fallan**

```ts
// src/modules/wallets/__tests__/infrastructure/http/dto/transfer-from-wallet.dto.spec.ts
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { TransferFromWalletDto } from '../../../../infrastructure/http/dto/transfer-from-wallet.dto';

const RECIPIENT = '0xe242ba5456b782919afc85687422eea2cb73b5d3';
const TOKEN = '0x782919afc85eea2cb736874225456bb5d3e242ba';

/** Las mismas opciones del `ValidationPipe` global de `main.ts`: sin ellas esto no mide lo real. */
const PIPE_OPTIONS = { whitelist: true, forbidNonWhitelisted: true, stopAtFirstError: false };

describe('TransferFromWalletDto', () => {
  it('debería aceptar un envío nativo con destinatario e importe', () => {
    // Arrange
    const body = { recipient: RECIPIENT, kind: 'native', amount: '1000000000000000000' };

    // Act
    const errors = validate(body);

    // Assert
    expect(errors).toEqual([]);
  });

  it('debería aceptar un envío fungible con dirección de token e importe', () => {
    // Arrange
    const body = { recipient: RECIPIENT, kind: 'fungible', tokenAddress: TOKEN, amount: '100000' };

    // Act
    const errors = validate(body);

    // Assert
    expect(errors).toEqual([]);
  });

  it('debería aceptar un NFT con dirección de token e identificador de token', () => {
    // Arrange
    const body = { recipient: RECIPIENT, kind: 'nft', tokenAddress: TOKEN, tokenId: '0' };

    // Act
    const errors = validate(body);

    // Assert
    expect(errors).toEqual([]);
  });

  it('debería aceptar un multi-token con token, importe e identificador', () => {
    // Arrange
    // El literal publicado lleva GUION: `multi-token`. Es la misma cadena en el dominio, en el
    // mapper, en la columna `asset_kind` y aquí; la única forma camelCase del vocabulario es la
    // clave `multiToken` del matcher de `TransferAsset`, que es un identificador de TypeScript
    // y no un valor del contrato.
    const body = {
      recipient: RECIPIENT,
      kind: 'multi-token',
      tokenAddress: TOKEN,
      amount: '5',
      tokenId: '3',
    };

    // Act
    const errors = validate(body);

    // Assert
    expect(errors).toEqual([]);
  });

  it('debería exigir el importe en un envío nativo', () => {
    // Arrange
    const body = { recipient: RECIPIENT, kind: 'native' };

    // Act
    const errors = validate(body);

    // Assert
    expect(errors.map((error) => error.property)).toEqual(['amount']);
  });

  it('debería exigir la dirección del token y el identificador en un NFT', () => {
    // Arrange
    const body = { recipient: RECIPIENT, kind: 'nft' };

    // Act
    const errors = validate(body);

    // Assert
    expect(errors.map((error) => error.property).sort()).toEqual(['tokenAddress', 'tokenId']);
  });

  it('debería rechazar una clase de activo que no está en la lista publicada', () => {
    // Arrange
    const body = { recipient: RECIPIENT, kind: 'erc-4337', amount: '1' };

    // Act
    const errors = validate(body);

    // Assert
    expect(errors.map((error) => error.property)).toContain('kind');
  });

  it('debería rechazar multitoken sin guion, que no es el vocabulario publicado', () => {
    // Arrange
    // La grafía sin guion no existe en ninguna capa. Este caso la fija en el borde para que un
    // cliente que la escriba reciba un 400 con nombre en vez de llegar al dominio con una clase
    // que ninguna rama del matcher conoce.
    const body = { recipient: RECIPIENT, kind: 'multitoken', tokenAddress: TOKEN, amount: '5' };

    // Act
    const errors = validate(body);

    // Assert
    expect(errors.map((error) => error.property)).toContain('kind');
  });

  it('debería rechazar un destinatario cuyo checksum EIP-55 no cuadra', () => {
    // Arrange
    // Un solo carácter de caja cambiada respecto de la forma canónica: la clase de fallo por la
    // que existe el validador, porque el activo se iría a una dirección que no es de nadie.
    const body = {
      recipient: '0x5aaeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
      kind: 'native',
      amount: '1',
    };

    // Act
    const errors = validate(body);

    // Assert
    expect(errors.map((error) => error.property)).toEqual(['recipient']);
  });

  it.each([
    ['con signo', '+1'],
    ['sin parte entera', '.5'],
    ['sin parte decimal', '1.'],
    ['con ceros a la izquierda', '007'],
    ['que no es un número', 'mucho'],
  ])('debería rechazar un importe %s', (_caso, amount) => {
    // Arrange
    const body = { recipient: RECIPIENT, kind: 'native', amount };

    // Act
    const errors = validate(body);

    // Assert
    expect(errors.map((error) => error.property)).toEqual(['amount']);
  });

  it('debería rechazar un importe como número, que un token de 18 decimales no soporta', () => {
    // Arrange
    const body = { recipient: RECIPIENT, kind: 'native', amount: 1 };

    // Act
    const errors = validate(body);

    // Assert
    expect(errors.map((error) => error.property)).toEqual(['amount']);
  });

  it('debería aceptar un cuerpo con un campo cuya condición es falsa, que el dominio rechazará', () => {
    // Arrange
    // ⚠️ El caso que documenta la laguna a propósito: `@ValidateIf` hace OBLIGATORIO, no
    // PROHIBIDO. Un campo DECLARADO en el DTO no lo rechaza `forbidNonWhitelisted` aunque su
    // condición sea falsa, así que este cuerpo pasa el transporte y muere en `TransferAsset` con
    // `AssetFieldNotAllowedError` → 400 por el fallback del filtro. Quien «arregle» esta
    // aparente laguna metiendo la exclusividad en `class-validator` estará duplicando una
    // invariante de negocio en el transporte, donde nadie la puede sostener.
    const body = { recipient: RECIPIENT, kind: 'native', amount: '1', tokenId: '7' };

    // Act
    const errors = validate(body);

    // Assert
    expect(errors).toEqual([]);
  });

  it('debería rechazar un campo que el DTO no declara', () => {
    // Arrange
    // La otra mitad, para que la de arriba no se lea como «el DTO no rechaza nada»: lo NO
    // declarado sí lo rechaza `forbidNonWhitelisted`.
    const body = { recipient: RECIPIENT, kind: 'native', amount: '1', fromPrivateKey: '0xdead' };

    // Act
    const errors = validate(body);

    // Assert
    expect(errors.map((error) => error.property)).toEqual(['fromPrivateKey']);
  });
});

// Helpers

const validate = (body: object) =>
  validateSync(plainToInstance(TransferFromWalletDto, body), PIPE_OPTIONS);
```

```ts
// src/modules/wallets/__tests__/infrastructure/http/dto/wallet-response.dto.spec.ts
import { WalletResponseDto } from '../../../../infrastructure/http/dto/wallet-response.dto';
import { buildWallet } from '../../../helpers/wallet.factory';

const OWNER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const MASTER = '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed';
const DERIVED = '0x687422eea2cb73b5d3e242ba5456b782919afc85';

describe('WalletResponseDto', () => {
  describe('fromDomain()', () => {
    it('debería mapear la wallet custodiada campo a campo', () => {
      // Arrange
      const wallet = buildWallet({ ownerId: OWNER_ID, address: DERIVED, addressIndex: 7 });

      // Act
      const dto = WalletResponseDto.fromDomain(wallet);

      // Assert
      expect(dto).toMatchObject({
        kind: 'custodial',
        ownerId: OWNER_ID,
        address: DERIVED,
        index: 7,
        status: 'receive-only',
        activationTxId: null,
      });
      expect(dto.id).toBe(wallet.id.value);
    });

    it('debería exponer solo los campos del DTO, nunca la entidad', () => {
      // Arrange
      const wallet = buildWallet({ ownerId: OWNER_ID, address: DERIVED, addressIndex: 7 });

      // Act
      const dto = WalletResponseDto.fromDomain(wallet);

      // Assert
      expect(Object.keys(dto).sort()).toEqual([
        'activationTxId',
        'address',
        'id',
        'index',
        'kind',
        'ownerId',
        'status',
      ]);
    });

    it('debería dejar fuera la dirección de la master bajo la que se derivó', () => {
      // Arrange
      // ⚠️ `ownerAddress` es la EOA que paga TODO el gas del sistema. Publicarla en la respuesta
      // de cada usuario la repartiría a cualquiera con una cuenta, y no hay forma de retirarla
      // después. El campo existe en el agregado por `assertOwnedBy`, no para salir por la API.
      const wallet = buildWallet({ ownerId: OWNER_ID, address: DERIVED, ownerAddress: MASTER });

      // Act
      const dto = WalletResponseDto.fromDomain(wallet);

      // Assert
      expect(JSON.stringify(dto)).not.toContain(MASTER.slice(2, 14));
    });
  });

  describe('forMaster()', () => {
    it('debería publicar la master con kind master, sin id y con index nulo', () => {
      // Arrange
      const ownerId = OWNER_ID;

      // Act
      const dto = WalletResponseDto.forMaster(ownerId, MASTER);

      // Assert
      // Un 404 al admin sería mentira a medias: sí tiene dirección, y es la que sostiene todo.
      // Lo que no tiene es fila, índice ni activación, y eso es exactamente lo que dicen los
      // tres nulos.
      expect(dto).toEqual({
        kind: 'master',
        id: null,
        ownerId: OWNER_ID,
        address: MASTER,
        index: null,
        status: 'active',
        activationTxId: null,
      });
    });
  });
});
```

```ts
// src/modules/wallets/__tests__/infrastructure/http/dto/wallet-transfer-response.dto.spec.ts
import { WalletTransferResponseDto } from '../../../../infrastructure/http/dto/wallet-transfer-response.dto';
import { buildTransfer } from '../../../helpers/wallet-transfer.factory';

const OWNER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const FROM = '0x687422eea2cb73b5d3e242ba5456b782919afc85';
const RECIPIENT = '0xe242ba5456b782919afc85687422eea2cb73b5d3';

describe('WalletTransferResponseDto', () => {
  describe('fromDomain()', () => {
    it('debería mapear la transferencia campo a campo, con reasonCode saliendo como reason', () => {
      // Arrange
      const transfer = buildTransfer({
        ownerId: OWNER_ID,
        from: FROM,
        recipient: RECIPIENT,
        assetKind: 'native',
        amount: '100000',
      });

      // Act
      const dto = WalletTransferResponseDto.fromDomain(transfer);

      // Assert
      expect(dto).toMatchObject({
        ownerId: OWNER_ID,
        from: FROM,
        recipient: RECIPIENT,
        kind: 'native',
        tokenAddress: null,
        amount: '100000',
        tokenId: null,
        status: 'submitting',
        txId: null,
        reason: null,
      });
      expect(dto.id).toBe(transfer.id.value);
    });

    it('debería publicar el código de motivo de un rechazo del proveedor', () => {
      // Arrange
      // `reasonCode` sale de `PROVIDER_FAILURE_REASONS`, la lista cerrada que comparten el
      // adaptador y el libro. Es lo que hace que publicarlo sea seguro: nunca es el `message`
      // del proveedor, cuyo 401 interpola la API key.
      const transfer = buildTransfer({
        ownerId: OWNER_ID,
        from: FROM,
        recipient: RECIPIENT,
        status: 'rejected',
        reasonCode: 'body-rejected',
      });

      // Act
      const dto = WalletTransferResponseDto.fromDomain(transfer);

      // Assert
      expect(dto).toMatchObject({ status: 'rejected', reason: 'body-rejected', txId: null });
    });

    it('debería exponer solo los campos del DTO, nunca la entidad', () => {
      // Arrange
      const transfer = buildTransfer({ ownerId: OWNER_ID, from: FROM, recipient: RECIPIENT });

      // Act
      const dto = WalletTransferResponseDto.fromDomain(transfer);

      // Assert
      expect(Object.keys(dto).sort()).toEqual([
        'amount',
        'createdAt',
        'from',
        'id',
        'kind',
        'ownerId',
        'reason',
        'recipient',
        'status',
        'tokenAddress',
        'tokenId',
        'txId',
      ]);
    });
  });
});
```

- [ ] **Step 2: Ejecuta los tests para verificar que fallan**

Run: `pnpm test src/modules/wallets/__tests__/infrastructure/http/dto/`
Expected: FAIL — `Cannot find module '../../../../infrastructure/http/dto/transfer-from-wallet.dto'`
(y los otros dos)

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/modules/wallets/infrastructure/http/dto/transfer-from-wallet.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

import { TRANSFER_ASSET_KINDS, type TransferAssetKind } from '../../../domain/transfer-asset';
import { IsChecksummedAddress } from '../validators/is-checksummed-address.validator';

/**
 * ⚠️ **La lista de clases de activo se IMPORTA del dominio, no se copia.** Es la misma cadena en
 * los cuatro sitios donde el vocabulario aparece —dominio, mapper, columna `asset_kind` y este
 * contrato—, `multi-token` con guion incluido. Una segunda lista aquí publicaría un enum que
 * podría divergir del que el dominio acepta, y la divergencia solo se vería el día que alguien
 * añadiera una clase a una de las dos.
 *
 * Lo que sí se mantiene es que la clase viaje al caso de uso como `string`
 * (`TransferAssetParts.kind`): así una clase que este DTO dejara pasar muere en el dominio con
 * `UnknownAssetKindError` → 400 con nombre, en vez de en un `switch` sin rama devolviendo
 * `undefined`, que habría sido un 500 donde tocaba un 400.
 */
const NEEDS_TOKEN_ADDRESS: readonly string[] = ['fungible', 'nft', 'multi-token'];
const NEEDS_AMOUNT: readonly string[] = ['fungible', 'multi-token', 'native'];
const NEEDS_TOKEN_ID: readonly string[] = ['nft', 'multi-token'];

/**
 * Decimal canónico: sin signo, sin ceros a la izquierda, con parte entera y parte decimal
 * opcional. Es MÁS estricto que el patrón del proveedor —que acepta `+1`, `.5` y `1.`—, y no por
 * purismo: los tres rompen la igualdad canónica del string con la que el libro compara importes.
 * El `0` sí pasa aquí y muere en `TokenAmount`, mismo criterio que `@ValidateIf`: el transporte
 * valida forma, el dominio decide.
 */
const AMOUNT_SHAPE = /^(0|[1-9]\d*)(\.\d+)?$/;
const TOKEN_ID_SHAPE = /^(0|[1-9]\d*)$/;

/**
 * Cuerpo de `POST /wallets/me/transfers`.
 *
 * ⚠️ **`@ValidateIf` hace OBLIGATORIO, no PROHIBIDO, y la diferencia es la que confunde.** Con
 * `whitelist` y `forbidNonWhitelisted` activos, un campo **declarado** en este DTO NO se rechaza
 * aunque su condición sea falsa: `class-validator` solo descarta las propiedades sin metadata de
 * validación, y `@ValidateIf` es metadata. Así que un envío nativo que traiga `tokenId` pasa el
 * transporte, y está bien que pase: la exclusividad real entre `tokenAddress`, `amount` y
 * `tokenId` es una invariante de NEGOCIO y vive en `TransferAsset`, que la hace imposible por
 * construcción y sale como 400 por el fallback del filtro. Meterla aquí sería mantener la misma
 * regla en dos sitios, y el sitio donde el compilador no la puede sostener.
 *
 * No lleva `custodialAddress` ni nada parecido: el origen del envío es la dirección de la wallet
 * del `sub` del token, jamás un dato del cuerpo. Y no lleva —ni podrá llevar— `fromPrivateKey`:
 * la clave de la master no entra por HTTP.
 */
export class TransferFromWalletDto {
  @ApiProperty({
    description:
      'Dirección que recibe el activo. Si viene con mayúsculas y minúsculas mezcladas se ' +
      'verifica su checksum EIP-55; toda en minúsculas se acepta, porque entonces no lleva ' +
      'checksum que comprobar.',
    example: '0xe242ba5456b782919afc85687422eea2cb73b5d3',
    minLength: 42,
    maxLength: 42,
  })
  @IsString()
  @IsChecksummedAddress()
  recipient!: string;

  @ApiProperty({
    description:
      'Clase del activo. Determina qué campos son obligatorios: `native` solo importe; ' +
      '`fungible` token e importe; `nft` token e identificador; `multi-token` los tres.',
    enum: [...TRANSFER_ASSET_KINDS],
    example: 'native',
  })
  @IsIn([...TRANSFER_ASSET_KINDS])
  kind!: TransferAssetKind;

  @ApiPropertyOptional({
    description:
      'Dirección del contrato del token. Obligatoria salvo en `native`, que es moneda nativa ' +
      'de la cadena y no tiene contrato.',
    example: '0x782919afc85eea2cb736874225456bb5d3e242ba',
  })
  @ValidateIf((dto: TransferFromWalletDto) => NEEDS_TOKEN_ADDRESS.includes(dto.kind))
  @IsString()
  @IsChecksummedAddress()
  tokenAddress?: string;

  @ApiPropertyOptional({
    description:
      'Importe a enviar, como cadena decimal canónica. Cadena y no número: un token de 18 ' +
      'decimales no cabe en un flotante sin perder precisión. Obligatorio salvo en `nft`.',
    example: '100000',
    maxLength: 79,
  })
  @ValidateIf((dto: TransferFromWalletDto) => NEEDS_AMOUNT.includes(dto.kind))
  @IsString()
  @MaxLength(79)
  @Matches(AMOUNT_SHAPE)
  amount?: string;

  @ApiPropertyOptional({
    description:
      'Identificador del token, entero decimal como cadena. El token `0` existe, así que aquí ' +
      'sí se acepta el cero. Obligatorio en `nft` y en `multi-token`.',
    example: '100000',
    maxLength: 78,
  })
  @ValidateIf((dto: TransferFromWalletDto) => NEEDS_TOKEN_ID.includes(dto.kind))
  @IsString()
  @MaxLength(78)
  @Matches(TOKEN_ID_SHAPE)
  tokenId?: string;
}
```

```ts
// src/modules/wallets/infrastructure/http/dto/wallet-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';

import type { Wallet } from '../../../domain/entities/wallet.entity';
import { WALLET_STATUSES, type WalletStatus } from '../../../domain/wallet-status';

/**
 * `kind` es vocabulario del TRANSPORTE y por eso sí se declara aquí: el dominio no conoce la
 * master —no tiene fila en `wallets`— y esta distinción solo existe en la respuesta. Los estados,
 * en cambio, se importan de `domain/wallet-status.ts`, que es su única fuente.
 */
export const WALLET_KINDS = ['master', 'custodial'] as const;
export type WalletKind = (typeof WALLET_KINDS)[number];

/**
 * ⚠️ **`oneOf` con `type: 'null'`, y NO `nullable: true`.** Los dos guardianes del contrato
 * compilan el esquema con Ajv 2020-12 (`ajv/dist/2020`), y la cabecera de
 * `openapi-contract.e2e-spec.ts` ya lo deja medido: **Ajv ignora `nullable` en silencio**. Con
 * `{ type: 'integer', nullable: true }`, la respuesta real de la master —`index: null`— fallaría
 * `openapi-runtime-contract.e2e-spec.ts` con `must be integer`, y el ejemplo publicado fallaría
 * el check de ejemplo↔esquema.
 *
 * `type: 'null'` es vocabulario de JSON Schema 2020-12 y no de OpenAPI 3.0 —que solo tiene
 * `nullable`—, así que esto es una desviación consciente del dialecto declarado. Se elige porque
 * es la única forma en que el campo nulo queda REALMENTE validado por los dos gates, y porque el
 * documento ya se valida como 2020-12 en ambos.
 */
const nullableOf = (schema: Record<string, unknown>): Record<string, unknown> => ({
  oneOf: [schema, { type: 'null' }],
});

/**
 * Respuesta de `POST /wallets` y de `GET /wallets/me`.
 *
 * Un solo DTO con discriminador `kind` y no dos: el admin sí tiene dirección —la master, la que
 * sostiene el gas de todo el sistema— y responderle 404 sería mentira a medias. Lo que no tiene
 * es fila en `wallets`, y por eso `id`, `index` y `activationTxId` son nulos en ese caso.
 *
 * **No publica marcas de tiempo.** La master no tiene fila, así que cualquier campo que ella no
 * pueda rellenar tendría que salir nullable para todos; un `createdAt` que es nulo la mitad de
 * las veces vale menos que no publicarlo.
 */
export class WalletResponseDto {
  @ApiProperty({
    description:
      'Qué clase de dirección es. `custodial` es una gas pump address derivada; `master` es la ' +
      'EOA de la plataforma, que solo ve el rol admin.',
    enum: [...WALLET_KINDS],
    example: 'custodial',
  })
  kind!: WalletKind;

  @ApiProperty({
    description: 'Identificador de la wallet. Nulo para la master, que no tiene fila propia.',
    ...nullableOf({ type: 'string', format: 'uuid' }),
    example: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  })
  id!: string | null;

  @ApiProperty({
    description: 'Dueño de la dirección: siempre el `sub` del token.',
    example: '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012',
    format: 'uuid',
  })
  ownerId!: string;

  @ApiProperty({
    description: 'La dirección, en minúsculas. Es la que hay que usar para recibir fondos.',
    example: '0x687422eea2cb73b5d3e242ba5456b782919afc85',
  })
  address!: string;

  @ApiProperty({
    description:
      'Índice con el que se derivó la dirección bajo la master. Nulo para la master, que no se ' +
      'deriva de ningún índice.',
    ...nullableOf({ type: 'integer', minimum: 0 }),
    example: 7,
  })
  index!: number | null;

  @ApiProperty({
    description:
      'Capacidad actual de la dirección. `receive-only` recibe pero no envía; `activating` ' +
      'tiene una activación enviada y no confirmada; `active` puede enviar. ⚠️ Este endpoint no ' +
      'reconcilia con la cadena, así que el estado puede ir por detrás: para saberlo con ' +
      'certeza, llama al endpoint de activación, que sí consulta al proveedor.',
    enum: [...WALLET_STATUSES],
    example: 'active',
  })
  status!: WalletStatus;

  @ApiProperty({
    description:
      'Hash de la transacción de activación. Puede seguir nulo con la dirección ya `active`: ' +
      'la cadena puede confirmarlo sin que nosotros hayamos llegado a guardar el hash.',
    ...nullableOf({ type: 'string' }),
    example: '0xc83f8818db43d9ba4accfe454aa44fc33123d47a4f89d47b314d6748eb0e9bc9',
  })
  activationTxId!: string | null;

  /** El dominio nunca se serializa directamente: siempre pasa por este DTO. */
  static fromDomain(wallet: Wallet): WalletResponseDto {
    const snapshot = wallet.toSnapshot();
    const dto = new WalletResponseDto();
    dto.kind = 'custodial';
    dto.id = snapshot.id;
    dto.ownerId = snapshot.ownerId;
    dto.address = snapshot.address;
    dto.index = snapshot.addressIndex;
    dto.status = snapshot.status;
    dto.activationTxId = snapshot.activationTxId;
    return dto;
  }

  /**
   * La EOA del admin, que **no está en la tabla `wallets`** y por eso no puede salir de un
   * agregado. Su `status` es `active` porque una EOA puede enviar desde siempre: no hay contrato
   * que desplegar.
   *
   * ⚠️ Consecuencia operativa que conviene tener escrita: responder «qué direcciones
   * controlamos» exige mirar la tabla **y** la configuración. Quien mire solo la tabla se dejará
   * fuera precisamente la que tiene los fondos de gas.
   */
  static forMaster(ownerId: string, address: string): WalletResponseDto {
    const dto = new WalletResponseDto();
    dto.kind = 'master';
    dto.id = null;
    dto.ownerId = ownerId;
    dto.address = address;
    dto.index = null;
    dto.status = 'active';
    dto.activationTxId = null;
    return dto;
  }
}
```

```ts
// src/modules/wallets/infrastructure/http/dto/wallet-transfer-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';

import { TIMESTAMP } from '@common/dto/error-example.factory';

import type { WalletTransfer } from '../../../domain/entities/wallet-transfer.entity';
import {
  PROVIDER_FAILURE_REASONS,
  type ProviderFailureReason,
} from '../../../domain/errors/wallet.errors';
import { TRANSFER_ASSET_KINDS, type TransferAssetKind } from '../../../domain/transfer-asset';
import { TRANSFER_STATUSES, type TransferStatus } from '../../../domain/transfer-status';

/** Mismo motivo, medido, que en `wallet-response.dto.ts`: Ajv ignora `nullable` en silencio. */
const nullableOf = (schema: Record<string, unknown>): Record<string, unknown> => ({
  oneOf: [schema, { type: 'null' }],
});

/**
 * Una fila del libro de transferencias. La fila se escribe ANTES de llamar al proveedor, así que
 * un timeout deja rastro — que es justo el caso para el que el libro existe.
 */
export class WalletTransferResponseDto {
  @ApiProperty({
    description: 'Identificador de la transferencia.',
    example: 'a3f1c2d4-5b6e-4f7a-8c9d-0e1f2a3b4c5d',
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({
    description: 'Dueño de la wallet que envió: siempre el `sub` del token.',
    example: '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012',
    format: 'uuid',
  })
  ownerId!: string;

  @ApiProperty({
    description:
      'Dirección desde la que salió el activo: la de la wallet custodiada, nunca la master. ' +
      'La master firma y paga el gas; no envía.',
    example: '0x687422eea2cb73b5d3e242ba5456b782919afc85',
  })
  from!: string;

  @ApiProperty({
    description: 'Dirección que recibe el activo.',
    example: '0xe242ba5456b782919afc85687422eea2cb73b5d3',
  })
  recipient!: string;

  @ApiProperty({
    description: 'Clase del activo transferido.',
    enum: [...TRANSFER_ASSET_KINDS],
    example: 'native',
  })
  kind!: TransferAssetKind;

  @ApiProperty({
    description: 'Contrato del token. Nulo en un envío de moneda nativa.',
    ...nullableOf({ type: 'string' }),
    example: null,
  })
  tokenAddress!: string | null;

  @ApiProperty({
    description: 'Importe enviado, como cadena decimal. Nulo en un envío de NFT.',
    ...nullableOf({ type: 'string' }),
    example: '100000',
  })
  amount!: string | null;

  @ApiProperty({
    description: 'Identificador del token. Nulo salvo en NFT y multi-token.',
    ...nullableOf({ type: 'string' }),
    example: null,
  })
  tokenId!: string | null;

  @ApiProperty({
    description:
      'Qué sabemos del envío. `submitting`: la fila se escribió y aún no hay respuesta. ' +
      '`submitted`: el proveedor devolvió un hash, la transacción está enviada —no ' +
      'necesariamente minada—. `rejected`: el proveedor rechazó el cuerpo y NO pasó nada en la ' +
      'cadena. ⚠️ `unknown`: hubo timeout, red caída o un fallo de nuestra cuenta con el ' +
      'proveedor, y la transacción **pudo minarse o no**. Una fila que se queda en ' +
      '`submitting` tras responder la petición se lee como `unknown`.',
    enum: [...TRANSFER_STATUSES],
    example: 'submitted',
  })
  status!: TransferStatus;

  @ApiProperty({
    description: 'Hash de la transacción. Solo lo hay en `submitted`.',
    ...nullableOf({ type: 'string' }),
    example: '0xc83f8818db43d9ba4accfe454aa44fc33123d47a4f89d47b314d6748eb0e9bc9',
  })
  txId!: string | null;

  @ApiProperty({
    description:
      'Código de motivo del fallo, de la lista cerrada `PROVIDER_FAILURE_REASONS`. Nulo mientras ' +
      'no haya fallado nada.',
    ...nullableOf({ type: 'string', enum: [...PROVIDER_FAILURE_REASONS] }),
    example: null,
  })
  reason!: ProviderFailureReason | null;

  // `type: String` + `format` explícitos, misma red de seguridad que documenta `placedAt` en
  // `order-response.dto.ts`.
  @ApiProperty({
    description: 'Momento en que se escribió la fila, antes de llamar al proveedor. En UTC.',
    example: TIMESTAMP,
    type: String,
    format: 'date-time',
  })
  createdAt!: Date;

  /**
   * ⚠️ **`reason` es un código NUESTRO, jamás el `message` del proveedor.** El del 401 de Tatum
   * interpola la API key —`"Unable to find valid subscription for '${apiKey}'"`, medido en su
   * `openapi.json`—, y este campo se publica por `GET /wallets/me/transfers`. Copiar aquí el
   * texto del proveedor sería publicar un secreto a cualquiera que liste su propio libro. Por eso
   * el tipo del campo es `ProviderFailureReason` y no `string`: lo que no esté en la lista cerrada
   * no compila.
   *
   * El snapshot llama a ese dato `reasonCode` —igual que la columna `reason_code`— y el contrato
   * HTTP lo publica como `reason`. Esta línea es el único punto donde los dos nombres se cruzan.
   */
  static fromDomain(transfer: WalletTransfer): WalletTransferResponseDto {
    const snapshot = transfer.toSnapshot();
    const dto = new WalletTransferResponseDto();
    dto.id = snapshot.id;
    dto.ownerId = snapshot.ownerId;
    dto.from = snapshot.from;
    dto.recipient = snapshot.recipient;
    dto.kind = snapshot.assetKind;
    dto.tokenAddress = snapshot.tokenAddress;
    dto.amount = snapshot.amount;
    dto.tokenId = snapshot.tokenId;
    dto.status = snapshot.status;
    dto.txId = snapshot.txId;
    dto.reason = snapshot.reasonCode;
    dto.createdAt = snapshot.createdAt;
    return dto;
  }
}
```

- [ ] **Step 4: Ejecuta los tests para verificar que pasan**

Run: `pnpm test src/modules/wallets/__tests__/infrastructure/http/dto/`
Expected: PASS — 24 passed (17 del DTO de entrada, 4 de `WalletResponseDto`, 3 de
`WalletTransferResponseDto`)

---

### Task 38: Filtro de excepciones de dominio del contexto

**Layer:** infrastructure
**Rule codes to honor:** `error-use-exception-filters`, `error-throw-http-exceptions`, `security-sanitize-output`

⚠️ **Todo lo que no sea 400 hay que mapearlo explícitamente.** El fallback de
`DomainExceptionFilter` es 400, así que un error nuevo sin fila en este mapa saldría como «entrada
inválida» aunque fuera un 502 — y, siendo 4xx, `ErrorReporter` (que solo ve 5xx) no lo vería.

⚠️ **Las aridades de los constructores son las del contrato y no se negocian aquí.** Las que este
filtro y su suite ejercitan, literalmente:

| Error                                                                                             | Constructor                                                       |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `WalletNotFoundError`, `WalletOwnerGoneError`, `WalletAssignmentLostError`                        | `(ownerId: string)`                                               |
| `WalletNotActivatedError`                                                                         | `(status: WalletStatus)`                                          |
| `WalletActivationInProgressError`, `WalletAlreadyActivatedError`, `AdminUsesMasterAddressError`   | `()`                                                              |
| `WalletOwnerMismatchError`                                                                        | `(walletOwnerAddress: string, configuredMaster: string)`          |
| `WalletAddressIsMasterError`, `WalletAddressAlreadyUsedError`                                     | `(address: string)`                                               |
| `AddressIndexAlreadyUsedError`, `InvalidAddressIndexError`                                        | `(index: number)` / `(value: number)`                             |
| `InvalidWalletIdError`, `InvalidTransferIdError`, `InvalidEthereumAddressError`                   | `(value: string)`                                                 |
| `WalletProviderRejectedError`, `WalletProviderUnreachableError`, `WalletProviderUnavailableError` | `(reason: ProviderFailureReason, providerStatus: number \| null)` |

Los `reason` salen de `PROVIDER_FAILURE_REASONS`, la lista cerrada del dominio; no hay una segunda
lista de motivos.

**Files:**

- Create: `src/modules/wallets/infrastructure/http/wallets-domain-exception.filter.ts`
- Test: `src/modules/wallets/__tests__/infrastructure/http/wallets-domain-exception.filter.spec.ts`
- Depende de: `src/modules/wallets/domain/errors/wallet.errors.ts` con el marcador
  `WalletDomainError`, el padre abstracto `WalletProviderError` y las 23 clases concretas del
  contrato. Este mapa traduce 17 de ellas; las 6 restantes —`InvalidEthereumAddressError`,
  `InvalidTokenAmountError`, `InvalidTokenIdError`, `MissingAssetFieldError`,
  `AssetFieldNotAllowedError` y `UnknownAssetKindError`— caen en el fallback 400 a propósito.

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/modules/wallets/__tests__/infrastructure/http/wallets-domain-exception.filter.spec.ts
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import {
  AddressIndexAlreadyUsedError,
  AdminUsesMasterAddressError,
  InvalidAddressIndexError,
  InvalidEthereumAddressError,
  InvalidTransferIdError,
  InvalidWalletIdError,
  WalletActivationInProgressError,
  WalletAddressAlreadyUsedError,
  WalletAddressIsMasterError,
  WalletAlreadyActivatedError,
  WalletAssignmentLostError,
  WalletDomainError,
  WalletNotActivatedError,
  WalletNotFoundError,
  WalletOwnerGoneError,
  WalletOwnerMismatchError,
  WalletProviderRejectedError,
  WalletProviderUnavailableError,
  WalletProviderUnreachableError,
} from '../../../domain/errors/wallet.errors';
import { WalletsDomainExceptionFilter } from '../../../infrastructure/http/wallets-domain-exception.filter';

const OWNER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const ADDRESS = '0x687422eea2cb73b5d3e242ba5456b782919afc85';
const MASTER = '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed';

const PROVIDER_UNREACHABLE =
  'The custodial provider did not answer; the result of the operation is unknown';
const PROVIDER_UNAVAILABLE = 'The custodial provider integration is unavailable';

describe('WalletsDomainExceptionFilter', () => {
  describe('catch()', () => {
    it('debería traducir WalletNotFoundError a 404', () => {
      // Arrange
      const filter = new WalletsDomainExceptionFilter();

      // Act + Assert
      expect(() => filter.catch(new WalletNotFoundError(OWNER_ID))).toThrow(NotFoundException);
    });

    it('debería traducir WalletOwnerGoneError a 403 con el mensaje canónico', () => {
      // Arrange
      const filter = new WalletsDomainExceptionFilter();

      // Act
      const thrown = captureError(() => filter.catch(new WalletOwnerGoneError(OWNER_ID)));

      // Assert
      // El motivo (borrado vs desactivado) es información interna, igual que en `orders`.
      expect(thrown).toBeInstanceOf(ForbiddenException);
      expect(thrown.message).toBe('Forbidden');
      expect(thrown.message).not.toContain('9d2a1c7e');
    });

    it.each([
      ['WalletNotActivatedError', new WalletNotActivatedError('receive-only')],
      ['WalletActivationInProgressError', new WalletActivationInProgressError()],
      ['WalletAlreadyActivatedError', new WalletAlreadyActivatedError()],
      ['AdminUsesMasterAddressError', new AdminUsesMasterAddressError()],
    ])('debería traducir %s a 409', (_caso, error) => {
      // Arrange
      const filter = new WalletsDomainExceptionFilter();

      // Act + Assert
      expect(() => filter.catch(error)).toThrow(ConflictException);
    });

    it.each([
      ['InvalidWalletIdError', new InvalidWalletIdError('no-es-uuid')],
      ['InvalidTransferIdError', new InvalidTransferIdError('no-es-uuid')],
      ['InvalidAddressIndexError', new InvalidAddressIndexError(-1)],
      ['AddressIndexAlreadyUsedError', new AddressIndexAlreadyUsedError(7)],
      ['WalletAddressAlreadyUsedError', new WalletAddressAlreadyUsedError(ADDRESS)],
      ['WalletOwnerMismatchError', new WalletOwnerMismatchError(ADDRESS, MASTER)],
      ['WalletAddressIsMasterError', new WalletAddressIsMasterError(ADDRESS)],
      ['WalletAssignmentLostError', new WalletAssignmentLostError(OWNER_ID)],
    ])('debería traducir %s a 500', (_caso, error) => {
      // Arrange
      const filter = new WalletsDomainExceptionFilter();

      // Act + Assert
      expect(() => filter.catch(error)).toThrow(InternalServerErrorException);
    });

    it('debería publicar el 500 con el cuerpo saneado y el detalle solo en el cause', () => {
      // Arrange
      // Los ocho 500 nombran direcciones e índices internos, y fuera de producción
      // `AllExceptionsFilter` devuelve el mensaje tal cual: el cuerpo tiene que salir idéntico
      // al de cualquier otro fallo del servidor, con el detalle viajando solo al logger.
      const filter = new WalletsDomainExceptionFilter();
      const domainError = new WalletAddressIsMasterError(ADDRESS);

      // Act
      const thrown = captureError(() => filter.catch(domainError));

      // Assert
      expect((thrown as InternalServerErrorException).getResponse()).toEqual({
        statusCode: 500,
        message: 'Internal server error',
        // `expectedErrorName(500)` de `error-example.factory.ts`, no el canónico HTTP
        // `Internal Server Error`: el 500 del contrato es el de la rama saneada del filtro
        // global, y este tiene que salir igual.
        error: 'InternalServerError',
      });
      expect(JSON.stringify((thrown as InternalServerErrorException).getResponse())).not.toContain(
        '0x687422',
      );
      expect(thrown.cause).toBe(domainError);
    });

    it('debería traducir WalletProviderRejectedError a 400', () => {
      // Arrange
      const filter = new WalletsDomainExceptionFilter();

      // Act + Assert
      // El único 400 del proveedor que es culpa del cliente: solo la transferencia lleva entrada
      // suya, y su motivo es `body-rejected`. Un 400 en derivar o activar es configuración
      // NUESTRA, llega como `misconfigured` y sale 503.
      expect(() => filter.catch(new WalletProviderRejectedError('body-rejected', 400))).toThrow(
        BadRequestException,
      );
    });

    it('debería traducir WalletProviderUnreachableError a 502', () => {
      // Arrange
      const filter = new WalletsDomainExceptionFilter();

      // Act + Assert
      expect(() => filter.catch(new WalletProviderUnreachableError('timeout', null))).toThrow(
        BadGatewayException,
      );
    });

    it('debería traducir WalletProviderUnavailableError a 503', () => {
      // Arrange
      const filter = new WalletsDomainExceptionFilter();

      // Act + Assert
      expect(() => filter.catch(new WalletProviderUnavailableError('unauthorized', 401))).toThrow(
        ServiceUnavailableException,
      );
    });

    it('debería publicar el 502 y el 503 con mensaje fijo, sin el código de motivo', () => {
      // Arrange
      const filter = new WalletsDomainExceptionFilter();

      // Act
      const unreachable = captureError(() =>
        filter.catch(new WalletProviderUnreachableError('timeout', null)),
      );
      const unavailable = captureError(() =>
        filter.catch(new WalletProviderUnavailableError('unauthorized', 401)),
      );

      // Assert
      // El motivo es diagnóstico interno: lo escribe el adaptador en el log, no la respuesta.
      expect(unreachable.message).toBe(PROVIDER_UNREACHABLE);
      expect(unreachable.message).not.toContain('timeout');
      expect(unavailable.message).toBe(PROVIDER_UNAVAILABLE);
      expect(unavailable.message).not.toContain('unauthorized');
      expect((unreachable as BadGatewayException).getResponse()).toMatchObject({
        statusCode: 502,
        error: 'Bad Gateway',
      });
      expect((unavailable as ServiceUnavailableException).getResponse()).toMatchObject({
        statusCode: 503,
        error: 'Service Unavailable',
      });
    });

    it('debería dejar el 502 y el 503 sin cause', () => {
      // Arrange
      // ⚠️ La causa de un fallo del proveedor es un error del TRANSPORTE, y el serializador de
      // pino concatena mensajes y stacks de las causas (§7.1). Si ese error llevara dentro el
      // cuerpo de la transferencia, la clave privada de la master acabaría en el log. Los ocho
      // 500 sí llevan cause porque su causa es un error de DOMINIO: direcciones e índices.
      const filter = new WalletsDomainExceptionFilter();

      // Act
      const unreachable = captureError(() =>
        filter.catch(new WalletProviderUnreachableError('unreachable', null)),
      );
      const unavailable = captureError(() =>
        filter.catch(new WalletProviderUnavailableError('upstream-error', 502)),
      );

      // Assert
      expect(unreachable.cause).toBeUndefined();
      expect(unavailable.cause).toBeUndefined();
    });

    it('debería traducir InvalidEthereumAddressError a 400 por el fallback', () => {
      // Arrange
      const filter = new WalletsDomainExceptionFilter();

      // Act + Assert
      expect(() => filter.catch(new InvalidEthereumAddressError('0xzz'))).toThrow(
        BadRequestException,
      );
    });

    it('debería tratar un error de dominio sin mapeo como 400', () => {
      // Arrange
      // ⚠️ `new UnmappedDomainError()` va DENTRO del `it` y no en una tabla de `it.each`: la
      // clase se declara en el bloque `// Helpers` del final, y una tabla se evalúa mientras
      // corre el cuerpo del `describe`, cuando todavía está en su zona muerta temporal. La suite
      // entera moriría con `Cannot access 'UnmappedDomainError' before initialization` sin
      // ejecutar un solo caso. Las clases de error importadas arriba sí pueden ir en tablas.
      const filter = new WalletsDomainExceptionFilter();

      // Act + Assert
      expect(() => filter.catch(new UnmappedDomainError())).toThrow(BadRequestException);
    });
  });
});

// Helpers

class UnmappedDomainError extends WalletDomainError {
  constructor() {
    super('Regla de dominio nueva sin mapeo HTTP');
  }
}

const captureError = (fn: () => unknown): Error => {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error('Se esperaba que la función lanzara un error y no lo hizo');
};
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/modules/wallets/__tests__/infrastructure/http/wallets-domain-exception.filter.spec.ts`
Expected: FAIL — `Cannot find module '../../../infrastructure/http/wallets-domain-exception.filter'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/modules/wallets/infrastructure/http/wallets-domain-exception.filter.ts
import {
  BadGatewayException,
  BadRequestException,
  Catch,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import {
  DomainExceptionFilter,
  type DomainErrorMapping,
} from '@common/http/domain-exception.filter';

import {
  AddressIndexAlreadyUsedError,
  AdminUsesMasterAddressError,
  InvalidAddressIndexError,
  InvalidTransferIdError,
  InvalidWalletIdError,
  WalletActivationInProgressError,
  WalletAddressAlreadyUsedError,
  WalletAddressIsMasterError,
  WalletAlreadyActivatedError,
  WalletAssignmentLostError,
  WalletDomainError,
  WalletNotActivatedError,
  WalletNotFoundError,
  WalletOwnerGoneError,
  WalletOwnerMismatchError,
  WalletProviderRejectedError,
  WalletProviderUnavailableError,
  WalletProviderUnreachableError,
} from '../../domain/errors/wallet.errors';

/**
 * Cuerpo del 500, idéntico al que emite la rama saneada de `AllExceptionsFilter` y al que
 * publica `buildErrorExample(500, …)`. `description` es lo que Nest escribe en `body.error`, y
 * tiene que ser `InternalServerError` —el valor de `NON_CANONICAL_ERRORS`— y no el canónico HTTP
 * `Internal Server Error`, o el cuerpo real dejaría de coincidir con el documentado.
 */
const internalServerError = (cause: WalletDomainError): InternalServerErrorException =>
  new InternalServerErrorException('Internal server error', {
    description: 'InternalServerError',
    cause,
  });

/** Mensaje fijo del 502. Un timeout NO es «no se ejecutó»: el resultado queda desconocido. */
const PROVIDER_UNREACHABLE =
  'The custodial provider did not answer; the result of the operation is unknown';

/** Mensaje fijo del 503. La causa es siempre nuestra: clave, plan o configuración. */
const PROVIDER_UNAVAILABLE = 'The custodial provider integration is unavailable';

/**
 * Traduce los errores del dominio de `wallets` al protocolo HTTP. El recorrido del mapa lo pone
 * `DomainExceptionFilter`; aquí solo la tabla de este contexto (§3.5 del spec).
 *
 * **Todas las excepciones se construyen con un STRING** —o con string más opciones, como el 500—,
 * nunca con un objeto: así Nest rellena `body.error` con el nombre canónico del status, que es lo
 * que `buildErrorExample` deriva, y el nombre de la clase de dominio no llega jamás al cliente.
 * Además, `AllExceptionsFilter` copia a `details` las claves conocidas del cuerpo de una
 * `HttpException`: con un objeto, cualquier campo que alguien añadiera ahí saldría publicado.
 *
 * ⚠️ **El orden importa: gana el PRIMER `instanceof` que coincide.** Las tres clases de proveedor
 * comparten el padre abstracto `WalletProviderError`, que NO se mapea: mapearlo se comería a las
 * tres si alguien lo pusiera por delante.
 *
 * ⚠️ **Los tres `Invalid*` de identidad e índice salen como 500, no como 400.** No son alcanzables
 * desde ninguna entrada del cliente: los cinco endpoints son «lo mío» y nadie pasa un id de
 * wallet ni un índice por la API. Si se disparan es corrupción de la fila o agotamiento de la
 * secuencia, y publicarlos como «entrada inválida» los escondería del `ErrorReporter`, que solo
 * ve 5xx — que es exactamente la información que hace falta cuando eso pasa.
 *
 * Lo que NO está en la tabla cae en el fallback 400 de la base, y ahí es donde debe caer:
 * `InvalidEthereumAddressError`, `InvalidTokenAmountError`, `InvalidTokenIdError`,
 * `MissingAssetFieldError`, `AssetFieldNotAllowedError` y `UnknownAssetKindError` son todos
 * entrada del cliente que el dominio rechaza.
 */
@Catch(WalletDomainError)
export class WalletsDomainExceptionFilter extends DomainExceptionFilter<WalletDomainError> {
  protected readonly mappings: DomainErrorMapping<WalletDomainError> = [
    [WalletNotFoundError, (error) => new NotFoundException(error.message)],
    [WalletNotActivatedError, (error) => new ConflictException(error.message)],
    [WalletActivationInProgressError, (error) => new ConflictException(error.message)],
    [WalletAlreadyActivatedError, (error) => new ConflictException(error.message)],
    /**
     * El 409 del rol admin. Lo lanzan `AssignWalletUseCase`, `ActivateWalletUseCase` y
     * `TransferAssetUseCase` a partir del `ownerRole` de su entrada: la regla no es «este usuario
     * no puede», es «el sistema tiene UNA sola EOA y ya es suya», así que vive donde está la
     * invariante y no en el controlador.
     */
    [AdminUsesMasterAddressError, (error) => new ConflictException(error.message)],
    // String constante, como `CustomerGoneError` en `orders`: si el dueño fue borrado o
    // desactivado es información interna, y para el caller significa lo mismo.
    [WalletOwnerGoneError, () => new ForbiddenException('Forbidden')],
    [InvalidWalletIdError, internalServerError],
    [InvalidTransferIdError, internalServerError],
    [InvalidAddressIndexError, internalServerError],
    [AddressIndexAlreadyUsedError, internalServerError],
    [WalletAddressAlreadyUsedError, internalServerError],
    [WalletOwnerMismatchError, internalServerError],
    [WalletAddressIsMasterError, internalServerError],
    [WalletAssignmentLostError, internalServerError],
    /**
     * El único 400 que viene del proveedor, y solo en la transferencia: es el único endpoint con
     * entrada del cliente a la que culpar. `POST /wallets` y `POST /wallets/me/activation`
     * construimos su cuerpo enteros, así que un 400 ahí llega como `misconfigured` y sale 503.
     *
     * ⚠️ `error.message` se publica, y eso solo es seguro porque el mensaje de esa clase es FIJO
     * y su `reason` sale de `PROVIDER_FAILURE_REASONS`, una lista cerrada nuestra. El `message`
     * del proveedor NUNCA: el de su 401 interpola la API key. Si alguien cambia esa clase para
     * copiar el texto del proveedor, este es el punto exacto por el que el secreto sale al
     * cliente.
     */
    [WalletProviderRejectedError, (error) => new BadRequestException(error.message)],
    /**
     * ⚠️ 502 y 503 sin `cause` y con mensaje FIJO, y las dos cosas por lo mismo: la causa real es
     * un error del transporte, y `pino-std-serializers` concatena mensajes y stacks de las
     * causas. Si ese error llevara dentro el cuerpo de la transferencia, la clave privada de la
     * master acabaría escrita en el log. El diagnóstico lo da el adaptador, que ya logueó el
     * código de motivo sin el cuerpo.
     */
    [WalletProviderUnreachableError, () => new BadGatewayException(PROVIDER_UNREACHABLE)],
    [WalletProviderUnavailableError, () => new ServiceUnavailableException(PROVIDER_UNAVAILABLE)],
  ];
}
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/modules/wallets/__tests__/infrastructure/http/wallets-domain-exception.filter.spec.ts`
Expected: PASS — 22 passed

---

### Task 39: `WalletsController` con los cinco endpoints y su documentación OpenAPI

**Layer:** infrastructure
**Rule codes to honor:** `security-use-guards`, `security-auth-jwt`, `security-rate-limiting`, `api-use-dto-serialization`, `api-use-interceptors`

⚠️ **`openapi-contract.e2e-spec.ts` rompe el build, y lo bidireccional es lo que muerde:**
declarar un 400 en un endpoint que no acepta entrada rompe igual que omitirlo. Aquí:
`POST /wallets`, `GET /wallets/me` y `POST /wallets/me/activation` **no** declaran 400 —no tienen
cuerpo ni parámetros que el `ValidationPipe` pueda rechazar—; `POST /wallets/me/transfers`
(cuerpo) y `GET /wallets/me/transfers` (query) **sí**.

⚠️ **Esta tarea deja `pnpm test:e2e` en rojo hasta que se complete la 40.** Publica ejemplos con
status 502 y 503, y `openapi-contract.e2e-spec.ts` exige que todo status de error publicado esté
en `VERIFIED_ERROR_STATUSES`, que hoy llega hasta el 500. Las dos tareas van en el mismo ciclo.

⚠️ **El controlador NO decide nada sobre el rol.** Pasa `ownerRole` —el `role` del token, jamás del
cuerpo— a los cuatro casos de uso que lo reciben, y ellos lanzan `AdminUsesMasterAddressError` para
el admin en asignar, activar y transferir. En la lectura no hay error: `FindWalletByOwnerUseCase`
devuelve `null` y **este controlador compone la respuesta `kind: 'master'`** con la dirección de la
configuración. `ListWalletTransfersUseCase` no recibe rol: al admin le sale una página vacía por el
propio filtro por dueño, que es la verdad y no un caso especial.

**Files:**

- Create: `src/modules/wallets/infrastructure/http/wallets.controller.ts`
- Test: `src/modules/wallets/__tests__/infrastructure/http/wallets.controller.spec.ts`
- Depende de: los cinco casos de uso de `application/use-cases/` con las entradas del contrato
  —`{ ownerId, ownerRole }` en los tres primeros, `{ ownerId, ownerRole, recipient, asset }` en la
  transferencia y `{ ownerId, page, limit }` en el listado—, los DTO de la tarea 37, el filtro de
  la tarea 38 y `WalletsConfig.masterAddress`.
- Depende de: `src/modules/wallets/__tests__/helpers/wallet.factory.ts` (`buildWallet`) y
  `src/modules/wallets/__tests__/helpers/wallet-transfer.factory.ts` (`buildTransfer`), creados
  por la tarea 16. Aquí solo se importan.
- Depende de: `wallets.module.ts` lo declara en `controllers`, y el escenario de cada operación
  entra en `openapi-runtime-contract.e2e-spec.ts` (tarea del E2E).

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/modules/wallets/__tests__/infrastructure/http/wallets.controller.spec.ts
import type { ConfigService } from '@nestjs/config';

import { PaginationDto } from '@common/dto/pagination.dto';

import type { ActivateWalletUseCase } from '../../../application/use-cases/activate-wallet.use-case';
import type { AssignWalletUseCase } from '../../../application/use-cases/assign-wallet.use-case';
import type { FindWalletByOwnerUseCase } from '../../../application/use-cases/find-wallet-by-owner.use-case';
import type { ListWalletTransfersUseCase } from '../../../application/use-cases/list-wallet-transfers.use-case';
import type { TransferAssetUseCase } from '../../../application/use-cases/transfer-asset.use-case';
import { WalletsController } from '../../../infrastructure/http/wallets.controller';
import { buildTransfer } from '../../helpers/wallet-transfer.factory';
import { buildWallet } from '../../helpers/wallet.factory';

const OWNER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const MASTER = '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed';
const DERIVED = '0x687422eea2cb73b5d3e242ba5456b782919afc85';
const RECIPIENT = '0xe242ba5456b782919afc85687422eea2cb73b5d3';

const USER = { sub: OWNER_ID, email: 'maria.gonzalez@empresa.com.mx', role: 'user' };
const ADMIN = { sub: OWNER_ID, email: 'admin@empresa.com.mx', role: 'admin' };

describe('WalletsController', () => {
  describe('assign()', () => {
    it('debería asignar la wallet con el ownerId y el rol del token, nunca del cuerpo', async () => {
      // Arrange
      const assign = jest
        .fn()
        .mockResolvedValue(buildWallet({ ownerId: OWNER_ID, address: DERIVED }));
      const controller = buildController({ assign });

      // Act
      const result = await controller.assign(USER);

      // Assert
      expect(assign).toHaveBeenCalledWith({ ownerId: OWNER_ID, ownerRole: 'user' });
      expect(result.address).toBe(DERIVED);
      expect(result.kind).toBe('custodial');
    });

    it('debería pasar el rol admin al caso de uso, que es quien decide el 409', async () => {
      // Arrange
      // ⚠️ La barrera NO vive aquí: la invariante «el sistema tiene UNA sola EOA y es la del
      // admin» (§3.1.1) es de negocio, y `AssignWalletUseCase` la sostiene lanzando
      // `AdminUsesMasterAddressError`, que el filtro traduce a 409. El controlador solo transporta
      // el rol; duplicar el corte aquí sería mantener la misma regla en dos sitios.
      const assign = jest.fn().mockRejectedValue(new Error('el caso de uso decide'));
      const controller = buildController({ assign });

      // Act + Assert
      await expect(controller.assign(ADMIN)).rejects.toThrow('el caso de uso decide');
      expect(assign).toHaveBeenCalledWith({ ownerId: OWNER_ID, ownerRole: 'admin' });
    });
  });

  describe('findMine()', () => {
    it('debería devolver la wallet custodiada del usuario', async () => {
      // Arrange
      const find = jest
        .fn()
        .mockResolvedValue(buildWallet({ ownerId: OWNER_ID, address: DERIVED }));
      const controller = buildController({ find });

      // Act
      const result = await controller.findMine(USER);

      // Assert
      expect(find).toHaveBeenCalledWith({ ownerId: OWNER_ID, ownerRole: 'user' });
      expect(result).toMatchObject({ kind: 'custodial', address: DERIVED });
    });

    it('debería componer la master con kind master e index nulo cuando la lectura devuelve null', async () => {
      // Arrange
      // Un 404 aquí sería mentira a medias: el admin SÍ tiene dirección, y es la que sostiene el
      // gas de todo el sistema. El caso de uso devuelve `null` porque la master no tiene fila; la
      // dirección la pone la configuración, no la tabla.
      const find = jest.fn().mockResolvedValue(null);
      const controller = buildController({ find });

      // Act
      const result = await controller.findMine(ADMIN);

      // Assert
      expect(find).toHaveBeenCalledWith({ ownerId: OWNER_ID, ownerRole: 'admin' });
      expect(result).toMatchObject({ kind: 'master', address: MASTER, index: null, id: null });
    });
  });

  describe('activate()', () => {
    it('debería activar la wallet del dueño del token pasando su rol', async () => {
      // Arrange
      const activate = jest
        .fn()
        .mockResolvedValue(buildWallet({ ownerId: OWNER_ID, address: DERIVED }));
      const controller = buildController({ activate });

      // Act
      const result = await controller.activate(USER);

      // Assert
      expect(activate).toHaveBeenCalledWith({ ownerId: OWNER_ID, ownerRole: 'user' });
      expect(result.address).toBe(DERIVED);
    });

    it('debería pasar el rol admin al caso de uso, que es quien decide el 409', async () => {
      // Arrange
      const activate = jest.fn().mockRejectedValue(new Error('el caso de uso decide'));
      const controller = buildController({ activate });

      // Act + Assert
      await expect(controller.activate(ADMIN)).rejects.toThrow('el caso de uso decide');
      expect(activate).toHaveBeenCalledWith({ ownerId: OWNER_ID, ownerRole: 'admin' });
    });
  });

  describe('transfer()', () => {
    it('debería pasar el activo como partes primitivas al caso de uso', async () => {
      // Arrange
      // El dominio construye el activo (§5.3): el controller no importa `TransferAsset` ni
      // decide la clase. Pasar la clase como `string` es lo que hace que una clase desconocida
      // salga 400 desde el dominio y no 500 por un `switch` sin rama.
      const transfer = jest.fn().mockResolvedValue(buildTransfer({ ownerId: OWNER_ID }));
      const controller = buildController({ transfer });

      // Act
      await controller.transfer(
        { recipient: RECIPIENT, kind: 'fungible', tokenAddress: DERIVED, amount: '100000' },
        USER,
      );

      // Assert
      expect(transfer).toHaveBeenCalledWith({
        ownerId: OWNER_ID,
        ownerRole: 'user',
        recipient: RECIPIENT,
        asset: {
          kind: 'fungible',
          tokenAddress: DERIVED,
          amount: '100000',
          tokenId: undefined,
        },
      });
    });

    it('debería pasar el rol admin al caso de uso, que es quien decide el 409', async () => {
      // Arrange
      const transfer = jest.fn().mockRejectedValue(new Error('el caso de uso decide'));
      const controller = buildController({ transfer });

      // Act + Assert
      await expect(
        controller.transfer({ recipient: RECIPIENT, kind: 'native', amount: '1' }, ADMIN),
      ).rejects.toThrow('el caso de uso decide');
      expect(transfer).toHaveBeenCalledWith({
        ownerId: OWNER_ID,
        ownerRole: 'admin',
        recipient: RECIPIENT,
        asset: { kind: 'native', tokenAddress: undefined, amount: '1', tokenId: undefined },
      });
    });

    it('debería exponer solo los campos del DTO, nunca la entidad', async () => {
      // Arrange
      const transfer = jest.fn().mockResolvedValue(buildTransfer({ ownerId: OWNER_ID }));
      const controller = buildController({ transfer });

      // Act
      const result = await controller.transfer(
        { recipient: RECIPIENT, kind: 'native', amount: '1' },
        USER,
      );

      // Assert
      expect(Object.keys(result).sort()).toEqual([
        'amount',
        'createdAt',
        'from',
        'id',
        'kind',
        'ownerId',
        'reason',
        'recipient',
        'status',
        'tokenAddress',
        'tokenId',
        'txId',
      ]);
    });
  });

  describe('listTransfers()', () => {
    it('debería paginar el libro con los valores por defecto cuando la query viene vacía', async () => {
      // Arrange
      const list = jest
        .fn()
        .mockResolvedValue({ items: [buildTransfer({ ownerId: OWNER_ID })], total: 1 });
      const controller = buildController({ list });

      // Act
      const result = await controller.listTransfers(USER, buildPagination());

      // Assert
      expect(list).toHaveBeenCalledWith({ ownerId: OWNER_ID, page: 1, limit: 20 });
      expect(result.meta).toMatchObject({ page: 1, limit: 20, total: 1, hasNextPage: false });
    });

    it('debería devolver una página vacía al rol admin, sin caso especial y sin pasarle el rol', async () => {
      // Arrange
      // El admin no tiene wallet custodiada, así que no tiene transferencias: la página sale
      // vacía por el propio filtro por dueño. Un `if` aquí sería lógica sin trabajo que hacer, y
      // por eso este es el único caso de uso cuya entrada no lleva `ownerRole`.
      const list = jest.fn().mockResolvedValue({ items: [], total: 0 });
      const controller = buildController({ list });

      // Act
      const result = await controller.listTransfers(ADMIN, buildPaginationOf(2, 5));

      // Assert
      expect(list).toHaveBeenCalledWith({ ownerId: OWNER_ID, page: 2, limit: 5 });
      expect(result.items).toEqual([]);
    });
  });
});

// Helpers

/**
 * Doble a mano de un caso de uso.
 *
 * El `as unknown as` es obligatorio, no pereza: los cinco casos de uso guardan sus puertos en
 * parameter properties `private readonly`, y TypeScript incluye los miembros privados en el tipo
 * de la clase, así que un objeto con solo `execute` no es asignable. Se comprueba quitando el
 * `as unknown` y ejecutando `pnpm typecheck`.
 */
const useCaseDouble = <T>(execute: jest.Mock): T => ({ execute }) as unknown as T;

type Doubles = {
  assign?: jest.Mock;
  find?: jest.Mock;
  activate?: jest.Mock;
  transfer?: jest.Mock;
  list?: jest.Mock;
};

const configWithMaster = (): ConfigService =>
  ({ getOrThrow: () => ({ masterAddress: MASTER }) }) as unknown as ConfigService;

const buildController = ({
  assign = jest.fn(),
  find = jest.fn(),
  activate = jest.fn(),
  transfer = jest.fn(),
  list = jest.fn(),
}: Doubles): WalletsController =>
  new WalletsController(
    useCaseDouble<AssignWalletUseCase>(assign),
    useCaseDouble<FindWalletByOwnerUseCase>(find),
    useCaseDouble<ActivateWalletUseCase>(activate),
    useCaseDouble<TransferAssetUseCase>(transfer),
    useCaseDouble<ListWalletTransfersUseCase>(list),
    configWithMaster(),
  );

/** Paginación con los defaults del DTO, tal como llega cuando no hay query string. */
const buildPagination = (): PaginationDto => new PaginationDto();

const buildPaginationOf = (page: number, limit: number): PaginationDto => {
  const dto = new PaginationDto();
  dto.page = page;
  dto.limit = limit;
  return dto;
};
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/modules/wallets/__tests__/infrastructure/http/wallets.controller.spec.ts`
Expected: FAIL — `Cannot find module '../../../infrastructure/http/wallets.controller'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/modules/wallets/infrastructure/http/wallets.controller.ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseFilters,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import type { AuthenticatedUser } from '@common/auth/authenticated-user';
import { ApiStandardErrors } from '@common/decorators/api-standard-errors.decorator';
import { Auth } from '@common/decorators/auth.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { ApiEnvelope, ApiPaginatedEnvelope } from '@common/dto/api-envelope.dto';
import { TIMESTAMP } from '@common/dto/error-example.factory';
import { ErrorResponseDto, ValidationErrorResponseDto } from '@common/dto/error-response.dto';
import { errorExample, requestMeta } from '@common/dto/openapi-example.helpers';
import { PaginatedResponseDto } from '@common/dto/paginated-response.dto';
import { PaginationDto } from '@common/dto/pagination.dto';
import type { WalletsConfig } from '@config/wallets.config';

import { ActivateWalletUseCase } from '../../application/use-cases/activate-wallet.use-case';
import { AssignWalletUseCase } from '../../application/use-cases/assign-wallet.use-case';
import { FindWalletByOwnerUseCase } from '../../application/use-cases/find-wallet-by-owner.use-case';
import { ListWalletTransfersUseCase } from '../../application/use-cases/list-wallet-transfers.use-case';
import { TransferAssetUseCase } from '../../application/use-cases/transfer-asset.use-case';

import { TransferFromWalletDto } from './dto/transfer-from-wallet.dto';
import { WalletResponseDto } from './dto/wallet-response.dto';
import { WalletTransferResponseDto } from './dto/wallet-transfer-response.dto';
import { WalletsDomainExceptionFilter } from './wallets-domain-exception.filter';

const COLLECTION_PATH = '/api/v1/wallets';
const ME_PATH = `${COLLECTION_PATH}/me`;
const ACTIVATION_PATH = `${ME_PATH}/activation`;
const TRANSFERS_PATH = `${ME_PATH}/transfers`;

const OWNER_ID_EXAMPLE = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const TX_ID_EXAMPLE = '0xc83f8818db43d9ba4accfe454aa44fc33123d47a4f89d47b314d6748eb0e9bc9';

/**
 * ⚠️ Los `message` de los ejemplos son lo ÚNICO que ningún guardián compara con la realidad: el
 * del contrato verifica las claves, el `error` derivado del status y el esquema; el de runtime
 * valida la respuesta real contra el esquema, no contra el texto. Estos cuatro reproducen los
 * mensajes FIJOS de `domain/errors/wallet.errors.ts` —`AdminUsesMasterAddressError`,
 * `WalletActivationInProgressError`, `WalletNotActivatedError` y `WalletNotFoundError`— y hay que
 * cotejarlos con esa tarea, porque nada los pondrá rojos si divergen.
 */
const ADMIN_USES_MASTER_EXAMPLE =
  'The admin account owns the master address and cannot use a derived one';
const ACTIVATION_IN_PROGRESS_EXAMPLE = 'An activation is already in flight for this wallet';
const WALLET_NOT_ACTIVATED_EXAMPLE = 'The wallet cannot send yet: its status is receive-only';
const WALLET_NOT_FOUND_EXAMPLE = `No wallet is assigned to owner ${OWNER_ID_EXAMPLE}`;

const PROVIDER_UNREACHABLE_EXAMPLE =
  'The custodial provider did not answer; the result of the operation is unknown';
const PROVIDER_UNAVAILABLE_EXAMPLE = 'The custodial provider integration is unavailable';

const WALLET_EXAMPLE = {
  kind: 'custodial',
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  ownerId: OWNER_ID_EXAMPLE,
  address: '0x687422eea2cb73b5d3e242ba5456b782919afc85',
  index: 7,
  status: 'receive-only',
  activationTxId: null,
} as const;

const MASTER_EXAMPLE = {
  ...WALLET_EXAMPLE,
  kind: 'master',
  id: null,
  address: '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed',
  index: null,
  status: 'active',
} as const;

const TRANSFER_EXAMPLE = {
  id: 'a3f1c2d4-5b6e-4f7a-8c9d-0e1f2a3b4c5d',
  ownerId: OWNER_ID_EXAMPLE,
  from: WALLET_EXAMPLE.address,
  recipient: '0xe242ba5456b782919afc85687422eea2cb73b5d3',
  kind: 'native',
  tokenAddress: null,
  amount: '100000',
  tokenId: null,
  status: 'submitted',
  txId: TX_ID_EXAMPLE,
  reason: null,
  createdAt: TIMESTAMP,
} as const;

/**
 * Adaptador de entrada del contexto. El dueño sale SIEMPRE del `sub` del token y jamás del
 * cuerpo: ninguno de los cinco endpoints declara un campo de dueño, así que
 * `forbidNonWhitelisted` rechaza al que lo mande. El rol viaja igual, desde el `role` del token.
 *
 * ⚠️ **Aquí no hay ninguna barrera al rol admin, y es deliberado.** La regla no es «este usuario
 * no puede», es «el sistema tiene UNA sola EOA y es la del admin» (§3.1.1): una invariante de
 * negocio, que por tanto sostienen los casos de uso. `AssignWalletUseCase`,
 * `ActivateWalletUseCase` y `TransferAssetUseCase` reciben `ownerRole` y lanzan
 * `AdminUsesMasterAddressError`, que el filtro de este contexto traduce a 409 — y lo lanzan
 * ANTES de llamar al proveedor, que es lo que evita gastar créditos y quemar gas para acabar
 * rechazando.
 *
 * `GET /wallets/me` no lanza nada: `FindWalletByOwnerUseCase` devuelve `null` y este controlador
 * compone la respuesta con `kind: 'master'` y la dirección de la configuración. Un 404 sería
 * mentira a medias, porque el admin tiene dirección y es la que sostiene todo el gas del sistema.
 *
 * Los ejemplos de las direcciones van en MINÚSCULAS a propósito. Una dirección con mayúsculas y
 * minúsculas mezcladas solo es válida si su checksum EIP-55 cuadra, y **aquí no se ha calculado
 * ninguno a mano**: un ejemplo con el checksum mal saldría publicado como cuerpo correcto y sería
 * un 400 para quien lo copiara.
 */
@ApiTags('Wallets')
@Controller('wallets')
@UseFilters(WalletsDomainExceptionFilter)
export class WalletsController {
  private readonly masterAddress: string;

  constructor(
    private readonly assignWallet: AssignWalletUseCase,
    private readonly findWalletByOwner: FindWalletByOwnerUseCase,
    private readonly activateWallet: ActivateWalletUseCase,
    private readonly transferAsset: TransferAssetUseCase,
    private readonly listWalletTransfers: ListWalletTransfersUseCase,
    configService: ConfigService,
  ) {
    this.masterAddress = configService.getOrThrow<WalletsConfig>('wallets').masterAddress;
  }

  @Auth()
  @Post()
  // 200 y no 201: la segunda llamada NO crea nada, y publicar 201 en un endpoint que la mitad de
  // las veces no crea es la clase de ficción que el guardián del contrato existe para impedir.
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'assignWallet',
    summary: 'Asigna al usuario autenticado una dirección Ethereum custodiada',
    description:
      'Reserva un índice y deriva bajo la master una gas pump address para el usuario del ' +
      'token. Es idempotente: si el usuario ya tiene dirección, devuelve la misma sin gastar ' +
      'créditos del proveedor ni consumir otro índice. La dirección nace en `receive-only`: ya ' +
      'puede RECIBIR fondos, pero para enviar hay que activarla. El rol admin recibe 409, ' +
      'porque su dirección es la master y darle además una derivada le dejaría dos.',
  })
  @ApiEnvelope(WalletResponseDto, {
    description: 'Dirección custodiada del usuario, recién asignada o ya existente.',
    example: { success: true, data: WALLET_EXAMPLE, request: requestMeta(COLLECTION_PATH) },
  })
  @ApiConflictResponse({
    description: 'El rol admin ya tiene la master: no se le asigna una dirección derivada.',
    type: ErrorResponseDto,
    example: errorExample(409, ADMIN_USES_MASTER_EXAMPLE, COLLECTION_PATH),
  })
  @ApiForbiddenResponse({
    description: 'El usuario del token ya no existe o está inactivo.',
    type: ErrorResponseDto,
    example: errorExample(403, 'Forbidden', COLLECTION_PATH),
  })
  @ApiBadGatewayResponse({
    description:
      'El proveedor no respondió, respondió algo que no cumple su propio esquema, o expiró el ' +
      'tiempo de espera. Derivar no toca la cadena, así que reintentar es seguro.',
    type: ErrorResponseDto,
    example: errorExample(502, PROVIDER_UNREACHABLE_EXAMPLE, COLLECTION_PATH),
  })
  @ApiServiceUnavailableResponse({
    description:
      'La integración con el proveedor está caída por causa nuestra: clave de API inválida, ' +
      'plan caducado o cuerpo mal construido. No es un fallo de la petición del cliente.',
    type: ErrorResponseDto,
    example: errorExample(503, PROVIDER_UNAVAILABLE_EXAMPLE, COLLECTION_PATH),
  })
  @ApiStandardErrors()
  async assign(@CurrentUser() user: AuthenticatedUser): Promise<WalletResponseDto> {
    const wallet = await this.assignWallet.execute({ ownerId: user.sub, ownerRole: user.role });
    return WalletResponseDto.fromDomain(wallet);
  }

  @Auth()
  @Get('me')
  @ApiOperation({
    operationId: 'findMyWallet',
    summary: 'Devuelve la dirección del usuario autenticado',
    description:
      'Lee la dirección asignada sin llamar al proveedor. ⚠️ Por eso el `status` puede ir por ' +
      'detrás de la cadena: una activación confirmada hace minutos puede seguir apareciendo ' +
      'como `activating` aquí. Para conocerlo con certeza, llama al endpoint de activación, que ' +
      'sí reconcilia contra el proveedor. Al rol admin le responde su master, con ' +
      '`kind: "master"` e `index` nulo: sí tiene dirección, y es la que paga el gas de todos.',
  })
  @ApiEnvelope(WalletResponseDto, {
    description: 'Dirección del usuario, custodiada o master según el rol.',
    example: { success: true, data: MASTER_EXAMPLE, request: requestMeta(ME_PATH) },
  })
  @ApiNotFoundResponse({
    description: 'El usuario todavía no ha pedido su dirección con POST /wallets.',
    type: ErrorResponseDto,
    example: errorExample(404, WALLET_NOT_FOUND_EXAMPLE, ME_PATH),
  })
  @ApiStandardErrors()
  async findMine(@CurrentUser() user: AuthenticatedUser): Promise<WalletResponseDto> {
    const wallet = await this.findWalletByOwner.execute({
      ownerId: user.sub,
      ownerRole: user.role,
    });

    // `null` es la respuesta del caso de uso para quien no tiene fila en `wallets` y sí tiene
    // dirección: el admin. La master sale de la configuración porque no está en ninguna tabla.
    return wallet === null
      ? WalletResponseDto.forMaster(user.sub, this.masterAddress)
      : WalletResponseDto.fromDomain(wallet);
  }

  @Auth()
  @Post('me/activation')
  // 202 y no 200: la transacción de activación está ENVIADA, no minada. Prometer 200 sería
  // afirmar que al volver la dirección ya puede enviar, y no es verdad.
  @HttpCode(HttpStatus.ACCEPTED)
  // Límite propio, más estricto que el global: cada llamada gasta 3 créditos y QUEMA GAS de la
  // master, así que el techo real no es la CPU sino el saldo. 10/min es el mismo que llevan los
  // dos endpoints de `auth`, y `ThrottlerGuard` cuenta por clase Y handler, así que activar y
  // transferir tienen contadores separados.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    operationId: 'activateMyWallet',
    summary: 'Activa la dirección del usuario para poder enviar',
    description:
      'Pregunta primero al proveedor si la dirección ya puede enviar —y si puede, se limita a ' +
      'reconciliar nuestro estado— y, si no, envía la transacción de activación pagando el gas ' +
      'con la master. Responde 202 con la wallet en `activating`: la transacción está enviada, ' +
      'no minada. Repetir la llamada sobre una activación en curso responde 409, no repite el ' +
      'envío: activar dos veces quema el gas dos veces y el proveedor lo acepta sin quejarse.',
  })
  @ApiEnvelope(WalletResponseDto, {
    status: HttpStatus.ACCEPTED,
    description: 'Activación enviada, o estado reconciliado si la cadena ya la tenía activa.',
    example: {
      success: true,
      data: { ...WALLET_EXAMPLE, status: 'activating', activationTxId: TX_ID_EXAMPLE },
      request: requestMeta(ACTIVATION_PATH),
    },
  })
  @ApiConflictResponse({
    description:
      'Hay una activación en curso, la dirección ya está activa, o el rol admin ha pedido ' +
      'activar una master que no lo necesita.',
    type: ErrorResponseDto,
    example: errorExample(409, ACTIVATION_IN_PROGRESS_EXAMPLE, ACTIVATION_PATH),
  })
  @ApiForbiddenResponse({
    description: 'El usuario del token ya no existe o está inactivo.',
    type: ErrorResponseDto,
    example: errorExample(403, 'Forbidden', ACTIVATION_PATH),
  })
  @ApiNotFoundResponse({
    description: 'El usuario todavía no ha pedido su dirección con POST /wallets.',
    type: ErrorResponseDto,
    example: errorExample(404, WALLET_NOT_FOUND_EXAMPLE, ACTIVATION_PATH),
  })
  @ApiBadGatewayResponse({
    description:
      'El proveedor no respondió o su respuesta no cumple su esquema. ⚠️ Un timeout NO ' +
      'significa que no se ejecutara: la activación pudo enviarse igualmente.',
    type: ErrorResponseDto,
    example: errorExample(502, PROVIDER_UNREACHABLE_EXAMPLE, ACTIVATION_PATH),
  })
  @ApiServiceUnavailableResponse({
    description: 'La integración con el proveedor está caída por causa nuestra.',
    type: ErrorResponseDto,
    example: errorExample(503, PROVIDER_UNAVAILABLE_EXAMPLE, ACTIVATION_PATH),
  })
  @ApiStandardErrors()
  async activate(@CurrentUser() user: AuthenticatedUser): Promise<WalletResponseDto> {
    const wallet = await this.activateWallet.execute({ ownerId: user.sub, ownerRole: user.role });
    return WalletResponseDto.fromDomain(wallet);
  }

  @Auth()
  @Post('me/transfers')
  @HttpCode(HttpStatus.OK)
  // Mismo motivo y mismo límite que en la activación: 3 créditos y gas de la master por llamada.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    operationId: 'transferFromMyWallet',
    summary: 'Envía un activo desde la dirección del usuario',
    description:
      'Envía moneda nativa, un token fungible, un NFT o un multi-token desde la dirección ' +
      'custodiada del usuario. El origen es SIEMPRE su dirección: la master firma y paga el ' +
      'gas, no envía. La fila del libro se escribe ANTES de llamar al proveedor, así que un ' +
      'timeout deja rastro con estado `unknown` en vez de desaparecer. La dirección debe estar ' +
      'activa (409 si no lo está) y el destinatario con checksum EIP-55 correcto si viene con ' +
      'la caja mezclada.',
  })
  // El contract guard NO valida los examples de request contra el schema: completos a mano.
  @ApiBody({
    type: TransferFromWalletDto,
    examples: {
      native: {
        summary: 'Moneda nativa: solo importe',
        value: {
          recipient: '0xe242ba5456b782919afc85687422eea2cb73b5d3',
          kind: 'native',
          amount: '1000000000000000000',
        },
      },
      nft: {
        summary: 'NFT: token e identificador, nunca importe',
        value: {
          recipient: '0xe242ba5456b782919afc85687422eea2cb73b5d3',
          kind: 'nft',
          tokenAddress: '0x782919afc85eea2cb736874225456bb5d3e242ba',
          tokenId: '100000',
        },
      },
      multiToken: {
        // La clave del ejemplo es un identificador y va en camelCase; el VALOR publicado lleva
        // guion, `multi-token`, que es la única grafía del vocabulario.
        summary: 'Multi-token: token, importe e identificador, los tres',
        value: {
          recipient: '0xe242ba5456b782919afc85687422eea2cb73b5d3',
          kind: 'multi-token',
          tokenAddress: '0x782919afc85eea2cb736874225456bb5d3e242ba',
          amount: '5',
          tokenId: '100000',
        },
      },
    },
  })
  @ApiEnvelope(WalletTransferResponseDto, {
    description: 'Fila del libro con lo que sabemos del envío.',
    example: { success: true, data: TRANSFER_EXAMPLE, request: requestMeta(TRANSFERS_PATH) },
  })
  @ApiBadRequestResponse({
    description:
      'El cuerpo no supera la validación de entrada, el dominio rechaza la combinación de ' +
      'campos para esa clase de activo, o el proveedor rechazó el cuerpo. ⚠️ Límite reconocido: ' +
      'el proveedor devuelve el mismo error cuando el destinatario es inválido —culpa del ' +
      'cliente— y cuando la master no tiene fondos —culpa nuestra—, así que algunos 503 salen ' +
      'hoy como 400.',
    type: ValidationErrorResponseDto,
    example: errorExample(
      400,
      'recipient must be an Ethereum address with a valid EIP-55 checksum',
      TRANSFERS_PATH,
    ),
  })
  @ApiConflictResponse({
    description:
      'La dirección todavía no está activa, o el rol admin ha intentado enviar desde la master.',
    type: ErrorResponseDto,
    example: errorExample(409, WALLET_NOT_ACTIVATED_EXAMPLE, TRANSFERS_PATH),
  })
  @ApiForbiddenResponse({
    description: 'El usuario del token ya no existe o está inactivo.',
    type: ErrorResponseDto,
    example: errorExample(403, 'Forbidden', TRANSFERS_PATH),
  })
  @ApiNotFoundResponse({
    description: 'El usuario todavía no ha pedido su dirección con POST /wallets.',
    type: ErrorResponseDto,
    example: errorExample(404, WALLET_NOT_FOUND_EXAMPLE, TRANSFERS_PATH),
  })
  @ApiBadGatewayResponse({
    description:
      'El proveedor no respondió o su respuesta no cumple su esquema. ⚠️ El envío **pudo ' +
      'minarse o no**: la fila del libro queda en `unknown`, que es literalmente lo que sabemos.',
    type: ErrorResponseDto,
    example: errorExample(502, PROVIDER_UNREACHABLE_EXAMPLE, TRANSFERS_PATH),
  })
  @ApiServiceUnavailableResponse({
    description: 'La integración con el proveedor está caída por causa nuestra.',
    type: ErrorResponseDto,
    example: errorExample(503, PROVIDER_UNAVAILABLE_EXAMPLE, TRANSFERS_PATH),
  })
  @ApiStandardErrors()
  async transfer(
    @Body() dto: TransferFromWalletDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WalletTransferResponseDto> {
    // Partes primitivas, no un `TransferAsset`: el dominio construye el activo (§5.3) y la clase
    // viaja como `string` para que una desconocida muera en el dominio con un 400 con nombre.
    const transfer = await this.transferAsset.execute({
      ownerId: user.sub,
      ownerRole: user.role,
      recipient: dto.recipient,
      asset: {
        kind: dto.kind,
        tokenAddress: dto.tokenAddress,
        amount: dto.amount,
        tokenId: dto.tokenId,
      },
    });
    return WalletTransferResponseDto.fromDomain(transfer);
  }

  @Auth()
  @Get('me/transfers')
  @ApiOperation({
    operationId: 'listMyWalletTransfers',
    summary: 'Lista el libro de transferencias del usuario, paginado',
    description:
      'Devuelve las transferencias del usuario del token, de la más reciente a la más antigua. ' +
      'No llama al proveedor: publica lo que el libro sabe. ⚠️ Una fila en `unknown` significa ' +
      'que el envío pudo minarse o no, y este ciclo no consulta la cadena para resolverlo. Al ' +
      'rol admin le devuelve una página vacía, porque la master no envía por gas pump.',
  })
  @ApiPaginatedEnvelope(WalletTransferResponseDto, {
    description: 'Página del libro de transferencias.',
    example: {
      success: true,
      data: {
        items: [TRANSFER_EXAMPLE],
        meta: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      },
      request: requestMeta(TRANSFERS_PATH),
    },
  })
  @ApiBadRequestResponse({
    description: 'La paginación no supera la validación de entrada.',
    type: ValidationErrorResponseDto,
    example: errorExample(
      400,
      'page must not be less than 1, limit must not be greater than 100',
      `${TRANSFERS_PATH}?page=0&limit=101`,
    ),
  })
  @ApiStandardErrors()
  async listTransfers(
    @CurrentUser() user: AuthenticatedUser,
    @Query() pagination: PaginationDto,
  ): Promise<PaginatedResponseDto<WalletTransferResponseDto>> {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;

    // `page`/`limit` y no `skip`/`take` (§5 del spec): la aritmética del desplazamiento vive en
    // el caso de uso, que es quien conoce el orden con el que se lee el libro. Y sin `ownerRole`:
    // este es el único de los cinco cuya entrada no lo lleva, porque al admin le basta el filtro
    // por dueño para recibir la página vacía que le corresponde.
    const result = await this.listWalletTransfers.execute({ ownerId: user.sub, page, limit });

    return PaginatedResponseDto.of(
      result.items.map((transfer) => WalletTransferResponseDto.fromDomain(transfer)),
      result.total,
      page,
      limit,
    );
  }
}
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/modules/wallets/__tests__/infrastructure/http/wallets.controller.spec.ts`
Expected: PASS — 11 passed

---

### Task 40: Contrastar el 502 y el 503 contra `AllExceptionsFilter`, y solo entonces ampliar `VERIFIED_ERROR_STATUSES`

**Layer:** common
**Rule codes to honor:** `error-use-exception-filters`, `api-use-dto-serialization`

⚠️ **El orden es la tarea.** `VERIFIED_ERROR_STATUSES` es una promesa que `openapi-contract.e2e-spec.ts`
consume para rechazar status sin contrastar. Ampliarla antes de escribir los casos deja al guardián
en verde afirmando algo que nadie comprobó, que es justo el fallo que la cabecera de esa constante
describe. Aquí se hace al revés y además se cierra la puerta: el conjunto `covered` deja de ser un
literal a mano y **se deriva de la tabla de casos**, así que declarar un status cubierto sin tener
su excepción real deja de ser posible.

**Files:**

- Modify: `src/common/__tests__/dto/error-example.factory.spec.ts`
- Modify: `src/common/dto/error-example.factory.ts`

- [ ] **Step 1: Escribe el test que falla — la tabla de casos pasa a ser la fuente de `covered`**

Reemplaza el contenido de `src/common/__tests__/dto/error-example.factory.spec.ts` por este:

```ts
// src/common/__tests__/dto/error-example.factory.spec.ts
import { NoopErrorReporter } from '@common/observability/error-reporter';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  type ArgumentsHost,
  type HttpException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { HttpAdapterHost } from '@nestjs/core';
import { ThrottlerException } from '@nestjs/throttler';
import type { PinoLogger } from 'nestjs-pino';

import { buildErrorExample, VERIFIED_ERROR_STATUSES } from '../../dto/error-example.factory';
import { AllExceptionsFilter, type ErrorPayload } from '../../filters/all-exceptions.filter';

/**
 * Cierra el flanco que el guardián del contrato no puede cubrir por sí solo.
 *
 * `openapi-contract.e2e-spec.ts` comprueba que los `example` publicados coinciden con
 * `buildErrorExample`, pero como esos ejemplos **salen** de la factoría, esa comparación solo
 * verifica consistencia interna: si la factoría empezara a producir un cuerpo falso, los
 * ejemplos lo heredarían y el guardián seguiría en verde. Medido, no supuesto.
 *
 * Aquí se contrasta la factoría contra la única fuente de verdad, `AllExceptionsFilter`, pasando
 * excepciones reales por su `catch()`. Sin servidor, sin base de datos y sin fixtures, así que
 * cubre **todos** los status —incluidos los que ningún endpoint ejercita todavía—, no solo los
 * que tienen un E2E escrito.
 */
describe('buildErrorExample', () => {
  const PATH = '/api/v1/resource';

  /**
   * Los status contrastados con una excepción REAL, y la única fuente de la lista.
   *
   * Estaba duplicada: la tabla del `it.each` por un lado y un `new Set([...])` escrito a mano en
   * el caso de cobertura por otro. Esa duplicación era el hueco por el que se podía declarar un
   * status «cubierto» sin escribir su excepción: bastaba con añadirlo a las dos listas de
   * literales y a `VERIFIED_ERROR_STATUSES`, y los tres guardianes se quedaban verdes sin que
   * nadie hubiera pasado nada por el filtro. Con `covered` derivado de aquí, eso no compila.
   */
  const VERIFIED_CASES: [label: string, status: number, makeException: () => HttpException][] = [
    ['400', 400, () => new BadRequestException('email must be a valid address')],
    ['401', 401, () => new UnauthorizedException('Unauthorized')],
    ['403', 403, () => new ForbiddenException('Forbidden')],
    ['404', 404, () => new NotFoundException('User abc was not found')],
    ['409', 409, () => new ConflictException('Email a@b.com is already registered')],
    ['429', 429, () => new ThrottlerException()],
    // Los dos que trae `wallets`, con los mensajes FIJOS que emite su filtro de dominio: 502
    // cuando el proveedor de custodia no responde o su respuesta no cumple su propio esquema,
    // 503 cuando la integración está caída por causa nuestra. Se construyen con STRING, como los
    // de arriba, porque es lo que hace que Nest rellene `body.error` con el nombre canónico que
    // `expectedErrorName` deriva del status.
    [
      '502',
      502,
      () =>
        new BadGatewayException(
          'The custodial provider did not answer; the result of the operation is unknown',
        ),
    ],
    [
      '503',
      503,
      () => new ServiceUnavailableException('The custodial provider integration is unavailable'),
    ],
  ];

  // 401 y 403 se construyen con un STRING (`new UnauthorizedException('Unauthorized')`), nunca
  // sin argumento: `new UnauthorizedException()` serializa sin `error` propio y el filtro cae a
  // `exception.name` (`UnauthorizedException`, no canónico), que es exactamente lo que
  // `NON_CANONICAL_ERRORS` documenta para 429/500. La promesa canónica `error: 'Unauthorized'` /
  // `'Forbidden'` que publica `buildErrorExample` solo se sostiene si `JwtAuthGuard` construye
  // sus excepciones así; `openapi-contract.e2e-spec.ts` es el guardián end-to-end que lo
  // comprueba contra el documento real, no solo contra este contraste.
  it.each(VERIFIED_CASES)(
    'debería producir para %s el mismo cuerpo que AllExceptionsFilter',
    (_label, status, makeException) => {
      // Arrange
      const { filter, reply } = buildFilter();

      // Act
      filter.catch(makeException(), buildHost(PATH));
      const actual = reply.mock.calls[0]?.[1] as ErrorPayload;
      const documented = buildErrorExample(status, { path: PATH, message: actual.message });

      // Assert
      // `timestamp` y `requestId` se igualan: cambian en cada respuesta y no forman parte del
      // contrato de forma. Todo lo demás —claves exactas, `statusCode`, `error`, `path`— sí.
      expect({
        ...actual,
        timestamp: documented.timestamp,
        requestId: documented.requestId,
      }).toEqual(documented);
    },
  );

  it('debería cubrir con casos reales todos los status que declara verificados', () => {
    // Arrange
    // 500 no está en la tabla y se suma aquí: su cuerpo no sale de una `HttpException` sino de
    // la rama `isProductionLike` del filtro, y por eso tiene su propio caso más abajo.
    const covered = new Set([...VERIFIED_CASES.map(([, status]) => status), 500]);

    // Act
    const uncovered = [...VERIFIED_ERROR_STATUSES].filter((status) => !covered.has(status));

    // Assert
    // `VERIFIED_ERROR_STATUSES` es una promesa que el guardián del contrato consume para
    // rechazar status sin contrastar. Este test es lo que impide que esa promesa se firme sin
    // cumplirse: añadir un 422 al conjunto sin escribir su caso de arriba pone esto en rojo.
    expect(uncovered).toEqual([]);
  });

  it('debería producir para 500 el cuerpo saneado que el filtro emite en producción', () => {
    // Arrange
    // La rama `isProductionLike` es la que importa documentar: en desarrollo el filtro deja
    // pasar el mensaje real, y publicar ese ejemplo filtraría topología interna.
    const { filter, reply } = buildFilter(true);

    // Act
    filter.catch(new TypeError('connect ECONNREFUSED 10.0.1.5:5432'), buildHost(PATH));
    const actual = reply.mock.calls[0]?.[1] as ErrorPayload;
    const documented = buildErrorExample(500, { path: PATH, message: actual.message });

    // Assert
    expect({ ...actual, timestamp: documented.timestamp, requestId: documented.requestId }).toEqual(
      documented,
    );
    expect(actual.message).toBe('Internal server error');
  });
});

// Helpers

const buildHost = (url: string): ArgumentsHost =>
  ({
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({ id: 'req-x', url }),
      getResponse: () => ({}),
    }),
  }) as unknown as ArgumentsHost;

const buildFilter = (isProductionLike = false) => {
  const reply = jest.fn();
  const httpAdapterHost = {
    httpAdapter: { getRequestUrl: (req: { url: string }) => req.url, reply },
  } as unknown as HttpAdapterHost;
  const logger = {
    setContext: jest.fn(),
    fatal: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  } as unknown as PinoLogger;
  const config = { getOrThrow: () => ({ isProductionLike }) } as unknown as ConfigService;

  // El reporter real que no hace nada, no un doble: esta suite comprueba el CUERPO del error, y
  // un `jest.fn()` aquí solo añadiría ruido a un punto que no está bajo prueba.
  return {
    filter: new AllExceptionsFilter(httpAdapterHost, logger, config, new NoopErrorReporter()),
    reply,
  };
};
```

- [ ] **Step 2: Ejecuta el test y comprueba qué pasa exactamente**

Run: `pnpm test src/common/__tests__/dto/error-example.factory.spec.ts`
Expected: PASS — 10 passed (8 filas de la tabla + cobertura + 500)

⚠️ **Aquí NO hay rojo previo, y decirlo importa**: este paso no añade comportamiento, **mide** el
que ya existe. Las dos filas nuevas pasan a la primera porque `expectedErrorName` deriva el nombre
canónico de `node:http` para cualquier status, y ese es precisamente el hecho que había que
comprobar en vez de suponer: que 502 y 503 siguen la regla canónica y no traen un `body.error`
propio. El rojo del ciclo llega en el paso 3, y llega **por el lado correcto**: si alguien amplía
la constante sin haber escrito estas filas, el caso de cobertura se pone rojo y lo nombra.

- [ ] **Step 3: Comprueba que el rojo aparece si el orden se invierte**

Run: `pnpm test src/common/__tests__/dto/error-example.factory.spec.ts -t "todos los status que declara verificados"`
tras editar `VERIFIED_ERROR_STATUSES` **sin** las filas del paso 1 (deshaz el paso 1
temporalmente, o borra las dos filas).
Expected: FAIL — `expect(received).toEqual(expected)` con `Received: [502, 503]`

Vuelve a dejar las filas del paso 1 antes de seguir. Este paso no cambia código: comprueba que
el guardián guarda de verdad, que es la regla del repo sobre no fiarse de un test de regresión sin
romperlo a propósito.

- [ ] **Step 4: Amplía `VERIFIED_ERROR_STATUSES`**

```ts
// src/common/dto/error-example.factory.ts
export const VERIFIED_ERROR_STATUSES: ReadonlySet<number> = new Set([
  400, 401, 403, 404, 409, 429, 500, 502, 503,
]);
```

502 y 503 entran ahora, y solo ahora, porque el paso 1 los pasó por `AllExceptionsFilter` de
verdad. `wallets` es su primer productor: 502 cuando el proveedor de custodia no responde o
devuelve un 200 que no cumple su propio esquema, 503 cuando la integración está caída por causa
nuestra —clave de API muerta, plan caducado, cuerpo mal construido—.

⚠️ El 503 de `/health` **sigue exento** por `KNOWN_ERROR_SHAPE_ANOMALIES` y esto no lo cambia: su
cuerpo se aparta de `ErrorPayload` porque `HealthCheckService` lanza
`ServiceUnavailableException(result)` con el objeto de Terminus. Esa exención describe una anomalía
de forma, no un status sin contrastar, y las dos cosas son independientes.

- [ ] **Step 5: Ejecuta la suite completa de `common` para verificar que pasa**

Run: `pnpm test src/common/__tests__/dto/`
Expected: PASS — todas las suites de `common/dto` en verde, `error-example.factory.spec.ts` con 10
casos.

⚠️ El cierre real de esta tarea es `pnpm test:e2e`: `openapi-contract.e2e-spec.ts` es quien
consume la constante, y hasta este punto estaba en rojo con
`POST /api/v1/wallets/me/transfers → 502` y `→ 503` desde que la tarea 39 publicó esos ejemplos.

---

### Task 41: Cableado de `WalletsModule` en la aplicación y en los gates transversales

**Layer:** bootstrap
**Rule codes to honor:** `arch-feature-modules`, `arch-avoid-circular-deps`, `di-use-interfaces-tokens`, `di-prefer-constructor-injection`, `devops-use-config-module`

**Files:**

- Create: `src/modules/wallets/wallets.module.ts`
- Modify: `src/app.module.ts`, `commitlint.config.cjs`, `eslint.config.mjs`, `CLAUDE.md`
- Test: `src/__tests__/module-registration.spec.ts` (nuevo), `src/modules/wallets/__tests__/wallets.module.e2e-spec.ts` (nuevo)

Dos tests y dos ciclos rojo→verde, porque cubren dos fallos distintos y ninguno caza el del otro:
el unitario caza el **olvido administrativo** (módulo que existe pero no está ni en `app.module.ts`
ni en `commitlint.config.cjs`) leyendo el disco, sin base de datos; el E2E caza el **grafo de DI
roto** (un `import type` de un puerto, un `useClass` mal atado) compilando el `AppModule` real.

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/__tests__/module-registration.spec.ts
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');

/**
 * Contrato administrativo de un bounded context: existir en `src/modules/` no basta para estar
 * en la aplicación.
 *
 * Nombra el FALLO que evita, que es doble y silencioso en las dos mitades:
 *
 *   1. Un módulo ausente de `app.module.ts` compila, pasa lint y typecheck, y sus tests
 *      unitarios siguen verdes — porque instancian las clases a mano. Lo único que falla es la
 *      aplicación: la ruta devuelve 404 y nadie sabe por qué. `openapi-runtime-contract` sí lo
 *      cazaría, pero solo después de que alguien escriba su escenario, y ese escenario se
 *      escribe DESPUÉS.
 *   2. Un scope ausente de `commitlint.config.cjs` no rompe nada hasta el `git commit`, y
 *      entonces el camino de menor resistencia es commitear sin scope. Es literalmente lo que
 *      pasó con la reestructuración hexagonal, y por eso el comentario de ese archivo lo pide.
 *
 * Se deriva del disco y no de una lista escrita aquí: una lista habría que mantenerla, y sería
 * el mismo olvido una capa más arriba.
 */
describe('registro de un bounded context', () => {
  const MODULES_DIR = path.join(ROOT, 'src', 'modules');

  const contexts = readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const appModuleSource = readFileSync(path.join(ROOT, 'src', 'app.module.ts'), 'utf-8');
  const commitlintSource = readFileSync(path.join(ROOT, 'commitlint.config.cjs'), 'utf-8');

  it('debería importar en app.module.ts el module file de cada contexto', () => {
    // Arrange
    const expected = contexts.map((context) => `@modules/${context}/${context}.module`);

    // Act
    const missing = expected.filter((specifier) => !appModuleSource.includes(specifier));

    // Assert
    expect(missing).toEqual([]);
  });

  it('debería declarar en commitlint.config.cjs el scope de cada contexto', () => {
    // Arrange
    // El bloque se recorta desde `'scope-enum'` hasta el final del archivo: después de esa
    // regla no queda nada más, así que el recorte captura la lista entera sin parsear JS.
    const scopeBlock = commitlintSource.slice(commitlintSource.indexOf("'scope-enum'"));
    const declared = new Set([...scopeBlock.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]));

    // Act
    const missing = contexts.filter((context) => !declared.has(context));

    // Assert
    expect(missing).toEqual([]);
  });
});
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/__tests__/module-registration.spec.ts`
Expected: FAIL — dos casos rojos, `expect(received).toEqual(expected)` con
`Received: ["@modules/wallets/wallets.module"]` y `Received: ["wallets"]`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// src/modules/wallets/wallets.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsersModule } from '../users/users.module';

import { ActivateWalletUseCase } from './application/use-cases/activate-wallet.use-case';
import { AssignWalletUseCase } from './application/use-cases/assign-wallet.use-case';
import { FindWalletByOwnerUseCase } from './application/use-cases/find-wallet-by-owner.use-case';
import { ListWalletTransfersUseCase } from './application/use-cases/list-wallet-transfers.use-case';
import { TransferAssetUseCase } from './application/use-cases/transfer-asset.use-case';
import { AddressIndexAllocator } from './domain/ports/address-index.allocator';
import { CustodialAddressGateway } from './domain/ports/custodial-address.gateway';
import { OwnerDirectory } from './domain/ports/owner.directory';
import { WalletRepository } from './domain/ports/wallet.repository';
import { WalletTransferRepository } from './domain/ports/wallet-transfer.repository';
import { TatumCustodialAddressGateway } from './infrastructure/gateways/tatum-custodial-address.gateway';
import { TatumHttpClient } from './infrastructure/gateways/tatum-http.client';
import { UsersOwnerDirectory } from './infrastructure/gateways/users-owner.directory';
import { WalletsController } from './infrastructure/http/wallets.controller';
import { SequenceAddressIndexAllocator } from './infrastructure/persistence/sequence-address-index.allocator';
import { WalletOrmEntity } from './infrastructure/persistence/wallet.orm-entity';
import { WalletTypeOrmRepository } from './infrastructure/persistence/wallet.typeorm.repository';
import { WalletTransferOrmEntity } from './infrastructure/persistence/wallet-transfer.orm-entity';
import { WalletTransferTypeOrmRepository } from './infrastructure/persistence/wallet-transfer.typeorm.repository';
import { MasterKeyStartupCheck } from './infrastructure/security/master-key-startup.check';

/**
 * Composition root del contexto. `UsersModule` se importa por su module file —la única puerta
 * cross-módulo (regla 3 + enmienda G1)— y de él solo se consume `UsersLookup`, inyectada en el
 * adaptador del directorio. `wallets` NO importa `auth.module`: `@Auth()` protege los cinco
 * endpoints porque `APP_GUARD` es multi-provider y `auth` ya registró el guard globalmente, así
 * que de `auth` no se consume ni un símbolo.
 *
 * Ni `exports` ni re-export de tipos al final del archivo: nadie consume `wallets`. La fachada
 * es opcional en `docs/module-blueprint.md` y escribirla sin consumidor sería superficie pública
 * que hay que mantener y que ningún compilador comprueba que siga siendo correcta.
 *
 * `TatumHttpClient` es un provider suelto, sin puerto: no es un contrato del dominio sino la
 * pieza de transporte que el gateway compone. Ponerle un puerto habría publicado `fetch` como
 * concepto de negocio.
 *
 * ⚠️ `MasterKeyStartupCheck` está en `providers` y esa línea es la comprobación entera. Nest no
 * instancia lo que no registra, así que sin ella la clase existe, sus tests unitarios siguen
 * verdes y su `OnModuleInit` NO CORRE NUNCA: la aplicación arrancaría con una dirección de master
 * que no corresponde a la clave privada configurada, y eso solo se vería en el primer envío, con
 * el gas ya gastado.
 */
@Module({
  imports: [TypeOrmModule.forFeature([WalletOrmEntity, WalletTransferOrmEntity]), UsersModule],
  controllers: [WalletsController],
  providers: [
    TatumHttpClient,
    MasterKeyStartupCheck,
    // El token es la propia `abstract class` del puerto: quien la declare como tipo de un
    // parámetro de constructor la recibe sin `@Inject`. Que el adaptador cumpla el puerto lo
    // garantiza su `implements`, no estas líneas — `ClassProvider.provide` está tipado `any`.
    { provide: WalletRepository, useClass: WalletTypeOrmRepository },
    { provide: WalletTransferRepository, useClass: WalletTransferTypeOrmRepository },
    { provide: AddressIndexAllocator, useClass: SequenceAddressIndexAllocator },
    { provide: CustodialAddressGateway, useClass: TatumCustodialAddressGateway },
    { provide: OwnerDirectory, useClass: UsersOwnerDirectory },
    AssignWalletUseCase,
    FindWalletByOwnerUseCase,
    ActivateWalletUseCase,
    TransferAssetUseCase,
    ListWalletTransfersUseCase,
  ],
})
export class WalletsModule {}
```

```ts
// src/app.module.ts — dos ediciones, el import y la entrada en `imports`
import { UsersModule } from '@modules/users/users.module';
import { WalletsModule } from '@modules/wallets/wallets.module';
```

```ts
// src/app.module.ts — dentro de `imports`, después de OrdersModule
    OrdersModule,
    // `wallets` va el último por la misma razón que `orders`: depende de `UsersModule`, que ya
    // está arriba. La dirección es de una sola vía (wallets → users) y así se lee en la lista.
    WalletsModule,
```

```js
// commitlint.config.cjs — dentro de `scope-enum`, en el bloque de bounded contexts
        // Bounded contexts (src/modules/<context>/)
        'health',
        'users',
        'auth',
        'orders',
        'wallets',
```

⚠️ **Esta tarea es la ÚNICA que edita `eslint.config.mjs` en todo el ciclo**, y lo hace de una
sola vez con la lista cerrada FINAL: los siete nombres que ya existían más los CUATRO datos que
acompañan a los puertos de `wallets` (`WalletSaveOutcome` del repositorio de wallets,
`FindTransfersCriteria` y `TransferPage` del repositorio de transferencias, y `SendCommand` del
gateway custodial). Once nombres, en orden alfabético. Ninguna otra tarea del plan toca este
archivo: la que necesite un `type` inline de un puerto de `wallets` ya lo tiene legalizado aquí.

```js
// eslint.config.mjs — la lista cerrada del segundo selector, FINAL y completa: 7 + 4
          selector:
            'ImportDeclaration[source.value=/(ports\\/|\\.module$)/] > ImportSpecifier[importKind="type"]:not([imported.name=/^(CreateProfileResult|DirectoryUser|FindTransfersCriteria|FindUsersCriteria|SendCommand|SignedToken|TokenClaims|TransferPage|UserPage|UserSummary|WalletSaveOutcome)$/])',
```

```md
<!-- CLAUDE.md — sección «Architecture rules», la frase que enumera los contextos -->

There are four: `users` (profiles), `auth` (credentials and tokens), `orders` and `wallets`
(custodial Ethereum addresses), plus the flat `health`.
```

```md
<!-- CLAUDE.md — sección «Architecture rules», la viñeta de la lista cerrada -->

- **Inline `type` stays legal for the data that travels with a port** — `UserPage`,
  `FindUsersCriteria`, `SignedToken`, `TokenClaims`, `DirectoryUser`, `CreateProfileResult`,
  `UserSummary`, `WalletSaveOutcome`, `FindTransfersCriteria`, `TransferPage`, `SendCommand` are
  not injectable, so `import { UserRepository, type UserPage } from '…'` is the correct shape.
  Those eleven names are a **closed list inside the lint rule**, because nothing in the import
  site distinguishes a port from its data: the specifier selector fails closed, so a port marked
  `type` by accident goes red on its own and a genuinely new data type costs one reviewed line in
  `eslint.config.mjs`.
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/__tests__/module-registration.spec.ts`
Expected: PASS — 2 passed

- [ ] **Step 5: Escribe el segundo test que falla**

```ts
// src/modules/wallets/__tests__/wallets.module.e2e-spec.ts
import { Test, type TestingModule } from '@nestjs/testing';

import { AppModule } from '../../../app.module';
import { AddressIndexAllocator } from '../domain/ports/address-index.allocator';
import { CustodialAddressGateway } from '../domain/ports/custodial-address.gateway';
import { OwnerDirectory } from '../domain/ports/owner.directory';
import { WalletRepository } from '../domain/ports/wallet.repository';
import { WalletTransferRepository } from '../domain/ports/wallet-transfer.repository';
import { TatumCustodialAddressGateway } from '../infrastructure/gateways/tatum-custodial-address.gateway';
import { UsersOwnerDirectory } from '../infrastructure/gateways/users-owner.directory';
import { WalletsController } from '../infrastructure/http/wallets.controller';
import { SequenceAddressIndexAllocator } from '../infrastructure/persistence/sequence-address-index.allocator';
import { WalletTypeOrmRepository } from '../infrastructure/persistence/wallet.typeorm.repository';
import { WalletTransferTypeOrmRepository } from '../infrastructure/persistence/wallet-transfer.typeorm.repository';
import { MasterKeyStartupCheck } from '../infrastructure/security/master-key-startup.check';

/**
 * E2E porque compilar `AppModule` abre la conexión a PostgreSQL (`pnpm db:up`).
 *
 * Lo que caza y ningún gate estático caza: un `import type` de un puerto en un archivo con
 * decoradores. La referencia se elide, la metadata no se emite, `lint:check` y `typecheck`
 * quedan VERDES y Nest revienta al resolver con «Nest can't resolve dependencies of the
 * AssignWalletUseCase (?, …)». La regla de `eslint.config.mjs` cubre los `ports/` y los
 * `*.module` ajenos; este test cubre el resto del grafo, resolviendo cada token de verdad.
 */
describe('WalletsModule', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('debería resolver el repositorio de wallets por el token de su puerto', () => {
    // Act
    const repository = moduleRef.get(WalletRepository, { strict: false });

    // Assert
    expect(repository).toBeInstanceOf(WalletTypeOrmRepository);
  });

  it('debería resolver el repositorio de transferencias por el token de su puerto', () => {
    // Act
    const repository = moduleRef.get(WalletTransferRepository, { strict: false });

    // Assert
    expect(repository).toBeInstanceOf(WalletTransferTypeOrmRepository);
  });

  it('debería resolver el asignador de índices por el token de su puerto', () => {
    // Act
    const allocator = moduleRef.get(AddressIndexAllocator, { strict: false });

    // Assert
    expect(allocator).toBeInstanceOf(SequenceAddressIndexAllocator);
  });

  it('debería resolver el gateway del proveedor custodial por el token de su puerto', () => {
    // Act
    const gateway = moduleRef.get(CustodialAddressGateway, { strict: false });

    // Assert
    expect(gateway).toBeInstanceOf(TatumCustodialAddressGateway);
  });

  it('debería resolver el directorio de dueños por el token de su puerto', () => {
    // Act
    const directory = moduleRef.get(OwnerDirectory, { strict: false });

    // Assert
    expect(directory).toBeInstanceOf(UsersOwnerDirectory);
  });

  it('debería resolver el controller del contexto', () => {
    // Act
    const controller = moduleRef.get(WalletsController, { strict: false });

    // Assert
    expect(controller).toBeInstanceOf(WalletsController);
  });

  it('debería resolver la comprobación de arranque de la clave de la master', () => {
    // Act
    const check = moduleRef.get(MasterKeyStartupCheck, { strict: false });

    // Assert
    // Nombra el FALLO que evita: `MasterKeyStartupCheck` fuera de `providers` compila, pasa lint
    // y deja sus unitarios verdes, pero su `OnModuleInit` no lo ejecuta nadie — la aplicación
    // arrancaría con una master cuya clave privada es de otra EOA y el fallo aparecería en el
    // primer envío, con el gas ya pagado. Que este `get` resuelva es la prueba de que Nest lo
    // instanció, y si lo instanció, corrió su `onModuleInit` al compilar el módulo.
    expect(check).toBeInstanceOf(MasterKeyStartupCheck);
  });
});
```

- [ ] **Step 6: Ejecuta el test para verificar que falla**

Run: `pnpm db:up && pnpm test:e2e src/modules/wallets/__tests__/wallets.module.e2e-spec.ts`
Expected: FAIL antes de este cableado — `Nest could not find WalletRepository element`.
Con `wallets.module.ts` ya escrito en el Step 3, el rojo que queda es el de un `import type`
de puerto: `Nest can't resolve dependencies of the …UseCase (?, …)`.

- [ ] **Step 7: Escribe la implementación mínima**

No hay código nuevo: el cableado se escribió entero en el Step 3. Si el Step 6 sale rojo, el
arreglo es quitar el `import type` del puerto en el archivo que Nest nombra y dejarlo como
import de valor:

```ts
// src/modules/wallets/application/use-cases/assign-wallet.use-case.ts — forma correcta del import
import { AddressIndexAllocator } from '../../domain/ports/address-index.allocator';
import { CustodialAddressGateway } from '../../domain/ports/custodial-address.gateway';
import { OwnerDirectory } from '../../domain/ports/owner.directory';
import { WalletRepository } from '../../domain/ports/wallet.repository';
```

- [ ] **Step 8: Ejecuta el test para verificar que pasa**

Run: `pnpm test:e2e src/modules/wallets/__tests__/wallets.module.e2e-spec.ts`
Expected: PASS — 7 passed

---

### Task 42: `test/helpers/tatum-stub-server.ts`, el proveedor falso que sí ejercita el adaptador

**Layer:** infrastructure
**Rule codes to honor:** `test-mock-external-services`, `test-e2e-supertest`

**Files:**

- Create: `test/helpers/tatum-stub-server.ts`
- Test: `src/__tests__/tatum-stub-server.spec.ts`

⚠️ **El spec vive en `src/__tests__/` y no junto al helper.** `jest.config.mjs` fija
`roots: ['<rootDir>/src']`, así que un `*.spec.ts` dentro de `test/` **no se descubre** — se
quedaría sin ejecutar y nadie lo notaría. El precedente exacto es `src/__tests__/secretlint.spec.ts`,
que prueba `.secretlintrc.json`, otro archivo de fuera de `src/`.

Cuatro decisiones del stub, cada una tapando un fallo distinto (spec §8):

| Decisión                                       | Qué fallo evita                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Sin respuesta programada ⇒ **418**             | Un 500 o un 404 el adaptador los traduce a algo creíble (502 / 503) y el fallo del stub se disfraza de fallo real  |
| Registro de `unstubbed`, que debe quedar vacío | Un escenario que llama a una ruta que nadie programó pasaría igual, afirmando sobre una respuesta inventada        |
| Enmascarar la clave **al guardar**, no al leer | Un `console.log(stub.calls)` o un snapshot escribiría la clave privada de la master en la salida de CI             |
| Cola FIFO por ruta y `hang` explícito          | Sin `hang` no hay forma de provocar el timeout, que es el único caso que prueba la escritura por delante del libro |

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/__tests__/tatum-stub-server.spec.ts
import {
  MASKED_SECRET,
  TATUM_STUB_BASE_URL,
  TatumStubServer,
  UNSTUBBED_STATUS,
} from '@test/helpers/tatum-stub-server';

describe('TatumStubServer', () => {
  let stub: TatumStubServer;

  beforeAll(async () => {
    stub = await TatumStubServer.start();
  });

  afterEach(() => {
    stub.reset();
  });

  afterAll(async () => {
    await stub.stop();
  });

  describe('stub()', () => {
    it('debería devolver la respuesta programada para una ruta exacta', async () => {
      // Arrange
      stub.stub('POST', '/v3/gas-pump', { status: 200, body: ['0xabc'] });

      // Act
      const response = await post('/v3/gas-pump', { chain: 'ETH' });

      // Assert
      expect({ status: response.status, body: await response.json() }).toEqual({
        status: 200,
        body: ['0xabc'],
      });
    });

    it('debería casar una ruta comodín por prefijo', async () => {
      // Arrange
      stub.stub('GET', '/v3/gas-pump/activated/*', { status: 200, body: { activated: true } });

      // Act
      const response = await fetch(`${TATUM_STUB_BASE_URL}/v3/gas-pump/activated/ETH/0xaa/7`);

      // Assert
      expect(await response.json()).toEqual({ activated: true });
    });

    it('debería consumir las respuestas de una misma ruta en orden FIFO', async () => {
      // Arrange
      stub.stub('POST', '/v3/gas-pump', { status: 200, body: ['primera'] });
      stub.stub('POST', '/v3/gas-pump', { status: 200, body: ['segunda'] });

      // Act
      const first = await (await post('/v3/gas-pump', {})).json();
      const second = await (await post('/v3/gas-pump', {})).json();

      // Assert
      expect([first, second]).toEqual([['primera'], ['segunda']]);
    });
  });

  describe('rutas sin programar', () => {
    it('debería responder 418 cuando la ruta golpeada no tiene respuesta programada', async () => {
      // Act
      const response = await post('/v3/blockchain/sc/custodial/transfer', {});

      // Assert
      // 418 a propósito: ningún estado que el adaptador sepa traducir a 400, 502 o 503, para
      // que un fallo del stub no se confunda nunca con uno del proveedor.
      expect(response.status).toBe(UNSTUBBED_STATUS);
    });

    it('debería registrar la ruta golpeada sin respuesta programada', async () => {
      // Act
      await post('/v3/gas-pump/activate', {});

      // Assert
      expect(stub.unstubbed).toEqual(['POST /v3/gas-pump/activate']);
    });
  });

  describe('calls', () => {
    it('debería guardar la clave privada ENMASCARADA en el registro de llamadas', async () => {
      // Arrange
      stub.stub('POST', '/v3/blockchain/sc/custodial/transfer', {
        status: 200,
        body: { txId: 'ab' },
      });
      const secret = `0x${'1'.repeat(64)}`;

      // Act
      await post('/v3/blockchain/sc/custodial/transfer', { chain: 'ETH', fromPrivateKey: secret });

      // Assert
      // Sobre el registro ENTERO serializado: comprobar solo `calls[0].body.fromPrivateKey`
      // dejaría pasar una copia de la clave en cualquier otro campo.
      expect(JSON.stringify(stub.calls)).not.toContain(secret);
      expect(stub.calls[0]?.body).toEqual({ chain: 'ETH', fromPrivateKey: MASKED_SECRET });
    });

    it('debería registrar si la petición llevaba cabecera x-api-key sin guardar su valor', async () => {
      // Arrange
      stub.stub('POST', '/v3/gas-pump', { status: 200, body: [] });

      // Act
      await post('/v3/gas-pump', {}, { 'x-api-key': 'una-clave-de-api' });

      // Assert
      expect(stub.calls[0]).toEqual({
        method: 'POST',
        path: '/v3/gas-pump',
        body: {},
        apiKeyPresent: true,
      });
      expect(JSON.stringify(stub.calls)).not.toContain('una-clave-de-api');
    });
  });

  describe('hang', () => {
    it('debería no responder nunca cuando la respuesta programada es hang', async () => {
      // Arrange
      stub.stub('POST', '/v3/blockchain/sc/custodial/transfer', { status: 200, hang: true });

      // Act
      const failure = await post('/v3/blockchain/sc/custodial/transfer', {}, {}, 300).catch(
        (error: unknown) => error,
      );

      // Assert
      // `AbortSignal.timeout` rechaza con un DOMException cuyo `name` es "TimeoutError" — NO
      // "AbortError", y por eso se discrimina por `name` y nunca por `instanceof`.
      expect((failure as Error).name).toBe('TimeoutError');
    });
  });

  describe('reset()', () => {
    it('debería vaciar la cola, el registro de llamadas y las rutas sin programar', async () => {
      // Arrange
      stub.stub('POST', '/v3/gas-pump', { status: 200, body: [] });
      await post('/v3/gas-pump', {});
      await post('/v3/gas-pump/activate', {});

      // Act
      stub.reset();

      // Assert
      expect({ calls: stub.calls, unstubbed: stub.unstubbed }).toEqual({
        calls: [],
        unstubbed: [],
      });
    });
  });
});

// Helpers

const post = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
  timeoutMs = 5_000,
): Promise<Response> =>
  fetch(`${TATUM_STUB_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/__tests__/tatum-stub-server.spec.ts`
Expected: FAIL — `Cannot find module '@test/helpers/tatum-stub-server' from 'src/__tests__/tatum-stub-server.spec.ts'`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// test/helpers/tatum-stub-server.ts
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

/**
 * Puerto FIJO, no efímero. El adaptador lee su URL de la configuración, que `test/setup-env.ts`
 * fija antes de que arranque el `AppModule`: un puerto efímero solo se conoce DESPUÉS de
 * arrancar el servidor, y para entonces la configuración ya está congelada (`cache: true` en
 * `ConfigModule.forRoot`). Fuera del rango efímero de Linux (32768-60999) para que el sistema no
 * se lo dé a otro proceso mientras la suite corre.
 */
export const TATUM_STUB_PORT = 14567;
export const TATUM_STUB_HOST = '127.0.0.1';
export const TATUM_STUB_BASE_URL = `http://${TATUM_STUB_HOST}:${TATUM_STUB_PORT}`;

/** Lo que queda en el registro en lugar del secreto. No es un valor válido de clave. */
export const MASKED_SECRET = '[[stub-masked]]';

/**
 * ⚠️ 418 y no 500 ni 404: es el único status del rango que el adaptador NO sabe traducir a
 * nada creíble. Un 500 saldría como 502 «proveedor caído» y un 404 como 503 «4xx no
 * documentado» — las dos formas exactas que un fallo real produce, así que un escenario con una
 * ruta sin programar se leería como un defecto del código en vez de como un defecto del guion.
 */
export const UNSTUBBED_STATUS = 418;

/** Cualquier propiedad cuyo nombre huela a clave privada se enmascara AL GUARDAR. */
const SECRET_KEY_PATTERN = /privatekey/i;

export type StubbedResponse = {
  readonly status: number;
  readonly body?: unknown;
  /** No responder jamás. Es la única forma de provocar el timeout del adaptador. */
  readonly hang?: boolean;
};

export type RecordedCall = {
  readonly method: string;
  readonly path: string;
  readonly body: Record<string, unknown> | null;
  /** Presencia, nunca el valor: el mensaje de 401 del proveedor interpola la clave de API. */
  readonly apiKeyPresent: boolean;
};

/**
 * Stub HTTP del proveedor para los E2E de `wallets`.
 *
 * **Por qué un servidor local y no un interceptor ni un adaptador falso** (spec §8): es la única
 * de las tres opciones que ejercita el adaptador de verdad. Un adaptador falso dejaría el
 * guardián de contrato en verde mientras el archivo más propenso a defectos del módulo —el que
 * traduce statuses, normaliza `txId` sin `0x` y discrimina el timeout por `err.name`— no se
 * ejecuta en ninguna prueba. Y no añade una dependencia, que es la política visible del repo.
 */
export class TatumStubServer {
  private readonly server: Server;
  private readonly queues = new Map<string, StubbedResponse[]>();
  private readonly sockets = new Set<Socket>();
  private readonly held = new Set<ServerResponse>();
  private readonly recorded: RecordedCall[] = [];
  private readonly missed: string[] = [];

  private constructor() {
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
    // Sin este registro, `stop()` se queda colgado esperando a las conexiones que un `hang`
    // dejó abiertas, y Jest muere con «A worker process has failed to exit gracefully».
    this.server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
  }

  static start(): Promise<TatumStubServer> {
    const stub = new TatumStubServer();
    return new Promise((resolve, reject) => {
      stub.server.once('error', reject);
      stub.server.listen(TATUM_STUB_PORT, TATUM_STUB_HOST, () => resolve(stub));
    });
  }

  /**
   * Programa una respuesta. Se consumen en orden FIFO por ruta.
   *
   * `path` puede terminar en `/*` para casar por prefijo, que es lo que necesita
   * `GET /v3/gas-pump/activated/{chain}/{owner}/{index}`: el índice lo decide la secuencia de
   * PostgreSQL y el guion del test no puede saberlo de antemano.
   */
  stub(method: string, path: string, response: StubbedResponse): void {
    const key = `${method.toUpperCase()} ${path}`;
    this.queues.set(key, [...(this.queues.get(key) ?? []), response]);
  }

  get calls(): readonly RecordedCall[] {
    return this.recorded;
  }

  /** Rutas golpeadas sin respuesta programada. Cada escenario afirma que queda vacía. */
  get unstubbed(): readonly string[] {
    return this.missed;
  }

  reset(): void {
    this.releaseHeld();
    this.queues.clear();
    this.recorded.length = 0;
    this.missed.length = 0;
  }

  async stop(): Promise<void> {
    this.releaseHeld();
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private releaseHeld(): void {
    for (const response of this.held) {
      response.destroy();
    }
    this.held.clear();
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = (request.method ?? 'GET').toUpperCase();
    const path = (request.url ?? '/').split('?')[0] ?? '/';
    const raw = await readBody(request);

    // El enmascarado va AQUÍ, antes del push, y no en el getter: si el registro llegara a
    // guardar el secreto, cualquier `console.log`, snapshot o volcado de un test rojo lo
    // escribiría en la salida de CI. Enmascarar al leer deja el agujero abierto en memoria.
    this.recorded.push({
      method,
      path,
      body: maskSecrets(raw),
      apiKeyPresent: typeof request.headers['x-api-key'] === 'string',
    });

    const stubbed = this.take(method, path);
    if (!stubbed) {
      this.missed.push(`${method} ${path}`);
      response.writeHead(UNSTUBBED_STATUS, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ stub: 'unprogrammed', method, path }));
      return;
    }

    if (stubbed.hang) {
      this.held.add(response);
      return;
    }

    response.writeHead(stubbed.status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(stubbed.body ?? null));
  }

  private take(method: string, path: string): StubbedResponse | undefined {
    const exact = this.queues.get(`${method} ${path}`);
    if (exact && exact.length > 0) {
      return exact.shift();
    }
    for (const [key, queue] of this.queues) {
      const separator = key.indexOf(' ');
      const keyMethod = key.slice(0, separator);
      const keyPath = key.slice(separator + 1);
      if (queue.length === 0 || keyMethod !== method || !keyPath.endsWith('/*')) {
        continue;
      }
      if (path.startsWith(keyPath.slice(0, -1))) {
        return queue.shift();
      }
    }
    return undefined;
  }
}

// Helpers

const readBody = (request: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });

const maskSecrets = (raw: string): Record<string, unknown> | null => {
  if (raw.length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).map(([key, value]) =>
      SECRET_KEY_PATTERN.test(key) ? [key, MASKED_SECRET] : [key, value],
    ),
  );
};
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/__tests__/tatum-stub-server.spec.ts`
Expected: PASS — 9 passed

---

### Task 43: las cinco variables de `wallets` en `test/setup-env.ts`

**Layer:** bootstrap
**Rule codes to honor:** `devops-use-config-module`, `test-mock-external-services`

**Files:**

- Modify: `test/setup-env.ts`
- Test: `src/__tests__/test-env-defaults.spec.ts` (nuevo)

⚠️ **Esta tarea es la ÚNICA del ciclo que edita `test/setup-env.ts`.** Las cinco variables que
fija son las de la tabla de configuración —`TATUM_API_URL`, `TATUM_API_KEY`, `TATUM_TIMEOUT_MS`,
`WALLETS_MASTER_ADDRESS` y `WALLETS_MASTER_PRIVATE_KEY`— y no hay más nombres: `TATUM_BASE_URL`,
`WALLETS_TATUM_BASE_URL` y `WALLETS_TATUM_API_KEY` no existen en ninguna parte del sistema. Las
otras dos variables del contexto (`WALLETS_ACTIVATION_PAYER` y `WALLETS_NETWORK`) no se tocan
aquí: sus valores por defecto ya son los que la suite necesita, y fijarlas a mano solo añadiría
dos líneas que ninguna aserción comprueba.

⚠️ **La línea de la URL es lo ÚNICO que impide que una suite hable con el proveedor de verdad y
mueva dinero.** No es una comodidad de configuración: es un control de seguridad. Por eso la
tarea 44 lleva además el caso A17, que afirma sobre la configuración YA RESUELTA por la
aplicación — el guardián del guardián, porque un borrado accidental de esta línea dejaría el
resto de la suite verde mientras las transferencias salen a la testnet real.

⚠️ **La pareja dirección/clave de test no es arbitraria: la comprobación de arranque deriva la
dirección desde la clave y la compara con `WALLETS_MASTER_ADDRESS`** (spec §3.1.1). Si no
coinciden, el `AppModule` no arranca y TODA la suite E2E se cae. La pareja usada aquí es el vector
de prueba canónico de secp256k1 (clave = 1), de entropía nula. **Medido, no supuesto**, con
`@noble/hashes` ya presente en el árbol:

```bash
node -e "
const { keccak_256 } = require('./node_modules/.pnpm/@noble+hashes@1.8.0/node_modules/@noble/hashes/sha3.js');
const crypto = require('node:crypto');
const ecdh = crypto.createECDH('secp256k1');
ecdh.setPrivateKey(Buffer.from('0000000000000000000000000000000000000000000000000000000000000001','hex'));
const pub = ecdh.getPublicKey(null,'uncompressed');
console.log('0x' + Buffer.from(keccak_256(pub.subarray(1))).subarray(12).toString('hex'));
"
# => 0x7e5f4552091a69125d5dfcb7b8c2659029395bdf
```

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/__tests__/test-env-defaults.spec.ts
/**
 * `test/setup-env.ts` corre en `setupFiles`, así que para cuando este spec se evalúa ya escribió
 * en `process.env`. Afirmar sobre `process.env` directamente es, por tanto, afirmar sobre lo que
 * el `AppModule` bajo test va a leer — no sobre el fuente del archivo.
 *
 * Nombra el FALLO que evita: sin la URL a loopback, `pnpm test:e2e` habla con la API real de
 * Tatum, gasta créditos y —en el caso de la transferencia— MUEVE DINERO. Ninguna otra prueba de
 * la suite se pondría roja por ello; al contrario, pasarían.
 */
describe('entorno por defecto de la suite', () => {
  it('debería apuntar la URL del proveedor custodial a loopback', () => {
    // Act
    const apiUrl = process.env.TATUM_API_URL;

    // Assert
    expect(apiUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('debería fijar las cinco variables del contexto wallets', () => {
    // Arrange
    const names = [
      'TATUM_API_URL',
      'TATUM_API_KEY',
      'TATUM_TIMEOUT_MS',
      'WALLETS_MASTER_ADDRESS',
      'WALLETS_MASTER_PRIVATE_KEY',
    ];

    // Act
    const missing = names.filter((name) => (process.env[name] ?? '').length === 0);

    // Assert
    // Se comprueba PRESENCIA, nunca el valor: imprimir la clave privada en el diff de un
    // `expect` fallido la escribiría en la salida de CI.
    expect(missing).toEqual([]);
  });

  it('debería fijar un timeout del proveedor corto para que el caso del timeout no tarde', () => {
    // Act
    const timeout = Number(process.env.TATUM_TIMEOUT_MS);

    // Assert
    // El `testTimeout` de la suite E2E es 30 s: con el timeout de producción el caso A13 de
    // `wallets.e2e-spec.ts` no cabría dentro y saldría rojo por la razón equivocada.
    expect(timeout).toBeLessThanOrEqual(2_000);
  });
});
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test src/__tests__/test-env-defaults.spec.ts`
Expected: FAIL — 3 casos rojos; el primero con `expected undefined to match /^http:\/\/127\.0\.0\.1:\d+$/`

- [ ] **Step 3: Escribe la implementación mínima**

```ts
// test/setup-env.ts — al final del archivo, tras HEALTH_RSS_LIMIT_MB
// -----------------------------------------------------------------------------
//  Contexto `wallets`: el proveedor custodial, apuntado a loopback
// -----------------------------------------------------------------------------
//
// ⚠️ ESTA PRIMERA LÍNEA ES UN CONTROL DE SEGURIDAD, no configuración de comodidad. Sin ella el
// adaptador cae al valor del `.env` (o al default de `wallets.config.ts`), que apunta a la API
// real de Tatum: `pnpm test:e2e` gastaría créditos en cada corrida y, en la suite de
// transferencias, MOVERÍA DINERO de la master. Ninguna otra aserción de la suite se pondría
// roja por eso — al contrario, todas pasarían. Por eso hay además un caso que afirma sobre la
// configuración YA RESUELTA por la aplicación (A17 de `wallets.e2e-spec.ts`): un borrado
// accidental de esta línea tiene que ponerse rojo en algún sitio.
//
// El puerto es el fijo de `test/helpers/tatum-stub-server.ts`, y tiene que ser fijo: la
// configuración se congela al construir el `AppModule` (`cache: true`), antes de que un puerto
// efímero se pudiera conocer.
process.env.TATUM_API_URL ??= 'http://127.0.0.1:14567';

// El stub no valida la clave; lo que importa es que exista, porque `wallets.config.ts` la exige
// fuera de desarrollo y porque el adaptador la manda en `x-api-key`. `??=` respeta un valor
// explícito del shell, mismo patrón que JWT_SECRET.
process.env.TATUM_API_KEY ??= 'stub-api-key-for-e2e';

// Corto a propósito. El caso del timeout (A13) espera a que la petición expire de verdad contra
// un stub que no responde; con el timeout de producción no cabría en el `testTimeout` de 30 s de
// la suite E2E y el rojo hablaría del reloj, no del libro de transferencias.
process.env.TATUM_TIMEOUT_MS ??= '1500';

// ⚠️ Los dos valores siguientes SON UNA PAREJA y no se pueden tocar por separado: la
// comprobación de arranque deriva la dirección desde la clave y aborta si no coincide con la
// configurada (spec §3.1.1). Cambiar uno sin el otro tumba TODA la suite E2E en el `beforeAll`,
// con un error que habla de configuración y no del test que se estaba escribiendo.
//
// Es el vector de prueba canónico de secp256k1 (clave privada = 1), de entropía NULA: gitleaks
// no lo marca y no hay nada que filtrar porque no controla fondo alguno. Medido en este repo con
// el `@noble/hashes` ya presente en el árbol — el comando está en el plan, Task 43:
//   priv 0x00…01  ->  addr 0x7e5f4552091a69125d5dfcb7b8c2659029395bdf
process.env.WALLETS_MASTER_ADDRESS ??= '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf';
process.env.WALLETS_MASTER_PRIVATE_KEY ??=
  '0x0000000000000000000000000000000000000000000000000000000000000001';
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test src/__tests__/test-env-defaults.spec.ts`
Expected: PASS — 3 passed

---

### Task 44: `wallets.e2e-spec.ts` — los cinco endpoints contra app real, PostgreSQL real y el stub

**Layer:** infrastructure
**Rule codes to honor:** `test-e2e-supertest`, `test-mock-external-services`, `security-use-guards`, `security-auth-jwt`, `api-use-dto-serialization`

**Casos acordados:**

| #   | Caso (se vuelve el `it`)                                                                               | Entrada / estado inicial                                                          | Resultado esperado                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| A1  | debería devolver 200 con la dirección derivada y un índice numérico al pedir la wallet por primera vez | usuario sin wallet; stub programado con la derivación                             | 200, `data.address` = la del stub, `data.index` es un **number** entero ≥ 0, envelope de tres claves         |
| A2  | debería devolver la misma dirección sin llamar al proveedor cuando se repite la petición               | wallet ya asignada; nada programado para la segunda llamada                       | 200 con la misma dirección; **una sola** llamada `POST /v3/gas-pump` en el registro del stub                 |
| A3  | debería no devolver nunca una dirección igual a la master configurada                                  | dos usuarios distintos piden wallet                                               | ninguna de las dos direcciones devueltas coincide con `WALLETS_MASTER_ADDRESS`                               |
| A4  | debería responder 409 al rol admin, que ya tiene la master                                             | token de admin                                                                    | 409 y **cero** filas nuevas en `wallets`                                                                     |
| A5  | debería responder 401 al pedir la wallet sin token                                                     | sin cabecera Authorization                                                        | 401                                                                                                          |
| A6  | debería devolver la wallet del usuario con kind custodial                                              | wallet ya asignada                                                                | 200, `kind: 'custodial'`, `address` = la del stub, `index` numérico                                          |
| A7  | debería devolver la master con kind master e index nulo para el admin                                  | token de admin                                                                    | 200, `kind: 'master'`, `index: null`, `address` = la master configurada                                      |
| A8  | debería responder 404 al consultar la wallet de un usuario que no la ha pedido                         | usuario sin wallet                                                                | 404                                                                                                          |
| A9  | debería responder 202 y dejar la fila en activating con el txId prefijado con 0x                       | wallet receive-only; stub: `activated:false` + `txId` **sin** `0x`                | 202; fila con `status='activating'` y `activation_tx_id` = `0x` + el txId del stub                           |
| A10 | debería responder 409 al activar una wallet que el proveedor ya da por activada                        | wallet activating; stub: `activated:true`                                         | 409; la fila queda en `status='active'` por la reconciliación                                                |
| A11 | debería responder 409 al transferir desde una wallet que el proveedor no da por activada               | wallet receive-only; stub: `activated:false`                                      | 409 y **cero** filas en `wallet_transfers`                                                                   |
| A12 | debería registrar la transferencia como submitted con el txId del proveedor prefijado con 0x           | wallet activa; stub: `activated:true` + `txId` sin `0x`                           | 200; una fila `status='submitted'` con `tx_id` = `0x` + el txId del stub                                     |
| A13 | debería dejar la fila en unknown cuando la llamada al proveedor expira                                 | wallet activa; stub: `activated:true` + la transferencia **no responde** (`hang`) | 502; **una** fila con `status='unknown'` — ni ausente, ni `rejected`, ni `submitting`                        |
| A14 | debería registrar la transferencia como rejected con un código propio cuando el proveedor devuelve 400 | wallet activa; stub: `activated:true` + 400 con un `message` que interpola algo   | 400; fila `status='rejected'`, `reason_code` de la lista cerrada y **sin** el texto del proveedor en la fila |
| A15 | debería responder 400 sin llamar al proveedor cuando el checksum EIP-55 del destinatario está roto     | wallet activa; nada programado en el stub                                         | 400; **cero** llamadas registradas en el stub y cero filas en `wallet_transfers`                             |
| A16 | debería listar solo las transferencias del usuario autenticado, paginadas                              | una transferencia del usuario y otra de un segundo usuario                        | 200; `data.items` de longitud 1 y `data.meta.total` 1                                                        |
| A17 | debería resolver la configuración del proveedor contra loopback                                        | la app ya arrancada                                                               | `walletsConfig.apiUrl` casa `^http://127\.0\.0\.1:` — el guardián del guardián de la tarea 43                |

⚠️ **A13 es el caso que de verdad prueba el libro.** Sin él, la escritura por delante no está
probada y su motivo de existir tampoco: con la escritura posterior un timeout no dejaría rastro,
que es justo el caso para el que la tabla existe.

La comprobación «ninguna ruta golpeada sin respuesta programada» vive en un `afterEach`, no en un
`it`: no es un caso de comportamiento sino la higiene del guion. Va con `reset()` **antes** de la
aserción para que un fallo no arrastre estado al siguiente test.

**Files:**

- Test: `src/modules/wallets/__tests__/wallets.e2e-spec.ts`

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/modules/wallets/__tests__/wallets.e2e-spec.ts
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import type { WalletsConfig } from '@config/wallets.config';
import { createTestApp } from '@test/helpers/create-test-app';
import { resetThrottler } from '@test/helpers/reset-throttler';
import { TatumStubServer } from '@test/helpers/tatum-stub-server';

/** Cumple `@MinLength(8)` de `RegisterAccountDto`; el valor en sí es irrelevante. */
const DEFAULT_PASSWORD = 'contrasena-larga-de-prueba';

/**
 * La master del entorno de test. Es el vector canónico de secp256k1 (clave = 1) que fija
 * `test/setup-env.ts`, y la comprobación de arranque ya verificó que la clave configurada
 * deriva exactamente esta dirección — si no, el `AppModule` no habría arrancado.
 */
const MASTER_ADDRESS = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf';

/**
 * Direcciones que SOLO el stub puede producir. Los casos felices afirman sobre el CONTENIDO y no
 * sobre el status (spec §8): un 200 con la dirección equivocada pasaría una aserción de status.
 */
const DERIVED_ADDRESS = `0xdeadbeef${'0'.repeat(31)}1`;
const SECOND_ADDRESS = `0xdeadbeef${'0'.repeat(31)}2`;

/**
 * ⚠️ Los dos txId van SIN el prefijo `0x`, como el ejemplo del proveedor: 64 hexadecimales
 * pelados, `type: string` sin `pattern` (medido sobre `docs/tatum/gas-pump/openapi.json`). Que
 * las aserciones esperen `0x` + esto es lo que prueba la normalización del adaptador; sin ella
 * `TransactionHash` lanzaría y saldría un 400 con el gas ya pagado.
 */
const ACTIVATION_TX = 'ac'.repeat(32);
const TRANSFER_TX = '7a'.repeat(32);

/** Todo en minúsculas: sin mayúsculas no hay checksum EIP-55 que comprobar, y se acepta. */
const RECIPIENT = '0xabcdef0123456789abcdef0123456789abcdef01';

/**
 * La forma EIP-55 correcta de RECIPIENT con UN carácter de caso cambiado (`C` -> `c`, posición 3
 * del cuerpo). Medido con keccak256 sobre el cuerpo en minúsculas:
 *   0xabcdef0123456789abcdef0123456789abcdef01 -> 0xabCDeF0123456789AbcdEf0123456789aBCDEF01
 */
const BROKEN_CHECKSUM_RECIPIENT = '0xabcDeF0123456789AbcdEf0123456789aBCDEF01';

/** Un envío nativo válido: `amount` viaja como string, nunca como número (18 decimales). */
const NATIVE_TRANSFER = { recipient: RECIPIENT, kind: 'native', amount: '1000000000000000' };

type WalletRow = { status: string; address: string; activation_tx_id: string | null };
type TransferRow = { status: string; tx_id: string | null; reason_code: string | null };

describe('Wallets (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let prefix: string;
  let stub: TatumStubServer;
  let userToken: string;
  let secondToken: string;
  let adminToken: string;

  beforeAll(async () => {
    stub = await TatumStubServer.start();
    ({ app, prefix } = await createTestApp());
    dataSource = app.get(DataSource);

    // Arranque limpio de las cuentas y UN solo login por cuenta para toda la suite: el
    // presupuesto de `@Throttle` de auth es 10/min y esta suite hace muchas peticiones.
    await dataSource.query('TRUNCATE TABLE wallet_transfers');
    await dataSource.query('TRUNCATE TABLE wallets');
    await dataSource.query('TRUNCATE TABLE auth_credentials');
    await dataSource.query('TRUNCATE TABLE users CASCADE');

    userToken = await registerAndLogin('duena@example.com');
    secondToken = await registerAndLogin('segunda@example.com');
    adminToken = await registerAndLogin('admin.wallets@example.com');
    await dataSource.query(`UPDATE users SET role = 'admin' WHERE email = $1`, [
      'admin.wallets@example.com',
    ]);
    // El rol viaja EN el token, así que hay que volver a firmarlo tras promover.
    adminToken = await login('admin.wallets@example.com');
  });

  beforeEach(async () => {
    // Solo las tablas de wallets: truncar users mataría a los dueños de los tokens.
    // La secuencia de índices NO se reinicia. Reiniciarla es exactamente el desastre que el
    // índice único sobre `address_index` existe para convertir en un 500 con nombre (spec §5.1),
    // y ninguna aserción de aquí necesita que el índice valga cero: A1 afirma que es un NÚMERO
    // entero no negativo, que además es lo que caza el bug del `int8` entregado como string.
    await dataSource.query('TRUNCATE TABLE wallet_transfers');
    await dataSource.query('TRUNCATE TABLE wallets');
    // ⚠️ Los dos endpoints que mueven gas o dinero —`POST /wallets/me/activation` y
    // `POST /wallets/me/transfers`— llevan su propio `@Throttle({ limit: 10, ttl: 60_000 })`, y
    // `ThrottlerGuard` cuenta por clase Y handler. Esta suite hace más de diez llamadas a cada
    // uno contra la MISMA app, así que sin el reset se autoenvenena: los últimos casos reciben
    // 429 donde esperan 200 o 202, y el rojo habla del presupuesto de peticiones del test y no
    // del código bajo prueba. Ningún `describe` de aquí mide el 429, así que vaciar el contador
    // no borra nada que se esté midiendo.
    resetThrottler(app);
  });

  afterEach(() => {
    // Reset primero, aserción después: si la aserción falla, el estado del stub ya está limpio
    // y el siguiente test habla de sí mismo.
    const missed = [...stub.unstubbed];
    stub.reset();
    expect(missed).toEqual([]);
  });

  afterAll(async () => {
    await app?.close();
    await stub?.stop();
  });

  describe('POST /wallets', () => {
    it('debería devolver 200 con la dirección derivada y un índice numérico al pedir la wallet por primera vez', async () => {
      // Arrange
      stubDerive(DERIVED_ADDRESS);

      // Act
      const response = await postWallet(userToken);

      // Assert
      expect(response.status).toBe(200);
      expect(Object.keys(response.body as Record<string, unknown>).sort()).toEqual([
        'data',
        'request',
        'success',
      ]);
      expect(response.body.data.address).toBe(DERIVED_ADDRESS);
      // `typeof number` no es celo: la secuencia devuelve un `bigint` y el driver de PostgreSQL
      // entrega los `int8` COMO STRING. Sin conversión explícita el índice viajaría al proveedor
      // como texto y sus campos de rango, que son enteros, lo rechazarían.
      expect(typeof response.body.data.index).toBe('number');
      expect(Number.isInteger(response.body.data.index)).toBe(true);
      expect(response.body.data.index).toBeGreaterThanOrEqual(0);
    });

    it('debería devolver la misma dirección sin llamar al proveedor cuando se repite la petición', async () => {
      // Arrange
      stubDerive(DERIVED_ADDRESS);
      const first = await postWallet(userToken);

      // Act — nada programado para esta segunda llamada: si el caso de uso llamara al
      // proveedor, el stub respondería 418 y `unstubbed` dejaría de estar vacío.
      const second = await postWallet(userToken);

      // Assert
      expect(second.status).toBe(200);
      expect(second.body.data.address).toBe(first.body.data.address);
      expect(stub.calls.filter((call) => call.path === '/v3/gas-pump')).toHaveLength(1);
    });

    it('debería no devolver nunca una dirección igual a la master configurada', async () => {
      // Arrange
      stubDerive(DERIVED_ADDRESS);
      stubDerive(SECOND_ADDRESS);

      // Act
      const first = await postWallet(userToken);
      const second = await postWallet(secondToken);

      // Assert
      // El sistema completo, de punta a punta: es el quinto de los cinco controles de §3.1.1 y
      // el único que mira lo que el cliente recibe de verdad.
      expect([first.body.data.address, second.body.data.address]).not.toContain(MASTER_ADDRESS);
    });

    it('debería responder 409 al rol admin, que ya tiene la master', async () => {
      // Act
      const response = await postWallet(adminToken);

      // Assert
      expect(response.status).toBe(409);
      const rows = await dataSource.query<{ count: number }[]>(
        'SELECT COUNT(*)::int AS count FROM wallets',
      );
      expect(rows[0]?.count).toBe(0);
    });

    it('debería responder 401 al pedir la wallet sin token', async () => {
      // Act
      const response = await request(app.getHttpServer()).post(`${prefix}/wallets`).send();

      // Assert
      expect(response.status).toBe(401);
    });
  });

  describe('GET /wallets/me', () => {
    it('debería devolver la wallet del usuario con kind custodial', async () => {
      // Arrange
      stubDerive(DERIVED_ADDRESS);
      await postWallet(userToken);

      // Act
      const response = await getWallet(userToken);

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.data.kind).toBe('custodial');
      expect(response.body.data.address).toBe(DERIVED_ADDRESS);
      expect(typeof response.body.data.index).toBe('number');
    });

    it('debería devolver la master con kind master e index nulo para el admin', async () => {
      // Act
      const response = await getWallet(adminToken);

      // Assert
      // Un 404 aquí sería mentira a medias: el admin SÍ tiene dirección y es la que sostiene
      // todo el fondo de gas. Su EOA no está en la tabla, vive en la configuración.
      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        kind: 'master',
        index: null,
        address: MASTER_ADDRESS,
      });
    });

    it('debería responder 404 al consultar la wallet de un usuario que no la ha pedido', async () => {
      // Act
      const response = await getWallet(userToken);

      // Assert
      expect(response.status).toBe(404);
    });
  });

  describe('POST /wallets/me/activation', () => {
    it('debería responder 202 y dejar la fila en activating con el txId prefijado con 0x', async () => {
      // Arrange
      stubDerive(DERIVED_ADDRESS);
      await postWallet(userToken);
      stubActivationCheck(false);
      stubActivate(ACTIVATION_TX);

      // Act
      const response = await postActivation(userToken);

      // Assert
      // 202 y no 200: la transacción está ENVIADA, no minada.
      expect(response.status).toBe(202);
      const rows = await dataSource.query<WalletRow[]>(
        'SELECT status, address, activation_tx_id FROM wallets',
      );
      expect(rows[0]).toMatchObject({
        status: 'activating',
        activation_tx_id: `0x${ACTIVATION_TX}`,
      });
    });

    it('debería responder 409 al activar una wallet que el proveedor ya da por activada', async () => {
      // Arrange
      stubDerive(DERIVED_ADDRESS);
      await postWallet(userToken);
      stubActivationCheck(true);

      // Act
      const response = await postActivation(userToken);

      // Assert
      expect(response.status).toBe(409);
      const rows = await dataSource.query<WalletRow[]>('SELECT status FROM wallets');
      // La reconciliación es perezosa y va DENTRO de activar: la misma llamada que sirve de
      // precondición cura el estado. Por eso la fila acaba en `active` pese al 409.
      expect(rows[0]?.status).toBe('active');
    });
  });

  describe('POST /wallets/me/transfers', () => {
    it('debería responder 409 al transferir desde una wallet que el proveedor no da por activada', async () => {
      // Arrange
      stubDerive(DERIVED_ADDRESS);
      await postWallet(userToken);
      stubActivationCheck(false);

      // Act
      const response = await postTransfer(userToken, NATIVE_TRANSFER);

      // Assert
      expect(response.status).toBe(409);
      // La escritura por delante ocurre DESPUÉS de la precondición: si no, el libro se llenaría
      // de rechazos que nunca salieron del proceso.
      expect(await countTransfers()).toBe(0);
    });

    it('debería registrar la transferencia como submitted con el txId del proveedor prefijado con 0x', async () => {
      // Arrange
      await giveActiveWallet(userToken);
      stubActivationCheck(true);
      stub.stub('POST', '/v3/blockchain/sc/custodial/transfer', {
        status: 200,
        body: { txId: TRANSFER_TX },
      });

      // Act
      const response = await postTransfer(userToken, NATIVE_TRANSFER);

      // Assert
      expect(response.status).toBe(200);
      const rows = await dataSource.query<TransferRow[]>(
        'SELECT status, tx_id, reason_code FROM wallet_transfers',
      );
      expect(rows).toEqual([{ status: 'submitted', tx_id: `0x${TRANSFER_TX}`, reason_code: null }]);
    });

    it('debería dejar la fila en unknown cuando la llamada al proveedor expira', async () => {
      // Arrange
      await giveActiveWallet(userToken);
      stubActivationCheck(true);
      // El stub acepta la conexión y NO responde jamás. Es la única forma de provocar el
      // timeout de verdad: un 504 simulado ejercitaría otra rama del adaptador.
      stub.stub('POST', '/v3/blockchain/sc/custodial/transfer', { status: 200, hang: true });

      // Act
      const response = await postTransfer(userToken, NATIVE_TRANSFER);

      // Assert
      expect(response.status).toBe(502);
      const rows = await dataSource.query<TransferRow[]>(
        'SELECT status, tx_id, reason_code FROM wallet_transfers',
      );
      // ⚠️ Este es el caso que prueba el libro. La fila tiene que EXISTIR y decir `unknown`:
      // ausente significaría que la escritura por delante no ocurrió; `rejected` afirmaría que
      // la cadena no se tocó, y un timeout no permite afirmar eso; `submitting` sería el estado
      // del que nadie sabe salir.
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('unknown');
      expect(rows[0]?.tx_id).toBeNull();
    });

    it('debería registrar la transferencia como rejected con un código propio cuando el proveedor devuelve 400', async () => {
      // Arrange
      await giveActiveWallet(userToken);
      stubActivationCheck(true);
      const providerMessage = "Unable to find valid subscription for 'clave-del-proveedor'";
      stub.stub('POST', '/v3/blockchain/sc/custodial/transfer', {
        status: 400,
        body: { errorCode: 'transaction.invalid', message: providerMessage },
      });

      // Act
      const response = await postTransfer(userToken, NATIVE_TRANSFER);

      // Assert
      expect(response.status).toBe(400);
      const rows = await dataSource.query<TransferRow[]>(
        'SELECT status, tx_id, reason_code FROM wallet_transfers',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('rejected');
      expect(rows[0]?.reason_code).toEqual(expect.any(String));
      // ⚠️ El motivo es un código de una lista CERRADA, nunca el `message` del proveedor: el
      // texto del 401 de Tatum interpola la clave de API, y esta tabla se publica por
      // `GET /wallets/me/transfers`. Guardarlo escribiría un secreto en una respuesta pública.
      expect(JSON.stringify(rows)).not.toContain(providerMessage);
      expect(JSON.stringify(response.body)).not.toContain(providerMessage);
    });

    it('debería responder 400 sin llamar al proveedor cuando el checksum EIP-55 del destinatario está roto', async () => {
      // Arrange
      await giveActiveWallet(userToken);
      const callsBefore = stub.calls.length;

      // Act
      const response = await postTransfer(userToken, {
        ...NATIVE_TRANSFER,
        recipient: BROKEN_CHECKSUM_RECIPIENT,
      });

      // Assert
      expect(response.status).toBe(400);
      // Todo 400 muere sin gastar créditos: la construcción del dominio va ANTES de tocar la red.
      expect(stub.calls).toHaveLength(callsBefore);
      expect(await countTransfers()).toBe(0);
    });
  });

  describe('GET /wallets/me/transfers', () => {
    it('debería listar solo las transferencias del usuario autenticado, paginadas', async () => {
      // Arrange
      await giveActiveWallet(userToken);
      await giveActiveWallet(secondToken, SECOND_ADDRESS);
      await submitTransfer(userToken, TRANSFER_TX);
      await submitTransfer(secondToken, 'bb'.repeat(32));

      // Act
      const response = await request(app.getHttpServer())
        .get(`${prefix}/wallets/me/transfers?page=1&limit=20`)
        .set('Authorization', `Bearer ${userToken}`);

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.data.items).toHaveLength(1);
      expect(response.body.data.meta.total).toBe(1);
      expect(response.body.data.items[0].txId).toBe(`0x${TRANSFER_TX}`);
    });
  });

  describe('configuración resuelta', () => {
    it('debería resolver la configuración del proveedor contra loopback', () => {
      // Arrange
      const config = app.get(ConfigService).getOrThrow<WalletsConfig>('wallets');

      // Act
      const apiUrl = config.apiUrl;

      // Assert
      // ⚠️ El guardián del guardián. Sin este caso, borrar la línea de `test/setup-env.ts`
      // dejaría toda la suite en verde mientras las transferencias salen a la testnet real y
      // gastan ETH de la master. Afirma sobre la config YA RESUELTA por la aplicación, no sobre
      // `process.env`: entre las dos está `ConfigModule`, que es donde un default podría ganar.
      expect(apiUrl).toMatch(/^http:\/\/127\.0\.0\.1:/);
    });
  });
});

// Helpers

const postWallet = (token: string) =>
  request(app.getHttpServer())
    .post(`${prefix}/wallets`)
    .set('Authorization', `Bearer ${token}`)
    .send();

const getWallet = (token: string) =>
  request(app.getHttpServer()).get(`${prefix}/wallets/me`).set('Authorization', `Bearer ${token}`);

const postActivation = (token: string) =>
  request(app.getHttpServer())
    .post(`${prefix}/wallets/me/activation`)
    .set('Authorization', `Bearer ${token}`)
    .send();

const postTransfer = (token: string, body: Record<string, unknown>) =>
  request(app.getHttpServer())
    .post(`${prefix}/wallets/me/transfers`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

const stubDerive = (address: string): void => {
  stub.stub('POST', '/v3/gas-pump', { status: 200, body: [address] });
};

const stubActivate = (txId: string): void => {
  stub.stub('POST', '/v3/gas-pump/activate', { status: 200, body: { txId } });
};

/**
 * Comodín por prefijo: la ruta real lleva el índice que asignó la secuencia
 * (`/v3/gas-pump/activated/ETH/<master>/<índice>`), y el guion no puede saberlo de antemano
 * porque la secuencia no se reinicia entre tests.
 */
const stubActivationCheck = (activated: boolean): void => {
  stub.stub('GET', '/v3/gas-pump/activated/*', { status: 200, body: { activated } });
};

/** Deja al usuario con una wallet en estado `active`, que es la precondición de transferir. */
const giveActiveWallet = async (token: string, address = DERIVED_ADDRESS): Promise<void> => {
  stubDerive(address);
  await postWallet(token);
  stubActivationCheck(false);
  stubActivate(ACTIVATION_TX);
  await postActivation(token);
  stubActivationCheck(true);
  stub.stub('POST', '/v3/blockchain/sc/custodial/transfer', {
    status: 200,
    body: { txId: TRANSFER_TX },
  });
  // Una transferencia de calentamiento no: se consume la programación con una lectura del
  // estado, que es lo que cura la wallet a `active` sin escribir en el libro.
  await getWallet(token);
};

const submitTransfer = async (token: string, txId: string): Promise<void> => {
  stubActivationCheck(true);
  stub.stub('POST', '/v3/blockchain/sc/custodial/transfer', { status: 200, body: { txId } });
  await postTransfer(token, NATIVE_TRANSFER);
};

const countTransfers = async (): Promise<number> => {
  const rows = await dataSource.query<{ count: number }[]>(
    'SELECT COUNT(*)::int AS count FROM wallet_transfers',
  );
  return rows[0]?.count ?? 0;
};

const login = async (email: string): Promise<string> => {
  const response = await request(app.getHttpServer())
    .post(`${prefix}/auth/login`)
    .send({ email, password: DEFAULT_PASSWORD })
    .expect(200);
  return response.body.data.accessToken as string;
};

const registerAndLogin = async (email: string): Promise<string> => {
  await request(app.getHttpServer())
    .post(`${prefix}/auth/register`)
    .send({ email, name: 'Duena E2E', password: DEFAULT_PASSWORD })
    .expect(201);
  return login(email);
};
```

⚠️ **Ajuste JIT que la implementación tiene que resolver, no esconder.** `giveActiveWallet`
consume la programación de la transferencia con un `getWallet` porque la lectura NO reconcilia
(spec §5.4: las dos lecturas no llaman al proveedor). Si al ejecutar el Step 2 la wallet se queda
en `activating` y A12 sale 409, el helper correcto es dejar `stubActivationCheck(true)` programado
y que sea la propia transferencia la que reconcilie — se ajusta el helper, **nunca** el estado de
la fila por SQL: escribir el estado a mano probaría la tabla, no el sistema.

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm db:up && pnpm db:migrate:test && pnpm test:e2e src/modules/wallets/__tests__/wallets.e2e-spec.ts`
Expected: FAIL — antes del controller, todos los casos con `404` en lugar del status esperado.
Antes de la migración, el `beforeAll` muere con `relation "wallet_transfers" does not exist`.

- [ ] **Step 3: Escribe la implementación mínima**

No hay implementación nueva en esta tarea: el módulo entero lo escriben las tareas 1-40 y el
cableado la 41. Lo único que este paso escribe es la programación del stub cuando el Step 2
delate una llamada al proveedor que el guion no previó. La forma es siempre la misma —una línea
por llamada, en el `// Arrange` del caso que la provoca— y nunca la contraria:

```ts
// src/modules/wallets/__tests__/wallets.e2e-spec.ts — la forma de cerrar una ruta sin programar
// PROHIBIDO: un stub «por defecto» en el beforeEach que responda a todo. Volvería inútil el
// registro `unstubbed`, que es la capa que impide que un escenario afirme sobre una respuesta
// que nadie escribió. Cada llamada al proveedor se programa en el caso que la provoca.
stub.stub('GET', '/v3/gas-pump/activated/*', { status: 200, body: { activated: true } });
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test:e2e src/modules/wallets/__tests__/wallets.e2e-spec.ts`
Expected: PASS — 17 passed

---

### Task 45: los cinco escenarios de `wallets` en el guardián de contrato en ejecución

**Layer:** bootstrap
**Rule codes to honor:** `test-e2e-supertest`, `api-use-dto-serialization`, `test-mock-external-services`

**Files:**

- Modify: `src/bootstrap/__tests__/openapi-runtime-contract.e2e-spec.ts`

⚠️ Este archivo tiene un caso, «debería ejercitar todas las operaciones que el documento
publica», que se pone **rojo solo** en cuanto los cinco endpoints existen. Añadir el escenario no
es opcional ni cortés: es el precio, escrito a propósito, de publicar un endpoint.

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/bootstrap/__tests__/openapi-runtime-contract.e2e-spec.ts — import nuevo
import { TatumStubServer } from '@test/helpers/tatum-stub-server';
```

```ts
// src/bootstrap/__tests__/openapi-runtime-contract.e2e-spec.ts — declaración del stub
let context: Context;
let stub: TatumStubServer;
const ajv = new Ajv({ strict: false, allErrors: true });
```

```ts
// src/bootstrap/__tests__/openapi-runtime-contract.e2e-spec.ts — dentro del beforeAll,
// antes de createTestApp y ampliando los TRUNCATE
  beforeAll(async () => {
    // El stub arranca ANTES que la app: el adaptador de wallets no llama al proveedor al
    // construirse, pero si algún día lo hiciera, el orden inverso daría un ECONNREFUSED en el
    // arranque y el fallo hablaría del stub y no de la aplicación.
    stub = await TatumStubServer.start();
    ({ app, prefix, appConfig } = await createTestApp());
    document = buildOpenApiDocument(app, appConfig);
    const dataSource = app.get(DataSource);
    await dataSource.query('TRUNCATE TABLE wallet_transfers');
    await dataSource.query('TRUNCATE TABLE wallets');
    await dataSource.query('TRUNCATE TABLE auth_credentials');
    await dataSource.query('TRUNCATE TABLE users CASCADE');
    await dataSource.query('TRUNCATE TABLE orders CASCADE');
```

```ts
// src/bootstrap/__tests__/openapi-runtime-contract.e2e-spec.ts — el afterAll
afterAll(async () => {
  await app?.close();
  // La aserción va antes de parar el stub: una ruta golpeada sin respuesta programada
  // significa que el guion mandó una llamada que nadie previó, y la respuesta 418 con la que
  // el stub contestó no representa nada del proveedor.
  expect(stub?.unstubbed ?? []).toEqual([]);
  await stub?.stop();
});
```

```ts
// src/bootstrap/__tests__/openapi-runtime-contract.e2e-spec.ts — los cinco escenarios, al
// final del array SCENARIOS, después del último de POST /orders
    // Los cinco de `wallets`, EN ESTE ORDEN: `it.each` conserva el orden del array y Jest los
    // corre en serie, así que cada uno deja el estado que el siguiente necesita — la wallet
    // existe antes de leerla, y está activándose antes de transferir. El stub se programa dentro
    // de cada `run`, que es lo único que mantiene el escenario autocontenido.
    {
      operation: 'POST /wallets',
      status: 200,
      describe: 'el alta de la wallet custodiada',
      run: (context) => {
        stub.stub('POST', '/v3/gas-pump', {
          status: 200,
          body: [`0xdeadbeef${'0'.repeat(31)}1`],
        });
        return request(context.app.getHttpServer())
          .post(`${context.prefix}/wallets`)
          .set('Authorization', `Bearer ${context.userToken}`)
          .send();
      },
    },
    {
      operation: 'GET /wallets/me',
      status: 200,
      describe: 'la consulta de la wallet propia',
      run: (context) => get(context, '/wallets/me', context.userToken),
    },
    {
      operation: 'POST /wallets/me/activation',
      status: 202,
      describe: 'la activación de la wallet',
      run: (context) => {
        stub.stub('GET', '/v3/gas-pump/activated/*', {
          status: 200,
          body: { activated: false },
        });
        stub.stub('POST', '/v3/gas-pump/activate', {
          status: 200,
          body: { txId: 'ac'.repeat(32) },
        });
        return request(context.app.getHttpServer())
          .post(`${context.prefix}/wallets/me/activation`)
          .set('Authorization', `Bearer ${context.userToken}`)
          .send();
      },
    },
    {
      operation: 'POST /wallets/me/transfers',
      status: 200,
      describe: 'una transferencia enviada',
      run: (context) => {
        // `activated: true` reconcilia la wallet de `activating` a `active` en la misma llamada
        // que sirve de precondición (spec §5.4): sin ella la transferencia daría 409.
        stub.stub('GET', '/v3/gas-pump/activated/*', { status: 200, body: { activated: true } });
        stub.stub('POST', '/v3/blockchain/sc/custodial/transfer', {
          status: 200,
          body: { txId: '7a'.repeat(32) },
        });
        return request(context.app.getHttpServer())
          .post(`${context.prefix}/wallets/me/transfers`)
          .set('Authorization', `Bearer ${context.userToken}`)
          .send({
            recipient: '0xabcdef0123456789abcdef0123456789abcdef01',
            kind: 'native',
            amount: '1000000000000000',
          });
      },
    },
    {
      operation: 'GET /wallets/me/transfers',
      status: 200,
      describe: 'el listado paginado del libro de transferencias',
      run: (context) => get(context, '/wallets/me/transfers?page=1&limit=20', context.userToken),
    },
```

- [ ] **Step 2: Ejecuta el test para verificar que falla**

Run: `pnpm test:e2e src/bootstrap/__tests__/openapi-runtime-contract.e2e-spec.ts`
Expected: FAIL sin los escenarios — el caso «debería ejercitar todas las operaciones que el
documento publica» rojo con `Received: ["GET /wallets/me", "GET /wallets/me/transfers",
"POST /wallets", "POST /wallets/me/activation", "POST /wallets/me/transfers"]`

- [ ] **Step 3: Escribe la implementación mínima**

Los cuatro bloques del Step 1 son la edición completa: no hay código de producción nuevo en esta
tarea. Si algún escenario sale rojo por `Sin esquema publicado para … -> …`, el defecto está en la
documentación OpenAPI del endpoint —falta el `@ApiEnvelope` de ese status— y se arregla allí, en
el controller, no aflojando el escenario:

```ts
// src/modules/wallets/infrastructure/http/wallets.controller.ts — la forma que el guardián exige
  @ApiEnvelope(WalletResponseDto, {
    status: HttpStatus.OK,
    description: 'Wallet custodiada del usuario autenticado.',
    example: {
      success: true,
      data: WALLET_EXAMPLE,
      request: requestMeta(COLLECTION_PATH),
    },
  })
```

- [ ] **Step 4: Ejecuta el test para verificar que pasa**

Run: `pnpm test:e2e src/bootstrap/__tests__/openapi-runtime-contract.e2e-spec.ts`
Expected: PASS — 22 passed (los 16 escenarios que ya había, los 5 nuevos y la cobertura del guion)

---

### Task 46: cobertura del asignador y la convención de esquema de las dos tablas nuevas

**Layer:** bootstrap
**Rule codes to honor:** `test-use-testing-module`, `db-use-migrations`

**Files:**

- Modify: `jest.config.mjs`, `test/jest-e2e.config.mjs`, `src/database/__tests__/schema-conventions.e2e-spec.ts`

⚠️ **Esta tarea no lleva ciclo rojo→verde y conviene decir por qué en vez de fingir uno.** Es
configuración de medición y la ampliación de un guardián existente. El caso de
`schema-conventions` se pone rojo **solo si la migración está mal** —esa es exactamente su razón
de existir— así que su rojo sería un defecto de otra tarea, no un paso de esta. La regla del repo
ya exime a infra, config y wiring de la tabla de casos acordados; esto es lo mismo un escalón más
abajo.

`*.allocator.ts` sale de la suite unitaria por el **mismo criterio literal** que
`*.typeorm.repository.ts`: habla con un almacén real —una secuencia de PostgreSQL— y el skill
exige probarlo contra la base, no con `jest.mock('typeorm')`. Medirlo en la unitaria penalizaría
por seguir la convención del repo, que es la frase que ese bloque ya tiene escrita.

- [ ] **Step 1: Añade las dos tablas nuevas al guardián de convenciones del esquema**

```ts
// src/database/__tests__/schema-conventions.e2e-spec.ts — el caso de la traza de auditoría
describe('la traza de auditoría', () => {
  it('debería estar completa en las cinco tablas que llevan agregado', () => {
    // Arrange
    const AUDIT = ['created_at', 'updated_at', 'created_by', 'updated_by'];
    const byTable = new Map<string, string[]>();
    for (const column of columns) {
      byTable.set(column.table_name, [
        ...(byTable.get(column.table_name) ?? []),
        column.column_name,
      ]);
    }

    // Act
    const missing = ['users', 'auth_credentials', 'orders', 'wallets', 'wallet_transfers'].flatMap(
      (table) =>
        AUDIT.filter((audit) => !byTable.get(table)?.includes(audit)).map(
          (audit) => `${table}.${audit}`,
        ),
    );

    // Assert
    // `orders_outbox` queda fuera a propósito: no es un agregado, es una cola. Sus filas no
    // tienen autor ni ciclo de vida — tienen `occurred_at` y `processed_at`, que son otra cosa.
    // `wallets` y `wallet_transfers` SÍ entran: las dos son `Entity<TId>`, así que las dos
    // heredan la traza completa de `shared/domain/entity.base.ts` y sus mappers la escriben.
    expect(missing).toEqual([]);
  });
});
```

- [ ] **Step 2: Ejecuta el guardián del esquema**

Run: `pnpm db:up && pnpm db:migrate:test && pnpm test:e2e src/database/__tests__/schema-conventions.e2e-spec.ts`
Expected: PASS — 4 passed. Un rojo aquí nombra la columna que falta (p. ej.
`wallet_transfers.updated_by`) y el arreglo es la migración, nunca la lista.

- [ ] **Step 3: Mueve `*.allocator.ts` de la suite unitaria a la E2E**

```js
// jest.config.mjs — dentro de `collectCoverageFrom`, junto a las demás exclusiones medidas en E2E
    '!src/**/*.module.ts',
    '!src/**/*.typeorm.repository.ts',
    //   - `*.allocator.ts`: mismo criterio EXACTO que `*.typeorm.repository.ts`, no una
    //     excepción nueva. El asignador de índices habla con un almacén real —una secuencia de
    //     PostgreSQL— y su modo de fallo interesante (que el driver entregue el `int8` COMO
    //     STRING) solo se observa contra la base de verdad. Un unitario con la sesión doblada
    //     mediría el doble, no el driver. Lo mide `test/jest-e2e.config.mjs`, con su umbral.
    '!src/**/*.allocator.ts',
    '!src/database/data-source.ts',
```

```js
// test/jest-e2e.config.mjs — dentro de `collectCoverageFrom`, tras los repositorios TypeORM
  collectCoverageFrom: [
    'src/**/*.module.ts',
    'src/**/*.typeorm.repository.ts',
    // Entra con `wallets`: la suite unitaria lo excluye por el mismo motivo que a los
    // repositorios, así que sin esta línea no lo mediría NINGUNA de las dos — que es
    // exactamente el agujero que este archivo documentó y cerró el 2026-08-19.
    'src/**/*.allocator.ts',
    'src/database/data-source.ts',
    'src/database/seeds/**',
    'src/database/outbox/**',
    'src/database/migrations/**',
    '!src/**/__tests__/**',
  ],
  coverageDirectory: 'coverage-e2e',
  // `json-summary` se añade para poder REMEDIR los umbrales sin leer a ojo la tabla de texto:
  // el paso de remedición del plan lee `coverage-e2e/coverage-summary.json`. `text` y `lcov`
  // se quedan: uno es lo que se ve en CI y el otro lo que consume el informe.
  coverageReporters: ['text', 'lcov', 'json-summary'],
```

- [ ] **Step 4: Mide la cobertura E2E real con el módulo dentro**

Run: `pnpm db:up && pnpm db:migrate:test && pnpm migration:run && pnpm test:e2e:ci`
Expected: la suite entera en verde y el informe de cobertura escrito en `coverage-e2e/`.
Si alguno de los cuatro umbrales vigentes (branches 38, functions 88, lines 87, statements 84)
se pone rojo, **no se baja el umbral**: significa que el E2E de `wallets` no está ejercitando
algún archivo del scope, y el arreglo es el escenario que falta.

- [ ] **Step 5: Calcula los cuatro umbrales nuevos con los números medidos**

Run:

```bash
node -e "
const s = require('./coverage-e2e/coverage-summary.json').total;
const floor = (k) => Math.floor(s[k].pct) - 3;
console.log('    statements ', s.statements.pct, ' -> suelo', floor('statements'));
console.log('    branches   ', s.branches.pct,   ' -> suelo', floor('branches'));
console.log('    functions  ', s.functions.pct,  ' -> suelo', floor('functions'));
console.log('    lines      ', s.lines.pct,      ' -> suelo', floor('lines'));
console.log();
console.log('  coverageThreshold: {');
console.log('    global: { branches: ' + floor('branches') + ', functions: ' + floor('functions') + ', lines: ' + floor('lines') + ', statements: ' + floor('statements') + ' },');
console.log('  },');
"
```

Expected: ocho líneas con los porcentajes medidos y, debajo, el bloque `coverageThreshold`
literal listo para pegar.

⚠️ El margen es de **3 puntos**, que es el criterio que ese archivo ya tiene escrito y medido
(«apretarlos más convertiría cualquier refactor menor en una CI roja, que es la vía rápida a que
alguien los baje sin mirar»). Los suelos solo **suben**: si el calculado sale por debajo del
vigente, se deja el vigente y se investiga por qué la cobertura bajó.

- [ ] **Step 6: Escribe los umbrales medidos y la entrada de remedición**

Se pega el bloque `coverageThreshold` que imprimió el Step 5 sustituyendo al vigente en
`test/jest-e2e.config.mjs`, y encima de él, en el comentario de cabecera de esa clave, se añade un
párrafo con **esta forma exacta**, con la fecha del día y los cuatro porcentajes y suelos que
imprimió el mismo comando:

```js
// test/jest-e2e.config.mjs — forma del párrafo de remedición (los números son los del Step 5)
// **Remedición del <fecha>**, al entrar `wallets`: el módulo aporta dos repositorios TypeORM,
// el asignador de índices sobre la secuencia, su `*.module.ts` y una migración, todos
// ejercitados por `wallets.e2e-spec.ts` y por el guardián de contrato en ejecución.
//
//     statements  <medido>  (suelo <medido-3>)      branches  <medido>  (suelo <medido-3>)
//     functions   <medido>  (suelo <medido-3>)      lines     <medido>  (suelo <medido-3>)
//
// Los suelos se elevan con 3 puntos de margen, mismo criterio que las dos remediciones
// anteriores. El asignador entra con su E2E propio; si aparece con cobertura baja en el
// informe, es que le falta el caso del `int8` entregado como string, no que sobre el umbral.
```

- [ ] **Step 7: Ejecuta la suite E2E completa con los umbrales nuevos**

Run: `pnpm test:e2e:ci`
Expected: PASS — suites verdes y **ningún** `Jest: "global" coverage threshold … not met`

---

### Task 47: verificación integral del ciclo

**Layer:** bootstrap
**Rule codes to honor:** `test-use-testing-module`, `test-e2e-supertest`, `security-sanitize-output`, `db-use-migrations`

**Files:**

- Ninguno. Esta tarea no escribe código: ejecuta los ocho controles y termina **sugiriendo** el
  commit. ⚠️ **Ningún paso ejecuta `git commit`, `git add`, `git push` ni `git tag`.**

- [ ] **Step 1: Definition of Done, mitad sin base de datos**

Run: `pnpm typecheck && pnpm lint:check && pnpm format:check && pnpm test`
Expected: PASS — `tsc` sin salida; ESLint sin salida; Prettier `All matched files use Prettier
code style!`; Jest con todas las suites verdes y **sin** `coverage threshold … not met`.

Un rojo típico y su lectura: `no-restricted-syntax` sobre un `import type` de un puerto significa
que ese archivo tiene decoradores y el import hay que pasarlo a valor; **no** se añade el nombre a
la lista cerrada del selector salvo que sea de verdad un dato no inyectable.

- [ ] **Step 2: Definition of Done, mitad con base de datos, y el build**

Run: `pnpm db:up && pnpm db:migrate:test && pnpm migration:run && pnpm test:e2e && pnpm build`
Expected: PASS — `migration:run` aplica la migración de `wallets` a la base de desarrollo y
`db:migrate:test` a `crypto_amazon_clon_api_test`; la suite E2E entera verde; `nest build` sin
errores.

⚠️ **Las dos bases, no una.** La CLI de TypeORM lee `DB_DATABASE` del `.env`, que apunta a la de
desarrollo; `test/setup-env.ts` redirige solo dentro del proceso de Jest. Saltarse
`db:migrate:test` da `relation "wallets" does not exist` en el `beforeAll` del primer E2E que
trunque esa tabla, y parece un bug del código cuando es un esquema que nadie migró.

- [ ] **Step 3: El gate de fronteras no se toca — un módulo nuevo no cuesta ni una regla**

Run: `git diff --stat eslint.boundaries.js`
Expected: **salida vacía**.

Es una afirmación comprobable de la cabecera de ese archivo: «módulo nuevo bajo `src/modules/` →
cero ediciones aquí: los wildcards lo cubren». `wallets` es el tercer consumidor de la enmienda
G1/G2 (importar el `*.module.ts` ajeno desde `infrastructure/`), después de `orders` y de `auth`,
y ninguno de los dos necesitó una regla nueva. Si el diff **no** está vacío, la pregunta correcta
no es «qué regla añado» sino «qué import ilegal estoy legalizando».

Run: `pnpm test src/__tests__/eslint-boundaries.spec.ts`
Expected: PASS — los 34 casos + P1, sin tocar el archivo compartido.

- [ ] **Step 4: Auditoría de mutación con el scope ENTERO**

Run: `pnpm test:mutation`
Expected: PASS — `Final mutation score of <medido> is greater than or equal to break threshold 85`.

⚠️ **Sin `--mutate`, y no es una preferencia de estilo.** El umbral es global y cada módulo pesa
según su número de mutantes, no según su porcentaje: un scope acotado **no dice a qué distancia
está la CI de ponerse roja**. Ya costó una conclusión equivocada en el ciclo del 2026-08-22 —se
midió `orders` aislado, dio 85.11 % y se reportó que la CI estaba a 0.11 puntos, cuando el margen
real era 9.44. Y un scope acotado sin lógica mutable no dice nada en absoluto: `NaN < 85` es
`false`, así que Stryker sale con exit 0 e imprime un mensaje literalmente falso.

Tras la corrida, **actualizar la cabecera de `stryker.config.mjs`** con una entrada de remedición
fechada: score global, censo (killed / survived / sin cobertura / error) y el reparto por módulo
con su peso en mutantes. Un mutante **sin cobertura** casi nunca es «falta un test»: es «sobra
código», y el ejemplo del repo es el `restoreProfile()` que se retiró el mismo día.

- [ ] **Step 5: La invariante greppable de la clave privada**

Run:

```bash
rg -n --glob '!**/__tests__/**' 'masterPrivateKey\.value' src/modules/wallets
```

Expected: **exactamente dos líneas**, ambas en
`src/modules/wallets/infrastructure/gateways/tatum-custodial-address.gateway.ts` — la que compone
el cuerpo de la activación y la que compone el de la transferencia. Ese objeto va directo a la
llamada: no se guarda, no se loguea y no se adjunta a ningún error.

Run:

```bash
rg -n --glob '!**/__tests__/**' 'masterPrivateKey' src/modules/wallets src/config/wallets.config.ts
```

Expected: las dos anteriores, la del constructor del gateway que envuelve el string plano en el
`SecretValueObject`, y la del `registerAs` de la configuración. **Ninguna más**, y en particular
ninguna dentro de `domain/` ni de `application/`.

⚠️ El value object del secreto **no puede vivir en `src/config/`**: el gate solo permite
`config → config`, así que ni el kernel compartido ni los módulos son alcanzables desde ahí. La
configuración guarda un string plano y el adaptador lo envuelve en su constructor. Es un hecho de
la matriz de fronteras, no una preferencia.

Run:

```bash
rg -n 'console\.(warn|error)' src/modules/wallets
```

Expected: **salida vacía**. `no-console` permite `warn` y `error`, así que un volcado ahí ni
avisaría, y el cuerpo de la transferencia lleva la clave dentro.

- [ ] **Step 6: `secretlint` y `gitleaks` sobre los dos archivos que tocan el secreto**

Run: `pnpm secretlint --maskSecrets .env.example src/config/wallets.config.ts`
Expected: sin hallazgos (exit 0).

⚠️ **Y eso NO es el gate aquí — está medido.** Con el `.secretlintrc.json` de este repo, un
`.env.example` con una clave privada de Ethereum, tanto de ceros como con aspecto realista, da
**cero avisos**: `preset-recommend` dispara con formas conocidas y no trae regla de entropía
genérica. Pasar secretlint no demuestra nada sobre este secreto en concreto.

Run:

```bash
gitleaks detect --no-git --source . --redact --verbose
```

Sin gitleaks instalado, el equivalente:

```bash
docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:v8.30.1 detect --no-git --source /repo --redact --verbose
```

Expected: `no leaks found`.

⚠️ **Correr gitleaks a mano antes del primer commit es obligatorio**, y la razón está escrita en
`.github/workflows/security.yml`: la action **no escanea el historial completo en `push` ni en
`pull_request`** —elige un rango por su cuenta, a menudo un solo commit— así que el barrido que
mira hacia atrás depende del cron semanal. Un secreto que entre hoy puede tardar seis días en
salir. De ahí que `WALLETS_MASTER_PRIVATE_KEY` vaya **comentada y sin valor** en `.env.example`,
como ya está `JWT_SECRET`, y que el único placeholder ejecutable —de entropía nula— viva en
`wallets.config.ts`.

- [ ] **Step 7: Prueba de humo manual contra Sepolia — nueve pasos**

El DoD verifica el código, no la integración. Estos nueve pasos son lo único que demuestra que
Gas Pump hace lo que se compró. Se ejecutan a mano, contra testnet, y **no forman parte de CI**.

1. Crear `.env.local` con `TATUM_API_KEY` de testnet, `WALLETS_MASTER_ADDRESS` y
   `WALLETS_MASTER_PRIVATE_KEY` de la master real, y `TATUM_API_URL=https://api.tatum.io`.
   Anotar el consumo de créditos que marca el panel del proveedor **antes de empezar**.
2. `pnpm start:dev`. Expected: arranca. Si aborta con la comprobación de arranque, la dirección y
   la clave son de EOAs distintas — que es justo el agujero que esa comprobación cierra, y que sin
   ella solo se habría visto al enviar, con el gas ya gastado.
3. `POST /auth/register` + `POST /auth/login` con una cuenta nueva. Expected: 201 y 200 con
   `accessToken`.
4. `POST /wallets` con ese token. Expected: **200** con `address` e `index`; `address` **no** es
   la master.
5. Repetir el `POST /wallets` idéntico. Expected: **200 con la misma `address`** y el contador de
   créditos del panel **sin moverse** respecto al paso 4. Es la idempotencia barata: la segunda
   llamada no crea nada y no debe gastar.
6. Fondear esa dirección desde un faucet de Sepolia y esperar la confirmación en el explorador.
7. `POST /wallets/me/activation`. Expected: **202** con el txId. Repetir `GET /wallets/me` hasta
   que `status` sea `active` — la reconciliación es perezosa y ocurre dentro de activar, así que
   puede hacer falta un segundo `POST /wallets/me/activation` para que se cure.
8. `POST /wallets/me/transfers` con un envío **nativo** pequeño a una dirección propia. Expected:
   200 con `txId`. Abrir ese `txId` en el explorador y **verificar que la cuenta que paga el gas
   de la transacción es la master**, no la dirección del usuario. ⚠️ **Este es el paso que
   demuestra el objetivo del ciclo**; los ocho anteriores solo lo preparan.
9. `POST /wallets/me/transfers` con el mismo cuerpo pero cambiando **un** carácter de caso al
   destinatario en forma EIP-55. Expected: **400**, y el contador de créditos del panel **sin
   moverse** respecto al paso 8: el 400 muere en el borde HTTP, antes de tocar la red.

⚠️ Lo que esta prueba **no** cubre, dicho en voz alta: no hay clave de idempotencia del envío
(un reintento tras timeout puede transferir dos veces), nadie resuelve las filas en `unknown`, no
se gestiona el `nonce` y no hay alerta de saldo de la master. Los cuatro están en «Fuera de
alcance» del spec, no olvidados.

- [ ] **Step 8: Sugerir el commit y PARAR**

⚠️ **Ningún paso de esta tarea ejecuta `git commit`, `git add`, `git push` ni `git tag`.** La
política del repo es explícita: una autorización anterior nunca se reutiliza, y esto aplica
también a los subagentes. Cuando los siete pasos anteriores estén en verde, la tarea termina
diciendo exactamente esto y esperando:

> _"Te sugiero hacer un commit de los cambios por haber cerrado el ciclo del bounded context
> `wallets`: dominio, casos de uso, adaptadores, migración, cableado y las dos suites E2E, con el
> DoD completo, la auditoría de mutación por encima del umbral y gitleaks limpio sobre
> `.env.example` y `wallets.config.ts`. Avísame y lo redacto."_

El scope del mensaje, cuando se autorice, es `wallets` — el que la Task 41 añadió a
`commitlint.config.cjs`; sin esa entrada commitlint rechazaría el mensaje y el camino de menor
resistencia sería commitear sin scope.

---

## Notas para quien ejecute

### Lo que este repo castiga y no es evidente

- **`pnpm test` no comprueba tipos.** `jest.config.mjs` transforma con `@swc/jest` puro, así que la
  suite puede estar verde sobre código que no compila. Toda tarea que cambie una firma o un genérico
  captura su rojo con `pnpm typecheck`, que es una pasada aparte y obligatoria del DoD.
- **`import type` está prohibido para los puertos** en archivos con decoradores (`application/`,
  `infrastructure/`, `*.module.ts`): la referencia se borra del emit y Nest falla **en runtime** con
  `lint:check` y `typecheck` en verde. Los `type` de datos que viajan con un puerto sí van en línea,
  y por eso la Task 41 añade sus nombres a la lista cerrada de `eslint.config.mjs`.
- **Nada de barrels.** Ni un `index.ts` bajo `src/`: la regla 5 del gate lo prohíbe y el simple hecho
  de existir es el error.
- **Un comentario que afirma un hecho comprobable lleva la medición al lado, o no se escribe.** Esa
  es la regla del repo y este ciclo ya la ha cobrado: la auditoría del spec encontró **tres
  afirmaciones falsas** publicadas como hechos del proveedor. Están corregidas y no deben volver:

| Afirmación falsa                                     | Lo medido sobre `openapi.json`                                                                                                         |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| «`chain` solo admite `"ETH"`»                        | `CreateGasPump` admite 7 cadenas, `ActivateGasPump` 5 y `TransferCustodialWallet` 6. Enviar `ETH` es **decisión nuestra**              |
| «Reactivar se rechaza con `"Wallet already exists"`» | Esa cadena es el `reason` de la operación **03**. La 02 responde `200 { txId }`: la segunda activación **se acepta** y el gas se quema |
| «La derivación es determinista»                      | La documentación solo garantiza que **no toca la cadena y no cuesta gas**                                                              |

### Cuatro mediciones que cambiaron el diseño, hechas ejecutando el código

El redactor del adaptador ejecutó todo su código en un directorio de sonda antes de escribirlo. Lo
que encontró está incorporado en las tareas, y conviene no «simplificarlo» de vuelta:

1. **`rejects.toEqual(new Error(...))` NO distingue ni la clase ni las propiedades del error, solo el
   mensaje.** Por eso todas las aserciones sobre errores del proveedor usan
   `rejects.toMatchObject({ name, reason, providerStatus })`. Con `toEqual`, un test que cree
   comprobar el motivo pasa igual con el motivo equivocado.
2. **Bajo Jest, el `DOMException` de `AbortSignal.timeout` da `instanceof Error === false`** —realm
   distinto—, aunque fuera de Jest dé `true`. Refuerza la regla de discriminar por `err.name ===
'TimeoutError'` y nunca por `instanceof`.
3. **`fc.hexaString()` no existe en `fast-check@4.9.0`.** Verificado por segunda vez:
   `typeof fc.hexaString === 'undefined'`. Los arbitrarios hexadecimales se construyen con
   `fc.constantFrom` sobre el alfabeto.
4. **Los comodines `*.x` de pino redactan a profundidad 2, no a la 3.** Medido con la configuración
   real del repo. Es la razón de que la defensa principal contra la fuga de la clave sea **no
   adjuntar nunca el cuerpo a un error**, y las rutas de redacción solo la red por debajo.

### Dos órdenes que no se pueden invertir

- **Task 40 antes que ampliar `VERIFIED_ERROR_STATUSES`.** Primero se contrastan el 502 y el 503
  contra `AllExceptionsFilter` con excepciones reales; solo después se amplía el conjunto. Al revés,
  el guardián del contrato queda verde afirmando algo que nadie comprobó — que es exactamente el
  fallo que la cabecera de esa constante describe.
- **gitleaks antes del primer commit** que toque `.env.example` o `wallets.config.ts`. La cabecera de
  `.github/workflows/security.yml` deja escrito que gitleaks **no escanea el historial completo en
  `push` ni en `pull_request`**: solo el cron semanal y el disparo manual lo hacen. Lo que entre hoy
  no lo caza el PR siguiente.
  ⚠️ Y `secretlint` **no** es el gate aquí: medido ejecutándolo, una clave privada de Ethereum en
  `.env.example` no le arranca ni un aviso.

### Migraciones y bases

La migración se aplica a **las dos** bases: `pnpm migration:run` para la de desarrollo y
`pnpm db:migrate:test` para `crypto_amazon_clon_api_test`. Y el `TRUNCATE` de los E2E **no puede
llevar `RESTART IDENTITY`**: reiniciaría la secuencia de índices y dos usuarios acabarían sobre la
misma dirección.

### Si algo se pone rojo

- **Si un spec existente se pone rojo y la tentación es tocar su aserción, para y consulta.** Una
  aserción que cambia significa que el ciclo alteró comportamiento ajeno.
- **Ningún caso nuevo se añade en silencio.** Si al implementar aparece un caso que no está en
  ninguna de las tablas de este plan, se consulta —confirmación JIT— y la fila se registra aquí
  **antes** de escribir su test. La trazabilidad tabla ↔ `it` es 1:1 y es lo que se valida al final.
- **Un test que pasa igual con y sin el arreglo no prueba nada.** Antes de dar por buena una
  regresión, rómpela a propósito y comprueba que se pone roja. En este repo ya pasó dos veces con
  tests que parecían cubrir un defecto.

### Lo que NO hace este plan

Nada de `git commit`, `git add`, `git push` ni `git tag`, en ningún paso. La Task 47 termina
sugiriendo el commit al usuario y esperando su instrucción explícita.
