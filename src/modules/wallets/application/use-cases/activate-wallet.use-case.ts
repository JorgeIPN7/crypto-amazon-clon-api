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
import { ADMIN_ROLE } from '../../domain/admin-role';

export type ActivateWalletInput = {
  ownerId: string;
  ownerRole: string;
};

/**
 * Activación de la gas pump address, con la reconciliación perezosa del spec §5.4 dentro.
 *
 * **Las cinco decisiones no son intercambiables, y cada una evita un gasto distinto:**
 *
 *   0. Rol `admin` ⇒ 409 sin tocar nada. La master no es una gas pump address: no hay nada que
 *      activar, y el rol viaja en el token, así que la comprobación no cuesta E/S.
 *   1. `active` guardado ⇒ 409 sin llamar a nadie. El estado es MONÓTONO —el contrato está
 *      desplegado y no se des-despliega—, así que el `active` cacheado es información completa y
 *      volver a preguntar sería pagar un crédito por saber lo que ya sabemos (spec §5.4, razón 2).
 *   2. El proveedor dice que ya puede enviar ⇒ **curación**, guardado y 409. Es la salida del
 *      fallo parcial: el proveedor aceptó una activación anterior y perdimos su respuesta. Sin
 *      ella la wallet quedaría colgada para siempre y el intento siguiente volvería a activar.
 *   3. `activating` guardado ⇒ 409 sin activar. La misma razón vista desde el otro lado: hay una
 *      transacción en vuelo y emitir la segunda la paga dos veces.
 *   4. Solo entonces se activa de verdad.
 *
 * ⚠️ **El corte 3 va DESPUÉS de preguntar al proveedor y no antes, y ese orden es la curación
 * entera.** Con `activating` cortando primero, una wallet cuya activación sí llegó a la cadena no
 * se enteraría nunca: la reconciliación de §5.4 no tiene planificador, así que este es el único
 * sitio donde ese `activating` colgado se resuelve.
 * ⚠️ **Quien lo fija son V2 y V3, NO V4** — que es lo contrario de lo que sugiere la intuición,
 * porque V4 es el caso que habla de `activating`. Llega aquí con el proveedor diciendo `false`, así
 * que el orden le da igual. Medido subiendo este bloque justo encima de `isSendingEnabled` y
 * corriendo la suite del módulo: caen **dos**, «debería curar la wallet a active…» y
 * «debería atribuir la curación al actor de reconciliación…»—, y V4 en verde.
 *
 * ⚠️ **Volver a activar NO falla de forma visible**, que es lo que hace caros los cortes 1-3.
 * Medido sobre `docs/tatum/gas-pump/openapi.json`: el `200` de `POST /v3/gas-pump/activate` —la
 * operación 02— es un `oneOf` de `TransactionHash` y `SignatureId`, sin rama de rechazo; la cadena
 * `"Wallet already exists"` aparece una sola vez en todo el documento, como `example` del campo
 * `reason` de `InvalidGasPumpAddress`, que solo cuelga de la operación 03 — la que este ciclo no
 * lee (backlog #7). Sin los cortes, el gas se quema y nadie se entera.
 *
 * ⚠️ **La curación se ATRIBUYE a `ACTIVATION_RECONCILIATION`, nunca al dueño que hizo la
 * petición.** Él no activó nada; lo hizo una transacción anterior. Ponerle su id dejaría la traza
 * afirmando algo falso justo sobre el fallo parcial que esta rama existe para tapar, y esa traza es
 * lo único que queda para reconstruirlo. Lo fija **un solo caso**, «debería atribuir la curación al
 * actor de reconciliación y no al dueño»: medido cambiando este argumento por `input.ownerId` y
 * corriendo la suite del módulo, cae **uno solo**, ese. Ningún mutante de Stryker cubre esa
 * sustitución —los dos argumentos son expresiones de miembro, no literales—, así que sin ese caso
 * el cambio pasaría en verde y con el gate de mutación al 100 %.
 *
 * ⚠️ **Se guarda ANTES de lanzar el 409.** Si se lanzara primero, la curación se perdería y la
 * wallet volvería a preguntar al proveedor en cada intento, para siempre. Medido borrando ese
 * `save`: caen **dos**, los dos casos de la curación. El 409 y no un 202 es
 * decisión escrita: el 202 significa «transacción de activación enviada, no minada», y en esta
 * rama no se envió nada — publicarlo sería la ficción que el guardián del contrato existe para
 * impedir. El cliente recibe el 409 y su siguiente `GET /wallets/me` ya ve `active`.
 *
 * ⚠️ **La pasarela recibe el ÍNDICE**, no la dirección. Medido en el mismo `openapi.json`: los
 * siete esquemas del `oneOf` de la operación 02 exigen `["chain","owner","from","to"]` con
 * `from`/`to` `type: integer`, y `GET /v3/gas-pump/activated/{chain}/{owner}/{index}` lo lleva en
 * la ruta. La dirección derivada no aparece en ninguna de las dos.
 *
 * ⚠️ **No escribe por delante, a diferencia de `transfer-asset.use-case.ts`**: si el proceso muere
 * entre la respuesta del proveedor y el guardado, el reintento vuelve a activar. Es una asimetría
 * ACEPTADA y anotada en `docs/backlog.md` #4 como **bloqueante para mainnet** —hoy la ventana
 * cuesta 2 créditos de llamada más 1 de comisión en testnet, no ETH, y `mainnet` está bloqueada en
 * el arranque por un `refine()` (#9)—. **No se «arregla» aquí**: la salida escrita es permitir
 * `activating` con `activationTxId` nulo y partir `markActivationRequested` en dos mutadores.
 *
 * ⚠️ **El desenlace de `save` se ignora a propósito.** `'owner-conflict'` es el `23505` del índice
 * único de `user_id` entre dos ALTAS simultáneas, y aquí la fila ya existe y ya lleva ese
 * `user_id`: no hay nadie con quien chocar. Es una afirmación sobre el adaptador, que todavía **no
 * existe** —medido: `find src/modules/wallets/infrastructure` responde `No such file or
 * directory`—, así que describe el reparto previsto y no algo comprobado contra PostgreSQL.
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

    // Aquí SÍ corre, a diferencia de la lectura: este caso de uso va a OPERAR con la dirección, y
    // operar bajo una master que ya no controlamos quema gas para nada.
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
    await this.wallets.save(wallet);
    return wallet;
  }
}
