import type { ConfigService } from '@nestjs/config';

import { PaginationDto } from '@common/dto/pagination.dto';

import type { ActivateWalletUseCase } from '../../../application/use-cases/activate-wallet.use-case';
import type { AssignWalletUseCase } from '../../../application/use-cases/assign-wallet.use-case';
import type { FindWalletByOwnerUseCase } from '../../../application/use-cases/find-wallet-by-owner.use-case';
import type { ListWalletTransfersUseCase } from '../../../application/use-cases/list-wallet-transfers.use-case';
import type { TransferAssetUseCase } from '../../../application/use-cases/transfer-asset.use-case';
import { WalletsController } from '../../../infrastructure/http/wallets.controller';
import { WalletsDomainExceptionFilter } from '../../../infrastructure/http/wallets-domain-exception.filter';
import { buildTransfer } from '../../helpers/wallet-transfer.factory';
import { buildWallet } from '../../helpers/wallet.factory';

const OWNER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const MASTER = '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed';
const DERIVED = '0x687422eea2cb73b5d3e242ba5456b782919afc85';
const RECIPIENT = '0xe242ba5456b782919afc85687422eea2cb73b5d3';

const USER = { sub: OWNER_ID, email: 'maria.gonzalez@empresa.com.mx', role: 'user' };
const ADMIN = { sub: OWNER_ID, email: 'admin@empresa.com.mx', role: 'admin' };

describe('WalletsController', () => {
  describe('assign()', () => {
    it('debería asignar la wallet con el ownerId y el rol del token, nunca del cuerpo', async () => {
      // Arrange
      const assign = jest
        .fn()
        .mockResolvedValue(buildWallet({ ownerId: OWNER_ID, address: DERIVED }));
      const controller = buildController({ assign });

      // Act
      const result = await controller.assign(USER);

      // Assert
      expect(assign).toHaveBeenCalledWith({ ownerId: OWNER_ID, ownerRole: 'user' });
      expect(result.address).toBe(DERIVED);
      expect(result.kind).toBe('custodial');
    });

    it('debería pasar el rol admin al caso de uso, que es quien decide el 409', async () => {
      // Arrange
      // ⚠️ La barrera NO vive aquí: la invariante «el sistema tiene UNA sola EOA y es la del
      // admin» (§3.1.1) es de negocio, y `AssignWalletUseCase` la sostiene lanzando
      // `AdminUsesMasterAddressError`, que el filtro traduce a 409. El controlador solo transporta
      // el rol; duplicar el corte aquí sería mantener la misma regla en dos sitios.
      const assign = jest.fn().mockRejectedValue(new Error('el caso de uso decide'));
      const controller = buildController({ assign });

      // Act + Assert
      await expect(controller.assign(ADMIN)).rejects.toThrow('el caso de uso decide');
      expect(assign).toHaveBeenCalledWith({ ownerId: OWNER_ID, ownerRole: 'admin' });
    });
  });

  describe('findMine()', () => {
    it('debería devolver la wallet custodiada del usuario', async () => {
      // Arrange
      const find = jest
        .fn()
        .mockResolvedValue(buildWallet({ ownerId: OWNER_ID, address: DERIVED }));
      const controller = buildController({ find });

      // Act
      const result = await controller.findMine(USER);

      // Assert
      expect(find).toHaveBeenCalledWith({ ownerId: OWNER_ID, ownerRole: 'user' });
      expect(result).toMatchObject({ kind: 'custodial', address: DERIVED });
    });

    it('debería componer la master con kind master e index nulo cuando la lectura devuelve null', async () => {
      // Arrange
      // Un 404 aquí sería mentira a medias: el admin SÍ tiene dirección, y es la que sostiene el
      // gas de todo el sistema. El caso de uso devuelve `null` porque la master no tiene fila; la
      // dirección la pone la configuración, no la tabla.
      const find = jest.fn().mockResolvedValue(null);
      const controller = buildController({ find });

      // Act
      const result = await controller.findMine(ADMIN);

      // Assert
      expect(find).toHaveBeenCalledWith({ ownerId: OWNER_ID, ownerRole: 'admin' });
      expect(result).toMatchObject({ kind: 'master', address: MASTER, index: null, id: null });
    });
  });

  describe('activate()', () => {
    it('debería activar la wallet del dueño del token pasando su rol', async () => {
      // Arrange
      const activate = jest
        .fn()
        .mockResolvedValue(buildWallet({ ownerId: OWNER_ID, address: DERIVED }));
      const controller = buildController({ activate });

      // Act
      const result = await controller.activate(USER);

      // Assert
      expect(activate).toHaveBeenCalledWith({ ownerId: OWNER_ID, ownerRole: 'user' });
      expect(result.address).toBe(DERIVED);
    });

    it('debería pasar el rol admin al caso de uso, que es quien decide el 409', async () => {
      // Arrange
      const activate = jest.fn().mockRejectedValue(new Error('el caso de uso decide'));
      const controller = buildController({ activate });

      // Act + Assert
      await expect(controller.activate(ADMIN)).rejects.toThrow('el caso de uso decide');
      expect(activate).toHaveBeenCalledWith({ ownerId: OWNER_ID, ownerRole: 'admin' });
    });
  });

  describe('transfer()', () => {
    it('debería pasar el activo como partes primitivas al caso de uso', async () => {
      // Arrange
      // El dominio construye el activo (§5.3): el controller no importa `TransferAsset` ni
      // decide la clase. Pasar la clase como `string` es lo que hace que una clase desconocida
      // salga 400 desde el dominio y no 500 por un `switch` sin rama.
      const transfer = jest.fn().mockResolvedValue(buildTransfer({ ownerId: OWNER_ID }));
      const controller = buildController({ transfer });

      // Act
      await controller.transfer(
        { recipient: RECIPIENT, kind: 'fungible', tokenAddress: DERIVED, amount: '100000' },
        USER,
      );

      // Assert
      expect(transfer).toHaveBeenCalledWith({
        ownerId: OWNER_ID,
        ownerRole: 'user',
        recipient: RECIPIENT,
        asset: {
          kind: 'fungible',
          tokenAddress: DERIVED,
          amount: '100000',
          tokenId: undefined,
        },
      });
    });

    it('debería pasar el rol admin al caso de uso, que es quien decide el 409', async () => {
      // Arrange
      const transfer = jest.fn().mockRejectedValue(new Error('el caso de uso decide'));
      const controller = buildController({ transfer });

      // Act + Assert
      await expect(
        controller.transfer({ recipient: RECIPIENT, kind: 'native', amount: '1' }, ADMIN),
      ).rejects.toThrow('el caso de uso decide');
      expect(transfer).toHaveBeenCalledWith({
        ownerId: OWNER_ID,
        ownerRole: 'admin',
        recipient: RECIPIENT,
        asset: { kind: 'native', tokenAddress: undefined, amount: '1', tokenId: undefined },
      });
    });

    it('debería exponer solo los campos del DTO, nunca la entidad', async () => {
      // Arrange
      const transfer = jest.fn().mockResolvedValue(buildTransfer({ ownerId: OWNER_ID }));
      const controller = buildController({ transfer });

      // Act
      const result = await controller.transfer(
        { recipient: RECIPIENT, kind: 'native', amount: '1' },
        USER,
      );

      // Assert
      expect(Object.keys(result).sort()).toEqual([
        'amount',
        'createdAt',
        'from',
        'id',
        'kind',
        'ownerId',
        'reason',
        'recipient',
        'status',
        'tokenAddress',
        'tokenId',
        'txId',
      ]);
    });
  });

  describe('listTransfers()', () => {
    it('debería paginar el libro con los valores por defecto cuando la query viene vacía', async () => {
      // Arrange
      const list = jest
        .fn()
        .mockResolvedValue({ items: [buildTransfer({ ownerId: OWNER_ID })], total: 1 });
      const controller = buildController({ list });

      // Act
      const result = await controller.listTransfers(USER, buildPagination());

      // Assert
      expect(list).toHaveBeenCalledWith({ ownerId: OWNER_ID, page: 1, limit: 20 });
      expect(result.meta).toMatchObject({ page: 1, limit: 20, total: 1, hasNextPage: false });
    });

    it('debería devolver una página vacía al rol admin, sin caso especial y sin pasarle el rol', async () => {
      // Arrange
      // El admin no tiene wallet custodiada, así que no tiene transferencias: la página sale
      // vacía por el propio filtro por dueño. Un `if` aquí sería lógica sin trabajo que hacer, y
      // por eso este es el único caso de uso cuya entrada no lleva `ownerRole`.
      const list = jest.fn().mockResolvedValue({ items: [], total: 0 });
      const controller = buildController({ list });

      // Act
      const result = await controller.listTransfers(ADMIN, buildPaginationOf(2, 5));

      // Assert
      expect(list).toHaveBeenCalledWith({ ownerId: OWNER_ID, page: 2, limit: 5 });
      expect(result.items).toEqual([]);
    });
  });

  /**
   * El alcance del filtro es una decisión del controlador, y este bloque es lo único que la
   * sostiene: `wallets-domain-exception.filter.ts` la delega en este archivo por escrito y el
   * documento OpenAPI no la ve —los dos desenlaces, 400 y 500, están declarados en el listado—,
   * así que ningún guardián del contrato la distingue.
   */
  describe('alcance de WalletsDomainExceptionFilter', () => {
    it('debería declarar el filtro en los cuatro handlers cuya entrada es del cliente', () => {
      // Arrange
      const handlers = ['assign', 'findMine', 'activate', 'transfer'] as const;

      // Act
      const declared = handlers.map((name) => filtersOf(WalletsController.prototype[name]));

      // Assert
      expect(declared).toEqual(handlers.map(() => [WalletsDomainExceptionFilter]));
    });

    it('debería dejar listTransfers SIN el filtro, para que una fila corrupta salga 500 y no 400', () => {
      // Arrange
      // `ListWalletTransfersUseCase` no recibe ni un campo de activo: los seis errores del
      // fallback del filtro solo pueden llegar aquí desde `WalletTransferMapper.toDomain`, o sea
      // de una FILA nuestra. Con el filtro puesto saldrían 400 —culpando al cliente— y además
      // fuera del radar del `ErrorReporter`, que solo mira 5xx.

      // Act
      const declared = filtersOf(WalletsController.prototype.listTransfers);

      // Assert
      expect(declared).toBeUndefined();
    });

    it('debería no declarar el filtro en la CLASE, que se lo pondría también al listado', () => {
      // Arrange
      // Este caso es el que hace caer al anterior si alguien «simplifica» los cuatro decoradores
      // subiéndolos a la clase: el metadato del handler seguiría vacío y el otro caso seguiría
      // verde, así que sin este el bloque entero dejaría de medir lo que dice medir.

      // Act
      const declared = filtersOf(WalletsController);

      // Assert
      expect(declared).toBeUndefined();
    });
  });
});

// Helpers

/**
 * Doble a mano de un caso de uso.
 *
 * El `as unknown as` es obligatorio, no pereza: los cinco casos de uso guardan sus puertos en
 * parameter properties `private readonly`, y TypeScript incluye los miembros privados en el tipo
 * de la clase, así que un objeto con solo `execute` no es asignable. Se comprueba quitando el
 * `as unknown` y ejecutando `pnpm typecheck`.
 */
const useCaseDouble = <T>(execute: jest.Mock): T => ({ execute }) as unknown as T;

type Doubles = {
  assign?: jest.Mock;
  find?: jest.Mock;
  activate?: jest.Mock;
  transfer?: jest.Mock;
  list?: jest.Mock;
};

const configWithMaster = (): ConfigService =>
  ({ getOrThrow: () => ({ masterAddress: MASTER }) }) as unknown as ConfigService;

const buildController = ({
  assign = jest.fn(),
  find = jest.fn(),
  activate = jest.fn(),
  transfer = jest.fn(),
  list = jest.fn(),
}: Doubles): WalletsController =>
  new WalletsController(
    useCaseDouble<AssignWalletUseCase>(assign),
    useCaseDouble<FindWalletByOwnerUseCase>(find),
    useCaseDouble<ActivateWalletUseCase>(activate),
    useCaseDouble<TransferAssetUseCase>(transfer),
    useCaseDouble<ListWalletTransfersUseCase>(list),
    configWithMaster(),
  );

/** Paginación con los defaults del DTO, tal como llega cuando no hay query string. */
const buildPagination = (): PaginationDto => new PaginationDto();

const buildPaginationOf = (page: number, limit: number): PaginationDto => {
  const dto = new PaginationDto();
  dto.page = page;
  dto.limit = limit;
  return dto;
};

/**
 * `EXCEPTION_FILTERS_METADATA` de `@nestjs/common/constants`, copiada como literal en vez de
 * importada: `eslint.config.mjs` prohíbe ese import profundo y `src/common/nest-metadata.constants.ts`
 * documenta por qué (el paquete no publica `exports`, así que el día que lo publique el import
 * muere en tiempo de ejecución con `pnpm typecheck` en verde).
 *
 * ⚠️ El riesgo de copiar una clave interna es que un renombrado la convierta en `undefined` y los
 * tres casos de arriba pasen a comprobar la nada. Aquí no puede: el primero afirma que los cuatro
 * handlers SÍ la llevan, así que un renombrado en Nest sale rojo en vez de silencioso. Medida, no
 * supuesta, leyendo la versión instalada:
 * `grep -n EXCEPTION_FILTERS_METADATA node_modules/@nestjs/common/constants.js` devuelve tres
 * líneas —el reexport de la 3, el mapa de la 31 y la declaración de la 26, que es la que importa:
 * `exports.EXCEPTION_FILTERS_METADATA = '__exceptionFilters__';`.
 */
const EXCEPTION_FILTERS_METADATA = '__exceptionFilters__';

/** Lo que `@UseFilters` escribió sobre un handler o sobre la clase. */
const filtersOf = (target: object): unknown[] | undefined =>
  Reflect.getMetadata(EXCEPTION_FILTERS_METADATA, target) as unknown[] | undefined;
