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
 * cross-módulo (regla 3 del gate de fronteras + enmienda G1)— y de él solo se consume
 * `UsersLookup`, inyectada en `UsersOwnerDirectory`.
 *
 * `wallets` NO importa `AuthModule` y no debe: `APP_GUARD` es multi-provider, así que el
 * `JwtAuthGuard` que `auth.module.ts` registra ya es global y `@Auth()` protege los cinco
 * endpoints sin que de `auth` se consuma un solo símbolo. Importarlo crearía una arista de módulo
 * que nadie necesita.
 *
 * Ni `exports` ni re-export de tipos al final del archivo: nadie consume `wallets`. La fachada es
 * opcional en `docs/module-blueprint.md` y escribirla sin consumidor sería superficie pública que
 * hay que mantener y que ningún compilador comprueba que siga siendo correcta.
 *
 * `TatumHttpClient` es un provider suelto, sin puerto: no es un contrato del dominio sino la pieza
 * de transporte que el gateway compone. Ponerle un puerto habría publicado `fetch` como concepto
 * de negocio.
 *
 * ⚠️ **`MasterKeyStartupCheck` está en `providers` y esa línea es la comprobación entera.** Nest no
 * instancia lo que no registra, así que sin ella la clase existe, sus unitarios siguen verdes y su
 * `OnModuleInit` NO CORRE NUNCA: la aplicación arrancaría con una `WALLETS_MASTER_ADDRESS` que no
 * corresponde a `WALLETS_MASTER_PRIVATE_KEY`, y eso solo se vería en el primer envío, con el gas ya
 * gastado. Quien lo mide es el caso «debería abortar el arranque cuando la dirección de la master
 * no corresponde a su clave privada» de `__tests__/wallets.module.e2e-spec.ts`. Se comprobó que
 * mide de verdad borrando esta línea **y su import** —solo la línea no compila, `TS6133`—: de los
 * ocho casos de ese archivo caen DOS, ese (`Expected constructor: Error / Received value:
 * undefined`) y «debería resolver la comprobación de arranque de la clave de la master»
 * (`Nest could not find MasterKeyStartupCheck element`). El primero es el que afirma la garantía;
 * el segundo solo afirma el registro, porque `compile()` no ejecuta hooks de ciclo de vida.
 *
 * Y sobre el binario, que es donde importa: con las dos borradas `node dist/src/main.js` con una
 * master incoherente escribe `Nest application successfully started` y se queda sirviendo; con
 * ellas puestas muere con `EXIT=1` y `Fatal bootstrap error`. Es la medición que cierra el
 * backlog #20, donde está la tabla entera.
 *
 * ⚠️ **Ningún puerto se importa aquí con `import type`.** Este archivo tiene un decorador, así que
 * `emitDecoratorMetadata` está en juego: un `import type` se elide, el `provide` se queda sin
 * referencia y Nest falla EN EJECUCIÓN con `lint:check` y `typecheck` en verde. El primer selector
 * de `no-restricted-syntax` de `eslint.config.mjs` caza esa forma en los `ports/` y en un
 * `*.module` ajeno; lo que caza el grafo entero es el E2E de este módulo, que resuelve cada token.
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
