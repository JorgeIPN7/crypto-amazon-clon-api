import { TATUM_STUB_BASE_URL } from '@test/helpers/tatum-stub-server';

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

  it('debería apuntar la URL del proveedor al puerto exacto del stub', () => {
    // Act
    const apiUrl = process.env.TATUM_API_URL;

    // Assert
    // El literal del puerto está DUPLICADO: `test/setup-env.ts` no puede importar el helper sin
    // cargar `node:http` en el `setupFiles` de todas las suites. Este caso es lo único que impide
    // que las dos copias diverjan, y la divergencia no sería barata: la suite de Task 44
    // arrancaría contra un puerto cerrado y fallaría con `ECONNREFUSED` traducido a un 502
    // «proveedor caído», que se lee como un defecto del adaptador.
    //
    // ⚠️ Los dos casos no se sustituyen, y está medido rompiendo cada lado por separado:
    //
    //   · puerto de `setup-env.ts` a 14568 ..................... cae SOLO este
    //   · URL de `setup-env.ts` a `https://api.tatum.io` ....... caen LOS DOS
    //   · `TATUM_STUB_HOST` del helper a `api.tatum.io` ........ cae SOLO este
    //
    // La tercera fila es la que justifica que este caso exista: el de loopback solo mira
    // `process.env`, así que un helper apuntado a un host real lo dejaría VERDE.
    expect(apiUrl).toBe(TATUM_STUB_BASE_URL);
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
    // El `testTimeout` de la suite E2E es 30 s: con el timeout de producción el caso del timeout
    // de `wallets.e2e-spec.ts` no cabría dentro y saldría rojo por la razón equivocada.
    expect(timeout).toBeLessThanOrEqual(2_000);
  });
});
