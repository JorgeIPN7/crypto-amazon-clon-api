import { fc, test as fcTest } from '@fast-check/jest';

import { AddressIndex } from '../../../domain/value-objects/address-index.vo';
import { captureError } from '../../helpers/capture-error';
import { EthereumAddress } from '../../../domain/value-objects/ethereum-address.vo';
import { TransactionHash } from '../../../domain/value-objects/transaction-hash.vo';
import { Wallet } from '../../../domain/entities/wallet.entity';
import { WalletId } from '../../../domain/value-objects/wallet-id.vo';
import { WALLET_STATUSES, type WalletStatus } from '../../../domain/wallet-status';
import {
  WalletActivationInProgressError,
  WalletAddressIsMasterError,
  WalletAlreadyActivatedError,
  WalletNotActivatedError,
  WalletOwnerMismatchError,
} from '../../../domain/errors/wallet.errors';

const WALLET_ID = WalletId.from('7c9e6679-7425-40de-944b-e07fc1f90ae7');
const OWNER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
/**
 * Actor DISTINTO del dueño a propósito, aunque el caso de uso del alta acabe pasando el mismo
 * `sub` a los dos: es lo único que demuestra que el agregado guarda ambos campos por separado en
 * lugar de derivar `createdBy` de `ownerId`.
 *
 * El argumento idéntico —hasta el literal— vive en `order.entity.spec.ts`: allí el actor es
 * distinto de `CUSTOMER_ID` por la misma razón, y ese `CUSTOMER_ID` es exactamente el `OWNER_ID`
 * de aquí. `user.entity.spec.ts` comparte los dos valores UUID de abajo, pero bajo los nombres
 * `CREATOR`/`EDITOR` y argumentando otra cosa —distinguir quién creó de quién tocó por última
 * vez—; esa entidad ni siquiera tiene un dueño del que `createdBy` pudiera derivarse.
 */
const ACTOR_ID = '5b7c2d4e-9a1f-4c3b-8e6d-0f2a4b6c8d1e';
const OTHER_ACTOR_ID = '3f1a9b2c-8d4e-4f6a-9b1c-2e5d7a0f3b48';

const MASTER = EthereumAddress.from('0x4f3edf983ac636a65a842ce7c78d9aa706d3b113');
const ROTATED_MASTER = EthereumAddress.from('0x627306090abab3a6e1400e9345bc60c78a8bef57');
const DERIVED = EthereumAddress.from('0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3');
const INDEX = AddressIndex.from(7);

const TX_ID = TransactionHash.from(
  '0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060',
);
const OTHER_TX_ID = TransactionHash.from(
  '0x88df016429689c079f3b2f6ad39fa052532c56795b733da78a91ebe6a713944b',
);

const NOW = new Date('2026-08-27T09:00:00.000Z');
const LATER = new Date('2026-08-27T10:30:00.000Z');
const MUCH_LATER = new Date('2026-08-27T12:45:00.000Z');

describe('Wallet', () => {
  describe('assign()', () => {
    it('debería nacer en receive-only, sin txId de activación y con las dos marcas selladas en el mismo instante', () => {
      // Arrange + Act
      const wallet = buildAssignedWallet();

      // Assert — `toEqual` y no `toBe` sobre las fechas: los getters de `Entity` devuelven copias
      // (`get createdAt() { return new Date(this._audit.createdAt) }`), así que la instancia que
      // sale nunca es la que entró.
      expect(wallet.status).toBe('receive-only');
      expect(wallet.activationTxId).toBeNull();
      expect(wallet.createdAt).toEqual(NOW);
      expect(wallet.updatedAt).toEqual(NOW);
    });

    it('debería registrar el actor recibido en createdBy y updatedBy sin derivarlo del dueño', () => {
      // Arrange
      const wallet = buildAssignedWallet();

      // Act
      const actors = { createdBy: wallet.createdBy, updatedBy: wallet.updatedBy };

      // Assert — con ACTOR_ID ≠ OWNER_ID, una implementación que escribiera `params.ownerId`
      // en la traza cae aquí.
      expect(actors).toEqual({ createdBy: ACTOR_ID, updatedBy: ACTOR_ID });
      expect(wallet.ownerId).toBe(OWNER_ID);
    });

    it('debería lanzar WalletAddressIsMasterError con la dirección cuando la derivada es la propia master', () => {
      // Arrange: el fallo que este caso cierra es catastrófico y silencioso — ese usuario
      // «tendría» el fondo de gas de la plataforma, y el siguiente también (§3.1.1).
      const act = (): Wallet =>
        Wallet.assign({
          id: WALLET_ID,
          ownerId: OWNER_ID,
          ownerAddress: MASTER,
          addressIndex: INDEX,
          address: EthereumAddress.from(MASTER.value),
          now: NOW,
          createdBy: ACTOR_ID,
        });

      // Act
      const error = captureError(act);

      // Assert — el error lleva la dirección repetida, que es el único dato que el operador
      // necesita para saber qué acuñó el adaptador.
      expect(error).toBeInstanceOf(WalletAddressIsMasterError);
      expect((error as WalletAddressIsMasterError).address).toBe(MASTER.value);
    });
  });

  describe('markActivationRequested()', () => {
    it('debería pasar de receive-only a activating guardando el txId y moviendo la traza', () => {
      // Arrange
      const wallet = buildAssignedWallet();

      // Act
      wallet.markActivationRequested(TX_ID, LATER, OTHER_ACTOR_ID);

      // Assert
      expect(wallet.status).toBe('activating');
      expect(wallet.activationTxId).toBe(TX_ID);
      expect(wallet.updatedAt).toEqual(LATER);
      expect(wallet.updatedBy).toBe(OTHER_ACTOR_ID);
    });

    it('debería lanzar WalletActivationInProgressError al pedir la activación de una wallet en activating', () => {
      // Arrange: una segunda petición trae un txId NUEVO. Tragársela dejaría guardado el
      // primero mientras el sistema cree haber registrado el segundo (§3.1).
      const wallet = buildActivatingWallet();

      // Act
      const error = captureError(() =>
        wallet.markActivationRequested(OTHER_TX_ID, MUCH_LATER, ACTOR_ID),
      );

      // Assert — el error no lleva argumentos: lo que hay que comprobar es que el estado
      // guardado no se movió.
      expect(error).toBeInstanceOf(WalletActivationInProgressError);
      expect(wallet.activationTxId).toBe(TX_ID);
    });

    it('debería lanzar WalletAlreadyActivatedError al pedir la activación de una wallet ya activa', () => {
      // Arrange: volver a activar NO falla de forma visible en el proveedor —la operación 02
      // responde 200 y el gas se quema—, así que el corte tiene que estar aquí (§3.1).
      const wallet = buildActiveWallet();

      // Act
      const error = captureError(() =>
        wallet.markActivationRequested(OTHER_TX_ID, MUCH_LATER, ACTOR_ID),
      );

      // Assert
      expect(error).toBeInstanceOf(WalletAlreadyActivatedError);
      expect(wallet.status).toBe('active');
      expect(wallet.activationTxId).toBe(TX_ID);
    });
  });

  describe('confirmActivated()', () => {
    it('debería pasar de activating a active conservando el txId de la activación', () => {
      // Arrange
      const wallet = buildActivatingWallet();

      // Act
      wallet.confirmActivated(MUCH_LATER, ACTOR_ID);

      // Assert
      expect(wallet.status).toBe('active');
      expect(wallet.activationTxId).toBe(TX_ID);
    });

    it('debería pasar de receive-only a active sin txId cuando la cadena ya lo confirma', () => {
      // Arrange: curación del fallo parcial de la activación —el proveedor aceptó la
      // transacción y perdimos su respuesta—. Sin esta transición la wallet queda colgada
      // para siempre y el intento siguiente VOLVERÍA a activar (§3.1).
      const wallet = buildAssignedWallet();

      // Act
      wallet.confirmActivated(LATER, ACTOR_ID);

      // Assert
      expect(wallet.status).toBe('active');
      expect(wallet.activationTxId).toBeNull();
    });

    it('debería ser no-op y NO mover la traza al confirmar una wallet ya activa', () => {
      // Arrange: mismo criterio que `User.promoteToAdmin` — repetir la confirmación no debe
      // reescribir `updatedBy`, o la traza acabaría nombrando a quien no activó nada.
      const wallet = buildActiveWallet();
      const before = { updatedAt: wallet.updatedAt, updatedBy: wallet.updatedBy };

      // Act
      wallet.confirmActivated(MUCH_LATER, OTHER_ACTOR_ID);

      // Assert
      expect(wallet.updatedAt).toEqual(before.updatedAt);
      expect(wallet.updatedBy).toBe(before.updatedBy);
    });

    // El simétrico del «moviendo la traza» que A4 sí tiene para `markActivationRequested`, y sin
    // él nadie afirma que una confirmación REAL mueva la traza: A7 y A8 miran el estado, A9 mira
    // que NO se mueva al repetir. Añadido por confirmación tras verlo sobrevivir a la mutación.
    //
    // ⚠️ Usa `MUCH_LATER`/`OTHER_ACTOR_ID` a propósito: `buildActivatingWallet` pidió la
    // activación con `LATER`/`ACTOR_ID`, así que con esos mismos valores el `touch()` no
    // cambiaría nada observable y el caso pasaría con el mutante puesto.
    //
    // Medido borrando `this.touch(now, by)` de `confirmActivated()` y corriendo la suite entera
    // del módulo: sin este caso, `162 passed` y no cae ni uno; con él, cae solo este.
    it('debería mover la traza al confirmar la activación de una wallet en activating', () => {
      // Arrange
      const wallet = buildActivatingWallet();

      // Act
      wallet.confirmActivated(MUCH_LATER, OTHER_ACTOR_ID);

      // Assert
      expect(wallet.updatedAt).toEqual(MUCH_LATER);
      expect(wallet.updatedBy).toBe(OTHER_ACTOR_ID);
    });
  });

  describe('canSend', () => {
    it('debería exponer canSend en true solo cuando la wallet está activa', () => {
      // Arrange: el getter es lo que publicará el DTO de lectura; `assertCanSend()` es lo que
      // corta la transferencia. Los dos leen el mismo estado y por eso no pueden divergir.
      const wallets = [buildAssignedWallet(), buildActivatingWallet(), buildActiveWallet()];

      // Act
      const flags = wallets.map((wallet) => wallet.canSend);

      // Assert
      expect(flags).toEqual([false, false, true]);
    });
  });

  describe('assertCanSend()', () => {
    it('debería no lanzar en assertCanSend cuando la wallet está activa', () => {
      // Arrange
      const wallet = buildActiveWallet();

      // Act + Assert — `not.toThrow()` y no `captureError`: ese helper LANZA cuando no hubo
      // error, que es justo el desenlace que este caso espera.
      expect(() => {
        wallet.assertCanSend();
      }).not.toThrow();
    });

    it('debería lanzar WalletNotActivatedError con el estado receive-only en assertCanSend', () => {
      // Arrange
      const wallet = buildAssignedWallet();

      // Act
      const error = captureError(() => {
        wallet.assertCanSend();
      });

      // Assert — el error lleva el ESTADO, no el id: el cliente ya sabe de qué wallet habla
      // —los cinco endpoints son «lo mío»— y lo que no sabe es en qué punto está.
      expect(error).toBeInstanceOf(WalletNotActivatedError);
      expect((error as WalletNotActivatedError).status).toBe('receive-only');
    });

    it('debería lanzar WalletNotActivatedError con el estado activating en assertCanSend', () => {
      // Arrange: `WalletActivationInProgressError` es del camino de ACTIVAR, no del de enviar.
      // Aquí el cliente pregunta «¿puedo enviar?» y la respuesta es «todavía no».
      const wallet = buildActivatingWallet();

      // Act
      const error = captureError(() => {
        wallet.assertCanSend();
      });

      // Assert
      expect(error).toBeInstanceOf(WalletNotActivatedError);
      expect((error as WalletNotActivatedError).status).toBe('activating');
    });
  });

  describe('assertOwnedBy()', () => {
    it('debería aceptar en assertOwnedBy una master equivalente construida en otra instancia', () => {
      // Arrange: el caso de uso pasa el `EthereumAddress` que le devuelve el gateway, que NO es
      // la instancia con la que se asignó la wallet. Compara VALOR, no identidad.
      const wallet = buildAssignedWallet();
      const sameMasterFromElsewhere = EthereumAddress.from(MASTER.value);

      // Act + Assert — que las dos instancias sean distintas es la premisa del caso, así que se
      // afirma antes: con `sameMasterFromElsewhere === MASTER` el `not.toThrow()` sería
      // tautológico y pasaría también con una comparación por identidad.
      expect(sameMasterFromElsewhere).not.toBe(MASTER);
      expect(() => {
        wallet.assertOwnedBy(sameMasterFromElsewhere);
      }).not.toThrow();
    });

    it('debería lanzar WalletOwnerMismatchError con las dos direcciones cuando la master no coincide', () => {
      // Arrange: una rotación de la master cambia la dirección de cada índice; sin esta
      // comprobación el sistema seguiría OPERANDO direcciones que ya no controlamos (§3.1).
      const wallet = buildAssignedWallet();

      // Act
      const error = captureError(() => {
        wallet.assertOwnedBy(ROTATED_MASTER);
      });

      // Assert — las DOS direcciones, en ese orden: con una sola, el operador vería «no
      // coinciden» sin poder saber cuál de las dos rotó.
      expect(error).toBeInstanceOf(WalletOwnerMismatchError);
      const mismatch = error as WalletOwnerMismatchError;
      expect({
        walletOwnerAddress: mismatch.walletOwnerAddress,
        configuredMaster: mismatch.configuredMaster,
      }).toEqual({ walletOwnerAddress: MASTER.value, configuredMaster: ROTATED_MASTER.value });
    });
  });

  describe('rehydrate()', () => {
    it('debería reconstituir el estado y el txId guardados', () => {
      // Arrange
      const wallet = rehydrateWallet({ status: 'activating', activationTxId: TX_ID });

      // Act
      const state = { status: wallet.status, activationTxId: wallet.activationTxId };

      // Assert
      expect(state).toEqual({ status: 'activating', activationTxId: TX_ID });
    });

    it('debería conservar por separado las dos marcas y los dos actores al reconstituir', () => {
      // Arrange — dos fechas y dos actores DISTINTOS aunque el sistema real no produzca hoy esa
      // fila: es lo único que demuestra que `rehydrate` no los colapsa. Con los cuatro valores
      // iguales, una implementación que ignorase dos parámetros pasaría igual.
      const wallet = rehydrateWallet({
        status: 'active',
        activationTxId: TX_ID,
        createdAt: NOW,
        updatedAt: MUCH_LATER,
        createdBy: null,
        updatedBy: ACTOR_ID,
      });

      // Act
      const trail = {
        createdAt: wallet.createdAt,
        updatedAt: wallet.updatedAt,
        createdBy: wallet.createdBy,
        updatedBy: wallet.updatedBy,
      };

      // Assert
      expect(trail).toEqual({
        createdAt: NOW,
        updatedAt: MUCH_LATER,
        createdBy: null,
        updatedBy: ACTOR_ID,
      });
    });
  });

  describe('toSnapshot()', () => {
    it('debería exponer estado, índice, direcciones y txId en el snapshot', () => {
      // Arrange
      const wallet = buildActivatingWallet();

      // Act
      const snapshot = wallet.toSnapshot();

      // Assert — el objeto COMPLETO y no once aserciones sueltas: `toEqual` sobre el objeto
      // entero es lo único que caza un campo de MÁS, que once `expect` por separado no verían.
      // Medido añadiendo `chain: 'ETH'` al objeto que devuelve `toSnapshot()` y corriendo la
      // suite ENTERA del módulo: cae este caso y ningún otro, con el diff señalando
      // `+ "chain": "ETH"`.
      expect(snapshot).toEqual({
        id: WALLET_ID.value,
        ownerId: OWNER_ID,
        ownerAddress: MASTER.value,
        addressIndex: 7,
        address: DERIVED.value,
        status: 'activating',
        activationTxId: TX_ID.value,
        createdAt: NOW,
        updatedAt: LATER,
        createdBy: ACTOR_ID,
        updatedBy: ACTOR_ID,
      });
    });

    // A18 fotografía una wallet en `activating`, donde el txId nunca es nulo, así que la rama
    // NULA de ese campo —toda wallet recién asignada, y la curación de A8— no la fotografiaba
    // nadie. Añadido por confirmación tras verlo sobrevivir a la mutación.
    //
    // El fallo que evita: con `this._activationTxId.value` en vez de `this._activationTxId?.value`,
    // el primer consumidor que pida el snapshot de una wallet recién asignada revienta con
    // `TypeError` — y ese es el camino MÁS común del módulo, el que recorre toda wallet nueva.
    // Medido con ese mutante y la suite entera: sin este caso, `162 passed` y no cae ni uno.
    //
    // ⚠️ Reescribir la expresión no lo tapaba: con el ternario explícito el superviviente seguía,
    // solo que como `ConditionalExpression`. El hueco era del caso, no de la forma.
    it('debería exponer activationTxId nulo en el snapshot de una wallet recién asignada', () => {
      // Arrange
      const wallet = buildAssignedWallet();

      // Act
      const snapshot = wallet.toSnapshot();

      // Assert
      expect(snapshot.activationTxId).toBeNull();
      expect(snapshot.status).toBe('receive-only');
    });
  });

  describe('monotonía del estado (property-based)', () => {
    fcTest.prop([
      fc.array(fc.constantFrom<ActivationStep>('request', 'confirm'), { minLength: 1 }),
    ])(
      'debería no retroceder nunca de estado, aplique la secuencia de transiciones que se aplique',
      (steps) => {
        // Arrange
        const wallet = buildAssignedWallet();
        const ranks = [rankOf(wallet.status)];

        // Act — las transiciones ilegales LANZAN (A5, A6) y `applyStep` se las traga a
        // propósito, porque lo que la propiedad afirma es que NINGUNA secuencia —legal o no—
        // hace retroceder el estado. Qué se traga y qué no está acotado en ese helper.
        for (const step of steps) {
          applyStep(wallet, step);
          ranks.push(rankOf(wallet.status));
        }

        // Assert — el rango sale del índice en `WALLET_STATUSES`, cuyo orden fija el caso A1 de
        // `wallet-status.spec.ts`. La serie tiene que ser no decreciente.
        expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
      },
    );
  });
});

// Helpers

type ActivationStep = 'request' | 'confirm';

const buildAssignedWallet = (): Wallet =>
  Wallet.assign({
    id: WALLET_ID,
    ownerId: OWNER_ID,
    ownerAddress: MASTER,
    addressIndex: INDEX,
    address: DERIVED,
    now: NOW,
    createdBy: ACTOR_ID,
  });

const buildActivatingWallet = (): Wallet => {
  const wallet = buildAssignedWallet();
  wallet.markActivationRequested(TX_ID, LATER, ACTOR_ID);
  return wallet;
};

const buildActiveWallet = (): Wallet => {
  const wallet = buildActivatingWallet();
  wallet.confirmActivated(LATER, ACTOR_ID);
  return wallet;
};

const rehydrateWallet = (row: {
  status: WalletStatus;
  activationTxId: TransactionHash | null;
  createdAt?: Date;
  updatedAt?: Date;
  createdBy?: string | null;
  updatedBy?: string | null;
}): Wallet =>
  Wallet.rehydrate({
    id: WALLET_ID,
    ownerId: OWNER_ID,
    ownerAddress: MASTER,
    addressIndex: INDEX,
    address: DERIVED,
    status: row.status,
    activationTxId: row.activationTxId,
    createdAt: row.createdAt ?? NOW,
    updatedAt: row.updatedAt ?? NOW,
    // ⚠️ `=== undefined` y **no `??`** en los dos actores, al revés que en las dos fechas. `??`
    // dispara también con `null`, y `null` es un valor LEGAL de estas dos columnas —«no se sabe
    // quién», según `shared/domain/system-actor.ts`—, así que con `??` el `createdBy: null` que
    // A17 pasa a propósito se convertía en `ACTOR_ID` y el caso no podía pasar nunca. Medido, no
    // supuesto: con `?? ACTOR_ID` la salida era
    // `- "createdBy": null` / `+ "createdBy": "5b7c2d4e-…"`, cae **un** caso.
    // Las fechas no tienen el problema porque `Date | null` no está en la firma: ahí sí son
    // equivalentes.
    createdBy: row.createdBy === undefined ? ACTOR_ID : row.createdBy,
    updatedBy: row.updatedBy === undefined ? ACTOR_ID : row.updatedBy,
  });

const rankOf = (status: WalletStatus): number => WALLET_STATUSES.indexOf(status);

/**
 * Aplica un paso de la secuencia de P1 y **se traga SOLO los dos rechazos que la máquina de
 * estados publica para una transición ilegal** — `WalletActivationInProgressError` (A5) y
 * `WalletAlreadyActivatedError` (A6). Todo lo demás se RELANZA.
 *
 * **El fallo que evita:** un `catch {}` a secas también se tragaría un fallo real de la
 * implementación, y P1 quedaría verde afirmando nada — que es exactamente el modo en que una
 * propiedad deja de proteger sin que nadie lo note. Medido, no supuesto: inyectando
 * `throw new TypeError('boom')` como primera línea de `markActivationRequested` y corriendo solo
 * P1 con `-t 'debería no retroceder nunca de estado'`, el árbol da
 * `Tests: 1 failed, 18 skipped, 19 total` con `TypeError: boom`, mientras que sustituyendo este
 * `catch` por un `catch {}` mudo —mismo bug inyectado, misma orden— da
 * `Tests: 18 skipped, 1 passed, 19 total`. La propiedad se pondría verde sobre una entidad rota.
 *
 * Lo que NO evita, dicho para no venderlo de más: si la implementación lanzara una de esas dos
 * clases donde no toca, este helper se la tragaría igual. Quien cubre eso son A5 y A6, que
 * comprueban desde qué estado sale cada una.
 */
const applyStep = (wallet: Wallet, step: ActivationStep): void => {
  try {
    if (step === 'request') {
      wallet.markActivationRequested(TX_ID, LATER, ACTOR_ID);
    } else {
      wallet.confirmActivated(LATER, ACTOR_ID);
    }
  } catch (error) {
    const isIllegalTransition =
      error instanceof WalletActivationInProgressError ||
      error instanceof WalletAlreadyActivatedError;
    if (!isIllegalTransition) {
      throw error;
    }
  }
};
