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

## 2. Ninguna migración tiene prueba, y ahora tampoco la que sí la tenía — CERRADA (2026-08-25)

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

**Cerrada el 2026-08-25** con `src/database/__tests__/migrations.e2e-spec.ts`: 5 casos sobre una
base desechable —`migrations_probe_<pid>`, creada en el `beforeAll` y destruida en el `afterAll`,
tal y como pedía el criterio— que cubren el set completo aplicándose, revirtiéndose entero,
reconstruyendo el mismo esquema **columna a columna y con su tipo**, y el viaje de ida y vuelta de
la pareja de credenciales con filas dentro. `src/database/migrations/**` entra en el
`collectCoverageFrom` del E2E y sale a **100 % de statements y lines**; los cuatro umbrales se
elevaron en consecuencia (84/38/88/87).

⚠️ **Un hallazgo que merece quedar aquí, medido rompiendo un `down()` a propósito.** Se quitó el
`DROP COLUMN` del `down()` de `AddSoftDeleteToUsers` y cayó **uno solo** de los cinco casos: el
del viaje parcial. Los otros cuatro revierten TODO, y al hacerlo el `DROP TABLE users` del
`down()` de `CreateUsersTable` se lleva por delante la columna huérfana — el defecto se borra a sí
mismo antes de que nadie lo mire. Es decir: **una reversión total no puede detectar un `down()`
incompleto**; solo lo ve una reversión parcial, que además es la única que ocurre de verdad —nadie
revierte siete migraciones, se revierte la última—. Una suite de migraciones que solo haga
`revertAll` da una sensación de cobertura que no tiene.

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

## 4. La activación no escribe por delante y puede quemar gas dos veces — BLOQUEANTE PARA MAINNET

**Qué pasa.** `TransferAssetUseCase` escribe la fila del libro **antes** de llamar al proveedor;
`ActivateWalletUseCase` la escribe **después**. Si el proceso muere entre la respuesta del proveedor
y el guardado, la wallet se queda en `receive-only` con una transacción de activación ya enviada, y
el intento siguiente **vuelve a activar**.

⚠️ Y volver a activar no falla de forma visible. Medido sobre `docs/tatum/gas-pump/openapi.json`: la
operación 02 responde `200` con un `TransactionHash`; la cadena `"Wallet already exists"` es el
`example` del campo `reason` de `InvalidGasPumpAddress`, que solo aparece en la respuesta de la
operación **03**. Es decir: la segunda activación se acepta, el gas se quema, y el fallo solo es
visible leyendo el `invalid[]` de la 03 — que este ciclo no lee (ver entrada #7).

**Criterio ya decidido.** Se acepta la asimetría en el ciclo de `wallets`, porque hoy el coste está
acotado: con `WALLETS_ACTIVATION_PAYER=tatum` en testnet la comisión la cubre el proveedor, así que
una activación duplicada cuesta 2 créditos de llamada más 1 de comisión, no ETH. Y `mainnet` está
bloqueada en el arranque por un `refine()` (entrada #9).

⚠️ **Deja de ser aceptable el día que la master pague gas de verdad.** Esta entrada es bloqueante
para levantar ese `refine()`: no se pasa a mainnet con la ventana abierta.

La salida es simétrica a la que ya usa la transferencia: permitir el estado `activating` con
`activationTxId` nulo y escribirlo **antes** de llamar, rellenando el hash después. Cuesta partir
`markActivationRequested` en dos mutadores y sus casos.

**Cómo se sabrá que está hecho.** Un caso que mata el proceso entre la llamada y el guardado deja la
wallet en `activating`, y el reintento **no** emite una segunda transacción de activación.

---

## 5. Una transferencia con resultado desconocido se queda en `unknown` para siempre

**Qué pasa.** Cuando la llamada de transferencia expira o el proveedor devuelve un 5xx, la fila del
libro queda en `unknown`: la transacción pudo minarse o no, y nadie vuelve a mirarlo. El usuario ve
`unknown` indefinidamente y soporte no puede responder qué pasó sin ir a un explorador de bloques.

**Criterio ya decidido.** Se acepta en el ciclo de `wallets`, porque el estado `unknown` ya es
honesto: no afirma nada falso, que es lo que haría un `rejected` inventado. Resolverlo exige
consultar el estado de una transacción en la cadena, que es una API distinta de las siete de Gas
Pump y no está en la documentación descargada.

**Cómo se sabrá que está hecho.** Ninguna fila del libro se queda en `unknown` más allá del tiempo
que tarda la cadena en confirmar, y el estado final distingue «se minó» de «se perdió».

---

## 6. No hay clave de idempotencia en el envío: un reintento del cliente puede transferir dos veces

**Qué pasa.** `POST /wallets/me/transfers` no acepta ninguna cabecera de idempotencia. Un cliente
que reintente tras un timeout —el caso exacto que deja la fila en `unknown`, entrada #5— emite una
segunda transferencia, y el dinero se mueve dos veces.

**Criterio ya decidido.** El libro de transferencias, que **sí** entra en el ciclo de `wallets`, es
la base sobre la que se monta: la fila existe desde antes de la llamada, así que una cabecera
`Idempotency-Key` sobre esa tabla es aditiva. La única palanca que ofrece el proveedor es el campo
`nonce` de la transferencia, opcional, y usarlo obliga a llevar la contabilidad de nonces de la
master (entrada #8).

⚠️ **No es opcional para mainnet**, por el mismo motivo que la entrada #4: mueve dinero real.

**Cómo se sabrá que está hecho.** Dos peticiones con la misma clave de idempotencia producen una
sola transferencia y devuelven la misma fila del libro.

---

## 7. Nadie lee el `invalid[]` de la activación, así que una activación fallida no dice por qué

**Qué pasa.** La operación 03 del proveedor (`GET /v3/gas-pump/address/{chain}/{txId}`) devuelve dos
arrays, `valid` e `invalid`, y este último trae el motivo por el que cada dirección no se activó.
`wallets` no la usa: reconcilia con la operación 04, que solo devuelve un booleano.

La consecuencia es doble. Una activación que falló de verdad se queda en `activating` para siempre,
porque `activated: false` es indistinguible de «todavía no». Y el motivo del fallo no se conoce, así
que en soporte no se puede responder por qué.

**Criterio ya decidido.** Se acepta en el ciclo de `wallets` porque la reconciliación perezosa con
la 04 es la que hace falta igualmente como precondición del envío, y montar la 03 exigiría un
proceso que la consulte, con su política de reintentos —la propia doc avisa de que devuelve error
mientras la transacción se procesa—. Es un componente nuevo, no una función.

Cuando entre, es también lo que hace alcanzable el estado `activation_failed`, hoy descartado del
dominio precisamente por inalcanzable.

**Cómo se sabrá que está hecho.** Una wallet cuya activación revirtió sale de `activating` sola y
guarda el motivo que devolvió el proveedor.

---

## 8. Dos transferencias concurrentes desde la misma master pueden colisionar de nonce

**Qué pasa.** El campo `nonce` de la transferencia es opcional y `wallets` no lo envía. La
documentación dice que sin él «se usará el último nonce conocido», así que dos transferencias en
vuelo desde la misma master pueden tomar el mismo y una de las dos se pierde o reemplaza a la otra.

**Criterio ya decidido.** Se acepta con el volumen previsto en testnet. La salida es serializar por
master —una cola— y llevar la contabilidad de nonces, que es la misma pieza que habilita la
idempotencia de la entrada #6. Las dos entran juntas o ninguna tiene sentido.

**Cómo se sabrá que está hecho.** N transferencias concurrentes desde la misma master producen N
transacciones distintas en la cadena, ninguna reemplazada.

---

## 9. `mainnet` está bloqueada en el arranque hasta que haya un sistema de gestión de claves

**Qué pasa.** Un `refine()` de `env.schema.ts` impide arrancar con `WALLETS_NETWORK=mainnet`. El
motivo está medido en la documentación del proveedor, que repite en tres operaciones: _«Providing
the private key in the API is not a secure way of signing transactions… You should use the private
keys only for testing a solution you are building on the testnet»_.

**Criterio ya decidido.** El bloqueo se queda hasta que la firma pase por el sistema de gestión de
claves del proveedor, que sustituye `fromPrivateKey` por un identificador de firma.

⚠️ **No es un cambio de una línea en el adaptador.** Con ese modo el proveedor responde
`{ signatureId }` en lugar de `{ txId }`, así que el método `send()` del puerto pasaría a devolver
una unión y el dominio ganaría un concepto nuevo —«envío pendiente de firma»— con su estado en el
libro. Y las entradas #4 y #6 son bloqueantes para levantar el `refine()`.

**Cómo se sabrá que está hecho.** El `refine()` desaparece, `WALLETS_MASTER_PRIVATE_KEY` deja de
existir, y ninguna petición al proveedor lleva una clave privada en el cuerpo.

---

## 10. Los 400 y 403 del proveedor son ambiguos y se traducen en bloque

**Qué pasa.** El adaptador clasifica los errores del proveedor por código HTTP, sin mirar el cuerpo,
y los dos códigos de cliente son ambiguos por diseño:

- El `400` llega con `errorCode: "validation.failed"` tanto si la dirección del destinatario es
  inválida —culpa del cliente, 400 correcto— como si la master no tiene fondos —culpa nuestra,
  debería ser 503 y llegar al APM—.
- El `403` tiene esta descripción, **idéntica en las siete operaciones** (medido en `openapi.json`):
  _«Forbidden. The request is authenticated, but it is not possible to perform the operation due to
  logical error or invalid permissions»_. Mapearlo entero a 503 publica una precondición de negocio
  del proveedor como caída de la integración.

**Criterio ya decidido.** Se acepta y **se escribe en el spec** en lugar de fingir que la tabla de
traducción es exacta: hasta que esto se cierre, algunos 503 salen como 400 y alguna precondición de
negocio sale como caída. Afinarlo exige leer y clasificar el array `data[]` del 400 y el
`errorCode`/`message` del 403, lo que ata el adaptador a cadenas del proveedor que pueden cambiar
sin aviso — por eso no se hizo a la primera.

⚠️ Lo que se clasifique **nunca** puede acabar en un mensaje ni en una propiedad de error: el
mensaje del 401 del proveedor interpola la API key.

**Cómo se sabrá que está hecho.** Un 400 por fondos insuficientes de la master sale como 503 y
aparece en el `ErrorReporter`; uno por destinatario inválido sigue saliendo como 400 y no aparece.

---

## 11. `wallets` no emite eventos de dominio ni publica fachada

**Qué pasa.** `Wallet` y `WalletTransfer` extienden `Entity`, no `AggregateRoot`: no hay eventos, no
hay outbox, y `wallets.module.ts` no exporta ninguna puerta cross-módulo.

**Criterio ya decidido.** Es lo que manda `docs/module-blueprint.md`: eventos, outbox y fachada son
**opcionales**, «solo si algo fuera del agregado debe reaccionar» y «solo si OTRO módulo tiene que
consumirte». Hoy nadie reacciona y nadie consume `wallets`. Escribirlos «por si acaso» sería código
sin consumidor, que es exactamente lo que el auditor de mutación delata.

**Cómo se sabrá que está hecho.** Cuando `orders` quiera cobrar en cripto: entonces `wallets`
publica una puerta por intención —previsiblemente una consulta de dirección, no el agregado— y
`AssetTransferred` gana un suscriptor.

---

## 12. Se deriva una dirección por alta: dos créditos por usuario

**Qué pasa.** `AssignWalletUseCase` llama a la operación 01 con un rango de un solo índice
(`from == to`), así que cada alta cuesta 2 créditos. La operación admite hasta 5.000 direcciones por
llamada en Ethereum.

**Criterio ya decidido.** Se acepta con el cupo del plan gratuito. Derivar por lotes obliga a
mantener una reserva de direcciones precalculadas y a decidir qué pasa con las que sobran, que es un
almacén nuevo para un problema que a este volumen no existe.

⚠️ Derivar no toca la cadena ni cuesta gas, así que el lote solo ahorra créditos, no dinero.

**Cómo se sabrá que está hecho.** El coste en créditos por alta deja de crecer linealmente con el
número de usuarios.

---

## 13. `wallets` no guarda la cadena, así que soportar una segunda exige expand/contract

**Qué pasa.** La tabla `wallets` no tiene columna de cadena: el literal `ETH` lo pone el adaptador.
Sus índices únicos son `user_id`, `address_index` y `address` a secas.

⚠️ Y la afirmación fácil de escribir aquí es falsa: **el proveedor no restringe `chain` a `"ETH"`**.
Medido en `openapi.json`: `CreateGasPump` admite 7 cadenas, `ActivateGasPump` 5 y
`TransferCustodialWallet` 6. Enviar solo `ETH` es decisión nuestra.

**Criterio ya decidido.** Una cadena en el ciclo de `wallets`. Añadir la segunda **no es aditivo**:
el índice único pasaría de `user_id` a `(user_id, chain)`, y eso es una pareja expand/contract sobre
una tabla con datos, con el procedimiento que describe `CLAUDE.md`. Además, cada cadena trae su
propio esquema de cuerpo —TRON cambia longitudes y añade `feeLimit`, Celo añade `feeCurrency`— así
que el adaptador dejaría de ser uno.

**Cómo se sabrá que está hecho.** Un mismo usuario puede tener una dirección por cadena y ninguna
consulta las confunde.

---

## 14. Nadie vigila el saldo de la master, que es punto único de fallo

**Qué pasa.** Todas las activaciones y todas las transferencias dependen de que la master tenga ETH.
Si se queda a cero, **todo** falla a la vez —el proveedor responde con un error que sale como 502 o
503— y no hay ninguna alerta: el primero en enterarse es un usuario.

**Criterio ya decidido.** Fuera del ciclo de `wallets` porque consultar un saldo no es una de las
siete operaciones de Gas Pump: es otra API del proveedor, con su coste en créditos y su periodicidad
que decidir.

⚠️ Con `WALLETS_ACTIVATION_PAYER=tatum` la activación **no** consume ETH de la master, así que en
testnet el síntoma aparecerá solo al transferir. En mainnet consumirá las dos cosas.

**Cómo se sabrá que está hecho.** El saldo de la master es un indicador con umbral, y cruzarlo avisa
antes de que falle la primera transferencia.

---

## 15. Tres de las siete operaciones de Gas Pump no se usan

**Qué pasa.** `wallets` usa cuatro: derivar, activar, comprobar la activación y transferir. Quedan
sin usar la transferencia por lotes (06), la autorización a un tercero (07) y la lectura del
resultado de la activación (03).

**Criterio ya decidido.** Ninguna tiene consumidor. La 03 tiene entrada propia (#7) porque su
ausencia sí deja un hueco funcional. La 07 (`approve`) es la que hace falta el día que se venda un
activo en un mercado: permite que el contrato del mercado mueva el activo desde la dirección
custodiada. La 06 es una optimización de la 05.

**Cómo se sabrá que está hecho.** Cuando exista el caso de uso que las pide. Esta entrada existe
para que nadie las implemente sin él.

---

## 16. El checksum EIP-55 solo se valida en el borde HTTP

**Qué pasa.** El value object `EthereumAddress` valida forma —`0x` más 40 hexadecimales— y normaliza
a minúsculas, pero **no** comprueba el checksum EIP-55. Esa comprobación vive en el DTO de la
transferencia, con `@noble/hashes`.

**Criterio ya decidido.** Es donde puede vivir: `domain/` no puede importar librerías externas
(regla 1 del gate de fronteras), y **keccak256 no está en `node:crypto`** — el `sha3-256` de la
biblioteca estándar usa otro padding y produce otro hash. Poner la comprobación en el borde cubre el
único origen de direcciones escritas por humanos; el otro origen es el proveedor, que las devuelve
en minúsculas y sin checksum que comprobar.

**Cómo se sabrá que está hecho.** No hay nada que hacer salvo que aparezca una segunda vía de
entrada de direcciones que no pase por un DTO. Esta entrada existe para que quien la añada sepa que
la garantía no está en el dominio.

---
