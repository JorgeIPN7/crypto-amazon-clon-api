import { Injectable } from '@nestjs/common';

import { SYSTEM_ACTORS } from '@shared/domain/system-actor';

import { CustodialAddressGateway } from '../../domain/ports/custodial-address.gateway';
import { EthereumAddress } from '../../domain/value-objects/ethereum-address.vo';
import { OwnerDirectory } from '../../domain/ports/owner.directory';
import { TransferAsset, type TransferAssetParts } from '../../domain/transfer-asset';
import { TransferId } from '../../domain/value-objects/transfer-id.vo';
import { WalletTransfer } from '../../domain/entities/wallet-transfer.entity';
import {
  AdminUsesMasterAddressError,
  WalletNotFoundError,
  WalletOwnerGoneError,
  WalletProviderError,
  WalletProviderRejectedError,
} from '../../domain/errors/wallet.errors';
import { WalletRepository } from '../../domain/ports/wallet.repository';
import { WalletTransferRepository } from '../../domain/ports/wallet-transfer.repository';

import type { TransactionHash } from '../../domain/value-objects/transaction-hash.vo';
import type { Wallet } from '../../domain/entities/wallet.entity';
import { ADMIN_ROLE } from '../../domain/admin-role';

export type TransferAssetInput = {
  ownerId: string;
  ownerRole: string;
  recipient: string;
  asset: TransferAssetParts;
};

/**
 * Transferencia custodiada. **El ORDEN de los siete pasos es la mitad del diseño**, porque cada
 * corte que se mueve hacia abajo cuesta dinero de verdad:
 *
 *   1. Rol `admin` ⇒ 409 sin tocar nada: la master no envía por Gas Pump. El rol viaja en el token,
 *      así que es el único corte que no cuesta ni una consulta local.
 *   2. Directorio, wallet y `assertOwnedBy`: lo que decide si esta operación puede existir. La
 *      última impide operar bajo una master que ya no controlamos, que sería quemar gas para nada.
 *   3. **Construir el dominio ANTES de tocar la red.** Destinatario y activo se validan aquí, así
 *      que todo 400 muere sin gastar un crédito. Es también el único sitio donde la exclusión mutua
 *      del activo se comprueba: el DTO valida transporte —formatos y presencia— y con
 *      `forbidNonWhitelisted` un campo DECLARADO pero prohibido para esa clase pasa igualmente
 *      (spec §6.1).
 *   4. Precondición de activación, con la reconciliación perezosa dentro (spec §5.4).
 *   5. **Escritura por delante del libro**, justo antes de la llamada y no antes: si se escribiera
 *      al principio, el libro se llenaría de rechazos que nunca salieron del proceso; si se
 *      escribiera después, un timeout no dejaría rastro — que es justo el caso para el que el libro
 *      existe (spec §3.2).
 *   6. La llamada. ⚠️ El origen es `wallet.address`, **nunca la master**: la master firma, no
 *      envía; enviar desde ella movería el fondo de gas de la plataforma.
 *   7. El desenlace, que son tres y ninguno se inventa.
 *
 * ⚠️ **Los pasos 5 y 6 son el único orden que este archivo no puede fijar solo con tipos**, y por
 * eso lo fija un caso que compara la secuencia ENTERA de llamadas —«debería escribir la fila del
 * libro ANTES de llamar al proveedor», con el diario `['save:submitting', 'send',
 * 'save:submitted']`— y no dos aserciones sueltas. Medido borrando ese `save` —que es dejar el
 * libro con escritura POSTERIOR, la alternativa que §3.2 descarta— y corriendo la suite del módulo:
 * caen **seis**. Son el del diario, el del hash devuelto, los dos del reintento,
 * el del `Error` sin traducir y la propiedad de la primera fila; los otros doce siguen verdes,
 * porque un rechazo local no llega a escribir en ninguno de los dos órdenes.
 *
 * ⚠️ **Un error que NO venga traducido del adaptador no se anota, se propaga.** El `reasonCode` del
 * libro reutiliza `ProviderFailureReason`, una lista cerrada donde no hay —ni debe haber— un código
 * para «defecto nuestro»: inventarlo publicaría una causa falsa en `GET /wallets/me/transfers`. La
 * fila se queda en `submitting`, que es exactamente lo que sabemos, y la regla escrita manda leerla
 * como `unknown` (spec §3.2).
 *
 * ⚠️ **La familia se captura por el PADRE abstracto, `WalletProviderError`, y no enumerando sus
 * tres hijos.** Con la enumeración, el hijo número cuatro caería por la rama del `else` y su fallo
 * se publicaría como un defecto nuestro — en verde y sin que nada lo dijera. Que leer `error.reason`
 * del padre baste está medido: `grep -n "readonly reason" domain/errors/wallet.errors.ts` devuelve
 * UNA línea, la 233, dentro de `WalletProviderError`. Lo del cuarto hijo, en cambio, es un
 * razonamiento y no una medición — hoy los hijos son tres y **ninguna prueba cubre ese futuro**.
 * El único que se nombra aparte es `WalletProviderRejectedError`, porque es el único desenlace que
 * afirma que **no pasó nada en la cadena**.
 *
 * ⚠️ **Lo que este caso de uso NO hace: reintentar la LLAMADA.** Un reintento ahí es una segunda
 * transacción, o sea dinero movido dos veces; la política vive en el adaptador y el JSDoc de
 * `CustodialAddressGateway` la escribe. Lo único reintentable es el guardado posterior — ver
 * `recordOutcome()`.
 *
 * ⚠️ **Y las dos deudas ACEPTADAS que salen de aquí, para que nadie las «arregle» por su cuenta**,
 * ambas con criterio escrito en `docs/backlog.md`: una fila `unknown` no la vuelve a mirar nadie
 * (#5 — resolverlo exige consultar el estado de la transacción en la cadena, una API que no es
 * ninguna de las siete de Gas Pump), y no hay clave de idempotencia, así que el cliente que
 * reintente tras un timeout mueve el dinero dos veces (#6, **no opcional para mainnet**). La
 * segunda se monta precisamente sobre la escritura por delante de este archivo: la fila existe
 * desde antes de la llamada, así que una `Idempotency-Key` sobre esa tabla es aditiva.
 */
@Injectable()
export class TransferAssetUseCase {
  constructor(
    private readonly owners: OwnerDirectory,
    private readonly wallets: WalletRepository,
    private readonly transfers: WalletTransferRepository,
    private readonly gateway: CustodialAddressGateway,
  ) {}

  async execute(input: TransferAssetInput): Promise<WalletTransfer> {
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

    // Aquí SÍ corre, a diferencia de la lectura: este caso de uso va a OPERAR con la dirección.
    wallet.assertOwnedBy(this.gateway.masterAddress());

    // Las dos construcciones que pueden lanzar un 400, ANTES de la primera llamada que cobra.
    const recipient = EthereumAddress.from(input.recipient);
    const asset = TransferAsset.fromParts(input.asset);

    await this.ensureCanSend(wallet);

    const transfer = WalletTransfer.start({
      id: TransferId.generate(),
      ownerId: input.ownerId,
      // La dirección de la WALLET, no la master. `Wallet` la publica como parameter property
      // pública, así que se pasa directa y no se reconstruye desde el snapshot.
      from: wallet.address,
      recipient,
      asset,
      now: new Date(),
      // Mismo criterio que `AssignWalletUseCase` y `PlaceOrderUseCase`: quién es el actor lo sabe
      // la aplicación, no el dominio. Hoy el único camino es el dueño moviendo lo suyo.
      createdBy: input.ownerId,
    });
    await this.transfers.save(transfer);

    let txId: TransactionHash;
    try {
      txId = await this.gateway.send({ from: wallet.address, recipient, asset });
    } catch (error) {
      if (error instanceof WalletProviderRejectedError) {
        // El 400 de validación del cuerpo es el ÚNICO rechazo. Un 401 o un 403 no rechazaron
        // nada: la petición ni se procesó como transferencia, así que van a `unknown`.
        transfer.markRejected(error.reason, new Date(), input.ownerId);
      } else if (error instanceof WalletProviderError) {
        transfer.markUnknown(error.reason, new Date(), input.ownerId);
      } else {
        // Sin motivo que anotar: se propaga y la fila se queda en `submitting`.
        throw error;
      }
      await this.recordOutcome(transfer);
      throw error;
    }

    transfer.markSubmitted(txId, new Date(), input.ownerId);
    await this.recordOutcome(transfer);
    return transfer;
  }

  /**
   * Precondición y reconciliación son **el mismo dato**, y por eso no hay planificador: la propia
   * documentación del proveedor dice que esta llamada es la que se hace «when a customer initiates
   * a fund transfer» (`docs/tatum/gas-pump/04-gaspumpaddressesactivatedornot.md`, citado en spec
   * §5.4). Con la wallet ya `active` se salta, porque el estado es MONÓTONO —el contrato está
   * desplegado y no se des-despliega— y volver a preguntar sería pagar un crédito por lo que ya
   * sabemos.
   *
   * ⚠️ **Mismo criterio, línea por línea, que `activate-wallet.use-case.ts`**: el mismo corte por
   * `wallet.canSend`, la misma llamada con el ÍNDICE, la misma curación con el mismo actor y el
   * mismo guardado antes de seguir. Dos lecturas del mismo estado que discreparan serían peor que
   * una sola: la wallet quedaría curada o colgada según por qué endpoint entrase el usuario. Lo
   * único que cambia es el desenlace, que es asunto de cada caso de uso — allí la curación termina
   * en 409 porque no había nada que activar, aquí sigue adelante porque la transferencia sí puede
   * salir.
   *
   * Quien rechaza es el agregado con `assertCanSend()`, que lleva su propio estado dentro del
   * error: si la curación no ocurrió, la wallet sigue en `receive-only` o en `activating` y el
   * error lo dice; si ocurrió, ya está `active` y la comprobación pasa sin más. Por eso no hay aquí
   * un `if (enabled) … else throw`: el estado lo publica el dominio, no este archivo.
   *
   * ⚠️ La curación se atribuye a `ACTIVATION_RECONCILIATION` y **no al dueño**: él no activó nada,
   * solo intentó transferir. Ponerle su id dejaría la traza afirmando algo falso justo sobre el
   * fallo parcial que esta rama existe para tapar. Ningún mutante de Stryker cubre esa sustitución
   * —los dos argumentos son expresiones de miembro, no literales—, así que el único control es el
   * caso «debería curar la wallet a active atribuyéndolo al actor de reconciliación y seguir
   * adelante». Medido pasando `input.ownerId` hasta aquí —un parámetro más en la firma— y
   * corriendo la suite del módulo: cae ese caso y ninguno más.
   *
   * ⚠️ **La pasarela recibe el ÍNDICE, no la dirección**, y el desenlace del `save` se ignora por lo
   * mismo que en `activate-wallet.use-case.ts`: `'owner-conflict'` es el `23505` del índice único
   * de `user_id` entre dos ALTAS, y aquí la fila ya existe con ese `user_id`.
   */
  private async ensureCanSend(wallet: Wallet): Promise<void> {
    if (wallet.canSend) {
      return;
    }

    const enabled = await this.gateway.isSendingEnabled(wallet.addressIndex);
    if (enabled) {
      wallet.confirmActivated(new Date(), SYSTEM_ACTORS.ACTIVATION_RECONCILIATION);
      await this.wallets.save(wallet);
    }

    wallet.assertCanSend();
  }

  /**
   * ⚠️ **Un fallo aquí NO puede tumbar la respuesta.** Cuando el proveedor ya contestó, el dinero
   * está movido: convertir un fallo de escritura en un 500 borraría el único sitio donde el cliente
   * puede leer el hash de una transacción que existe. La escritura no toca la cadena y es
   * idempotente, así que se reintenta **una vez**; si aun así falla, la fila sobrevive en
   * `submitting`, y la regla escrita manda leerla como `unknown` (spec §3.2).
   *
   * **Dos intentos escritos como dos, y no un bucle con tope.** El tope de un bucle es un número
   * que alguien sube; dos llamadas son dos llamadas. Lo ancla el caso «debería devolver la
   * transferencia enviada aunque el reintento del guardado también falle», que exige exactamente
   * TRES guardados en total —la escritura por delante más los dos intentos— y no «al menos tres».
   *
   * ⚠️ **El reintento vuelve a GUARDAR, nunca a marcar, y esa distinción hay que decirla porque el
   * JSDoc de `WalletTransfer.settle()` invita a leerla al revés.** Aquel corte en seco nombra
   * «un `catch` alrededor de una entidad ya marcada» y este método es ese `catch`; pero tal como
   * está escrito hoy **no depende de él**: la entidad entra ya liquidada y sale igual, porque aquí
   * no se llama a ningún `mark*`. Y en `execute()` tampoco puede correr un segundo: `markSubmitted`
   * solo se ejecuta si `send` resolvió y los otros dos solo si lanzó — comprobado leyendo las dos
   * ramas, no medido con una sonda. O sea que el corte de `settle()` es defensa en profundidad para
   * este archivo, no la razón de que el reintento sea seguro. Deja de serlo el día que alguien meta
   * un `mark*` dentro del reintento, que es justo lo que aquel corte impide.
   *
   * ⚠️ **Y lo que este método traga se traga en SILENCIO**, dicho en vez de escondido: no hay
   * logger ni `ErrorReporter` en la firma de este caso de uso —los cuatro puertos del contrato son
   * los del constructor—, así que un libro que deja de escribir no produce ninguna señal desde
   * aquí.
   *
   * ⚠️ **Y tampoco la produce nadie más, que es el dato que hay que tener.** Una versión anterior
   * de esta frase decía que la señal la daría «el adaptador de persistencia, que todavía no
   * existe»; el adaptador ya existe —`infrastructure/persistence/wallet-transfer.typeorm.repository.ts`—
   * y **no** emite ninguna: no lleva logger, no traduce nada (su JSDoc explica por qué la tabla no
   * tiene restricción que nombrar) y el `logQueryError` del propio TypeORM está apagado, porque
   * `buildTypeOrmOptions` toma `logging` de `DB_LOGGING`, cuyo `prefault` en `env.schema.ts` es
   * `'false'`. Como el `catch` de `trySave` se come la excepción antes de que llegue a
   * `AllExceptionsFilter`, el `ErrorReporter` tampoco la ve. Hoy, dos fallos de escritura seguidos
   * no dejan rastro en ningún sitio salvo la propia fila, que se queda en `submitting`.
   */
  private async recordOutcome(transfer: WalletTransfer): Promise<void> {
    const saved = await this.trySave(transfer);
    if (!saved) {
      await this.trySave(transfer);
    }
  }

  /**
   * ⚠️ **El `catch` de abajo es el ÚNICO superviviente de mutación de este archivo, y es
   * EQUIVALENTE — no un hueco.** Stryker lo muta a `catch {}`, con lo que la función cae por el
   * final devolviendo `undefined`; su único consumidor hace `if (!saved)`, y `!undefined` vale lo
   * mismo que `!false`. Ningún test puede matarlo sin asertar sobre un método privado.
   *
   * Se escribe porque sin esto el próximo que abra el informe ve un superviviente en el archivo
   * que mueve dinero y no puede distinguir un mutante equivalente de una omisión real.
   */
  private async trySave(transfer: WalletTransfer): Promise<boolean> {
    try {
      await this.transfers.save(transfer);
      return true;
    } catch {
      return false;
    }
  }
}
