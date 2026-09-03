import { ConfigService } from '@nestjs/config';

import { MasterKeyStartupCheck } from '../../../infrastructure/security/master-key-startup.check';

/**
 * Cuentas #0 y #1 de Hardhat/Anvil, las mismas que `master-address.derivation.spec.ts` — su JSDoc
 * lleva el porqué del par y, sobre todo, ⚠️ **por qué la constante no se llama `KEY`**: ese nombre
 * dispara `generic-api-key` de gitleaks y pone la CI en rojo (medido: 2 hallazgos con `KEY`, 0 con
 * `HARDHAT_SIGNER`).
 */
const HARDHAT_SIGNER = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const HARDHAT_ADDRESS = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const OTHER_ADDRESS = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';

/** Los dos placeholders de desarrollo de `wallets.config.ts`, copiados en su forma exacta. */
const DEV_ADDRESS = `0x${'0'.repeat(40)}`;
const DEV_PLACEHOLDER_SIGNER = `0x${'0'.repeat(64)}`;

describe('MasterKeyStartupCheck', () => {
  describe('onModuleInit()', () => {
    it('debería dejar arrancar cuando la clave configurada deriva la dirección configurada', () => {
      // Arrange
      const check = new MasterKeyStartupCheck(
        configWith({
          masterAddress: HARDHAT_ADDRESS,
          masterPrivateKey: HARDHAT_SIGNER,
          usingDevPlaceholders: false,
        }),
      );

      // Act + Assert
      expect(() => check.onModuleInit()).not.toThrow();
    });

    it('debería impedir el arranque cuando la dirección y la clave son de EOAs distintas', () => {
      // Arrange
      const check = new MasterKeyStartupCheck(
        configWith({
          masterAddress: OTHER_ADDRESS,
          masterPrivateKey: HARDHAT_SIGNER,
          usingDevPlaceholders: false,
        }),
      );

      // Act + Assert
      // Lanzar en `onModuleInit` aborta el arranque: `NestFactory.create` propaga el error. Un
      // proceso que no arranca es exactamente lo que se quiere — la alternativa es un despliegue
      // que funciona hasta la primera transferencia y ahí quema gas sin mover el activo.
      expect(() => check.onModuleInit()).toThrow(/no corresponde a WALLETS_MASTER_PRIVATE_KEY/);
    });

    /**
     * ⚠️ **El caso que hace que la comprobación pueda existir.** Sin él habría que elegir entre no
     * comprobar nunca o romper `pnpm start:dev` en un clon recién hecho: los 64 ceros del
     * placeholder pasan la comprobación de FORMA y aun así no se puede derivar de ellos —cero está
     * fuera del rango `[1, n-1]` de secp256k1, y la librería responde
     * `invalid private key: out of range [1..N-1]`, medido—.
     *
     * Y la dirección del placeholder es la dirección cero, que **no** es la que derivaría esa
     * clave si pudiera derivarse, así que ni siquiera un placeholder coherente salvaría el
     * arranque: el atajo es obligatorio, no una comodidad.
     *
     * Es seguro precisamente donde importa: `env.schema.ts` veta staging y production sin
     * credenciales, así que fuera de `development`/`test` `usingDevPlaceholders` no puede ser
     * `true` y la comprobación siempre corre.
     */
    it('debería dejar arrancar sin comprobar nada cuando la configuración usa los placeholders de desarrollo', () => {
      // Arrange
      const check = new MasterKeyStartupCheck(
        configWith({
          masterAddress: DEV_ADDRESS,
          masterPrivateKey: DEV_PLACEHOLDER_SIGNER,
          usingDevPlaceholders: true,
        }),
      );

      // Act + Assert
      expect(() => check.onModuleInit()).not.toThrow();
    });

    it('debería impedir el arranque cuando la clave no tiene la forma que el proveedor exige', () => {
      // Arrange
      const check = new MasterKeyStartupCheck(
        configWith({
          masterAddress: HARDHAT_ADDRESS,
          masterPrivateKey: 'no-es-una-clave',
          usingDevPlaceholders: false,
        }),
      );

      // Act + Assert
      expect(() => check.onModuleInit()).toThrow(/WALLETS_MASTER_PRIVATE_KEY no tiene la forma/);
    });

    it('debería leer la configuración bajo la clave «wallets» y no otra', () => {
      // Arrange
      // `getOrThrow('wallets')` con el nombre equivocado devolvería `undefined` y el fallo sería
      // un `TypeError` ilegible en el arranque, no el mensaje que este archivo publica.
      const configService = new ConfigService({
        wallets: {
          masterAddress: HARDHAT_ADDRESS,
          masterPrivateKey: HARDHAT_SIGNER,
          usingDevPlaceholders: false,
        },
      });
      const check = new MasterKeyStartupCheck(configService);

      // Act + Assert
      expect(() => check.onModuleInit()).not.toThrow();
    });

    it('debería no escribir nada en la consola, ni siquiera al rechazar', () => {
      // Arrange
      // La clase no tiene logger y este caso es lo que impide que alguien le añada uno «para
      // ayudar a depurar»: el único dato que tiene a mano es la clave privada. Quien avisa del
      // modo placeholder es `resolveTatumCredentials()`, una sola vez y sin valores.
      const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((method) =>
        jest.spyOn(console, method).mockImplementation(() => undefined),
      );
      const check = new MasterKeyStartupCheck(
        configWith({
          masterAddress: OTHER_ADDRESS,
          masterPrivateKey: HARDHAT_SIGNER,
          usingDevPlaceholders: false,
        }),
      );

      // Act
      expect(() => check.onModuleInit()).toThrow();

      // Assert
      expect(spies.filter((spy) => spy.mock.calls.length > 0)).toEqual([]);
    });
  });
});

// Helpers

type WalletsSlice = {
  masterAddress: string;
  masterPrivateKey: string;
  usingDevPlaceholders: boolean;
};

const configWith = (wallets: WalletsSlice): ConfigService =>
  ({ getOrThrow: () => wallets }) as unknown as ConfigService;
