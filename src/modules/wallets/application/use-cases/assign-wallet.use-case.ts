import { Injectable } from '@nestjs/common';

import { AddressIndexAllocator } from '../../domain/ports/address-index.allocator';
import { CustodialAddressGateway } from '../../domain/ports/custodial-address.gateway';
import { OwnerDirectory } from '../../domain/ports/owner.directory';
import { Wallet } from '../../domain/entities/wallet.entity';
import {
  AdminUsesMasterAddressError,
  WalletAssignmentLostError,
  WalletOwnerGoneError,
} from '../../domain/errors/wallet.errors';
import { WalletId } from '../../domain/value-objects/wallet-id.vo';
import { WalletRepository } from '../../domain/ports/wallet.repository';

export type AssignWalletInput = {
  ownerId: string;
  ownerRole: string;
};

/**
 * Rol que ya posee la master. Es un literal y no `USER_ROLES` de `users` a propósito: la regla 2
 * del gate de fronteras prohíbe a `application/` importar nada de otro módulo, y `common` tampoco
 * lo publica —`AuthenticatedUser.role` es un `string` laxo por ese mismo motivo—. El contenido lo
 * garantiza el token; aquí solo se compara.
 */
const ADMIN_ROLE = 'admin';

/**
 * Alta de la dirección custodiada, **idempotente y sin compensación**.
 *
 * El orden —rol → directorio → wallet existente → índice → derivar → guardar— no es estético:
 * cada paso es más caro e irreversible que el anterior. El rol viaja en el token y no cuesta E/S;
 * el directorio es una consulta local; la lectura de la wallet ahorra el crédito del proveedor
 * cuando el alta se repite; el índice sale de una secuencia y **consumirlo es irreversible por
 * diseño**; y solo después se gasta la llamada. Lo fija el caso «debería consultar el directorio
 * antes de reservar el índice y antes de derivar», que compara el diario de llamadas ENTERO
 * —`['exists', 'findByOwnerId', 'next', 'deriveAddress', 'save']`— y no solo dos de ellas.
 *
 * ⚠️ **El 409 al rol `admin` vive AQUÍ, no en el controlador.** El admin ya tiene dirección —la
 * master, que vive en la configuración y no en la tabla—, y darle además una derivada le dejaría
 * dos, rompiendo la invariante «una sola EOA en el sistema». Escrita en el borde HTTP, la regla se
 * saltaba con solo llamar al caso de uso desde otro sitio; escrita aquí, el único camino pasa por
 * ella y el filtro del contexto la publicará como 409 igual que cualquier otro error de dominio.
 * ⚠️ Ese filtro todavía NO existe —medido: `find src/modules/wallets/infrastructure` responde
 * `No such file or directory`—, así que hoy este error es un 409 previsto, no publicado.
 *
 * **Si la pasarela falla, lo que queda huérfano es un NÚMERO, no una fila** — por eso no hay
 * compensación y escribirla sería ceremonia. La compensación existe para desbloquear un reintento,
 * y aquí el reintento no está bloqueado: pide el índice siguiente. Los huecos son gratis porque
 * derivar no escribe en la cadena, así que un índice perdido es una dirección que nadie posee y a
 * la que nadie va a mandar nada.
 *
 * **La carrera se resuelve con UNA relectura, no con un bucle.** El `23505` de `user_id` llega
 * como el desenlace `owner-conflict` y no como excepción, precisamente para que no exista un
 * error publicable de «ya tienes wallet»: el endpoint responderá 200 con la wallet del ganador. Si
 * la relectura vuelve vacía —el ganador hizo `ROLLBACK` entre el conflicto y la lectura— se lanza
 * `WalletAssignmentLostError` y NO se reintenta el alta: reintentar gastaría otro índice y otro
 * crédito para volver a arriesgar exactamente la misma carrera.
 *
 * ⚠️ **`Wallet.assign()` puede lanzar `WalletAddressIsMasterError` y este caso de uso NO lo
 * captura.** Es deliberado: es la defensa en profundidad contra que el proveedor nos devuelva la
 * master y se la entreguemos a un usuario, y tragárselo aquí —devolviendo la wallet igualmente, o
 * reintentando con otro índice— convertiría el fallo más caro del módulo en silencio. Sale hacia
 * arriba tal cual.
 */
@Injectable()
export class AssignWalletUseCase {
  constructor(
    private readonly owners: OwnerDirectory,
    private readonly wallets: WalletRepository,
    private readonly indexes: AddressIndexAllocator,
    private readonly gateway: CustodialAddressGateway,
  ) {}

  async execute(input: AssignWalletInput): Promise<Wallet> {
    if (input.ownerRole === ADMIN_ROLE) {
      throw new AdminUsesMasterAddressError();
    }

    const exists = await this.owners.exists(input.ownerId);
    if (!exists) {
      throw new WalletOwnerGoneError(input.ownerId);
    }

    const existing = await this.wallets.findByOwnerId(input.ownerId);
    if (existing) {
      return existing;
    }

    const addressIndex = await this.indexes.next();
    // La master la aporta la pasarela desde la configuración; `deriveAddress` solo recibe el
    // índice, así que este es el único sitio donde el caso de uso la nombra.
    const ownerAddress = this.gateway.masterAddress();
    const address = await this.gateway.deriveAddress(addressIndex);

    const wallet = Wallet.assign({
      id: WalletId.generate(),
      ownerId: input.ownerId,
      ownerAddress,
      addressIndex,
      address,
      now: new Date(),
      // Mismo criterio que `PlaceOrderUseCase`: quién es el actor lo sabe la aplicación, no el
      // dominio. Hoy el único camino es el dueño pidiéndose su propia dirección, y el día que un
      // admin la pida en nombre de otro esta línea es la que cambia.
      createdBy: input.ownerId,
    });

    const outcome = await this.wallets.save(wallet);
    if (outcome === 'saved') {
      return wallet;
    }

    const winner = await this.wallets.findByOwnerId(input.ownerId);
    if (!winner) {
      throw new WalletAssignmentLostError(input.ownerId);
    }
    return winner;
  }
}
