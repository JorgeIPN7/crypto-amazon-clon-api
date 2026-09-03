import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Crea el esquema del bounded context `wallets`: la tabla de direcciones custodiadas, la secuencia
 * de la que salen sus índices, y el libro de transferencias.
 *
 * ## Qué salió de `migration:generate` y qué se añadió a mano
 *
 * El DDL de las dos tablas, sus cuatro índices y el `CHECK` los emitió
 * `pnpm migration:generate src/database/migrations/CreateWallets` a partir de `wallet.orm-entity.ts`
 * y `wallet-transfer.orm-entity.ts`; se reformateó a los literales multilínea del repo y se le
 * añadieron dos cosas que la CLI no puede dar:
 *
 * - **Los nombres de las claves primarias.** TypeORM las bautiza `PK_<hash>`; el repo las llama
 *   `pk_<tabla>` desde `create-users-table`, y el contrato de este módulo pide `pk_wallets` y
 *   `pk_wallet_transfers`. Renombrarlas no deja diferencia pendiente porque el comparador de
 *   esquema de TypeORM **no mira el nombre de la clave primaria**: medido dos veces, la primera al
 *   generar esta migración —el diff traía solo las dos tablas nuevas, ni un `ALTER` sobre `users`,
 *   `orders` ni `auth_credentials`, cuyas PK ya se llaman `pk_*`— y la segunda tras aplicarla, con
 *   un `pnpm migration:generate` que respondió «No changes in database schema were found».
 * - **La secuencia**, que la CLI no genera porque ninguna columna es `@Generated`: el índice no lo
 *   asigna el ORM al insertar, lo reserva `SequenceAddressIndexAllocator` con un `nextval` antes de
 *   llamar al proveedor.
 *
 * ## Por qué el `NOT NULL` es legal aquí, y por qué no hay expand/contract
 *
 * «Destructive migrations: expand/contract» de `CLAUDE.md` no prohíbe estrenar un `NOT NULL` sin
 * `DEFAULT`: prohíbe estrenarlo **sobre una tabla en la que alguna versión desplegada ya inserta sin
 * nombrar la columna**, porque entonces el problema se muda del `SELECT` al `INSERT` y las réplicas
 * viejas dejan de poder escribir. Esa condición no se cumple aquí y no puede cumplirse: **las dos
 * tablas NACEN en esta migración**, así que no existe ni existió código desplegado que inserte en
 * ellas — el `INSERT` más antiguo posible es el de los adaptadores que entran en esta misma release.
 * Es el mismo argumento con el que `create-orders-and-outbox` pudo dar `NOT NULL` a sus tres marcas
 * de tiempo, y con el que dárselas DESPUÉS habría sido un paso destructivo disfrazado.
 *
 * Consecuencia práctica, que es lo que hay que saber al desplegar: **no hay nada que partir y
 * `DB_MIGRATIONS_RUN=true` es seguro**. Una réplica antigua que siga sirviendo durante el rodado no
 * conoce estas tablas y no las toca; ninguna de sus consultas cambia, porque TypeORM enumera las
 * columnas de las tablas que sus entidades mapean y estas dos no están entre ellas.
 *
 * ## Por qué las marcas de tiempo NO llevan `DEFAULT now()`
 *
 * Porque metería un segundo reloj en el sistema. El instante lo pone el dominio con el `now` que le
 * inyecta el caso de uso, y por eso las columnas tampoco son `@CreateDateColumn`/`@UpdateDateColumn`
 * en las ORM entities. Con `DEFAULT now()` habría dos fuentes del mismo dato y la de la base ganaría
 * en silencio cada vez que alguien escribiera por SQL crudo —un seed, una migración de datos, una
 * consola—, sellando la fila con la hora del mantenimiento en vez de con la del hecho. El mismo
 * razonamiento, escrito antes, está en la cabecera de `create-orders-and-outbox`.
 *
 * ## Tres nombres de columna que no copian al dominio, y por qué
 *
 * - `wallets.user_id` guarda lo que el agregado llama `ownerId`: la columna dice a QUIÉN de `users`
 *   pertenece la dirección, con el mismo vocabulario que `auth_credentials.user_id`.
 * - `wallet_transfers.from_address` se llama así porque `FROM` es palabra reservada de SQL: una
 *   columna `from` habría que citarla con comillas dobles en cada consulta cruda —y este repo
 *   escribe SQL crudo en las migraciones, en los E2E de repositorio y en los guardianes de
 *   esquema—, donde olvidar las comillas no da un error de columna sino uno de sintaxis.
 * - `wallet_transfers.reason_code` dice que guarda un código de una lista cerrada y no el `message`
 *   del proveedor, que interpola la clave de API y se publicaría por HTTP.
 *
 * Los dos mappers de `infrastructure/persistence/` cruzan los tres nombres; ningún otro archivo del
 * módulo los ve.
 *
 * ## La secuencia, y el riesgo residual que hay que tener escrito
 *
 * El índice sale de una secuencia y NO de `max(address_index) + 1`. Dos razones (§5.1), y la segunda
 * es la decisiva: `max()` mira la tabla, así que reciclaría el índice de una fila borrada —dos
 * usuarios sobre la misma dirección—; y obligaría al orden «leer el máximo → derivar en el proveedor
 * → insertar», de modo que cada colisión tiraría los créditos de una llamada ya hecha. Con la
 * secuencia el índice es nuestro antes de gastar nada. Sus huecos son gratis: derivar no escribe en
 * la cadena, así que un hueco es una dirección que nadie posee.
 *
 * ⚠️ **Reiniciar la secuencia devuelve índices ya entregados, y eso son dos usuarios sobre la misma
 * dirección con los fondos mezclados.** Las tres formas de provocarlo son un
 * `TRUNCATE … RESTART IDENTITY`, un `setval` a mano y una restauración parcial. La primera es la
 * fácil de hacer sin querer y el `OWNED BY` de abajo la incluye: medido contra esta misma base —
 * `nextval` cuatro veces (0,1,2,3), `TRUNCATE "wallets" RESTART IDENTITY`, y el `nextval` siguiente
 * volvió a devolver 0. El índice único `idx_wallets_address_index` es lo que convierte ese desastre
 * silencioso en un 500 con nombre (`AddressIndexAlreadyUsedError`), y por eso el `TRUNCATE` de los
 * E2E de este módulo va deliberadamente SIN `RESTART IDENTITY`.
 *
 * `MINVALUE 0` no es decorativo: el mínimo por defecto de una secuencia ascendente es 1, y los
 * índices de gas pump arrancan en 0. Medido — `CREATE SEQUENCE … START WITH 0` a secas responde
 * `START value (0) cannot be less than MINVALUE (1)`. `AS integer` acota el máximo al del `integer`
 * de la columna, así que agotarla es un error del motor y no un desbordamiento silencioso. `NO
 * CYCLE` es explícito aunque sea el valor por defecto (medido: `pg_sequences.cycle` sale `false` sin
 * escribirlo), porque con `CYCLE` agotar el rango reiniciaría en `MINVALUE` y repartiría otra vez
 * índices ya entregados — el mismo desastre de arriba, esta vez sin que nadie lo hubiera pedido.
 *
 * `OWNED BY` va después del `CREATE TABLE` porque la columna tiene que existir. Lo que compra es que
 * la secuencia caiga con la tabla, y por eso el `down()` no la nombra.
 *
 * ## El `CHECK` es el primero del esquema
 *
 * Medido con `grep -rnE "CHECK|FOREIGN KEY|REFERENCES" src/database/migrations/` inmediatamente
 * antes de crear este archivo: cero resultados. Las únicas restricciones nombradas de las siete
 * migraciones anteriores eran cuatro `PRIMARY KEY`. Es un mecanismo nuevo en el repo y está escrito
 * aquí en vez de colado.
 *
 * Es el único de los cinco controles de §3.1.1 que ve una escritura por SQL crudo, que es
 * precisamente la que no pasa por `Wallet.assign()`. Qué se rompe sin él: alguien escribe la master
 * como dirección de un usuario y ese usuario «tiene» el fondo de gas de la plataforma —y el
 * siguiente también—, en silencio y sin que nada lo diga.
 *
 * **`wallet_transfers` no lleva `CHECK`, y es una decisión.** El candidato evidente sería cerrar
 * `reason_code` a `PROVIDER_FAILURE_REASONS`, porque `WalletTransfer.rehydrate` acepta cualquier
 * cadena que le pase el mapper con un `as`. Se deja fuera porque el contrato congelado §8 declara
 * para esa tabla la clave primaria y el índice compuesto y ningún `CHECK`, y porque una lista de
 * nueve literales duplicada en el esquema envejece sin que nadie la mire al añadir el décimo.
 * ⚠️ **El décimo llegó el 2026-09-02** (`chain-reverted`, la reversión de la cadena): la mitad del
 * argumento que se acaba de leer ya está comprobada —la lista crece— y la otra mitad sigue siendo
 * la decisión, o sea que la columna sigue admitiendo cualquier cadena. La deuda está en
 * `docs/backlog.md` **#21**; esta migración no se toca, porque cerrarla es una migración nueva. La
 * exclusión mutua de las cuatro columnas del activo tampoco se declara: la garantía la da
 * `TransferAsset`, que es el único camino de escritura.
 *
 * **Sin claves foráneas, como el resto del esquema.** No es olvido: los dos contextos pueden dejar
 * de compartir base, y `user_id` apunta a `users` desde otro bounded context. La comprobación de que
 * el dueño existe la hace `OwnerDirectory` en cada operación que cuesta dinero.
 *
 * Sin cualificar el schema en ningún sentido, como todas las migraciones del repo: los dos heredan
 * el `search_path` de la conexión, que sale de `DB_SCHEMA`.
 */
/**
 * ⚠️ **Sin bloqueo optimista, y es una decisión, no un olvido.** No hay columna `version` ni
 * `WHERE status = …`: `save()` es un upsert por clave primaria, así que la transición de estado
 * es «el último que escribe gana». Dos peticiones de activación concurrentes cargan las dos una
 * wallet en `receive-only`, las dos pasan el corte en memoria de `markActivationRequested` —que
 * solo ve su propia instancia—, las dos llaman al proveedor y **el gas se quema dos veces**.
 *
 * Se acepta porque la ventana es estrecha y en testnet cuesta créditos, no ETH; el mismo criterio
 * con el que la activación no escribe por delante (backlog #4, marcado como bloqueante para
 * mainnet). ⚠️ Lo que hay que saber es que **esta migración es el momento más barato de la vida
 * del proyecto para añadir esa columna**, y esa ventana se cierra con el primer despliegue.
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
        CONSTRAINT "ck_wallets_address_not_master" CHECK ("address" <> "owner_address"),
        CONSTRAINT "pk_wallets" PRIMARY KEY ("id")
      )
    `);

    // Los TRES índices son únicos y los tres significan cosas distintas, que es justo por lo que el
    // adaptador (`wallet.typeorm.repository.ts`) tiene que mirar `driverError.constraint` y no
    // quedarse en el código `23505`:
    //   - user_id       → carrera normal entre dos altas del mismo usuario. Es el desenlace
    //                     `'owner-conflict'` del puerto: no lanza, el caso de uso relee.
    //   - address_index → la secuencia repitió un índice. Dos usuarios sobre la misma dirección.
    //   - address       → el proveedor devolvió la misma dirección para índices distintos.
    // Los dos últimos sí lanzan (`AddressIndexAlreadyUsedError`, `WalletAddressAlreadyUsedError`) y
    // acaban en un 500 con nombre: una restricción sin traducción es una restricción sin
    // diagnóstico. **Renombrar un índice aquí obliga a renombrarlo en el adaptador**, o los tres
    // desenlaces colapsan en el mismo 500 anónimo.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_wallets_user_id" ON "wallets" ("user_id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_wallets_address_index" ON "wallets" ("address_index")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_wallets_address" ON "wallets" ("address")
    `);

    await queryRunner.query(`
      CREATE SEQUENCE "wallets_address_index_seq"
        AS integer
        START WITH 0
        MINVALUE 0
        INCREMENT BY 1
        NO CYCLE
    `);

    // `CREATE SEQUENCE` a secas NO ata la secuencia a nada: hace falta este `ALTER` para que sea
    // dependencia de la columna y caiga con la tabla en el `down()`, que es lo que la cabecera de
    // este archivo promete y lo que hace que el `down()` no la nombre.
    //
    // ⚠️ **Faltaba, y la ausencia estaba medida al revés.** Con esta línea fuera, todo caso de
    // `migrations.e2e-spec.ts` que revierte y vuelve a aplicar muere con
    // `relation "wallets_address_index_seq" already exists`: «debería reconstruir EXACTAMENTE el
    // mismo esquema al reaplicarse», «debería conservar el hash al revertir la expand y volver a
    // aplicarla», «debería negarse a revertir cuando hay un perfil sin credencial que restaurar» y
    // los cuatro de `CreateWallets` (remedido el 2026-08-31, al entrar esos cuatro).
    //
    // Los que solo aplican o solo revierten —«debería aplicarse entero y crear una tabla por cada
    // ORM entity registrada» y «debería revertirse entero y no dejar ninguna tabla de dominio»—
    // siguen verdes, porque `information_schema.tables` no lista secuencias: una secuencia
    // huérfana no es una tabla de más. Se nombran los casos y no cuántos son, que es lo que hacía
    // esta nota antes y lo que la habría vuelto falsa al añadir los cuatro nuevos.
    //
    // Que las dos bases ya migradas NO estén en deriva por añadirla ahora está comprobado, no
    // supuesto: las dos tienen ya la dependencia `deptype='a'` de `wallets.address_index` sobre
    // esta secuencia, medido con un `pg_depend`/`pg_class` contra `db_crypto_amazon_clon_api` y
    // contra `crypto_amazon_clon_api_test`. Esta línea escribe en el archivo lo que el esquema
    // aplicado ya dice.
    await queryRunner.query(`
      ALTER SEQUENCE "wallets_address_index_seq"
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

    // Compuesto y en este orden porque el listado paginado filtra por dueño y ordena por fecha
    // (`WHERE owner_id = $1 ORDER BY created_at DESC`); al revés no serviría para el filtro. No es
    // único: un dueño tiene muchas transferencias, y marcarlo único rompería el segundo envío de
    // cualquier usuario. Sin `DESC` —un btree se recorre en los dos sentidos, y `@Index` no modela
    // el sentido, así que un `DESC` solo en el SQL sería una divergencia entre entidad y esquema.
    await queryRunner.query(`
      CREATE INDEX "idx_wallet_transfers_owner_id_created_at"
        ON "wallet_transfers" ("owner_id", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Sin `DROP INDEX` propios, sin `DROP CONSTRAINT` y sin `DROP SEQUENCE`: los cuatro índices, el
    // `CHECK` y la secuencia `OWNED BY` son dependencias de sus tablas y caen con ellas. Un
    // `DROP SEQUENCE` escrito después del `DROP TABLE "wallets"` fallaría con «sequence
    // "wallets_address_index_seq" does not exist», y escrito antes sería redundante.
    //
    // Que la secuencia caiga de verdad lo fija el caso «debería tirar la secuencia junto con la
    // tabla que la posee» de `migrations.e2e-spec.ts`, que es el único del repo que la mira
    // directamente (`to_regclass`). Medido quitando el `OWNED BY` del `up()` y corriendo ese caso
    // solo: cae con `Expected: null · Received: "wallets_address_index_seq"`, o sea nombrando la
    // causa. Los demás casos que esa mutación tumba —«debería reconstruir EXACTAMENTE el mismo
    // esquema al reaplicarse», «debería conservar el hash al revertir la expand y volver a
    // aplicarla», «debería negarse a revertir cuando hay un perfil sin credencial que restaurar» y
    // los otros tres de `CreateWallets`— lo hacen con el `relation … already exists` del
    // `CREATE SEQUENCE` de arriba, que es el síntoma y llega un `up()` tarde.
    //
    // ⚠️ Esta nota decía hasta el 2026-08-31 que se ponía rojo «ese caso y solo ese de los cinco»,
    // y era FALSA en verde: contradecía además al comentario del `ALTER SEQUENCE` de este mismo
    // archivo, que dice tres. La medición da tres de los cinco previos. Se corrigió al medirla.
    await queryRunner.query(`DROP TABLE "wallet_transfers"`);
    await queryRunner.query(`DROP TABLE "wallets"`);
  }
}
