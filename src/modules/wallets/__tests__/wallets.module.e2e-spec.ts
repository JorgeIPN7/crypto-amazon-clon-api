import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';

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
 * decoradores. La referencia se elide, la metadata no se emite, `lint:check` y `typecheck` quedan
 * VERDES y Nest revienta al resolver con «Nest can't resolve dependencies of the AssignWalletUseCase
 * (?, …)». La regla de `eslint.config.mjs` cubre los `ports/` y los `*.module` ajenos; este archivo
 * cubre el resto del grafo, resolviendo cada token de verdad.
 */
describe('WalletsModule (e2e)', () => {
  describe('grafo de inyección', () => {
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

    /**
     * Este caso dice «está registrado», no «la garantía está activa», y la diferencia es medible:
     * `TestingModuleBuilder.compile()` construye las instancias y **no** ejecuta ningún hook de
     * ciclo de vida —leído en `node_modules/@nestjs/testing/testing-module.builder.js`, cuyo
     * `compile()` llama a `scan`, `createInstancesOfDependencies` y `applyApplicationProviders`, y
     * a nada más; `onModuleInit` lo dispara `init()`, que aquí no se llama—. O sea que resolver el
     * token NO prueba que la comprobación haya corrido. Quien lo prueba es el bloque «arranque con
     * la master incoherente» de más abajo, que sí llama `init()`.
     *
     * Se queda porque falla ANTES y mejor: sin el provider, este caso dice
     * `Nest could not find MasterKeyStartupCheck element`, que nombra la línea que falta; el otro
     * dice `Received function did not throw`, que obliga a deducirla.
     */
    it('debería resolver la comprobación de arranque de la clave de la master', () => {
      // Act
      const check = moduleRef.get(MasterKeyStartupCheck, { strict: false });

      // Assert
      expect(check).toBeInstanceOf(MasterKeyStartupCheck);
    });
  });

  /**
   * Cierra el backlog #20, y es el único caso del repo que distingue «`MasterKeyStartupCheck`
   * existe y está probado» de «la aplicación no arranca con una master incoherente». Hasta que
   * `wallets.module.ts` la declaró en `providers`, la propiedad no se cumplía a nivel de sistema:
   * medido arrancando el binario real con una dirección que no corresponde a la clave, arrancaba
   * igual.
   *
   * ⚠️ **Llama `init()` a propósito, y `compile()` no basta.** Se ve en la propia corrida verde:
   * `compile()` termina sin lanzar y es `init()` quien rechaza, o sea que el hook lo dispara el
   * segundo. Concuerda con el fuente —`@nestjs/testing/testing-module.builder.js`, cuyo `compile()`
   * llama a `scan`, `createInstancesOfDependencies` y `applyApplicationProviders`, y a nada más—.
   * Un caso que solo compilara no ejecutaría esta comprobación ni con el provider puesto.
   *
   * El entorno se toca y se restaura a mano porque `process.env` sobrevive al archivo: Jest reusa
   * el proceso del worker entre suites, así que una variable que se quede puesta se la lleva la
   * siguiente. Por eso el `finally` restaura el valor anterior, y borra la clave si antes no
   * existía.
   */
  describe('arranque con la master incoherente', () => {
    // Clave privada válida de secp256k1 —está en `[1, n-1]`— cuya dirección es
    // `0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a`. Calculada con la misma receta que
    // `deriveAddressFromPrivateKey`: keccak256 de la pública SIN comprimir menos su byte `0x04`,
    // últimos 20 bytes. No es un secreto: son 32 bytes de `0x11` escritos a mano.
    const MISMATCHED_PRIVATE_KEY = `0x${'11'.repeat(32)}`;
    const DERIVED_ADDRESS = '0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a';
    // Cualquier dirección que no sea la de arriba sirve; esta se elige por ser obviamente
    // artificial. Que las dos difieren se ve a simple vista, que es justo lo que queremos.
    const CONFIGURED_ADDRESS = `0x${'ab'.repeat(20)}`;

    const OVERRIDES: Readonly<Record<string, string>> = {
      TATUM_API_KEY: 'e2e-incoherent-master-check',
      // Loopback y puerto cerrado: el arranque no llama al proveedor, pero dejar la URL por
      // defecto (`https://api.tatum.io`) apuntando a la API real durante una suite es un riesgo
      // que no hace falta correr.
      TATUM_API_URL: 'http://127.0.0.1:1',
      WALLETS_MASTER_ADDRESS: CONFIGURED_ADDRESS,
      WALLETS_MASTER_PRIVATE_KEY: MISMATCHED_PRIVATE_KEY,
    };

    it('debería abortar el arranque cuando la dirección de la master no corresponde a su clave privada', async () => {
      // Arrange
      const previous = Object.fromEntries(
        Object.keys(OVERRIDES).map((key) => [key, process.env[key]]),
      );
      Object.assign(process.env, OVERRIDES);

      let moduleRef: TestingModule | undefined;
      let thrown: unknown;

      try {
        moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

        // Act
        thrown = await moduleRef.init().then(
          () => undefined,
          (error: unknown) => error,
        );
      } finally {
        // ⚠️ `close()` empieza por `await this.initializationPromise` —leído en
        // `node_modules/@nestjs/core/nest-application-context.js`—, y aquí esa promesa es la que
        // acaba de rechazar: vuelve a lanzar el MISMO error desde el `finally` y se lleva el caso
        // por delante. Medido: sin este `catch` el caso falla con
        // `WALLETS_MASTER_ADDRESS (0xabab…) no corresponde a WALLETS_MASTER_PRIVATE_KEY`.
        //
        // Y como `close()` aborta en ese primer `await`, tampoco llega a `callDestroyHook()`, que
        // es quien cierra el pool de TypeORM. Por eso el `catch` no se limita a tragarse el error:
        // destruye el `DataSource` a mano. Medido: sin esa línea Jest imprime «did not exit one
        // second after the test run has completed».
        await moduleRef?.close().catch(async () => {
          await moduleRef?.get(DataSource, { strict: false }).destroy();
        });
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
      }

      // Assert
      // Igualdad EXACTA, no `toContain`, y es la mitad que importa: «y nada más». El mensaje que
      // llega al operador nombra las dos direcciones —públicas— y jamás la clave privada, así que
      // la aserción tiene que caer ante CUALQUIER interpolación extra, por corta que sea.
      // Medido, y el intento fallido se cuenta porque es la lección: un
      // `expect(message).not.toContain(MISMATCHED_PRIVATE_KEY)` deja el caso VERDE con la
      // plantilla parcheada a `(clave ${masterPrivateKey.slice(0, 12)}…)` —8 passed, comprobado—,
      // porque doce caracteres no son la cadena entera. Con este `toBe`, ese mismo parche pone el
      // caso rojo. Mismo criterio, y misma medición, que el caso de
      // `master-address.derivation.spec.ts` que fija esta cadena en la unitaria; lo que añade
      // ESTE es que el mensaje sobreviva al camino real —`walletsConfig` → `MasterKeyStartupCheck`
      // → `assertMasterKeyMatchesAddress`— y no solo a un `ConfigService` doblado.
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toBe(
        `WALLETS_MASTER_ADDRESS (${CONFIGURED_ADDRESS}) no corresponde a WALLETS_MASTER_PRIVATE_KEY, ` +
          `cuya dirección es ${DERIVED_ADDRESS}`,
      );
    });
  });
});
