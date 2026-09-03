import type { AddressIndex } from '../../domain/value-objects/address-index.vo';
import type {
  CustodialAddressGateway,
  SendCommand,
} from '../../domain/ports/custodial-address.gateway';
import type { EthereumAddress } from '../../domain/value-objects/ethereum-address.vo';
import type { TransactionHash } from '../../domain/value-objects/transaction-hash.vo';
import type { TransferAssetKind } from '../../domain/transfer-asset';

/**
 * Lo que `sendCalls` guarda de cada envío: una lista de campos NOMBRADOS, aplanada igual que las
 * columnas del libro. Ver el aviso de enmascarado en la clase.
 */
export type RecordedSendCommand = {
  from: string;
  recipient: string;
  assetKind: TransferAssetKind;
  tokenAddress: string | null;
  amount: string | null;
  tokenId: string | null;
};

/**
 * Pasarela de mentira, con la misma política que tendrá el stub HTTP del E2E (spec §8): **no
 * responde por defecto**. Las tres operaciones que devuelven algo del proveedor rechazan con un
 * error que dice qué faltó programar, en vez de inventar una respuesta plausible — un valor por
 * defecto dejaría verde un caso que nunca programó la llamada que dice estar probando.
 *
 * `isSendingEnabled` sí tiene un defecto (`false`), y no es una excepción a lo anterior: «todavía
 * no puede enviar» es el estado inicial REAL de toda gas pump address recién derivada, no una
 * respuesta inventada. Aun así se puede programar un `Error`, porque el propio JSDoc del puerto
 * escribe que un `200` sin el campo `activated` se traduce a `WalletProviderUnreachableError` antes
 * de que el dominio lo vea: si el fake no supiera fallar aquí, ese camino no tendría doble.
 *
 * **Puede fallar de las diez formas de `PROVIDER_FAILURE_REASONS`** —medido: la lista de
 * `domain/errors/wallet.errors.ts` tiene diez elementos desde que `chain-reverted` entró el
 * 2026-09-02— sin enumerar ninguna: los cuatro `program*` aceptan cualquier `Error`, así que el
 * test pasa el `WalletProviderRejectedError`, `WalletProviderRevertedError`,
 * `WalletProviderUnreachableError` o `WalletProviderUnavailableError` que quiera, con su motivo y
 * su status. Enumerarlos aquí duplicaría la lista cerrada y la dejaría divergir en silencio — que
 * es justo lo que ese décimo motivo habría exigido tocar.
 *
 * ⚠️ **Las tres listas de índices se escriben ANTES de decidir si la llamada falla**, y eso es lo
 * que separa «no se llamó» de «se llamó y falló»: sin ello, un caso de uso que ni siquiera invoca
 * al proveedor sería indistinguible de uno que lo invoca y recibe un 503, y las dos cosas cuestan
 * cosas distintas (una quema gas, la otra no).
 *
 * ⚠️ **Guardan ÍNDICES, no direcciones**, porque eso es lo que reciben los métodos del puerto: la
 * API del proveedor toma índices en `activate` y en la ruta de `activated/{chain}/{owner}/{index}`.
 *
 * Cada lista existe para una aserción concreta: `deriveCalls` para comprobar que se deriva el
 * índice reservado y solo una vez; `isSendingEnabledCalls` para comprobar que una wallet ya
 * `active` NO vuelve a preguntar; `enableSendingCalls` para comprobar que una activación en curso
 * NO emite una segunda transacción; y `sendCalls` para comprobar que el origen es la dirección de
 * la wallet y jamás la master.
 *
 * ⚠️ **`sendCalls` guarda una PROYECCIÓN de campos nombrados, no el `SendCommand` recibido**, que
 * es la fila «Stub de pruebas → enmascara al guardar» de §7.1 del spec aplicada aquí. Conviene
 * decir exactamente qué compra y qué no, porque lo primero es menos de lo que el título sugiere y
 * lo segundo importa:
 *
 * - **Hoy no hay ningún secreto que enmascarar, y está medido**: `SendCommand` tiene exactamente
 *   tres campos —`from`, `recipient`, `asset`— y ninguno es la clave privada; el JSDoc del propio
 *   puerto escribe que «no aparece aquí y no puede aparecer», y quien la lee es el adaptador. El
 *   doble que SÍ la verá es el stub HTTP del E2E, que guarda cuerpos con `fromPrivateKey` dentro, y
 *   ese stub existe y vive en `test/helpers/tatum-stub-server.ts` —fuera de `src/`, porque lo
 *   consumen dos suites de sitios distintos—, y enmascara la clave al guardar lo que recibe.
 *   Decir que este fake «ve la clave privada» sigue siendo falso.
 *
 *   ⚠️ Aquí ponía «ese todavía no está en el árbol», con `find src/modules/wallets -name '*stub*'`
 *   como medición. Ese `find` sigue sin devolver nada porque está acotado a `src/modules/wallets`
 *   y el stub vive en `test/`: la medición era CIERTA y la conclusión FALSA. Es el mismo `find`
 *   que se caza a sí mismo que ya documenta `wallet-transfer.entity.ts`.
 * - **Lo que la proyección compra es que siga siendo así.** Guardar el mandato entero guarda todo
 *   lo que ese tipo LLEGUE a tener; una lista nombrada guarda solo lo que hoy se nombra, y un campo
 *   nuevo hay que añadirlo a mano. Falla en cerrado, igual que la lista cerrada del selector de
 *   `eslint.config.mjs`.
 * - **Y de paso quita el único uso que habría tenido un snapshot de Jest en el módulo**, que §7.1
 *   prohíbe: el `TransferAsset` crudo es opaco —hay que pasar por `match()` para leerlo—, y de esa
 *   incomodidad sale la tentación de `toMatchSnapshot()`. Aplanado, se compara campo a campo
 *   contra el `WalletTransferSnapshot` del libro, que tiene exactamente esa forma. Medido:
 *   `grep -rn "toMatchSnapshot" src/ --include='*.spec.ts'` no devuelve nada. El acotado a
 *   specs es el que mide lo que la frase afirma: sin él los dos únicos aciertos son este
 *   comentario y el de arriba, cazándose a sí mismos.
 */
export class FakeCustodialAddressGateway implements CustodialAddressGateway {
  readonly deriveCalls: AddressIndex[] = [];
  readonly enableSendingCalls: AddressIndex[] = [];
  readonly isSendingEnabledCalls: AddressIndex[] = [];
  readonly sendCalls: RecordedSendCommand[] = [];

  private derived: EthereumAddress | Error | null = null;
  private activation: TransactionHash | Error | null = null;
  private sent: TransactionHash | Error | null = null;
  private sendingEnabled: boolean | Error = false;

  constructor(private readonly master: EthereumAddress) {}

  programDeriveAddress(result: EthereumAddress | Error): void {
    this.derived = result;
  }

  programEnableSending(result: TransactionHash | Error): void {
    this.activation = result;
  }

  programSendingEnabled(result: boolean | Error): void {
    this.sendingEnabled = result;
  }

  programSend(result: TransactionHash | Error): void {
    this.sent = result;
  }

  masterAddress(): EthereumAddress {
    return this.master;
  }

  deriveAddress(index: AddressIndex): Promise<EthereumAddress> {
    this.deriveCalls.push(index);
    return FakeCustodialAddressGateway.settle('deriveAddress', this.derived);
  }

  enableSending(index: AddressIndex): Promise<TransactionHash> {
    this.enableSendingCalls.push(index);
    return FakeCustodialAddressGateway.settle('enableSending', this.activation);
  }

  isSendingEnabled(index: AddressIndex): Promise<boolean> {
    this.isSendingEnabledCalls.push(index);
    return FakeCustodialAddressGateway.settle('isSendingEnabled', this.sendingEnabled);
  }

  send(command: SendCommand): Promise<TransactionHash> {
    this.sendCalls.push(FakeCustodialAddressGateway.record(command));
    return FakeCustodialAddressGateway.settle('send', this.sent);
  }

  /**
   * Un solo resolvedor para las cuatro operaciones y no cuatro copias del mismo `if`: con cuatro,
   * el auditor de mutación tendría cuatro mutantes equivalentes del mismo corte. Mismo criterio con
   * el que `WalletTransfer` tiene un solo `settle()` privado para sus tres mutadores.
   *
   * `null` significa «sin programar» y solo lo alcanzan los tres campos que nacen así:
   * `sendingEnabled` nace en `false`, que es un valor y no una ausencia.
   */
  private static settle<TResult>(
    operation: string,
    programmed: TResult | Error | null,
  ): Promise<TResult> {
    if (programmed === null) {
      return Promise.reject(new Error(`FakeCustodialAddressGateway: ${operation} sin programar`));
    }
    if (programmed instanceof Error) {
      return Promise.reject(programmed);
    }
    return Promise.resolve(programmed);
  }

  /**
   * El aplanado del activo. Repite la forma de `WalletTransfer.toSnapshot()` en vez de reutilizarla
   * porque aquí no hay entidad: lo que llega es un `SendCommand`, y su `asset` solo se lee por
   * `match()`. Las claves del matcher son identificadores de TypeScript, así que `multiToken` va en
   * camelCase mientras el literal del vocabulario sigue siendo `'multi-token'` CON GUION — lo
   * segundo no se escribe aquí, sale del getter `kind` del propio activo.
   */
  private static record(command: SendCommand): RecordedSendCommand {
    const columns = command.asset.match<
      Pick<RecordedSendCommand, 'tokenAddress' | 'amount' | 'tokenId'>
    >({
      native: (amount) => ({ tokenAddress: null, amount: amount.value, tokenId: null }),
      fungible: (token, amount) => ({
        tokenAddress: token.value,
        amount: amount.value,
        tokenId: null,
      }),
      nft: (token, tokenId) => ({
        tokenAddress: token.value,
        amount: null,
        tokenId: tokenId.value,
      }),
      multiToken: (token, amount, tokenId) => ({
        tokenAddress: token.value,
        amount: amount.value,
        tokenId: tokenId.value,
      }),
    });

    return {
      from: command.from.value,
      recipient: command.recipient.value,
      assetKind: command.asset.kind,
      ...columns,
    };
  }
}
