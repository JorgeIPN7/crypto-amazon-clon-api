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
 * reconstruye **el mismo esquema** columna a columna, y que la pareja `MoveCredentialsToAuth`
 * —la única que MUEVE DATOS— los conserva en el viaje de ida y vuelta.
 *
 * No cubre: el comportamiento en rodado (dos versiones del código a la vez). Eso no se puede
 * simular sin dos procesos, y el razonamiento vive en la cabecera de cada migración.
 *
 * ## Qué caso caza qué, medido rompiendo un `down()` a propósito
 *
 * Se quitó el `DROP COLUMN "deleted_at"` del `down()` de `AddSoftDeleteToUsers` y se corrió la
 * suite. Cayó **uno** de los cinco: el del viaje de `MoveCredentialsToAuth`. Los otros cuatro
 * siguieron verdes, y el motivo importa: revierten **todo**, y al revertir todo el
 * `DROP TABLE users` del `down()` de `CreateUsersTable` se lleva por delante la columna
 * huérfana, así que el defecto se borra a sí mismo antes de que nadie lo mire.
 *
 * ⚠️ Es decir: **una reversión TOTAL no puede detectar un `down()` incompleto**; solo lo ve una
 * reversión PARCIAL, que además es la única que ocurre en producción — nadie revierte siete
 * migraciones, se revierte la última. El caso que da valor a esta suite es el que rebobina hasta
 * un punto intermedio, no los que van al principio.
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

  /** Nombres de las migraciones aplicadas, en orden de aplicación. */
  const appliedMigrations = async (): Promise<string[]> => {
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
});
