import { AddressIndex } from '../../domain/value-objects/address-index.vo';
import { EthereumAddress } from '../../domain/value-objects/ethereum-address.vo';
import { TransactionHash } from '../../domain/value-objects/transaction-hash.vo';
import { Wallet } from '../../domain/entities/wallet.entity';
import { WalletId } from '../../domain/value-objects/wallet-id.vo';

import type { WalletStatus } from '../../domain/wallet-status';

import { WalletOrmEntity } from './wallet.orm-entity';

/**
 * Única frontera entre la fila y el agregado. Once asignaciones explícitas en cada sentido, tantas
 * como campos tiene `WalletSnapshot`, y **ni un spread**.
 *
 * **Qué se rompe con `{ ...snapshot }`,** que es la forma que parece más corta:
 *
 * - un campo NUEVO del dominio aparecería en la fila sin que nadie lo decidiera, y TypeORM
 *   intentaría escribir una columna que no existe;
 * - un campo RENOMBRADO dejaría de escribirse en silencio, dejando la propiedad en `undefined` —
 *   que para TypeORM significa «no toques esta columna», no `NULL`, así que el UPDATE conservaría
 *   el valor viejo y la fila afirmaría algo que el agregado ya no dice;
 * - y no podría cruzar `ownerId` con `userId`, que es el trabajo por el que este archivo existe.
 *
 * ⚠️ **Aquí es donde `ownerId` se convierte en `userId`, y en ningún otro sitio del módulo.** El
 * agregado llama al dueño `ownerId`; la tabla lo guarda en `user_id`, y como ninguna columna del
 * repo lleva `name:`, la propiedad de la ORM entity tiene que llamarse `userId`. Ese cruce vive en
 * dos líneas de este archivo.
 *
 * **Reconstituye con `rehydrate`, nunca con `assign`.** No es simetría con `orders`: `assign()`
 * comprueba que la dirección entregada no sea la master, y volver a ejercer esa comprobación al
 * LEER convertiría una fila corrupta en una excepción al cargarla, justo cuando lo que hace falta
 * es poder leerla para diagnosticarla. La invariante se impone al ESCRIBIR — el agregado, el
 * `CHECK` del esquema y la traducción de su violación en el adaptador—, no al leer.
 *
 * **`row.status as WalletStatus` es un cast consciente y acotado.** La columna solo la escriben
 * este mapper y las migraciones; un valor ajeno no eleva ningún privilegio, porque el estado solo
 * gobierna precondiciones que fallan cerradas (`Wallet.canSend` compara con `'active'`, así que
 * cualquier cadena desconocida deja la wallet sin poder enviar). Mismo criterio, ya escrito, que el
 * `role` de `UserMapper`.
 */
export const WalletMapper = {
  toDomain(row: WalletOrmEntity): Wallet {
    return Wallet.rehydrate({
      id: WalletId.from(row.id),
      ownerId: row.userId,
      ownerAddress: EthereumAddress.from(row.ownerAddress),
      addressIndex: AddressIndex.from(row.addressIndex),
      address: EthereumAddress.from(row.address),
      status: row.status as WalletStatus,
      activationTxId: row.activationTxId === null ? null : TransactionHash.from(row.activationTxId),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      // Los dos actores viajan TAL CUAL, `null` incluido y sin coalescer: `null` significa «no se
      // sabe quién» y es un valor legítimo del dominio, no un hueco que rellenar.
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
    });
  },

  toPersistence(wallet: Wallet): WalletOrmEntity {
    const snapshot = wallet.toSnapshot();
    const row = new WalletOrmEntity();
    row.id = snapshot.id;
    row.userId = snapshot.ownerId;
    row.ownerAddress = snapshot.ownerAddress;
    row.addressIndex = snapshot.addressIndex;
    row.address = snapshot.address;
    row.status = snapshot.status;
    // El snapshot ya publica `string | null`, así que no hace falta `?? null`. Lo que NO puede
    // pasar es que llegue `undefined`: en TypeORM significa «no toques esta columna», y una wallet
    // que perdiera su txId conservaría el anterior en la fila.
    row.activationTxId = snapshot.activationTxId;
    row.createdAt = snapshot.createdAt;
    row.updatedAt = snapshot.updatedAt;
    row.createdBy = snapshot.createdBy;
    row.updatedBy = snapshot.updatedBy;
    return row;
  },
};
