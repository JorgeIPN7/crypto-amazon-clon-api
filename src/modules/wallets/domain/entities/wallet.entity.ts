import { Entity, type AuditTrail } from '@shared/domain/entity.base';

import type { AddressIndex } from '../value-objects/address-index.vo';
import type { EthereumAddress } from '../value-objects/ethereum-address.vo';
import type { TransactionHash } from '../value-objects/transaction-hash.vo';
import type { WalletId } from '../value-objects/wallet-id.vo';
import type { WalletStatus } from '../wallet-status';
import {
  WalletActivationInProgressError,
  WalletAddressIsMasterError,
  WalletAlreadyActivatedError,
  WalletNotActivatedError,
  WalletOwnerMismatchError,
} from '../errors/wallet.errors';

export type WalletSnapshot = {
  id: string;
  ownerId: string;
  ownerAddress: string;
  addressIndex: number;
  address: string;
  status: WalletStatus;
  activationTxId: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
};

/**
 * La dirección custodiada de un usuario. `Entity` y **no `AggregateRoot`**: en este ciclo nadie
 * reacciona a nada de `wallets` (§3.1), y `docs/module-blueprint.md` marca eventos de dominio y
 * outbox como **No** en su columna de obligatoriedad — «solo si algo fuera del agregado debe
 * reaccionar» (las filas `Eventos de dominio` y `Outbox transaccional` de su tabla; se citan por
 * nombre y no por número de línea, que se desplaza al editar el documento). Tampoco `SoftDeletableEntity`:
 * una gas pump address no se des-asigna, porque puede tener fondos.
 *
 * `ownerId` es un `string` y no un VO propio: llega del `sub` de un token ya verificado y el
 * identificador pertenece a `users`. Mismo criterio, y por la misma regla del gate de fronteras,
 * que `Order.customerId` y que `createdBy`/`updatedBy` de la traza.
 *
 * `ownerAddress` y `assertOwnedBy()` **van juntos o no van** (§3.1). Una rotación de la master
 * cambia la dirección de cada índice: sin la comprobación, el sistema seguiría operando
 * direcciones que ya no controla, y la columna sería un dato sin consumidor.
 */
export class Wallet extends Entity<WalletId> {
  private constructor(
    id: WalletId,
    readonly ownerId: string,
    readonly ownerAddress: EthereumAddress,
    readonly addressIndex: AddressIndex,
    readonly address: EthereumAddress,
    private _status: WalletStatus,
    private _activationTxId: TransactionHash | null,
    audit: AuditTrail,
  ) {
    super(id, audit);
  }

  /**
   * Alta de la dirección derivada. `updatedBy` nace igual a `createdBy` por la misma simetría con
   * la que `updatedAt` nace igual a `createdAt`: quien creó la fila es, hasta el primer `touch()`,
   * el último que la escribió. Mismo criterio que `User.create` y `Order.place`.
   *
   * ⚠️ **La comprobación contra la master es defensa en profundidad, no validación de entrada.**
   * Hoy el sistema solo sabe acuñar direcciones derivadas, así que la invariante de §3.1.1 se
   * cumple por construcción. Lo que esta línea caza es el fallo que SÍ es posible: que el
   * adaptador devuelva la master por error y se la entreguemos a un usuario. Sería catastrófico y
   * silencioso — ese usuario «tendría» el fondo de gas de la plataforma, y el siguiente también.
   * Es uno de los cinco controles de la tabla de §3.1.1, y el único que da un error con nombre en
   * el instante exacto de construir el agregado.
   *
   * Compara VALUE OBJECTS: `ValueObject.equals` mira la clase y luego el valor, y
   * `EthereumAddress.from()` normaliza a minúsculas, así que la master escrita en EIP-55 y la
   * misma en minúsculas se detectan igual.
   */
  static assign(params: {
    id: WalletId;
    ownerId: string;
    ownerAddress: EthereumAddress;
    addressIndex: AddressIndex;
    address: EthereumAddress;
    now: Date;
    createdBy: string | null;
  }): Wallet {
    if (params.address.equals(params.ownerAddress)) {
      throw new WalletAddressIsMasterError(params.address.value);
    }
    return new Wallet(
      params.id,
      params.ownerId,
      params.ownerAddress,
      params.addressIndex,
      params.address,
      'receive-only',
      null,
      {
        createdAt: params.now,
        updatedAt: params.now,
        createdBy: params.createdBy,
        updatedBy: params.createdBy,
      },
    );
  }

  /**
   * Reconstituye desde persistencia sin re-aplicar las reglas de creación, igual que
   * `User.rehydrate` no re-valida el nombre. **No repite la comprobación contra la master a
   * propósito**: la tabla de §3.1.1 enumera cinco controles y la reconstitución no es ninguno.
   * El de la fila leída es el `CHECK ("address" <> "owner_address")` del esquema, que además ve
   * las escrituras por SQL crudo —seed, migración, consola— que este constructor no vería jamás.
   *
   * ⚠️ **Ese `CHECK` YA existe y es una protección activa**, no un reparto previsto. Lo crea
   * `src/database/migrations/1787900000000-create-wallets.ts` con el nombre
   * `ck_wallets_address_not_master`, y quien lo comprueba contra el motor de verdad es el caso
   * «debería traducir la violación del CHECK a WalletAddressIsMasterError» de
   * `__tests__/infrastructure/persistence/wallet.typeorm.repository.e2e-spec.ts`, que inserta por
   * el repositorio una wallet construida con este mismo `rehydrate` —la única forma real de
   * esquivar el corte de `assign()`— y comprueba que PostgreSQL la para.
   *
   * (Aquí ponía «todavía NO existe», medido con `find src/database/migrations -name '*wallet*'`,
   * «que no devuelve nada». Esa frase se quedó INVERTIDA al aterrizar la migración: le decía al
   * lector que una protección no existía cuando sí existe, que es peor que no decir nada.)
   *
   * ⚠️ **Qué deja pasar exactamente, porque «no valida» no es lo mismo que «da igual».** Admite
   * las seis combinaciones de estado × txId, y DOS de ellas el dominio no las produce nunca:
   *
   * - **`receive-only` con txId**: `assign()` nace siempre con `null` y solo
   *   `markActivationRequested` escribe el campo. Si una fila así llega, la siguiente petición
   *   de activación **sobrescribe ese hash sin dejar rastro del primero** — justo el fallo que el
   *   corte en seco de ese método existe para impedir, colado por la puerta de la reconstitución.
   * - **`activating` sin txId**: tampoco la produce el dominio, y su daño es acotado: la
   *   reconciliación pregunta al proveedor por `(owner, index)` y no por el hash, así que una
   *   fila así se cura igual.
   *
   * Quien las cierra es el esquema, no este método. Que sigan siendo inalcanzables es una
   * afirmación sobre la migración, y por eso está escrita aquí en vez de darse por hecha.
   */
  static rehydrate(params: {
    id: WalletId;
    ownerId: string;
    ownerAddress: EthereumAddress;
    addressIndex: AddressIndex;
    address: EthereumAddress;
    status: WalletStatus;
    activationTxId: TransactionHash | null;
    createdAt: Date;
    updatedAt: Date;
    createdBy: string | null;
    updatedBy: string | null;
  }): Wallet {
    return new Wallet(
      params.id,
      params.ownerId,
      params.ownerAddress,
      params.addressIndex,
      params.address,
      params.status,
      params.activationTxId,
      {
        createdAt: params.createdAt,
        updatedAt: params.updatedAt,
        createdBy: params.createdBy,
        updatedBy: params.updatedBy,
      },
    );
  }

  get status(): WalletStatus {
    return this._status;
  }

  get activationTxId(): TransactionHash | null {
    return this._activationTxId;
  }

  /**
   * Lo que publicará el DTO de lectura, y la misma condición que corta `assertCanSend()`. Un solo
   * sitio decide qué significa «puede enviar»: con dos copias de la comparación, el día que el
   * dominio gane un estado más, la respuesta del `GET` y el corte del `POST` podrían divergir.
   */
  get canSend(): boolean {
    return this._status === 'active';
  }

  /**
   * ⚠️ **`activating → activating` LANZA, no es idempotente** (§3.1). Una segunda petición trae un
   * txId NUEVO: tragársela dejaría guardado el primero mientras el sistema cree haber registrado
   * el segundo, y nadie podría reconciliar ninguno de los dos.
   *
   * Y desde `active` lanza porque **volver a activar no falla de forma visible en el proveedor**.
   * Medido abriendo `docs/tatum/gas-pump/openapi.json`, no citado de oídas: el `200` de
   * `POST /v3/gas-pump/activate` —la operación 02— es un `oneOf` de `TransactionHash` y
   * `SignatureId`, sin rama de rechazo; y la cadena `"Wallet already exists"` aparece **una sola
   * vez** en todo el documento, en
   * `components/schemas/InvalidGasPumpAddress/properties/reason/example`, que solo cuelga de la
   * operación 03 — la que este ciclo no lee (§9). Sin este corte, el gas se quema y nadie se
   * entera.
   *
   * Los dos errores se construyen **sin argumentos**: son 409 sobre «lo mío» y no hay nada que
   * nombrar que el llamante no tenga ya delante.
   */
  markActivationRequested(txId: TransactionHash, now: Date, by: string | null): void {
    if (this._status === 'activating') {
      throw new WalletActivationInProgressError();
    }
    if (this._status === 'active') {
      throw new WalletAlreadyActivatedError();
    }
    this._status = 'activating';
    this._activationTxId = txId;
    this.touch(now, by);
  }

  /**
   * Reconciliación de §5.4, y también la CURACIÓN de `receive-only → active`: el proveedor aceptó
   * la transacción y perdimos su respuesta, así que la cadena ya dice que puede enviar y nuestro
   * txId no existe. Sin esa transición directa la wallet quedaría colgada para siempre y el
   * intento siguiente volvería a activar. Por eso `activationTxId` puede seguir siendo `null` en
   * `active`, que es lo que el caso A8 fija.
   *
   * **Sobre una wallet ya activa es no-op SIN `touch()`**, mismo criterio que
   * `User.promoteToAdmin`: repetir la confirmación no debe reescribir `updatedBy`, o la traza
   * acabaría nombrando a quien no activó nada. El corte en seco es anterior al `touch`.
   *
   * ⚠️ **Quien protege el `touch()` de abajo es un solo caso**, «debería mover la traza al
   * confirmar la activación de una wallet en activating» en `wallet.entity.spec.ts`, y hace
   * falta porque los otros tres casos de esta transición no lo tocan: dos miran el estado y el
   * tercero mira que la traza NO se mueva al repetir. Medido borrando la llamada y corriendo la
   * suite entera del módulo: cae ese caso y ningún otro.
   *
   * ⚠️ Ese caso confirma con un instante y un actor DISTINTOS de los que pidieron la activación,
   * y no es un detalle: con los mismos, el `touch` no cambiaría ningún valor observable y el
   * caso pasaría con la llamada borrada.
   */
  confirmActivated(now: Date, by: string | null): void {
    if (this._status === 'active') {
      return;
    }
    this._status = 'active';
    this.touch(now, by);
  }

  /**
   * Precondición de la transferencia. Lanza `WalletNotActivatedError` **con el ESTADO** tanto desde
   * `receive-only` como desde `activating`: el cliente ya sabe de qué wallet habla —los cinco
   * endpoints son «lo mío»— y lo que no sabe es en qué punto está.
   * `WalletActivationInProgressError` es del camino de ACTIVAR —una segunda petición de
   * activación— y darle un segundo productor lo publicaría en dos endpoints con dos significados
   * distintos.
   */
  assertCanSend(): void {
    if (!this.canSend) {
      throw new WalletNotActivatedError(this._status);
    }
  }

  /**
   * Compara VALUE OBJECTS, no strings: `ValueObject.equals` mira la clase y el valor, así que
   * acepta la master construida en otra caja —la que devolverá `CustodialAddressGateway`— sin que
   * nadie tenga que compartir instancias. Correrá en los tres casos de uso que llaman al proveedor
   * y NO en las dos lecturas (§5), donde meterla obligaría a inyectar el gateway solo para leer
   * un dato de configuración en el endpoint que más se llama.
   *
   * El error lleva **las dos direcciones**, en este orden: la master bajo la que se derivó la fila
   * y la que hay configurada ahora. Con una sola, el 500 diría «no coinciden» sin permitir saber
   * cuál de las dos rotó, que es justo lo que el operador necesita para decidir.
   */
  assertOwnedBy(master: EthereumAddress): void {
    if (!this.ownerAddress.equals(master)) {
      throw new WalletOwnerMismatchError(this.ownerAddress.value, master.value);
    }
  }

  /**
   * ⚠️ **El `?.` lo protege un solo caso**, «debería exponer activationTxId nulo en el
   * snapshot de una wallet recién asignada» en `wallet.entity.spec.ts`. El otro caso de este
   * método fotografía una wallet en `activating`, donde el txId nunca es nulo, así que sin
   * aquel nadie miraba la rama NULA — la de toda wallet recién asignada y la de la curación.
   *
   * **El fallo que evita:** sin el `?.`, el primer consumidor que pida el snapshot de una
   * wallet recién asignada revienta con `TypeError`, y ese es el camino MÁS común del módulo,
   * el que recorre toda wallet nueva. Medido quitándolo y corriendo la suite entera: cae ese
   * caso y ningún otro.
   *
   * ⚠️ Reescribirlo como ternario explícito NO habría cambiado nada — comprobado antes de
   * escribir el caso, para que nadie lo intente: el hueco era del caso que faltaba, no de la
   * forma de la expresión.
   */
  toSnapshot(): WalletSnapshot {
    return {
      id: this.id.value,
      ownerId: this.ownerId,
      ownerAddress: this.ownerAddress.value,
      addressIndex: this.addressIndex.value,
      address: this.address.value,
      status: this._status,
      activationTxId: this._activationTxId?.value ?? null,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      createdBy: this.createdBy,
      updatedBy: this.updatedBy,
    };
  }
}
