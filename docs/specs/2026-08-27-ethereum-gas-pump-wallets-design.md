# Direcciones Ethereum custodiadas con Gas Pump de Tatum

- **Fecha:** 2026-08-27
- **Estado:** aprobado, pendiente de plan
- **Origen:** sesión de `brainstorming` sobre «implementar gas pump de Tatum», con la documentación
  descargada en `docs/tatum/gas-pump/` como única fuente sobre el proveedor.

---

## 1. Objetivo

Dar a cada usuario una dirección Ethereum propia a la que recibir fondos y desde la que enviarlos,
**sin que ese usuario necesite ETH para pagar gas**: las comisiones las cubre una _master address_
de la plataforma.

---

## 2. Bounded context y ubicación

| Destino                             | Qué va ahí                                                               | Por qué ahí                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/modules/wallets/`              | El contexto completo: dominio, aplicación, infraestructura y sus pruebas | Es un lenguaje propio —dirección custodiada, índice, activación, transferencia— que no pertenece ni a `users` (perfiles) ni a `auth` (credenciales) ni a `orders` |
| `src/config/wallets.config.ts`      | Credenciales y parámetros del proveedor                                  | Patrón `registerAs` del repo; un módulo no lee `process.env` por su cuenta                                                                                        |
| `src/database/migrations/`          | `wallets`, su secuencia de índices y `wallet_transfers`                  | Las migraciones viven fuera de los módulos, sin excepción                                                                                                         |
| `test/helpers/tatum-stub-server.ts` | Servidor HTTP de pruebas del proveedor                                   | Lo consumen dos suites de sitios distintos, que es el criterio del repo para un helper transversal                                                                |

La dependencia cross-módulo es **`wallets → users` y solo esa**, consumiendo `UsersLookup` desde
`users.module.ts` — la única superficie legal (regla 3 del gate + enmienda G1). `wallets` **no**
importa `auth.module`: `@Auth()` funciona porque `APP_GUARD` es multi-provider y `auth` ya lo
registró globalmente, así que de `auth` no se consume ni un símbolo.

### La contradicción del encargo original, y cómo se resolvió

El encargo pedía wallets **no custodiadas**, entregando al usuario su clave privada para que
autorizara las transferencias. Es incompatible con Gas Pump, y no por criterio de diseño:

> Una gas pump address **es un contrato inteligente**. Los contratos no tienen clave privada — no
> existe la clave que entregar. Quien firma es siempre la master:
> `POST /v3/blockchain/sc/custodial/transfer` exige `fromPrivateKey` = _«The private key of the
> blockchain address that owns the gas pump address ("master address")»_
> (`docs/tatum/gas-pump/05-transfercustodialwallet.md`). La documentación del proveedor llama al
> escenario _«your custodial application»_ y las rutas se llaman literalmente `/custodial/`.

De las tres propiedades pedidas —Gas Pump, que el admin pague los fees, y no custodia con clave del
usuario— solo caben dos. Se planteó antes de construir nada y **se eligió el modelo custodial fiel
a la documentación**.

### Alternativas descartadas

| Alternativa                                                  | Por qué se descartó                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Wallets no custodiadas (HD wallet, clave al usuario)**     | Cumple la no custodia pero **el admin deja de pagar los fees**: cada usuario paga su propio gas. No usa Gas Pump en absoluto                                                                                                                                                                                                                                       |
| **No custodiadas + el admin financia el gas por adelantado** | El admin paga en sentido económico, pero cuesta **una transacción extra por envío** y deja ETH sobrante disperso en las direcciones de los usuarios. Tampoco usa Gas Pump                                                                                                                                                                                          |
| **Gas Pump + una clave de «autorización» para el usuario**   | Firma off-chain que nuestro propio backend verifica antes de llamar al proveedor. No es no-custodia: el backend tiene la master y puede saltarse la firma. Sería teatro                                                                                                                                                                                            |
| **SDK `@tatumio/tatum`**                                     | Los 7 `x-codeSamples` de `docs/tatum/gas-pump/openapi.json` están **vacíos** y no hay un solo ejemplo de SDK en la documentación descargada; lo único citado es `tatum-js` rama **v2** (legacy). Solo usamos 4 de las 7 operaciones, y `fetch`, `AbortSignal.timeout` y `Error.cause` son nativos en Node 24.19.0 (verificado ejecutándolo en el runtime del repo) |

### Decisiones cerradas con el usuario

| #   | Decisión                                                                                                                                                                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Modelo **custodial** con Gas Pump. Nadie recibe clave privada                                                                                                                                                                                                                                                  |
| 2   | Red inicial **testnet**. ⚠️ La red la decide la **API key**: no hay campo de red en ninguno de los 32 esquemas. Enviar `chain: "ETH"` es **decisión nuestra**, no restricción del proveedor — medido sobre `openapi.json`: `CreateGasPump` admite 7 cadenas, `ActivateGasPump` 5 y `TransferCustodialWallet` 6 |
| 3   | La **master EOA es la dirección del admin**. Todos los usuarios reciben índices de una secuencia desde 0, sin casos especiales. Coste aceptado: el saldo del admin y el fondo de gas se mezclan                                                                                                                |
| 4   | Los **cuatro `contractType`**: fungible, NFT, multi-token y nativo                                                                                                                                                                                                                                             |
| 5   | La wallet nace con `POST /wallets` explícito e **idempotente**, no en el registro                                                                                                                                                                                                                              |
| 6   | **Checksum EIP-55** del destinatario, con `@noble/hashes`                                                                                                                                                                                                                                                      |
| 7   | **Libro de transferencias dentro de este ciclo**: segundo agregado con su tabla                                                                                                                                                                                                                                |
| 8   | **`mainnet` bloqueado en el arranque.** ⚠️ Este código no puede ir a producción sin otro ciclo (KMS)                                                                                                                                                                                                           |
| 9   | **La activación NO escribe por delante**, a diferencia de la transferencia. Se acepta la asimetría: la ventana cuesta créditos de testnet, no ETH. ⚠️ Queda en el backlog **marcada como bloqueante para mainnet**                                                                                             |
| 10  | **Una sola EOA en el sistema, y es la del admin.** El admin **no tiene gas pump**; de su EOA se derivan las de los usuarios. `POST /wallets` responde **409** al rol admin y `GET /wallets/me` responde también para él, con un discriminador `kind`                                                           |
| 11  | **`CHECK ("address" <> "owner_address")`** en la tabla. ⚠️ Primer `CHECK` del esquema: hoy las cuatro migraciones solo declaran claves primarias                                                                                                                                                               |

---

## 3. Modelo de dominio

### 3.1 `Wallet` — `Entity<WalletId>`, no `AggregateRoot`

`docs/module-blueprint.md` marca eventos y outbox como **opcionales**: «solo si algo fuera del
agregado debe reaccionar». En este ciclo nadie reacciona, y el auditor de mutación castiga el código
sin consumidor. Tampoco `SoftDeletableEntity`: una gas pump address no se des-asigna, porque puede
tener fondos.

| Campo            | Tipo                      | Nota                                                                                                                 |
| ---------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `id`             | `WalletId`                | UUID v4                                                                                                              |
| `ownerId`        | `string`                  | El `sub` del token. `string` y no un VO, mismo criterio que `Order.customerId`: el identificador pertenece a `users` |
| `ownerAddress`   | `EthereumAddress`         | La master bajo la que se derivó la dirección                                                                         |
| `addressIndex`   | `AddressIndex`            | Entero no negativo, único en el sistema                                                                              |
| `address`        | `EthereumAddress`         | Determinista a partir de (`ownerAddress`, `addressIndex`)                                                            |
| `status`         | `WalletStatus`            | **Monótono**: nunca retrocede                                                                                        |
| `activationTxId` | `TransactionHash \| null` | Puede seguir nulo en `active` (curación)                                                                             |

```
             markActivationRequested(txId)        confirmActivated()
receive-only ────────────────────────────► activating ──────────────► active
     │                                                                  ▲
     └───────────────────── confirmActivated() ─────────────────────────┘
                 curación: la cadena ya lo dice y nuestro txId se perdió
```

Los estados nombran la **capacidad**, no el vocabulario del proveedor. **No existe
`activation_failed`**: con la reconciliación elegida (§5.4), un `activated:false` es indistinguible
de «todavía no», así que el estado sería inalcanzable — y este repo borra el dominio inalcanzable.

⚠️ La transición directa `receive-only → active` **no es un atajo**: es la salida del fallo parcial
de la activación, cuando el proveedor aceptó la transacción y perdimos su respuesta. Sin ella esa
wallet quedaría colgada para siempre, y el intento siguiente **volvería a activar**.

⚠️ **Y volver a activar no falla de forma visible, que es lo que lo hace peligroso.** Una versión
anterior de este párrafo decía que el proveedor lo rechazaría con `"Wallet already exists"`, y es
falso: medido sobre `openapi.json`, esa cadena es el `example` del campo `reason` de
`InvalidGasPumpAddress`, que solo aparece en la respuesta de la **operación 03**
(`GET /v3/gas-pump/address/{chain}/{txId}`). La **operación 02** responde `200` con un
`TransactionHash` o un `SignatureId`. Es decir: la segunda activación **se acepta**, el gas se
quema, y el fallo solo es visible leyendo el `invalid[]` de la 03 — que este ciclo no lee (§9).

Tres reglas de las transiciones, las tres con consecuencia:

- **`activating → activating` lanza**, no es idempotente: una segunda petición trae un txId nuevo, y
  tragárselo dejaría guardado el primero mientras el sistema cree haber registrado el segundo.
- **`active` + `confirmActivated()` es no-op SIN `touch()`**, mismo criterio que
  `User.promoteToAdmin`: repetir la confirmación no debe reescribir `updatedBy`, o la traza acabaría
  nombrando a quien no activó nada.
- **`ownerAddress` y `assertOwnedBy(master)` van juntos o no van.** Una rotación de la master cambia
  la dirección de cada índice; sin la comprobación el sistema seguiría respondiendo direcciones que
  ya no controlamos. Una columna sin su comprobación sería dato sin consumidor.

### 3.1.1 Invariante: una sola EOA en el sistema, y es la del admin

Ningún usuario puede acabar con una cuenta externa. Toda dirección que el sistema entrega a un
usuario es una gas pump address **derivada**. La única EOA es la master, que pertenece al admin y
vive en la configuración, **no en la tabla**.

Hoy eso es cierto **por construcción**: el sistema solo sabe acuñar direcciones derivadas. Lo que se
añade es defensa en profundidad contra el fallo que sí es posible —que el adaptador devuelva la
master por error y se la entregue a un usuario—, que sería catastrófico y silencioso: ese usuario
«tendría» el fondo de gas, y el siguiente también.

| Dónde                                             | Qué comprueba                                                                               | Qué caza que los demás no                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `Wallet.assign()`                                 | `address` no puede ser igual a `ownerAddress` ⇒ `WalletAddressIsMasterError` (500)          | El fallo en el instante de construirlo, con un error con nombre                     |
| Adaptador, al derivar                             | La respuesta trae **exactamente un** elemento y no es la master                             | Una respuesta vacía o de más, antes de llegar al dominio                            |
| Migración: `CHECK ("address" <> "owner_address")` | Lo mismo, en el esquema                                                                     | Una escritura directa por SQL —seed, migración, consola— que no pasa por el dominio |
| Arranque                                          | La dirección derivada de `WALLETS_MASTER_PRIVATE_KEY` coincide con `WALLETS_MASTER_ADDRESS` | Que las dos variables sean de EOAs **distintas** — ver el aviso de abajo            |
| E2E de `POST /wallets`                            | Ninguna dirección devuelta coincide con la master configurada                               | El sistema completo, de punta a punta                                               |

Y el corolario en el borde HTTP: **`POST /wallets` responde 409 al rol admin**, porque el admin ya
tiene dirección y darle además una derivada le dejaría dos. `GET /wallets/me` sí responde para él,
con un discriminador `kind: 'master' | 'custodial'` y `index` nulo en el primer caso — un 404 ahí
sería mentira a medias, porque el admin sí tiene dirección y es la que sostiene todo.

⚠️ **La comprobación de arranque no es opcional, y es la única que cierra un agujero real.** Medido:
`TransferCustodialWallet` tiene diez propiedades y **ninguna se llama `owner`** — la master viaja a
la transferencia **solo** como `fromPrivateKey`. Es decir: derivar y activar se hacen contra la
**dirección** configurada, y transferir se firma con la **clave** configurada, y nada ata las dos.
Una configuración en la que dirección y clave pertenezcan a EOAs distintas pasa `assertOwnedBy`
—que compara contra la config, no contra la clave— y solo falla al enviar, con el gas gastado.
Cerrarlo es derivar la dirección desde la clave al arrancar: cinco líneas con `@noble/curves`,
hermana de la `@noble/hashes` que ya entra por el checksum EIP-55.

⚠️ **Consecuencia operativa que hay que tener escrita:** la EOA del admin **no está en la tabla
`wallets`**. Responder «qué direcciones controlamos» exige mirar la tabla **y** la configuración.
Quien lo olvide se dejará fuera precisamente la que tiene los fondos de gas.

### 3.2 `WalletTransfer` — el libro, con escritura por delante

`Entity<TransferId>`. La fila se escribe **antes** de llamar al proveedor. Eso es lo que convierte
el libro en algo útil: con la escritura posterior, un timeout no dejaría rastro — que es justo el
caso para el que existe.

| Estado       | Cuándo                                                                               | Qué sabemos                                                  |
| ------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `submitting` | Fila escrita, antes de la llamada                                                    | Nada aún                                                     |
| `submitted`  | El proveedor devolvió `txId`                                                         | La transacción está enviada, no necesariamente minada        |
| `rejected`   | El proveedor rechazó **el cuerpo** con un 400                                        | **No pasó nada en la cadena.** Se guarda un código de motivo |
| `unknown`    | Timeout, red caída, 5xx, o un fallo de nuestra cuenta con el proveedor (401/403/4xx) | ⚠️ **Pudo minarse o no**                                     |

⚠️ **`rejected` es solo el 400 de validación del cuerpo.** Un 401 o un 403 no son un rechazo del
envío: nadie rechazó nada, la petición ni siquiera se procesó como transferencia. Meterlos en
`rejected` haría que la fila afirmara algo falso, así que van a `unknown` — que es literalmente lo
que sabemos.

⚠️ **El «motivo» es un código propio de una lista cerrada, NUNCA el `message` del proveedor.** No es
purismo: el mensaje del 401 de Tatum interpola la clave —
`"Unable to find valid subscription for '${apiKey}'"`, medido en `openapi.json`— así que guardarlo
escribiría un secreto en una tabla que además se publica por `GET /wallets/me/transfers`.

⚠️ **Y si el guardado falla DESPUÉS de un 200 del proveedor, la fila se queda en `submitting` con el
dinero ya movido.** La escritura posterior no toca la cadena y es idempotente, así que **se
reintenta una vez**; si aun así falla, la regla escrita es: **una fila en `submitting` que sobrevive
a su petición se lee como `unknown`**. Sin esa regla, `submitting` sería un estado del que nadie
sabe salir y que significaría dos cosas distintas.

⚠️ `unknown` es la respuesta honesta a «qué se guarda cuando el resultado es desconocido»: no se
inventa un `rejected`, que afirmaría algo falso, ni un `submitted` sin `txId`. A diferencia de
`activation_failed`, este estado **se alcanza cada vez que expira el timeout**, así que el dominio
lo modela.

La escritura previa ocurre **después** de toda la validación local y de la precondición de
activación, justo antes de la llamada. Antes, el libro se llenaría de rechazos que nunca salieron
del proceso.

### 3.3 Value objects

| VO                       | Valida                                                                         | Error                                            |
| ------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------ |
| `WalletId`, `TransferId` | UUID v4 vía `UuidId.assertUuid`                                                | `InvalidWalletIdError`, `InvalidTransferIdError` |
| `EthereumAddress`        | Recorta, exige `0x` + 40 hexadecimales, **normaliza a minúsculas**             | `InvalidEthereumAddressError`                    |
| `AddressIndex`           | Entero entre 0 y el máximo de un `integer` de PostgreSQL                       | `InvalidAddressIndexError`                       |
| `TokenAmount`            | Decimal canónico, sin ceros a la izquierda, no todo ceros, hasta 79 caracteres | `InvalidTokenAmountError`                        |
| `TokenId`                | Entero decimal canónico de hasta 78 dígitos                                    | `InvalidTokenIdError`                            |
| `TransactionHash`        | `0x` + 64 hexadecimales, normaliza a minúsculas                                | `InvalidTransactionHashError`                    |

Cuatro decisiones que conviene no revertir sin leer esto:

- **`EthereumAddress` normaliza a minúsculas** porque la misma dirección en EIP-55 y en minúsculas
  es la misma dirección: normalizar es lo que hace que `equals()` y el índice único de la base
  coincidan. Mismo patrón que `Email`.
- **`TokenAmount` es más estricto que el patrón del proveedor**, que acepta `+1`, `.5` y `1.`. Los
  tres rompen la igualdad canónica del string. Y el cero se rechaza: un envío de cero quema gas y no
  mueve nada.
- **`TokenId` sí acepta `"0"`**: el token 0 existe. Es la asimetría deliberada con `TokenAmount`.
- **`AddressIndex` topa en el máximo de la columna**: un VO que admite lo que la columna no puede
  guardar es una mentira.

### 3.4 El activo a transferir: hacer imposibles las cuatro combinaciones excluyentes

El proveedor exige exclusión mutua entre `tokenAddress`, `amount` y `tokenId` según el
`contractType`:

| Clase           | `tokenAddress` | `amount`      | `tokenId`     |
| --------------- | -------------- | ------------- | ------------- |
| fungible (0)    | obligatorio    | obligatorio   | **prohibido** |
| NFT (1)         | obligatorio    | **prohibido** | obligatorio   |
| multi-token (2) | obligatorio    | obligatorio   | obligatorio   |
| nativo (3)      | **prohibido**  | obligatorio   | **prohibido** |

**Una unión discriminada suelta no basta, y es medible:** TypeScript es estructural y el chequeo de
propiedades sobrantes solo se aplica a literales _frescos_. Con una variable intermedia,
`const x = { kind: 'native', amount, tokenId }; const a: TransferAsset = x;` **compila**. El tipo no
impide construir la combinación ilegal, que es exactamente lo que se pedía impedir.

La forma es una **clase con constructor privado, cuatro factorías estáticas y `match()`**, en
`domain/transfer-asset.ts`:

- Cada factoría declara solo los parámetros de su clase, así que `TransferAsset.nft({ token, amount })`
  no compila. No hay «campo opcional que no debías rellenar».
- El campo `private readonly state` la hace **nominal**: un objeto literal con la misma forma no es
  asignable.
- `match()` entrega los valores ya estrechados por rama, así que el adaptador **no puede** leer un
  `amount` que en esa rama no existe — y una quinta clase rompe su compilación, que es donde se
  quiere que rompa.
- `fromParts()` acepta la clase como `string`, **no** como el union estrecho. Es la lección medida
  con `invalid-profile`: hay entradas que pasan el DTO y mueren en el dominio, y con el tipo
  estrecho una clase desconocida caería por un `switch` sin `default` devolviendo `undefined` — un
  500 donde tocaba un 400.

⚠️ **No extiende `ValueObject`, y por eso vive suelta en `domain/` y no en `value-objects/`.**
`ValueObject.equals` compara con `===`: sobre un objeto eso es identidad de referencia, y
`toString()` daría `[object Object]`. Heredar obligaría a sobreescribir las dos únicas cosas que la
base aporta. El JSDoc de `value-object.base.ts` ya lo anticipa; la salida aquí es **no escribir
`equals` en absoluto**, porque ningún caso de uso compara dos activos. Y `value-objects/` contiene
solo lo que extiende `ValueObject`, regla escrita tras mover `user-role.ts`.

**El dominio no conoce los números `0`, `1`, `2` y `3`.** Son un `enum` de un contrato del
proveedor, no un concepto del negocio. La traducción vive en cuatro líneas del adaptador, una por
rama de `match()`, y así la exclusión mutua se cumple por construcción: no hay forma de escribir
`amount` en la rama del NFT, porque esa rama no recibe un `amount`.

### 3.5 Errores de dominio

`WalletDomainError extends DomainError` es el marcador que `@Catch()` discrimina; sin él el filtro
capturaría errores de otros contextos.

| Error                                                                                                                                                           | HTTP                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `InvalidEthereumAddressError`, `InvalidTokenAmountError`, `InvalidTokenIdError`, `MissingAssetFieldError`, `AssetFieldNotAllowedError`, `UnknownAssetKindError` | **400** por el fallback de `DomainExceptionFilter`                                                               |
| `InvalidWalletIdError`, `InvalidTransferIdError`, `InvalidAddressIndexError`, `InvalidTransactionHashError`                                                     | **500** explícito                                                                                                |
| `WalletNotFoundError`                                                                                                                                           | **404**                                                                                                          |
| `WalletNotActivatedError`, `WalletActivationInProgressError`, `WalletAlreadyActivatedError`, `AdminUsesMasterAddressError`                                      | **409**                                                                                                          |
| `WalletOwnerGoneError`                                                                                                                                          | **403**, construido con el string canónico como en `orders`                                                      |
| `AddressIndexAlreadyUsedError`, `WalletAddressAlreadyUsedError`, `WalletOwnerMismatchError`, `WalletAddressIsMasterError`, `WalletAssignmentLostError`          | **500**: violaciones de invariante o configuración rota, no errores del cliente. Con 5xx, `ErrorReporter` los ve |
| `WalletProviderRejectedError`                                                                                                                                   | **400**, solo en la transferencia (ver §7.2)                                                                     |
| `WalletProviderUnreachableError`                                                                                                                                | **502**                                                                                                          |
| `WalletProviderUnavailableError`                                                                                                                                | **503**                                                                                                          |

⚠️ Todo lo que no sea 400 hay que **mapearlo explícitamente**: el fallback de
`DomainExceptionFilter` es 400, así que un error nuevo sin fila en el mapa saldría como «entrada
inválida» aunque fuera un 502.

Cuatro decisiones de esta tabla no son obvias y vienen de la auditoría:

- **Los cuatro `Invalid*Error` inalcanzables desde la API salen como 500, no como 400.** No son alcanzables
  desde ninguna entrada del cliente: los cinco endpoints son «lo mío» y nadie pasa un id de wallet
  ni un índice por la API. Si se disparan, es corrupción de la fila o agotamiento de la secuencia —
  y publicarlos como «entrada inválida» los esconde del `ErrorReporter`, que solo ve 5xx.
- **`WalletAlreadyAssignedError` no existe, y el mecanismo que lo hace innecesario es un
  DESENLACE, no una excepción capturada.** `WalletRepository.save()` devuelve
  `WalletSaveOutcome = 'saved' | 'owner-conflict'`: el `23505` de `idx_wallets_user_id` es una
  carrera normal entre dos altas del mismo usuario, y el adaptador la traduce a `'owner-conflict'`
  para que el caso de uso relea y devuelva 200. Con eso no hay error que lanzar, ni que capturar, ni
  que mapear — que es lo que hace la afirmación literalmente cierta en vez de una promesa sobre
  quién captura qué. Los otros dos `23505` (`address_index`, `address`) y la violación del `CHECK`
  **sí lanzan**: son violaciones de invariante y tienen que ser 500 ruidosos.
  Para el caso en que la relectura vuelva vacía existe `WalletAssignmentLostError` (500).
- **`WalletAddressAlreadyUsedError` es nuevo.** La tabla tiene **tres** índices únicos y solo dos
  tenían traducción; el `23505` de `address` habría salido como un 500 anónimo, perdiendo justo el
  diagnóstico por el que ese índice existe.
- **La indisponibilidad del proveedor son dos clases, no una.** El filtro mapea clase → excepción
  HTTP, así que una sola clase no puede rendir 502 y 503 a la vez.

---

## 4. Puertos

Los cinco son `abstract class` en `domain/ports/`, con **solo miembros `abstract` públicos** — sin
campos, sin constructor, sin `protected`. Tipo y token de inyección son la misma referencia, así que
ningún consumidor necesita `@Inject`. Los adaptadores hacen `implements`, nunca `extends`.

| Puerto                     | Métodos                                                                       | Por qué está separado                                                                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `WalletRepository`         | `findByOwnerId`, `save` (devuelve `WalletSaveOutcome`)                        | Dos y no tres: nadie busca por id de wallet, porque los cinco endpoints son «lo mío». Mismo criterio con el que `delete()` salió de `UserRepository`         |
| `WalletTransferRepository` | `save`, `findByOwner(criteria)`                                               | El listado es paginado; `PaginationDto` y `PaginatedResponseDto` ya existen y `users` es el precedente                                                       |
| `AddressIndexAllocator`    | `next`                                                                        | **Otro almacén** (una secuencia, no la tabla), otro modo de fallo, otro fake. En el repositorio obligaría a todo fake que no reserva índices a implementarlo |
| `CustodialAddressGateway`  | `masterAddress`, `deriveAddress`, `enableSending`, `isSendingEnabled`, `send` | Nombrado por la **capacidad**: «gas pump» es la marca del producto del proveedor, no un concepto del dominio                                                 |
| `OwnerDirectory`           | `exists`                                                                      | Un JWT firmado sobrevive a la desactivación de su dueño y el esquema no tiene ni una clave foránea. Idéntico en espíritu a `CustomerDirectory` de `orders`   |

**Un solo `CustodialAddressGateway` y no tres**: detrás hay un único adaptador contra un único
proveedor y ningún método es peligroso-por-descuido, que fue el motivo real de partir `UsersFacade`.
Segregarlo multiplicaría el fake sin ganar una garantía del compilador.

⚠️ **Ningún archivo con decoradores puede importar un puerto con `import type`**: la referencia se
elide, la metadata no se emite y falla **en runtime** con `lint:check` y `typecheck` en verde. Los
`type` que viajan con un puerto sí van en línea, y por eso hay que añadir sus nombres a la lista
cerrada del selector de `eslint.config.mjs` — una línea revisada por cada uno, que es el precio que
esa lista cobra a propósito.

---

## 5. Casos de uso

Uno por archivo, con su `type` de entrada al lado, `@Injectable()` y método único `execute()`. El
reloj se inyecta desde el caso de uso, nunca desde el dominio.

| Archivo                             | Entrada                                    | Salida                     | Puertos                                                                                     |
| ----------------------------------- | ------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------- |
| `assign-wallet.use-case.ts`         | `{ ownerId, ownerRole }`                   | `Wallet`                   | `OwnerDirectory`, `WalletRepository`, `AddressIndexAllocator`, `CustodialAddressGateway`    |
| `find-wallet-by-owner.use-case.ts`  | `{ ownerId, ownerRole }`                   | `Wallet                    | null`                                                                                       | `WalletRepository` |
| `activate-wallet.use-case.ts`       | `{ ownerId, ownerRole }`                   | `Wallet`                   | `OwnerDirectory`, `WalletRepository`, `CustodialAddressGateway`                             |
| `transfer-asset.use-case.ts`        | `{ ownerId, ownerRole, recipient, asset }` | `WalletTransfer`           | `OwnerDirectory`, `WalletRepository`, `WalletTransferRepository`, `CustodialAddressGateway` |
| `list-wallet-transfers.use-case.ts` | `{ ownerId, page, limit }`                 | página de `WalletTransfer` | `WalletTransferRepository`                                                                  |

⚠️ **`ownerRole` viaja en la entrada de los cuatro primeros, y no es decoración.** Es lo que hace
cumplible la invariante de §3.1.1: con él, `AssignWalletUseCase`, `ActivateWalletUseCase` y
`TransferAssetUseCase` responden `AdminUsesMasterAddressError` (409) al rol `admin` —que ya tiene
dirección y no debe recibir una derivada—, y `FindWalletByOwnerUseCase` devuelve `null` para que el
controlador componga la respuesta `kind: 'master'`. Sale del `role` del token vía `@CurrentUser()`,
**jamás del cuerpo**, igual que el `ownerId`. `ListWalletTransfersUseCase` no lo necesita: al admin
le devuelve una página vacía, que es la verdad.

⚠️ **Los dos casos de lectura NO consultan el directorio de usuarios, y es deliberado**: el token ya
probó el `sub`, y un 403 ahí sería cosmético a cambio de una consulta extra en los endpoints más
llamados —la gente va a consultar repetidamente esperando la activación—. Los tres que cuestan
dinero o crean estado sí lo consultan. Queda fijado con un caso para que nadie lo «arregle» por
simetría.

⚠️ **`assertOwnedBy(master)` corre en los tres que llaman al proveedor, y NO en las dos lecturas.**
La regla de §3.1 dice «van juntos o no van», y hay que precisar dónde: la comprobación existe para
impedir **operar** con una wallet derivada por otra master, no para censurar una lectura. Meterla en
la lectura obligaría a inyectarle el gateway solo para leer un dato de configuración, y la lectura
es el endpoint que más se llama. La consecuencia asumida es que tras una rotación de la master,
`GET /wallets/me` sigue devolviendo la dirección vieja mientras cualquier intento de usarla da 500
con nombre — que es exactamente el orden de descubrimiento que se quiere.

⚠️ **La carrera del alta se resuelve con UNA relectura, no con un bucle.** Si el `23505` de
`user_id` salta, el caso de uso relee **una vez** y devuelve la wallet del ganador. Si la relectura
vuelve vacía —el ganador hizo `ROLLBACK` entre el conflicto y la lectura— se lanza
`WalletAssignmentLostError` (500) y **no se reintenta el alta**: reintentar gastaría otros dos
créditos y otro índice para volver a arriesgar la misma carrera.

### 5.1 La carrera al asignar índice: una secuencia de PostgreSQL

`AssignWalletUseCase` comprueba el directorio, devuelve la wallet existente si la hay (idempotencia
barata, sin gastar créditos), reserva un índice, deriva la dirección y guarda.

El índice sale de una **secuencia de PostgreSQL**, más **tres índices únicos**: `user_id`,
`address_index` y `address`.

**`max(index)+1` se descarta por dos razones, y la segunda es la decisiva:**

1. `max()` mira la tabla, así que **recicla el índice de una fila borrada** → dos usuarios con la
   misma dirección. Hoy no borramos wallets, pero una tabla es borrable por naturaleza y una
   secuencia no.
2. El orden obligado sería «leer el máximo → derivar en el proveedor → insertar», así que **cada
   colisión tira los créditos de una llamada ya hecha**. Con la secuencia el índice es nuestro antes
   de gastar nada, y el único conflicto que queda es el de `user_id`, que se resuelve releyendo.

Los huecos de la secuencia son gratis: derivar **no escribe en la cadena ni consume gas**
(`docs/tatum/gas-pump/01-precalculategaspumpaddresses.md`), así que un hueco es una dirección que
nadie posee y a la que nadie va a mandar nada.

⚠️ Riesgo residual, que va escrito en la cabecera de la migración: reiniciar la secuencia —un
`TRUNCATE ... RESTART IDENTITY`, un `setval` a mano, una restauración parcial— devolvería índices ya
usados, y eso son dos usuarios sobre la misma dirección con los fondos mezclados. El índice único
sobre `address_index` convierte ese desastre silencioso en un 500 con nombre.

### 5.2 Fallo parcial en el alta: no hay compensación, y es correcto

Si reservamos el índice y el proveedor falla, **lo que queda huérfano es un número, no una fila**.

|                               | `RegisterAccountUseCase`                                                                          | `AssignWalletUseCase`                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Qué queda                     | Una **fila** de perfil sin credencial                                                             | Un **número** de la secuencia                         |
| Qué rompe                     | El perfil huérfano retiene su email por el índice único → su dueño no puede registrarse nunca más | Nada: el intento siguiente pide el índice siguiente   |
| ¿El reintento está bloqueado? | **Sí** — por eso existe la compensación                                                           | **No**                                                |
| ¿Se puede deshacer?           | Sí, borrando la fila                                                                              | No: consumir una secuencia es irreversible por diseño |

La compensación existe para **desbloquear un reintento**. Aquí no hay nada que desbloquear, y
tampoco nada que ejecutar. Escribirla sería ceremonia.

Y por eso el orden **reservar → derivar → guardar** es el correcto: el alternativo —guardar la
wallet con la dirección nula y rellenarla después— obligaría al dominio a modelar «wallet sin
dirección», un estado que existiría solo para tapar un fallo de red.

### 5.3 La transferencia, paso a paso

Directorio → wallet → `assertOwnedBy` → construir dominio (destinatario y activo) **antes de tocar
la red**, para que todo 400 muera sin gastar créditos → precondición de activación → escritura por
delante del libro → llamada → actualizar el libro con `submitted`, `rejected` o `unknown`.

⚠️ El origen del envío es **la dirección de la wallet**, nunca la master: la master firma, no envía.

### 5.4 Reconciliación de la activación: perezosa, sin planificador

La activación es asíncrona. Se resuelve **dentro de activar y de transferir**, consultando al
proveedor si la dirección ya puede enviar. Tres razones:

1. Es una llamada que hay que hacer igualmente — el propio
   `docs/tatum/gas-pump/04-gaspumpaddressesactivatedornot.md` dice _«use this API when a customer
   initiates a fund transfer and you need to check whether their gas pump address is allowed to send
   funds»_. Precondición y reconciliación son el mismo dato, y montar un planificador aparte sería
   pagar dos veces por él.
2. El estado es **monótono**: una dirección activada no se des-activa, porque el contrato está
   desplegado. Una vez cacheado `active`, el coste tiende a cero.
3. Convierte el fallo parcial en auto-curación en lugar de en compensación.

**La deuda que deja, sin adornos:** la lectura de la wallet publica un estado que puede ir por
detrás de la cadena —hay que decirlo en su `description`, y el cliente debe consultar el endpoint de
activación, que sí reconcilia—; y una activación que falló de verdad se queda en `activating` para
siempre, porque un «todavía no» y un «nunca» son indistinguibles con esta llamada. La salida es leer
el listado de direcciones inválidas de la operación 03, y es la primera candidata del ciclo
siguiente.

---

## 6. Adaptadores

### 6.1 HTTP (`infrastructure/http/`)

Cinco endpoints, todos `@Auth()` sin roles:

| Método y ruta                 | Status  | Llamadas al proveedor          | Con rol `admin`                          |
| ----------------------------- | ------- | ------------------------------ | ---------------------------------------- |
| `POST /wallets`               | **200** | derivar (2 créditos)           | **409**: ya tiene la master              |
| `GET /wallets/me`             | 200     | ninguna                        | 200 con `kind: 'master'` e `index` nulo  |
| `POST /wallets/me/activation` | **202** | comprobar (1) + activar (2)    | **409**: no hay nada que activar         |
| `POST /wallets/me/transfers`  | 200     | comprobar (1) + transferir (2) | **409**: la master no envía por Gas Pump |
| `GET /wallets/me/transfers`   | 200     | ninguna                        | 200, página vacía                        |

⚠️ `POST /wallets` responde **200 y no 201**: la segunda llamada no crea nada, y publicar 201 en un
endpoint que la mitad de las veces no crea es la clase de ficción que el guardián del contrato
existe para impedir. Además, el guardián de runtime escoge el esquema por operación y status, y
necesita uno estable. `POST /wallets/me/activation` responde **202**: la transacción está _enviada_,
no minada.

**El checksum EIP-55 vive en el DTO, no en el dominio.** `domain/` no puede importar librerías
externas (regla 1 del gate), y **keccak256 no está en `node:crypto`**: el `sha3-256` de la
biblioteca estándar usa otro padding y da otro hash. Por eso `@noble/hashes` se usa en el validador
del DTO, que es `infrastructure/http/` y sí puede. Comportamiento, que es el estándar y no rompe
integraciones legítimas: si la dirección viene con mayúsculas y minúsculas mezcladas **se verifica
su checksum**; si viene toda en minúsculas se acepta, porque no lleva checksum que comprobar.

⚠️ Consecuencia que hay que tener escrita: la garantía **solo cubre lo que entra por HTTP**. El VO
`EthereumAddress` sigue validando forma y normalizando a minúsculas, sin checksum — y está bien,
porque el único otro origen de direcciones es el proveedor, que las devuelve en minúsculas.

⚠️ **`@ValidateIf` hace obligatorio, no prohibido.** Con `forbidNonWhitelisted`, un campo _declarado_
en el DTO no se rechaza aunque su condición sea falsa, así que un cuerpo con un campo de más pasa el
transporte. Y está bien que pase: la invariante real de exclusividad vive en el dominio y sale como
400 por el fallback del filtro. El DTO valida transporte —formatos y presencia— y nada más, y su
JSDoc lo dirá para que nadie «arregle» esa aparente laguna metiendo negocio en `class-validator`.

`amount` y `tokenId` viajan como **string**, no como número: un token de 18 decimales no puede pasar
por un flotante.

### 6.2 Proveedor externo (`infrastructure/gateways/`)

Tres piezas, separadas por lo que hace testeable a cada una:

| Archivo                              | Qué es                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `tatum-http.client.ts`               | Transporte: `fetch`, cabeceras, timeout, reintentos y **traducción de errores**                |
| `tatum-asset.mapper.ts`              | **Función pura**: vocabulario de dominio → `contractType` y campos excluyentes. No ve la clave |
| `tatum-custodial-address.gateway.ts` | Implementa el puerto: compone las dos anteriores y aporta la master y su clave                 |

Más `users-owner.directory.ts`, el anti-corruption layer hacia `users`, que traduce **campo a
campo** como `UsersCustomerDirectory`.

⚠️ `AbortSignal.timeout` rechaza con un `DOMException` cuyo `name` es `"TimeoutError"`, **no**
`"AbortError"`: hay que discriminar por `err.name`, nunca por `instanceof`.

#### Tres respuestas del proveedor que el adaptador tiene que normalizar antes de tocar el dominio

Las tres salieron de la auditoría y las tres se midieron sobre `openapi.json`. Sin ellas, el camino
feliz muere en un 400 con el gas ya pagado.

| Qué devuelve el proveedor                                                                              | Por qué rompe                                                                                                                                                                                            | Qué hace el adaptador                                                                                       |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `txId` **sin prefijo `0x`** — el ejemplo son 64 hexadecimales pelados, `type: string` sin `pattern`    | `TransactionHash` exige `0x` ⇒ `InvalidTransactionHashError` ⇒ **400 con el gas ya pagado**                                                                                                              | Prefija `0x` si falta, **antes** de construir el VO. Vale para las dos operaciones que devuelven `txId`     |
| `activated` **ausente**: el esquema `Activated` no tiene `required`, así que `{}` es un 200 válido     | Las dos lecturas por defecto son destructivas y el estado es **monótono**: leerlo como `false` quema gas en una dirección quizá ya activada; leerlo como `true` cura a un estado del que no se retrocede | La ausencia **no es un booleano**: es respuesta incompleta ⇒ `WalletProviderUnreachableError` (502, al APM) |
| Un array de derivación con **cero o más de un** elemento — el esquema declara `array` sin cardinalidad | Con `noUncheckedIndexedAccess`, el `[0]` es `string \| undefined`                                                                                                                                        | Exige **exactamente uno** para un rango `from == to`; si no, contrato roto ⇒ 502                            |

⚠️ La regla general que las tres comparten: **un 200 que no satisface el esquema esperado es un
contrato roto, no una entrada inválida del cliente.** Sale como 502 y va al `ErrorReporter`, al mismo
nivel que un cuerpo no-JSON. Publicarlo como 400 lo escondería del APM y culparía al cliente de un
fallo del proveedor.

**Reintentos**, con las cuatro llamadas enumeradas para que ninguna se quede sin decidir:

| Llamada                   | ¿Reintentable? | Motivo                                                                                                                 |
| ------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Derivar la dirección      | **Sí**         | _«does not make any changes on the blockchain itself… no gas fee is applied»_ (doc 01). Repetirla solo cuesta créditos |
| Comprobar si puede enviar | **Sí**         | Es un `GET` y no escribe en la cadena. Cuesta 1 crédito por intento                                                    |
| Activar                   | **No**         | Un reintento es una segunda transacción y el gas se paga dos veces                                                     |
| Transferir                | **No**         | Un reintento mueve el dinero dos veces                                                                                 |

⚠️ **El argumento del primero es «no cuesta gas», NO «es determinista».** La documentación no promete
en ningún sitio que la derivación de `(owner, índice)` sea determinista; lo único que garantiza es
que no toca la cadena. Apoyar la política en una propiedad que el proveedor no publica sería
exactamente el tipo de afirmación sin medir que `CLAUDE.md` prohíbe. La consecuencia práctica es que
**la fuente de verdad de la dirección es la fila guardada**, no una rederivación.

El campo que marca una petición como reintentable es **obligatorio**, no opcional con default, para
que una operación nueva obligue a decidir en vez de heredar en silencio.

⚠️ Un timeout **no es «no se ejecutó»**: para las dos operaciones que escriben en la cadena deja el
resultado desconocido, y eso es lo que el estado `unknown` del libro registra y lo que la
`description` del 502 dice.

### 6.3 Persistencia (`infrastructure/persistence/`)

Dos ORM entities, dos mappers, dos repositorios y el asignador de índices sobre la secuencia. Las
columnas se convierten a snake_case solas, así que **no se escribe `name:` en ningún `@Column`**;
`@Entity({ name })` sí es obligatorio. Ni `@CreateDateColumn` ni `@UpdateDateColumn`: el instante lo
pone el dominio.

⚠️ La secuencia devuelve un `bigint`, y el driver de PostgreSQL entrega los `int8` **como string**.
Sin una conversión explícita el índice viajaría al proveedor como texto y sus campos de rango, que
son enteros, lo rechazarían. Lo fija un caso del E2E del asignador.

**La tabla lleva `owner_address`**, la master bajo la que se derivó la dirección, y con ella la
restricción `CHECK ("address" <> "owner_address")`. ⚠️ Es el **primer `CHECK` del esquema**: las
cuatro migraciones actuales solo declaran claves primarias, ni un `CHECK` ni una clave foránea. Es
un mecanismo nuevo, pequeño y con motivo —es el único de los cinco controles de §3.1.1 que ve la
escritura por SQL crudo—, pero es un precedente y por eso está escrito aquí en vez de colado.

**Traducción de errores del driver**, en el adaptador y no en el caso de uso. Son **tres** índices
únicos y los tres necesitan fila, porque distinguirlos exige mirar la restricción violada y no solo
el código `23505`:

| Restricción violada | Significa                                                                 | Se traduce a                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `user_id`           | Carrera normal entre dos altas del mismo usuario                          | **No lanza**: `save()` devuelve `'owner-conflict'` y el caso de uso relee **una** vez y responde 200 con la wallet del ganador |
| `address_index`     | **La secuencia repitió un índice.** Dos usuarios sobre la misma dirección | `AddressIndexAlreadyUsedError` → **500 ruidoso**                                                                               |
| `address`           | El proveedor devolvió la misma dirección para índices distintos           | `WalletAddressAlreadyUsedError` → **500 ruidoso**                                                                              |

⚠️ La tercera fila faltaba en la primera versión de este spec. Una restricción sin traducción es una
restricción sin diagnóstico: el `23505` habría salido como un 500 anónimo, perdiendo justo la
información por la que ese índice existe. Y la violación del `CHECK` se traduce igual, a
`WalletAddressIsMasterError`.

**La migración es aditiva pura.** Ambas tablas nacen en ella, así que no existe ni existió una
versión desplegada que inserte sin nombrar sus columnas: el `NOT NULL` va en el `CREATE TABLE` y no
hay expand/contract que partir. Es exactamente la excepción que `CLAUDE.md` escribe. Y **sin
`DEFAULT now()`** en las marcas de tiempo, que metería un segundo reloj en el sistema.

---

## 7. Transversales

| Aspecto                                               | Decisión                                                                                                                                          | Rule code                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Ubicación del contexto y sus capas                    | Módulo por feature bajo `src/modules/wallets/`, capas dentro. La dependencia cross-módulo es de una sola vía                                      | `arch-feature-modules`, `arch-avoid-circular-deps`            |
| Puertos como `abstract class` que son su propio token | Sin `@Inject` en ningún consumidor                                                                                                                | `di-use-interfaces-tokens`, `di-prefer-constructor-injection` |
| Cinco puertos y no uno grande                         | El asignador de índices se separa del repositorio porque es otro almacén y otro fallo                                                             | `di-interface-segregation`, `arch-single-responsibility`      |
| Repositorios detrás de un puerto de dominio           | El ORM no cruza a `application/`                                                                                                                  | `arch-use-repository-pattern`                                 |
| Autenticación                                         | `@Auth()` en los cinco endpoints; el dueño sale del `sub`, jamás del cuerpo                                                                       | `security-use-guards`, `security-auth-jwt`                    |
| Validación de entrada                                 | DTOs con `class-validator` en `infrastructure/http/`; las invariantes de negocio en el dominio                                                    | `security-validate-all-input`, `api-use-pipes`                |
| Límite de peticiones                                  | Global por IP, más `@Throttle` propio en los dos endpoints que mueven gas o dinero. El plan gratuito del proveedor permite 5 llamadas por segundo | `security-rate-limiting`                                      |
| Errores de dominio → HTTP                             | Un filtro propio `extends DomainExceptionFilter`, con `@Catch` ancho sobre el marcador                                                            | `error-use-exception-filters`, `error-throw-http-exceptions`  |
| Errores del proveedor                                 | Traducidos en el adaptador; nunca escapa una excepción del transporte                                                                             | `error-handle-async-errors`, `test-mock-external-services`    |
| Serialización de respuestas                           | DTOs con `fromDomain` campo a campo; el dominio nunca se serializa                                                                                | `api-use-dto-serialization`, `api-use-interceptors`           |
| Migraciones                                           | Toda la DDL en `src/database/migrations/`, aplicada a las dos bases                                                                               | `db-use-migrations`                                           |
| Listado paginado                                      | `PaginationDto` y `PaginatedResponseDto` existentes; índice por dueño y fecha                                                                     | `perf-optimize-database`, `db-avoid-n-plus-one`               |
| Configuración                                         | `registerAs` + Zod, con las credenciales obligatorias fuera de desarrollo                                                                         | `devops-use-config-module`                                    |
| Logging                                               | Pino con rutas de redacción ampliadas; el adaptador nunca loguea el cuerpo                                                                        | `devops-use-logging`, `security-sanitize-output`              |

### 7.1 ⚠️ La fuga de la clave privada de la master

La clave viaja en el **cuerpo de cada transferencia**. Es el único secreto de este ciclo que no es
un hash, y hoy el repo **no lo taparía**. Medido, no supuesto:

| Superficie                          | El hecho                                                                                                                        | Cómo se tapa                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Serializador de errores de pino     | `pino-std-serializers` recorre **toda** propiedad enumerable del error. Un error que lleve la petición dentro la escribe entera | Los errores llevan **solo** un código de motivo y el status del proveedor |
| `error.cause`                       | El mismo serializador concatena mensajes y stacks de las causas                                                                 | Nunca una causa cuyo mensaje pueda contener el cuerpo                     |
| Rutas de redacción                  | `DEFAULT_REDACT_PATHS` redacta contraseñas, tokens, claves de API y secretos — **ninguna clave privada**                        | Añadir las tres rutas correspondientes                                    |
| Cuerpo HTTP al cliente              | Fuera de producción y staging, `AllExceptionsFilter` devuelve el mensaje del error tal cual. Eso incluye **desarrollo y test**  | Mensajes de error **fijos**, sin interpolar nada del cuerpo               |
| Fallback de `DomainExceptionFilter` | Publica el mensaje del error **en todos los entornos**                                                                          | Ídem, y los errores del proveedor se mapean explícitamente                |
| `details` de `AllExceptionsFilter`  | Copia claves conocidas del cuerpo de una `HttpException`                                                                        | Las `HttpException` se construyen **con string**, regla ya vigente        |
| `console.warn`                      | El lint permite `warn` y `error`, así que un volcado ahí **ni avisa**                                                           | Revisión; entra en el checklist                                           |
| Stub de pruebas                     | Guarda los cuerpos recibidos para poder afirmar sobre ellos                                                                     | Enmascara al guardar; cero snapshots en el módulo                         |
| Objeto de configuración             | Devuelve la clave como string plano                                                                                             | Ruta de redacción, y el adaptador la envuelve en un `SecretValueObject`   |

⚠️ El value object del secreto **no puede vivir en `src/config/`**: el gate solo permite
`config → config`, así que ni el kernel compartido ni los módulos son alcanzables desde ahí. La
configuración guarda un string plano y **el adaptador lo envuelve en su constructor**. Es un hecho
de la matriz de fronteras, no una preferencia.

**La invariante greppable:** la clave se lee en **exactamente dos sitios** de todo el módulo, ambos
construyendo el objeto que va directo a la llamada. Ese objeto no se guarda, no se loguea y no se
adjunta a ningún error.

⚠️ **Y `secretlint` no es el gate aquí — medido ejecutándolo.** Con el `.secretlintrc.json` del repo,
un `.env.example` con una clave privada de Ethereum (tanto de ceros como con aspecto realista) da
cero avisos: `preset-recommend` dispara con formas conocidas y no trae regla de entropía genérica.
El gate real es **gitleaks**, cuya regla genérica combina palabra clave y entropía. De ahí que la
variable vaya **comentada y sin valor** en `.env.example` —como ya está `JWT_SECRET`— y que el
placeholder ejecutable, de entropía nula, viva en el archivo de configuración. Ejecutar gitleaks a
mano antes del primer commit es obligatorio: su barrido del historial completo solo corre en el cron
semanal, no en el PR.

### 7.2 Traducción de errores del proveedor

`AllExceptionsFilter` reporta al `ErrorReporter` **solo los 5xx**. Eso decide qué es incidente.

| El proveedor devuelve                                                          | Significa                                                                      | Nuestro HTTP | ¿Al APM? |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------ | -------- |
| 400, **solo en la transferencia**                                              | Nuestro cuerpo no vale para esta entrada del cliente                           | **400**      | no       |
| 400 en **derivar o activar**                                                   | Configuración **nuestra**: esos cuerpos los construimos enteros                | **503**      | sí       |
| 401                                                                            | **Nuestra API key** está muerta o el plan caducó                               | **503**      | sí       |
| 403                                                                            | Permisos **nuestros**… o un error lógico del proveedor. Ver el límite de abajo | **503**      | sí       |
| Cualquier otro 4xx **no documentado** (404, 429, 402, 409…)                    | No forma parte de su contrato publicado                                        | **503**      | sí       |
| 5xx, DNS/TCP/TLS, timeout, cuerpo no-JSON, **200 que no satisface el esquema** | Proveedor caído o contrato roto                                                | **502**      | sí       |

Tres precisiones que la primera versión de esta tabla no tenía:

⚠️ **El 400 no significa lo mismo en los tres endpoints.** `POST /wallets` y
`POST /wallets/me/activation` no aceptan cuerpo ni parámetros: `chain`, `owner`, `from` y `to` los
construimos nosotros enteros. Un 400 del proveedor ahí es configuración rota **nuestra**, y
publicarlo como 400 lo escondería del `ErrorReporter`, que solo ve 5xx. Solo la transferencia lleva
entrada del cliente a la que culpar.

⚠️ **Ni `404` ni `429` están declarados por el proveedor.** Medido: las **siete** operaciones de
`openapi.json` declaran exactamente `200, 400, 401, 403, 500`. Darles fila propia como si vinieran
de su contrato era inventarlo; la fila genérica de «cualquier otro 4xx» los cubre y además cierra el
hueco real, que era un 402 o un 409 sin clasificar.

⚠️ **Límite reconocido en el 403, además del ya reconocido en el 400.** Su descripción, idéntica en
las siete operaciones, es _«Forbidden. The request is authenticated, but it is not possible to
perform the operation due to **logical error** or invalid permissions»_. Mapearlo entero a 503
publica una precondición de negocio del proveedor —por ejemplo, la dirección no activada— como caída
de la integración. Afinarlo exige clasificar su cuerpo, y es trabajo del ciclo siguiente.

⚠️ **El 401 del proveedor no puede salir como 401 nuestro.** Nuestro 401 tiene un significado
publicado y estrecho: `@Auth()` lo adjunta con «Token ausente, inválido o expirado». Devolverlo
cuando caduca la clave del proveedor le dice al cliente que **su** token es malo; borraría su
sesión, volvería a autenticarse y volvería a fallar. El fallo es enteramente nuestro y de
configuración.

⚠️ **Límite reconocido:** el código de error del proveedor es el mismo tanto si la dirección
destino es inválida —culpa del cliente, 400 correcto— como si la master no tiene fondos —culpa
nuestra, debería ser 503—. Afinarlo exige clasificar el detalle que devuelve, y es trabajo del ciclo
siguiente. **Hasta entonces algunos 503 nuestros saldrán como 400**, y decirlo es preferible a
fingir que la tabla es exacta.

⚠️ **502 y 503 no están en `VERIFIED_ERROR_STATUSES`**, así que publicarlos rompe el guardián del
contrato. El orden es: **primero** contrastarlos contra `AllExceptionsFilter` en
`error-example.factory.spec.ts`, **luego** ampliar el conjunto. Invertirlo deja el guardián verde
afirmando algo que nadie comprobó, que es justo el fallo que la cabecera de esa constante describe.

---

## 8. Estrategia de pruebas

Códigos de regla: `test-use-testing-module`, `test-e2e-supertest`, `test-mock-external-services`.

| Pieza                                                     | Suite             | Cómo                                                                                                                      |
| --------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Los seis VOs, `TransferAsset`, `Wallet`, `WalletTransfer` | unitaria          | AAA + `fast-check` con arbitrarios **construidos**, nunca filtrados                                                       |
| Los cinco casos de uso                                    | unitaria          | Fakes del puerto escritos a mano en `__tests__/helpers/`                                                                  |
| `tatum-asset.mapper.ts`                                   | unitaria          | Función pura, sin Nest. Igualdad del cuerpo completo por clase, más propiedades sobre el conjunto de claves               |
| `tatum-http.client.ts`                                    | unitaria          | `fetch` **inyectado por constructor**, no `jest.mock` de un módulo. Una fila por cada caso de la tabla de traducción      |
| Validador de checksum EIP-55                              | unitaria          | Propiedad: toda dirección con checksum correcto pasa, y **mutar un solo carácter** siempre falla                          |
| Fuga del secreto                                          | unitaria dedicada | Por cada error: serialización, `String()`, inspección profunda y **una línea real de pino escrita a un flujo en memoria** |
| Los dos repositorios y el asignador                       | E2E               | PostgreSQL real. Incluye la traducción de cada `23505` y que el índice llega como número                                  |
| Filtro, controlador y DTOs                                | unitaria          | Casos de uso doblados a mano                                                                                              |
| Los cinco endpoints                                       | E2E               | Aplicación real, PostgreSQL real y **stub HTTP del proveedor**                                                            |
| Migración                                                 | E2E               | Ya cubierta: `migrations.e2e-spec.ts` deriva las tablas esperadas de las ORM entities registradas                         |

**Mocking por capa:** cero mocks en `domain/`; fakes escritos a mano en `application/`, nunca
`jest.mock`; los repositorios contra PostgreSQL real en la suite E2E; el proveedor externo contra un
servidor local, no contra un interceptor.

⚠️ **El E2E de los endpoints necesita un stub, y la elección tiene motivo.** El guardián de runtime
exige una petición HTTP real por operación publicada, y en CI no hay API key ni salida a internet.
De las tres opciones —un servidor local, un interceptor tipo `nock`, o un adaptador falso cableado
por configuración— se elige **el servidor local**: es el único que ejerce el adaptador de verdad. Un
adaptador falso pondría el guardián en verde mientras el archivo más propenso a defectos del módulo
no se ejecuta en ninguna prueba, reproduciendo una capa más abajo el punto ciego que ese guardián
existe para cerrar. Y no añade dependencias, que es la política visible del repo.

Cuatro capas para que un fallo del stub no se confunda con uno real: el stub **no responde por
defecto** y devuelve un status inclasificable; cada escenario afirma al cerrar que no quedó ninguna
ruta sin programar; los casos felices afirman sobre el **contenido**, no sobre el status, con un
valor literal que solo el stub puede producir; y un caso afirma que la configuración resuelta apunta
a loopback — el guardián del guardián, porque sin él un borrado accidental mandaría la suite de
transferencias a mover dinero de verdad.

⚠️ **El caso que de verdad prueba el libro es el del timeout**: el stub no responde, la petición
expira, y la fila tiene que quedar en `unknown` — no ausente, no `rejected`. Sin ese caso, la
escritura por delante no está probada y su motivo de existir tampoco.

**Auditoría de mutación:** entran los VOs, el activo, las dos entidades, los errores y los cinco
casos de uso, del orden de 90 a 110 mutantes. Tres cuidados, todos con precedente medido en el repo:
comparar el error **completo** y no solo su clase, porque los mensajes sin igualdad exacta son una
de las dos familias de supervivientes conocidas; por cada expresión regular, un caso que solo falla
por el ancla, que es la otra; y **no mover lógica de dominio a `infrastructure/`**, porque sus
mutantes saldrían del denominador y el score subiría sin que nadie probara más — lo que la cabecera
de `stryker.config.mjs` llama «premiar una mudanza». Se mide con el scope entero, nunca acotado: un
scope aislado no dice a qué distancia está la CI del rojo.

**Modelo de colaboración:** llevan tabla de «Casos acordados» los seis VOs, `TransferAsset`, las dos
entidades y los cinco casos de uso. Quedan exentos, por la regla ya escrita, la configuración, el
cableado, la migración, los DTOs, el controlador, el filtro y los adaptadores — con una excepción
deliberada: la **traducción de errores del proveedor** y el **mapper del activo** llevan sus propias
tablas aunque vivan en `infrastructure/`, porque son decisiones con consecuencia y no cableado.

**Prueba de humo del objetivo real:** el DoD verifica el código, no la integración. Contra la
testnet, y a mano: dar de alta una cuenta, pedir la wallet, comprobar que repetir la petición
devuelve la misma dirección sin gastar créditos, fondearla desde un faucet, activarla, transferir, y
**verificar en un explorador que el gas lo pagó la master**. Ese último paso es el que demuestra que
Gas Pump hace lo que se compró. Más un envío a una dirección con checksum y un carácter cambiado,
que debe responder 400 sin gastar créditos.

---

## 9. Fuera de alcance

- **No** se implementa la clave de idempotencia del envío. Un reintento del cliente tras un timeout
  puede transferir dos veces; el libro que sí entra es la base sobre la que se monta después.
- **No** se resuelven las transferencias en `unknown`: nadie consulta la cadena para saber si se
  minaron.
- **No** se lee el listado de direcciones inválidas de la activación, así que una activación que
  falló de verdad se queda colgada y no sabremos por qué.
- **No** se gestiona el `nonce`: dos transferencias concurrentes desde la misma master pueden
  colisionar.
- **No** se soporta mainnet: está bloqueada en el arranque. La condición de salida es el sistema de
  gestión de claves del proveedor, que cambia la firma del puerto —devuelve un identificador de
  firma en lugar de un hash— y añadiría al dominio el concepto «envío pendiente de firma».
- **No** hay eventos de dominio, outbox ni fachada: nadie reacciona y nadie consume `wallets`.
- **No** se valida el checksum EIP-55 fuera del borde HTTP.
- **No** se derivan direcciones por lotes: una por alta. Aceptable con el cupo mensual del plan
  gratuito, no a escala.
- **No** se soporta más de una cadena. ⚠️ La wallet **no guarda** la cadena, así que añadir una
  segunda exigiría una pareja expand/contract sobre el índice único.
- **No** hay alerta de saldo de la master. Si se queda sin ETH, **todas** las activaciones y
  transferencias fallan a la vez y nadie avisa.
- **No** se usan las tres operaciones restantes del proveedor: transferencia por lotes, autorización
  a un tercero y lectura del resultado de la activación.
- **No** se clasifica el cuerpo de los 400 y 403 del proveedor. Los dos son ambiguos por diseño —el
  400 no distingue «dirección del destinatario inválida» de «la master no tiene fondos», y el 403
  incluye literalmente _«logical error or invalid permissions»_— así que hasta el ciclo siguiente
  **algunos 503 saldrán como 400 y alguna precondición de negocio saldrá como caída del proveedor**.
- **No** se escribe por delante en la activación, a diferencia de la transferencia. Si el proceso
  muere entre la llamada y el guardado, el reintento **vuelve a activar** y el gas se quema dos
  veces. Hoy son créditos de testnet; ⚠️ **es bloqueante para mainnet**, y así queda anotado en el
  backlog. Lo cierra permitir `activating` con `activationTxId` nulo y escribirlo antes de llamar.
