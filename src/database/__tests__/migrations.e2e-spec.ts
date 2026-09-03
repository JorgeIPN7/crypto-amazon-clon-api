import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';

import { buildDatabaseConfig } from '../../config/database.config';
import { envSchema } from '../../config/env.schema';
import { buildTypeOrmOptions } from '../typeorm-options';

/**
 * Nombre de la base desechable. Lleva el PID para que dos ejecuciones simultáneas —Jest en
 * paralelo, o un CI con varios jobs contra el mismo PostgreSQL— no se pisen la base.
 */
// Este spec lee `process.env` a pelo, sin pasar por el `ConfigModule` que carga el `.env` en los
// demás E2E: no levanta `AppModule` porque lo que prueba es anterior a la aplicación. Mismo
// patrón que `data-source.ts`, que tampoco vive dentro del contenedor de Nest.
loadEnv({ path: ['.env.local', '.env'], quiet: true });

const PROBE_DATABASE = `migrations_probe_${process.pid}`;

/**
 * Las tablas esperadas se DERIVAN de las ORM entities registradas, nunca de una lista escrita a
 * mano. Con la lista fija, el caso se rompía al añadir un módulo nuevo con un mensaje que no
 * hablaba del defecto —«esperaba 4 tablas, hay 5»—; medido generando un módulo con
 * `pnpm module:new`, que es exactamente el flujo en el que más molesta.
 *
 * Derivarlas además hace el caso MÁS valioso: ahora detecta lo contrario, una entidad declarada
 * cuya tabla ninguna migración crea, que es un defecto real y silencioso hasta el primer INSERT.
 */
const expectedTables = (dataSource: DataSource): string[] =>
  [...new Set(dataSource.entityMetadatas.map((metadata) => metadata.tableName))].sort();

const USER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$aBcDeFgHiJkLmNoPqRsTuVw';

type ColumnRow = { table_name: string; column_name: string; data_type: string };

/**
 * Las migraciones, ejercitadas de verdad: `up()`, `down()` y otra vez `up()`, **con filas dentro**.
 *
 * ## Por qué una base desechable y no `crypto_amazon_clon_api_test`
 *
 * Criterio del backlog #2, y no es teórico: probar una migración exige `undoLastMigration()`, y si
 * una aserción falla a mitad del viaje la base se queda con el esquema a medias —para esta suite y
 * para todas las que corran después—. La base de aquí se crea en el `beforeAll` y se destruye en
 * el `afterAll`, así que un fallo no puede contaminar nada.
 *
 * ## Por qué no basta con que `pnpm migration:run` funcione
 *
 * Porque eso solo ejercita los `up()`, en orden, sobre una base vacía — que es el camino que ya
 * recorre cualquiera al levantar el proyecto. Lo que nadie ejecuta nunca es el `down()`: se
 * escribe, se revisa leyéndolo y se descubre roto el día que hay que revertir en producción, que
 * es el peor momento posible. Estos casos son la única ejecución de los `down()` en todo el repo.
 *
 * ## Lo que cubre y lo que no
 *
 * Cubre: que el set completo aplica, que revierte entero dejando la base limpia, que reaplicar
 * reconstruye **el mismo esquema** columna a columna, que la pareja `MoveCredentialsToAuth`
 * —la única que MUEVE DATOS— los conserva en el viaje de ida y vuelta, y que la secuencia de
 * `CreateWallets` —el único objeto del esquema que `information_schema.columns` no ve— cae con su
 * tabla y vuelve entera y usable.
 *
 * No cubre: el comportamiento en rodado (dos versiones del código a la vez). Eso no se puede
 * simular sin dos procesos, y el razonamiento vive en la cabecera de cada migración.
 *
 * ## Qué caso caza qué, medido rompiendo un `down()` a propósito
 *
 * Se quitó el `DROP COLUMN "deleted_at"` del `down()` de `AddSoftDeleteToUsers` y se corrió la
 * suite. Cayó **exactamente uno**: «debería conservar el hash al revertir la expand y volver a
 * aplicarla». Los demás siguieron verdes, y el motivo importa: revierten **todo**, y al revertir
 * todo el `DROP TABLE users` del `down()` de `CreateUsersTable` se lleva por delante la columna
 * huérfana, así que el defecto se borra a sí mismo antes de que nadie lo mire.
 *
 * ⚠️ Es decir: **una reversión TOTAL no puede detectar un `down()` incompleto**; solo lo ve una
 * reversión PARCIAL, que además es la única que ocurre en producción — nadie revierte ocho
 * migraciones, se revierte la última. El caso que da valor a esta suite es el que rebobina hasta
 * un punto intermedio, no los que van al principio.
 *
 * La medición se repitió el 2026-08-31, al entrar los cuatro casos de `CreateWallets`, y el
 * resultado no cambió: sigue cayendo ese caso y solo ese. Los nuevos rebobinan una migración que
 * no toca `users`, así que no pueden ver esa columna. **Se nombra el caso y no cuántos son de
 * cuántos** a propósito: la redacción anterior decía «uno de los cinco» y habría pasado a ser
 * falsa —sin dejar de estar en verde— por el solo hecho de añadir casos, que es exactamente lo que
 * acaba de ocurrir.
 */
describe('migraciones (e2e)', () => {
  let admin: DataSource;
  let probe: DataSource;

  const buildProbeDataSource = (): DataSource => {
    const env = envSchema.parse(process.env);
    const options = buildTypeOrmOptions(buildDatabaseConfig(env));
    return new DataSource({
      ...options,
      database: PROBE_DATABASE,
      synchronize: false,
      migrationsRun: false,
    } as never);
  };

  /**
   * Nombres de las migraciones aplicadas, en orden de aplicación.
   *
   * La tabla `migrations` la crea TypeORM en el primer `runMigrations()`, así que sobre la base
   * recién creada todavía no existe. Sin el `to_regclass` de abajo, cualquier caso que empiece por
   * `revertAll()` solo funciona si otro lo precedió: medido corriendo esta suite con
   * `-t "CreateWallets"`, donde los cuatro morían con `relation "migrations" does not exist` antes
   * de llegar a su sujeto. Eso convierte «correr un solo caso» —que es como se comprueba que un
   * `down()` roto pone rojo a ESE caso y no a la suite entera— en algo imposible, y una suite que
   * no se puede medir por partes no puede afirmar qué caza cada parte.
   */
  const appliedMigrations = async (): Promise<string[]> => {
    const [existence] = await probe.query<{ present: boolean }[]>(
      "SELECT to_regclass('migrations') IS NOT NULL AS present",
    );
    if (existence?.present !== true) {
      return [];
    }
    const rows = await probe.query<{ name: string }[]>(
      'SELECT name FROM migrations ORDER BY timestamp ASC',
    );
    return rows.map((row) => row.name);
  };

  /** Columnas del esquema, ordenadas de forma estable para poder compararlas entre estados. */
  const schemaSnapshot = async (): Promise<ColumnRow[]> =>
    probe.query<ColumnRow[]>(
      `SELECT table_name, column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name <> 'migrations'
        ORDER BY table_name, column_name`,
    );

  const existingTables = async (): Promise<string[]> => {
    const rows = await probe.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name <> 'migrations'
        ORDER BY table_name`,
    );
    return rows.map((row) => row.table_name);
  };

  const revertAll = async (): Promise<void> => {
    // ⚠️ **Vaciar antes de revertir, o el `beforeEach` del describe siguiente hereda el estado del
    // anterior.** El `down()` de la expand se NIEGA a revertir cuando hay un perfil sin credencial
    // —lo comprueba un caso de esta misma suite—, así que el perfil huérfano que ese caso deja
    // sembrado bloquea la reversión del que venga detrás. Medido al añadir el describe de
    // `CreateWallets`: sus CUATRO casos murieron en este helper con «No se puede revertir
    // MoveCredentialsToAuthExpand: 1 perfil(es)…», ninguno por su propio sujeto. Era una bomba
    // latente, no un defecto nuevo: `MoveCredentialsToAuth` era el último describe y nadie
    // recogía detrás de él.
    //
    // No tapa nada: el único caso que afirma sobre un `down()` bloqueado por datos llama a
    // `undoLastMigration()` directamente, después de sembrar sus propias filas. Este helper es
    // montaje, nunca aserción.
    //
    // Sin `RESTART IDENTITY`, igual que los `TRUNCATE` de los E2E de `wallets` y por el motivo
    // que su migración explica: reiniciar la secuencia devuelve índices ya entregados. Aquí sería
    // inocuo —el `DROP TABLE` de abajo se lleva la secuencia—, pero el hábito es lo que se copia.
    const tables = await existingTables();
    if (tables.length > 0) {
      await probe.query(`TRUNCATE ${tables.map((table) => `"${table}"`).join(', ')}`);
    }

    // Contado desde la tabla `migrations` en vez de un número fijo: una migración nueva no
    // debería obligar a tocar este helper, y con un literal lo haría en silencio (revertiría de
    // menos y el caso siguiente arrancaría sobre un esquema a medias).
    let pending = (await appliedMigrations()).length;
    while (pending > 0) {
      await probe.undoLastMigration({ transaction: 'all' });
      pending -= 1;
    }
  };

  beforeAll(async () => {
    const env = envSchema.parse(process.env);
    const config = buildDatabaseConfig(env);
    // Conexión a `postgres` solo para crear la base: `CREATE DATABASE` no puede correr dentro de
    // una transacción ni desde la propia base que crea.
    admin = new DataSource({
      type: 'postgres',
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      database: 'postgres',
    });
    await admin.initialize();
    await admin.query(`DROP DATABASE IF EXISTS "${PROBE_DATABASE}"`);
    await admin.query(`CREATE DATABASE "${PROBE_DATABASE}"`);

    probe = buildProbeDataSource();
    await probe.initialize();
  }, 60_000);

  afterAll(async () => {
    // Los `isInitialized` no son cortesía: si el `beforeAll` falló al conectar, un `query()`
    // aquí lanza `Driver not Connected` y ESE es el error que Jest reporta, enmascarando el de
    // verdad. Pasó al escribir esta suite — el fallo real era de autenticación y no se veía.
    if (probe?.isInitialized) {
      await probe.destroy();
    }
    if (admin?.isInitialized) {
      // La base solo se puede tirar sin conexiones abiertas; el `destroy()` de arriba cierra las
      // nuestras, y nadie más debería estar dentro de una base con el PID en el nombre.
      await admin.query(`DROP DATABASE IF EXISTS "${PROBE_DATABASE}"`);
      await admin.destroy();
    }
  }, 60_000);

  describe('el set completo', () => {
    it('debería aplicarse entero y crear una tabla por cada ORM entity registrada', async () => {
      // Act
      await probe.runMigrations({ transaction: 'all' });

      // Assert
      expect(await existingTables()).toEqual(expectedTables(probe));
    }, 60_000);

    it('debería revertirse entero y no dejar ninguna tabla de dominio', async () => {
      // Act
      await revertAll();

      // Assert
      // Si un `down()` olvidara su `DROP TABLE`, la tabla sobreviviría aquí. Es el defecto que
      // nadie ve hasta que intenta revertir una release en producción.
      expect(await existingTables()).toEqual([]);
    }, 60_000);

    it('debería reconstruir EXACTAMENTE el mismo esquema al reaplicarse', async () => {
      // Arrange
      await probe.runMigrations({ transaction: 'all' });
      const first = await schemaSnapshot();

      // Act
      await revertAll();
      await probe.runMigrations({ transaction: 'all' });

      // Assert
      // Columna a columna y con su tipo. Un `down()` que restaure una columna como `varchar`
      // cuando el `up()` la crea `text` pasa desapercibido en cualquier prueba que solo mire
      // nombres de tabla, y deja la base divergiendo tras el primer ciclo de revertir/reaplicar.
      expect(await schemaSnapshot()).toEqual(first);
      expect(first.length).toBeGreaterThan(0);
    }, 90_000);
  });

  describe('MoveCredentialsToAuth, la única pareja que MUEVE datos', () => {
    /**
     * Deja la base en el estado «expand aplicada, contract todavía no»: es la ventana real de un
     * despliegue rodante, con el hash en las DOS tablas.
     *
     * Cuenta cuántas revertir en vez de fijar un número: las migraciones posteriores a la
     * contract ya son tres y serán más, y un literal aquí se quedaría corto en silencio.
     */
    const rewindToExpandState = async (): Promise<void> => {
      const applied = await appliedMigrations();
      const contractIndex = applied.findIndex((name) =>
        name.startsWith('MoveCredentialsToAuthContract'),
      );
      expect(contractIndex).toBeGreaterThanOrEqual(0);
      const toRevert = applied.length - contractIndex;
      for (let i = 0; i < toRevert; i += 1) {
        await probe.undoLastMigration({ transaction: 'all' });
      }
    };

    beforeEach(async () => {
      await revertAll();
      await probe.runMigrations({ transaction: 'all' });
      await rewindToExpandState();
    }, 90_000);

    it('debería conservar el hash al revertir la expand y volver a aplicarla', async () => {
      // Arrange: una cuenta viva en el estado de ventana, con el hash en `auth_credentials`.
      await probe.query(
        `INSERT INTO users (id, email, name, role, active, "created_at", "updated_at", password_hash)
         VALUES ($1, $2, 'Usuario Viajero', 'user', true, now(), now(), $3)`,
        [USER_ID, 'viajero@example.com', HASH],
      );
      await probe.query(
        `INSERT INTO auth_credentials (id, user_id, password_hash, "created_at", "updated_at")
         VALUES (gen_random_uuid(), $1, $2, now(), now())`,
        [USER_ID, HASH],
      );

      // Act: el viaje de vuelta y de ida otra vez.
      await probe.undoLastMigration({ transaction: 'all' });
      const afterDown = await probe.query<{ password_hash: string }[]>(
        'SELECT password_hash FROM users WHERE id = $1',
        [USER_ID],
      );
      await probe.runMigrations({ transaction: 'all' });
      const afterUp = await probe.query<{ password_hash: string }[]>(
        'SELECT password_hash FROM auth_credentials WHERE user_id = $1',
        [USER_ID],
      );

      // Assert
      // El `down()` de la expand devuelve el hash a `users` y tira `auth_credentials`; el `up()`
      // vuelve a copiarlo. Si cualquiera de los dos copiara mal, la cuenta quedaría sin poder
      // autenticarse y NADA lo diría: el esquema seguiría siendo correcto.
      expect(afterDown[0]?.password_hash).toBe(HASH);
      expect(afterUp[0]?.password_hash).toBe(HASH);
    }, 90_000);

    it('debería negarse a revertir cuando hay un perfil sin credencial que restaurar', async () => {
      // Arrange: un perfil sin fila en `auth_credentials`. Es un estado alcanzable —una cuenta
      // creada por el código nuevo durante la ventana— y su `password_hash` es NULL.
      await probe.query(
        `INSERT INTO users (id, email, name, role, active, "created_at", "updated_at")
         VALUES ($1, $2, 'Sin Credencial', 'user', true, now(), now())`,
        [USER_ID, 'sin.credencial@example.com'],
      );

      // Act & Assert
      // El `down()` de la expand restaura el `NOT NULL` de `password_hash`, y este perfil no
      // tiene con qué rellenarlo. Lo que se comprueba es que FALLA nombrando el problema, no que
      // PostgreSQL diga «column contains null values» sin decir de quién.
      await expect(probe.undoLastMigration({ transaction: 'all' })).rejects.toThrow();
    }, 90_000);
  });

  /**
   * `CreateWallets` es la única migración del esquema que crea una SECUENCIA, y eso le da un modo
   * de fallo que ninguna otra tiene: la secuencia no cae por un `DROP` escrito sino por dependencia
   * del `OWNED BY`, y `information_schema.tables` no la lista —una secuencia huérfana no es una
   * tabla de más—, así que un `down()` que la dejara suelta solo revienta al REAPLICAR: en el
   * despliegue siguiente, no en el que introdujo el defecto.
   *
   * ## Qué caza cada caso, medido rompiendo la migración a propósito (2026-08-31)
   *
   * Los casos de este describe se numeran 1º-4º por su orden de aparición abajo. La columna de la
   * derecha lista además, POR NOMBRE, los casos previos de la suite que caen — un total («siete de
   * nueve») se volvería falso solo con añadir un caso, y este describe es justo lo que acaba de
   * hacerlo.
   *
   * | Mutación                                     | Corriendo `-t "CreateWallets"` | Suite entera                        |
   * | -------------------------------------------- | ------------------------------ | ----------------------------------- |
   * | `down()` sin `DROP TABLE "wallet_transfers"` | los 4 (el 1º por su aserción)  | los 4 + los cuatro previos de abajo  |
   * | `up()` sin `ALTER SEQUENCE … OWNED BY`       | el 2º, 3º y 4º; el 1º pasa     | los 4 + esos previos salvo «revertirse entero» |
   * | `up()` sin `START WITH 0` / `MINVALUE 0`     | **solo el 4º**                 | **solo el 4º**                      |
   * | `down()` con un `DROP TABLE "orders"` de más | los 4 (el 1º por su aserción)  | los 4 + los cuatro previos de abajo  |
   *
   * Los «cuatro previos» son, en orden: «debería revertirse entero y no dejar ninguna tabla de
   * dominio», «debería reconstruir EXACTAMENTE el mismo esquema al reaplicarse», «debería conservar
   * el hash al revertir la expand y volver a aplicarla» y «debería negarse a revertir cuando hay un
   * perfil sin credencial que restaurar». El único caso de toda la suite que ninguna de las cuatro
   * mutaciones pone rojo es «debería aplicarse entero y crear una tabla por cada ORM entity
   * registrada»: solo aplica, nunca revierte.
   *
   * En la columna del medio, los rojos que NO son «por su aserción» son cascada: la mutación deja
   * un resto —la tabla o la secuencia huérfana— que revienta el `runMigrations()` del `beforeEach`
   * del caso siguiente. Por eso la aserción de cada caso se midió corriéndolo solo.
   *
   * La fila que justifica el describe entero es la tercera: una secuencia recreada con el mínimo
   * por defecto (1) en vez de 0 deja el esquema IDÉNTICO columna a columna, así que no la ven ni
   * `schemaSnapshot()` ni ningún otro guardián del repo. Solo la ve quien la USA, que es el 4º caso.
   *
   * ## Por qué revierten UNA sola migración, dicho con precisión
   *
   * Porque es la reversión que ocurre en producción —nadie revierte ocho, se revierte la última—.
   * Lo que compra, medido arriba, es **diagnóstico**, no detección: las dos mutaciones de tabla las
   * caza también la reversión total, pero contándolas como `relation "wallet_transfers" already
   * exists` en el `beforeEach` de otro caso, mientras que aquí el 1º las nombra en su diff
   * (`- "wallet_transfers"` cuando falta un `DROP`, `+ "orders"` cuando sobra).
   *
   * ⚠️ **La lección de la cabecera de esta suite —que una reversión total no ve un `down()`
   * incompleto— NO se reproduce en estas dos tablas, y conviene decirlo en vez de heredarla.** Allí
   * el defecto se borra a sí mismo porque el `DROP TABLE users` de una migración ANTERIOR se lleva
   * la columna huérfana. Estas dos tablas nacen en la ÚLTIMA migración y ninguna posterior las
   * toca, así que no hay nada que borre el rastro: medido, la reversión total también se pone roja
   * con las cuatro mutaciones. Lo que la reversión total sigue sin ver es la fila tres, y no por la
   * profundidad sino porque nadie miraba la secuencia.
   */
  describe('CreateWallets, la única migración con una secuencia', () => {
    /** Las dos tablas del contexto, que son las únicas que su `down()` puede tirar. */
    const WALLET_TABLES = ['wallet_transfers', 'wallets'];

    beforeEach(async () => {
      await revertAll();
      await probe.runMigrations({ transaction: 'all' });
    }, 90_000);

    it('debería llevarse sus dos tablas y ninguna otra al revertir solo la última migración', async () => {
      // Arrange
      const before = await existingTables();
      // Sin esta precondición las dos aserciones de abajo serían satisfacibles por vacío si las
      // tablas ni siquiera estuvieran: los dos lados saldrían vacíos y el caso pasaría verde.
      expect(before).toEqual(expect.arrayContaining(WALLET_TABLES));

      // Act
      await probe.undoLastMigration({ transaction: 'all' });

      // Assert
      // Dos direcciones, y las dos importan. Que lo desaparecido sean EXACTAMENTE sus dos tablas
      // caza el `down()` que olvida una; que lo que queda sea el resto intacto caza el que tira de
      // más. Las dos medidas, corriendo este caso solo (`-t "debería llevarse sus dos tablas"`,
      // que es la única forma de ver SU rojo y no el de la cascada que la mutación provoca en el
      // resto de la suite): borrando `DROP TABLE "wallet_transfers"` cae con `- "wallet_transfers"`
      // en el diff; añadiendo un `DROP TABLE "orders"` de más, con `+ "orders"`.
      const after = await existingTables();
      expect(before.filter((table) => !after.includes(table))).toEqual(
        before.filter((table) => WALLET_TABLES.includes(table)),
      );
      expect(after).toEqual(before.filter((table) => !WALLET_TABLES.includes(table)));
    }, 90_000);

    it('debería tirar la secuencia junto con la tabla que la posee', async () => {
      // Act
      await probe.undoLastMigration({ transaction: 'all' });

      // Assert
      // `to_regclass` devuelve NULL cuando la relación no existe, sin lanzar. Que la secuencia se
      // vaya sin un `DROP SEQUENCE` escrito es EL efecto del `OWNED BY`: sin esa cláusula quedaría
      // huérfana. Medido quitando el `ALTER SEQUENCE … OWNED BY` del `up()` y corriendo ESTE caso
      // solo: cae afirmando sobre la secuencia —`Expected: null · Received:
      // "wallets_address_index_seq"`—, que es el único rojo de toda la suite que nombra la causa.
      // Los demás que la mutación tumba lo hacen con el `relation … already exists` del
      // `CREATE SEQUENCE` de un `up()` posterior, o sea con el síntoma y a destiempo.
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
      // Si el `down()` dejara la secuencia suelta, el `CREATE SEQUENCE` del `up()` moriría con
      // «relation "wallets_address_index_seq" already exists» — y no en el despliegue que
      // introduce la migración, sino en el siguiente. Este caso lo ve revirtiendo UNA; el de
      // arriba de la suite («debería reconstruir EXACTAMENTE el mismo esquema al reaplicarse») lo
      // vería también, pero revirtiendo las ocho, que no es lo que nadie hace en producción.
      expect(await schemaSnapshot()).toEqual(before);
      expect(before.length).toBeGreaterThan(0);
    }, 90_000);

    it('debería dejar la secuencia usable y arrancando en cero tras el viaje de ida y vuelta', async () => {
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
      // sin `MINVALUE 0`, o con otro tipo—: `schemaSnapshot()` lee `information_schema.columns` y
      // no ve secuencias. Este caso la USA, que es la única forma de verlo. Medido quitando
      // `START WITH 0` y `MINVALUE 0` del `up()`: cae este y solo este, con
      // `Expected: 0 · Received: 1`, porque el mínimo por defecto de una secuencia ascendente es
      // 1 y los índices de gas pump arrancan en 0.
      expect(Number(first[0]?.nextval)).toBe(0);
      expect(Number(second[0]?.nextval)).toBe(1);
    }, 90_000);
  });
});
