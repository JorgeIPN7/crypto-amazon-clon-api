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
      // ⚠️ **Cómo cae exactamente el mutante, porque no es como parece:** quitando el `Number()`,
      // `AddressIndex.from('0')` no construye un VO con una cadena dentro — `Number.isInteger`
      // devuelve `false` para un string y el VO lanza `InvalidAddressIndexError` antes. Medido:
      // caen los TRES casos de este spec, los tres con
      // `InvalidAddressIndexError: <n> is not a valid address index`. Es decir, el
      // guardián no es esta aserción de `typeof` sino el VO — y esta aserción sigue haciendo
      // falta para que el motivo quede escrito donde alguien lo lea antes de «simplificar» la
      // conversión.
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
