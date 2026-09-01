import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { WalletsConfig } from '@config/wallets.config';

import { assertMasterKeyMatchesAddress } from './master-address.derivation';

/**
 * Corre la comprobación de coherencia master↔clave en el arranque del módulo.
 *
 * Es el ÚNICO de los cinco controles de la master que ve una discrepancia entre
 * `WALLETS_MASTER_ADDRESS` y `WALLETS_MASTER_PRIVATE_KEY`: `assertOwnedBy` compara contra la
 * configuración, no contra la clave, así que una configuración con la dirección de una cuenta y la
 * clave de otra pasa todo lo demás y solo falla al enviar, con el gas ya gastado.
 *
 * ⚠️ **Solo sirve si `wallets.module.ts` lo declara en `providers`.** Nest no instancia lo que no
 * está registrado, así que sin esa línea esta clase existe y no comprueba nada: el gate de
 * fronteras no lo ve y ningún test unitario lo notaría. Quien sí lo notaría es un E2E que arranque
 * el módulo con una configuración incoherente, y por eso ese caso vale más que este archivo.
 *
 * `ConfigService` se importa como VALOR (nunca `import type`): con `emitDecoratorMetadata`, un
 * `import type` se elide, la metadata no se emite y Nest falla en RUNTIME con
 * `can't resolve dependencies`, con lint y typecheck en verde.
 *
 * ⚠️ **Esta clase no tiene logger, y esa ausencia es la protección.** Lo único que tiene a mano es
 * la clave privada de la master —el único secreto de este módulo que no es un hash—, así que
 * cualquier línea de log que se añadiera «para depurar» nacería a un carácter de filtrarla. El
 * aviso del modo placeholder ya lo escribe `resolveTatumCredentials()` una sola vez, nombrando
 * variables y nunca valores. El caso que sella esto es «debería no escribir nada en la consola».
 */
@Injectable()
export class MasterKeyStartupCheck implements OnModuleInit {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Lanzar aquí aborta el arranque: `NestFactory.create` propaga el error del ciclo de vida y el
   * proceso muere. Es lo que se quiere — la alternativa es un despliegue que funciona hasta la
   * primera transferencia y ahí quema gas sin mover el activo.
   *
   * ⚠️ **El atajo del placeholder es lo que hace posible tener esta comprobación.** La clave de
   * relleno son 64 ceros, y cero está fuera del rango `[1, n-1]` que secp256k1 exige, así que de
   * ella no se puede derivar ninguna dirección: sin este `if` habría que elegir entre no comprobar
   * nunca o romper `pnpm start:dev` en un clon recién hecho. No abre un agujero donde importa,
   * porque el `refine()` de `env.schema.ts` impide arrancar sin credenciales fuera de
   * `development`/`test` — o sea que en staging y production `usingDevPlaceholders` no puede ser
   * `true` y la comprobación siempre corre.
   */
  onModuleInit(): void {
    const wallets = this.configService.getOrThrow<WalletsConfig>('wallets');

    if (wallets.usingDevPlaceholders) {
      return;
    }

    assertMasterKeyMatchesAddress(wallets);
  }
}
