import { Injectable } from '@nestjs/common';

import { WalletNotFoundError } from '../../domain/errors/wallet.errors';
import { WalletRepository } from '../../domain/ports/wallet.repository';

import type { Wallet } from '../../domain/entities/wallet.entity';

export type FindWalletByOwnerInput = {
  ownerId: string;
  ownerRole: string;
};

/**
 * Rol cuya dirección es la master. Literal y no `USER_ROLES` de `users`, por lo mismo que en
 * `assign-wallet.use-case.ts`: la regla 2 del gate de fronteras prohíbe a `application/` importar
 * nada de otro módulo, y `common` publica el rol como `string` por ese mismo motivo.
 */
const ADMIN_ROLE = 'admin';

/**
 * Lectura de «mi wallet»: un solo puerto, y las tres cosas que NO hace pesan más que la que hace.
 *
 * **Al rol `admin` le devuelve `null`, no un error** —a diferencia de los otros tres casos de uso,
 * que le responden `AdminUsesMasterAddressError`; de esos tres, hoy el único escrito es
 * `assign-wallet.use-case.ts`—. Su dirección es la master, que vive en la
 * configuración y no en la tabla, así que aquí no hay fila que buscar y el corte va ANTES de la
 * consulta; el controlador compone la respuesta con `kind: 'master'` e índice nulo. Un 404 sería
 * mentira a medias —el admin sí tiene dirección, y es la que sostiene todo—, y componer la
 * respuesta aquí obligaría a inyectar la configuración en un caso de uso que solo lee. La decisión
 * de QUÉ dirección publicar es de transporte; la de «este rol no tiene fila» es de negocio y por
 * eso vive aquí.
 *
 * **No consulta `OwnerDirectory`.** El token ya probó el `sub`, y un 403 aquí sería cosmético a
 * cambio de una consulta extra en el endpoint más llamado del módulo — la gente consulta
 * repetidamente esperando la activación. Los tres casos que cuestan dinero o crean estado sí lo
 * consultan (spec §5).
 * ⚠️ **La garantía que eso NO da, dicha en vez de escondida: un dueño desactivado cuyo JWT sigue
 * vivo PUEDE leer su wallet aquí**, hasta que el token expire. No podrá activarla ni transferir
 * —esos dos caminos sí pasan por el directorio y responden `WalletOwnerGoneError`, como ya hace
 * `assign-wallet.use-case.ts`, el único de los tres que hoy está escrito—, pero leer la dirección y
 * el estado, sí. Es el precio aceptado de no consultar; quien quiera cerrarlo tiene que pagar la
 * consulta en cada lectura, no «arreglar» la omisión por simetría.
 *
 * **No ejecuta `assertOwnedBy`.** Esa comprobación existe para impedir OPERAR con una wallet
 * derivada bajo otra master, no para censurar una lectura; meterla aquí obligaría además a inyectar
 * la pasarela solo para leer un dato de configuración. La consecuencia asumida también está escrita:
 * tras una rotación de la master este endpoint sigue devolviendo la dirección vieja, mientras
 * cualquier intento de usarla da 500 con nombre — que es el orden de descubrimiento que se quiere.
 *
 * ⚠️ **El estado que publica puede ir POR DETRÁS de la cadena**: la reconciliación es perezosa y
 * vive en activar y en transferir, no aquí (spec §5.4). Es deuda escrita, y la `description` de
 * `GET /wallets/me` tendrá que decirla en `infrastructure/http/wallets.controller.ts` — que hoy no
 * existe: medido, `find src/modules/wallets/infrastructure` responde `No such file or directory`.
 */
@Injectable()
export class FindWalletByOwnerUseCase {
  constructor(private readonly wallets: WalletRepository) {}

  async execute(input: FindWalletByOwnerInput): Promise<Wallet | null> {
    if (input.ownerRole === ADMIN_ROLE) {
      return null;
    }

    const wallet = await this.wallets.findByOwnerId(input.ownerId);
    if (!wallet) {
      throw new WalletNotFoundError(input.ownerId);
    }
    return wallet;
  }
}
