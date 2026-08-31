import { Injectable } from '@nestjs/common';

// ⚠️ `TransferPage` es un DATO que acompaña al puerto, así que su forma natural sería el `type`
// inline —`import { WalletTransferRepository, type TransferPage }`—, y aquí no lo lleva porque su
// nombre todavía NO está en la lista cerrada del selector de `eslint.config.mjs`. Medido
// escribiéndolo así y corriendo `npx eslint` sobre este archivo: sale `error` de
// `no-restricted-syntax` en la columna del specifier, con el mensaje que manda añadir el nombre a
// esa lista. La salida mientras tanto es importarlo como VALOR, que es la que prescribe el JSDoc
// del puerto y la que `wallet.repository.ts` escribe para `WalletSaveOutcome`.
import {
  TransferPage,
  WalletTransferRepository,
} from '../../domain/ports/wallet-transfer.repository';

export type ListWalletTransfersInput = {
  ownerId: string;
  page: number;
  limit: number;
};

/**
 * Listado del libro del dueño: un solo puerto, ninguna llamada al proveedor y cero aritmética.
 *
 * ⚠️ **Lo que este caso de uso NO hace y hoy no hace NADIE: traducir `submitting` a `unknown`.**
 * La regla de §3.2 dice que una fila que sobrevive en `submitting` a su petición se lee como
 * `unknown`, y está escrita en cuatro sitios —`transfer-status.ts`, `wallet-transfer.repository.ts`
 * y dos veces en `transfer-asset.use-case.ts`— que la delegan todos en «el consumidor». Este
 * archivo es hoy el único lector del libro en el árbol, y también la delega.
 *
 * Quien tendrá que aplicarla es el **DTO de respuesta del libro**,
 * `infrastructure/http/dto/wallet-transfer-response.dto.ts`. ⚠️ Aquí había una medición de su
 * ausencia —`find src/modules/wallets/infrastructure -name '*transfer*'`, «no devuelve nada»— y se
 * ha quitado porque se pudrió: ese `find` devuelve hoy los dos archivos de persistencia del libro,
 * que no son el DTO. Lo que importa es el archivo, no el hueco.
 * Hasta que ese DTO aplique la regla, `GET /wallets/me/transfers` publicaría `submitting` tal cual —
 * no es incorrecto (el vocabulario lo incluye), pero es MENOS honesto que `unknown`: dice «aún no
 * se sabe» de una petición que ya terminó.
 *
 * **Recibe `page`/`limit` y los entrega TAL CUAL en el criterio.** Es el vocabulario del cliente
 * —el mismo que publica `src/common/dto/pagination.dto.ts`— y quien lo traduce a desplazamiento es
 * el adaptador, que es el único que sabe cómo pagina su motor; meter aquí el `(page - 1) * limit`
 * ataría un caso de uso al `OFFSET` de PostgreSQL.
 *
 * ⚠️ **Es la decisión CONTRARIA a la de `users`, y hay que decirlo porque es el precedente que se
 * copia por costumbre.** Ese DTO publica un `get skip()` y `users` sí lo consume —medido:
 * `users/infrastructure/http/users.controller.ts` llama a `execute({ skip: pagination.skip, take:
 * limit })`, y su criterio viaja en `skip`/`take`—. Aquí el offset no cruza el puerto, así que lo
 * que allí es una multiplicación del transporte, aquí la hará el adaptador **y la repite el fake**
 * para mentir igual que la base. Ese coste está escrito en el JSDoc del propio puerto y es el
 * precio asumido de que el puerto no hable de offsets.
 *
 * **No consulta el directorio de dueños**, exactamente igual que `find-wallet-by-owner.use-case.ts`
 * y por el mismo motivo: el token ya probó el `sub`, y un 403 aquí sería cosmético a cambio de una
 * consulta extra en los dos endpoints más llamados del módulo (spec §5). El `ownerId` llega del
 * `sub` y nunca del cuerpo ni de la ruta, así que nadie puede pedir el libro de otro.
 * ⚠️ **La garantía que eso NO da, dicha en vez de escondida: un dueño desactivado cuyo JWT sigue
 * vivo PUEDE listar su libro aquí**, hasta que el token expire. No podrá transferir ni activar
 * —esos caminos sí pasan por el directorio y responden `WalletOwnerGoneError`—, pero leer lo que ya
 * movió, sí. Es el precio aceptado de no consultar, no un olvido que haya que «arreglar» por
 * simetría con los tres casos de uso que sí lo consultan; quien quiera cerrarlo tiene que pagar la
 * consulta en cada listado. Lo fija el caso «debería depender solo del repositorio, sin directorio
 * de dueños», gemelo del homónimo de la otra lectura.
 *
 * **No lleva `ownerRole`**, a diferencia de los otros cuatro casos de uso, y no es un descuido: el
 * admin usa la master, que no es una gas pump address y no envía por Gas Pump — su intento muere en
 * `transfer-asset.use-case.ts` con `AdminUsesMasterAddressError` antes de tocar nada. Así que no
 * tiene filas en el libro y la consulta normal ya le devuelve la página vacía que el spec §6.1 le
 * promete. Un corte por rol aquí sería código que solo puede divergir del de al lado.
 *
 * **Devuelve la `TransferPage` del puerto sin reenvolverla.** Componer la respuesta paginada es del
 * transporte: lo hará `infrastructure/http/wallets.controller.ts` con el DTO paginado que ya
 * publica `common/dto/`.
 */
@Injectable()
export class ListWalletTransfersUseCase {
  constructor(private readonly transfers: WalletTransferRepository) {}

  async execute(input: ListWalletTransfersInput): Promise<TransferPage> {
    return this.transfers.findByOwner({
      ownerId: input.ownerId,
      page: input.page,
      limit: input.limit,
    });
  }
}
