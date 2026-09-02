import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseFilters,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import type { AuthenticatedUser } from '@common/auth/authenticated-user';
import { ApiStandardErrors } from '@common/decorators/api-standard-errors.decorator';
import { Auth } from '@common/decorators/auth.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { ApiEnvelope, ApiPaginatedEnvelope } from '@common/dto/api-envelope.dto';
import { TIMESTAMP } from '@common/dto/error-example.factory';
import { ErrorResponseDto, ValidationErrorResponseDto } from '@common/dto/error-response.dto';
import { errorExample, requestMeta } from '@common/dto/openapi-example.helpers';
import { PaginatedResponseDto } from '@common/dto/paginated-response.dto';
import { PaginationDto } from '@common/dto/pagination.dto';
import type { WalletsConfig } from '@config/wallets.config';

import { ActivateWalletUseCase } from '../../application/use-cases/activate-wallet.use-case';
import { AssignWalletUseCase } from '../../application/use-cases/assign-wallet.use-case';
import { FindWalletByOwnerUseCase } from '../../application/use-cases/find-wallet-by-owner.use-case';
import { ListWalletTransfersUseCase } from '../../application/use-cases/list-wallet-transfers.use-case';
import { TransferAssetUseCase } from '../../application/use-cases/transfer-asset.use-case';

import { TransferFromWalletDto } from './dto/transfer-from-wallet.dto';
import { WalletResponseDto } from './dto/wallet-response.dto';
import { WalletTransferResponseDto } from './dto/wallet-transfer-response.dto';
import { WalletsDomainExceptionFilter } from './wallets-domain-exception.filter';

const COLLECTION_PATH = '/api/v1/wallets';
const ME_PATH = `${COLLECTION_PATH}/me`;
const ACTIVATION_PATH = `${ME_PATH}/activation`;
const TRANSFERS_PATH = `${ME_PATH}/transfers`;

const OWNER_ID_EXAMPLE = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const TX_ID_EXAMPLE = '0xc83f8818db43d9ba4accfe454aa44fc33123d47a4f89d47b314d6748eb0e9bc9';

/**
 * ⚠️ Los `message` de los ejemplos son lo ÚNICO que ningún guardián compara con la realidad: el
 * del contrato verifica las claves, el `error` derivado del status y el esquema; el de runtime
 * valida la respuesta real contra el esquema, no contra el texto. Estos cuatro reproducen los
 * mensajes FIJOS de `domain/errors/wallet.errors.ts` —`AdminUsesMasterAddressError`,
 * `WalletActivationInProgressError`, `WalletNotActivatedError` y `WalletNotFoundError`—, así que
 * hay que cotejarlos a mano con ese archivo cada vez que se toque cualquiera de los dos.
 *
 * Cotejados el 2026-08-31 uno a uno contra `wallet.errors.ts` (líneas 124-171). Los cuatro
 * borradores del plan decían otra cosa —«The admin account owns the master address and cannot use
 * a derived one», «An activation is already in flight for this wallet», «The wallet cannot send
 * yet: its status is receive-only» y «No wallet is assigned to owner …»— y ninguno existe en el
 * árbol: son exactamente la clase de ficción que este JSDoc avisa de que nada pone en rojo.
 *
 * ⚠️ `WALLET_NOT_ACTIVATED_EXAMPLE` lleva el estado ENTRECOMILLADO porque el mensaje interpola
 * `"${status}"` con comillas dobles dentro, y `receive-only` porque es el estado con el que un
 * cliente choca de verdad al intentar enviar sin haber activado. `WALLET_NOT_FOUND_EXAMPLE`
 * interpola el mismo `OWNER_ID_EXAMPLE` que publica el resto del documento.
 */
const ADMIN_USES_MASTER_EXAMPLE =
  'The admin operates the master address and has no gas pump wallet';
const ACTIVATION_IN_PROGRESS_EXAMPLE = 'Wallet already has an activation in progress';
const WALLET_NOT_ACTIVATED_EXAMPLE = 'Wallet cannot send funds yet: its status is "receive-only"';
const WALLET_NOT_FOUND_EXAMPLE = `Wallet for owner ${OWNER_ID_EXAMPLE} was not found`;

/**
 * Los dos mensajes FIJOS del proveedor, copiados de `wallets-domain-exception.filter.ts`, que es
 * quien los escribe (`PROVIDER_UNREACHABLE` y `PROVIDER_UNAVAILABLE`). No se importan de allí
 * porque allí son constantes privadas del módulo; se cotejan a mano igual que los cuatro de
 * arriba, y también se cotejaron el 2026-08-31.
 */
const PROVIDER_UNREACHABLE_EXAMPLE =
  'The custodial provider did not answer; the result of the operation is unknown';
const PROVIDER_UNAVAILABLE_EXAMPLE = 'The custodial provider integration is unavailable';

const WALLET_EXAMPLE = {
  kind: 'custodial',
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  ownerId: OWNER_ID_EXAMPLE,
  address: '0x687422eea2cb73b5d3e242ba5456b782919afc85',
  index: 7,
  status: 'receive-only',
  activationTxId: null,
} as const;

const MASTER_EXAMPLE = {
  ...WALLET_EXAMPLE,
  kind: 'master',
  id: null,
  address: '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed',
  index: null,
  status: 'active',
} as const;

const TRANSFER_EXAMPLE = {
  id: 'a3f1c2d4-5b6e-4f7a-8c9d-0e1f2a3b4c5d',
  ownerId: OWNER_ID_EXAMPLE,
  from: WALLET_EXAMPLE.address,
  recipient: '0xe242ba5456b782919afc85687422eea2cb73b5d3',
  kind: 'native',
  tokenAddress: null,
  amount: '100000',
  tokenId: null,
  status: 'submitted',
  txId: TX_ID_EXAMPLE,
  reason: null,
  createdAt: TIMESTAMP,
} as const;

/**
 * Adaptador de entrada del contexto. El dueño sale SIEMPRE del `sub` del token y jamás del
 * cuerpo: ninguno de los cinco endpoints declara un campo de dueño, así que
 * `forbidNonWhitelisted` rechaza al que lo mande. El rol viaja igual, desde el `role` del token.
 *
 * ⚠️ **Aquí no hay ninguna barrera al rol admin, y es deliberado.** La regla no es «este usuario
 * no puede», es «el sistema tiene UNA sola EOA y es la del admin» (§3.1.1): una invariante de
 * negocio, que por tanto sostienen los casos de uso. `AssignWalletUseCase`,
 * `ActivateWalletUseCase` y `TransferAssetUseCase` reciben `ownerRole` y lanzan
 * `AdminUsesMasterAddressError`, que el filtro de este contexto traduce a 409 — y lo lanzan
 * ANTES de llamar al proveedor, que es lo que evita gastar créditos y quemar gas para acabar
 * rechazando.
 *
 * `GET /wallets/me` no lanza nada: `FindWalletByOwnerUseCase` devuelve `null` y este controlador
 * compone la respuesta con `kind: 'master'` y la dirección de la configuración. Un 404 sería
 * mentira a medias, porque el admin tiene dirección y es la que sostiene todo el gas del sistema.
 *
 * ⚠️ **`@UseFilters` va en CUATRO handlers y no en la clase, y esa es la decisión que
 * `wallets-domain-exception.filter.ts` delega por escrito en este archivo.** El fallback de ese
 * filtro es un 400 —`DomainExceptionFilter` termina en `new BadRequestException(exception.message)`—
 * y seis errores del dominio caen ahí a propósito, porque en los cuatro endpoints con entrada del
 * cliente son entrada del cliente. En `GET /wallets/me/transfers` NO lo son: ese endpoint no
 * recibe ni un campo de activo, así que los únicos errores de esa familia que puede producir
 * vienen de una fila NUESTRA. Con el filtro puesto saldrían como 400 —culpando al cliente de
 * nuestros datos— y, peor, quedarían fuera del `ErrorReporter`, que solo mira 5xx.
 * Medido, no supuesto: `grep -rn "fromParts" src/modules/wallets/infrastructure/persistence/`
 * devuelve CUATRO líneas y las cuatro en `wallet-transfer.mapper.ts` —tres son prosa de su propio
 * JSDoc y la única llamada es la 74, dentro de `toDomain`—, y el único camino de lectura que la
 * alcanza es `WalletTransferTypeOrmRepository.findByOwner`, que solo llama este listado; `save()`
 * usa `toPersistence`, que no construye ningún activo. Sin el filtro, esos errores llegan a
 * `AllExceptionsFilter` y salen 500, que es la verdad.
 * ⚠️ El precio: **un sexto endpoint no hereda nada** y tiene que declarar el decorador. No hay
 * guardián que lo cace: el documento publica 400 y 500 en este listado —el 400 por la paginación—
 * así que `openapi-contract.e2e-spec.ts` queda verde con cualquiera de los dos repartos. Eso es
 * una lectura de sus reglas y NO una medición contra el guardián. Quien sí lo fija es el bloque
 * «alcance de WalletsDomainExceptionFilter» de la spec de este archivo, que además comprueba que
 * la clase NO lo declara: sin ese tercer caso, subirlos a la clase dejaría el bloque verde y sin
 * medir nada. Medido con las dos sondas: subir los cuatro decoradores a la clase pone rojos DOS
 * casos —«…los cuatro handlers…» y «…en la CLASE…»—, y añadir el decorador al listado pone rojo
 * UNO, el de `listTransfers`.
 *
 * **El 502 y el 503 que este archivo publica ya están contrastados contra el filtro.**
 * `VERIFIED_ERROR_STATUSES`, en `src/common/dto/error-example.factory.ts`, los incluye desde que
 * `error-example.factory.spec.ts` los pasó por `AllExceptionsFilter` con una `BadGatewayException`
 * y una `ServiceUnavailableException` reales; el guardián del contrato exige que todo status de
 * error publicado esté en ese conjunto, así que los seis ejemplos afectados —502 y 503 en asignar,
 * activar y transferir— ya no son hallazgos. Los dos siguen la regla canónica y NO traen un
 * `body.error` propio, que era el hecho a comprobar y no a suponer: medido metiendo
 * `502: 'BadGatewayException'` en `NON_CANONICAL_ERRORS`, que pone rojo UN caso de los diez de esa
 * spec, el del 502, con `error: "Bad Gateway"` frente a lo documentado.
 * El resto de las reglas del guardián ya pasaba antes. Medido con una sonda fuera de
 * `src/` que genera el documento solo con este controlador —el generador de `@nestjs/swagger`
 * sobre un módulo de test con los cinco casos de uso doblados; fuera de `src/` porque
 * `openapi-document.spec.ts` prohíbe un segundo generador dentro, y este comentario ya lo puso
 * rojo una vez por nombrar el método— y le pasa las reglas que no necesitan PostgreSQL (400 solo con
 * entrada, 429, 500, summary/description, parámetros con descripción y ejemplo, ejemplo en cada
 * respuesta con cuerpo, claves de `ErrorPayload`, `error` derivado del status, y los ejemplos
 * contra su propio esquema con el mismo Ajv 2020-12): cero hallazgos salvo esos seis.
 *
 * **Desde el 2026-08-31 el cableado existe y el guardián de verdad ya los ha visto.**
 * `wallets.module.ts` declara este controlador y `AppModule` importa `WalletsModule`, así que los
 * cinco endpoints entran en el documento que recorre `openapi-contract.e2e-spec.ts`. Ese guardián
 * recorre las operaciones DENTRO de cada caso, así que su cuenta de casos no se mueve al añadirlas
 * —19 antes y 19 después, medido quitando `WalletsModule` de `app.module.ts` y volviendo a
 * correrlo—: lo que cambia es lo que cada caso mira. Sale verde con `assignWallet`, `findMyWallet`,
 * `activateMyWallet`, `transferFromMyWallet` y `listMyWalletTransfers` dentro, o sea que las reglas
 * que la sonda anticipó las confirma ahora el documento real.
 *
 * ⚠️ Lo que ese guardián NO mira es la RESPUESTA: eso es
 * `openapi-runtime-contract.e2e-spec.ts`, cuyo caso «debería ejercitar todas las operaciones que el
 * documento publica» estuvo ROJO desde el cableado, con exactamente estas cinco rutas en el
 * `Received` (`POST /wallets`, `GET /wallets/me`, `POST /wallets/me/activation`,
 * `POST /wallets/me/transfers`, `GET /wallets/me/transfers`) y el resto de sus 16 casos en verde —
 * medido—. Ese precio es deliberado y lo pagan los cinco escenarios que ese archivo ya tiene: uno
 * por operación, cada uno con su montaje y con el proveedor doblado por el stub de loopback.
 *
 * Los ejemplos de las direcciones van en MINÚSCULAS a propósito. Una dirección con mayúsculas y
 * minúsculas mezcladas solo es válida si su checksum EIP-55 cuadra, y **aquí no se ha calculado
 * ninguno a mano**: un ejemplo con el checksum mal saldría publicado como cuerpo correcto y sería
 * un 400 para quien lo copiara.
 */
@ApiTags('Wallets')
@Controller('wallets')
export class WalletsController {
  private readonly masterAddress: string;

  constructor(
    private readonly assignWallet: AssignWalletUseCase,
    private readonly findWalletByOwner: FindWalletByOwnerUseCase,
    private readonly activateWallet: ActivateWalletUseCase,
    private readonly transferAsset: TransferAssetUseCase,
    private readonly listWalletTransfers: ListWalletTransfersUseCase,
    configService: ConfigService,
  ) {
    this.masterAddress = configService.getOrThrow<WalletsConfig>('wallets').masterAddress;
  }

  @Auth()
  @Post()
  @UseFilters(WalletsDomainExceptionFilter)
  // 200 y no 201: la segunda llamada NO crea nada, y publicar 201 en un endpoint que la mitad de
  // las veces no crea es la clase de ficción que el guardián del contrato existe para impedir.
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'assignWallet',
    summary: 'Asigna al usuario autenticado una dirección Ethereum custodiada',
    description:
      'Reserva un índice y deriva bajo la master una gas pump address para el usuario del ' +
      'token. Es idempotente: si el usuario ya tiene dirección, devuelve la misma sin gastar ' +
      'créditos del proveedor ni consumir otro índice. La dirección nace en `receive-only`: ya ' +
      'puede RECIBIR fondos, pero para enviar hay que activarla. El rol admin recibe 409, ' +
      'porque su dirección es la master y darle además una derivada le dejaría dos.',
  })
  @ApiEnvelope(WalletResponseDto, {
    description: 'Dirección custodiada del usuario, recién asignada o ya existente.',
    example: { success: true, data: WALLET_EXAMPLE, request: requestMeta(COLLECTION_PATH) },
  })
  @ApiConflictResponse({
    description: 'El rol admin ya tiene la master: no se le asigna una dirección derivada.',
    type: ErrorResponseDto,
    example: errorExample(409, ADMIN_USES_MASTER_EXAMPLE, COLLECTION_PATH),
  })
  @ApiForbiddenResponse({
    description: 'El usuario del token ya no existe o está inactivo.',
    type: ErrorResponseDto,
    example: errorExample(403, 'Forbidden', COLLECTION_PATH),
  })
  @ApiBadGatewayResponse({
    description:
      'El proveedor no respondió, respondió algo que no cumple su propio esquema, o expiró el ' +
      'tiempo de espera. Derivar no toca la cadena, así que reintentar es seguro.',
    type: ErrorResponseDto,
    example: errorExample(502, PROVIDER_UNREACHABLE_EXAMPLE, COLLECTION_PATH),
  })
  @ApiServiceUnavailableResponse({
    description:
      'La integración con el proveedor está caída por causa nuestra: clave de API inválida, ' +
      'plan caducado o cuerpo mal construido. No es un fallo de la petición del cliente.',
    type: ErrorResponseDto,
    example: errorExample(503, PROVIDER_UNAVAILABLE_EXAMPLE, COLLECTION_PATH),
  })
  @ApiStandardErrors()
  async assign(@CurrentUser() user: AuthenticatedUser): Promise<WalletResponseDto> {
    const wallet = await this.assignWallet.execute({ ownerId: user.sub, ownerRole: user.role });
    return WalletResponseDto.fromDomain(wallet);
  }

  @Auth()
  @Get('me')
  @UseFilters(WalletsDomainExceptionFilter)
  @ApiOperation({
    operationId: 'findMyWallet',
    summary: 'Devuelve la dirección del usuario autenticado',
    description:
      'Lee la dirección asignada sin llamar al proveedor. ⚠️ Por eso el `status` puede ir por ' +
      'detrás de la cadena: una activación confirmada hace minutos puede seguir apareciendo ' +
      'como `activating` aquí. Para conocerlo con certeza, llama al endpoint de activación, que ' +
      'sí reconcilia contra el proveedor. Al rol admin le responde su master, con ' +
      '`kind: "master"` e `index` nulo: sí tiene dirección, y es la que paga el gas de todos.',
  })
  @ApiEnvelope(WalletResponseDto, {
    description: 'Dirección del usuario, custodiada o master según el rol.',
    example: { success: true, data: MASTER_EXAMPLE, request: requestMeta(ME_PATH) },
  })
  @ApiNotFoundResponse({
    description: 'El usuario todavía no ha pedido su dirección con POST /wallets.',
    type: ErrorResponseDto,
    example: errorExample(404, WALLET_NOT_FOUND_EXAMPLE, ME_PATH),
  })
  @ApiStandardErrors()
  async findMine(@CurrentUser() user: AuthenticatedUser): Promise<WalletResponseDto> {
    const wallet = await this.findWalletByOwner.execute({
      ownerId: user.sub,
      ownerRole: user.role,
    });

    // `null` es la respuesta del caso de uso para quien no tiene fila en `wallets` y sí tiene
    // dirección: el admin. La master sale de la configuración porque no está en ninguna tabla.
    return wallet === null
      ? WalletResponseDto.forMaster(user.sub, this.masterAddress)
      : WalletResponseDto.fromDomain(wallet);
  }

  @Auth()
  @Post('me/activation')
  @UseFilters(WalletsDomainExceptionFilter)
  // 202 y no 200: la transacción de activación está ENVIADA, no minada. Prometer 200 sería
  // afirmar que al volver la dirección ya puede enviar, y no es verdad.
  @HttpCode(HttpStatus.ACCEPTED)
  // Límite propio, más estricto que el global: cada llamada gasta créditos del proveedor y QUEMA
  // GAS de la master, así que el techo real no es la CPU sino el saldo. 10/min es el mismo que
  // llevan los dos endpoints de `auth`, y `ThrottlerGuard` cuenta por clase Y handler, así que
  // activar y transferir tienen contadores separados.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    operationId: 'activateMyWallet',
    summary: 'Activa la dirección del usuario para poder enviar',
    description:
      'Pregunta primero al proveedor si la dirección ya puede enviar —y si puede, se limita a ' +
      'reconciliar nuestro estado— y, si no, envía la transacción de activación pagando el gas ' +
      'con la master. Responde 202 con la wallet en `activating`: la transacción está enviada, ' +
      'no minada. Repetir la llamada sobre una activación en curso responde 409, no repite el ' +
      'envío: activar dos veces quema el gas dos veces y el proveedor lo acepta sin quejarse.',
  })
  @ApiEnvelope(WalletResponseDto, {
    status: HttpStatus.ACCEPTED,
    description: 'Activación enviada, o estado reconciliado si la cadena ya la tenía activa.',
    example: {
      success: true,
      data: { ...WALLET_EXAMPLE, status: 'activating', activationTxId: TX_ID_EXAMPLE },
      request: requestMeta(ACTIVATION_PATH),
    },
  })
  @ApiConflictResponse({
    description:
      'Hay una activación en curso, la dirección ya está activa, o el rol admin ha pedido ' +
      'activar una master que no lo necesita.',
    type: ErrorResponseDto,
    example: errorExample(409, ACTIVATION_IN_PROGRESS_EXAMPLE, ACTIVATION_PATH),
  })
  @ApiForbiddenResponse({
    description: 'El usuario del token ya no existe o está inactivo.',
    type: ErrorResponseDto,
    example: errorExample(403, 'Forbidden', ACTIVATION_PATH),
  })
  @ApiNotFoundResponse({
    description: 'El usuario todavía no ha pedido su dirección con POST /wallets.',
    type: ErrorResponseDto,
    example: errorExample(404, WALLET_NOT_FOUND_EXAMPLE, ACTIVATION_PATH),
  })
  @ApiBadGatewayResponse({
    description:
      'El proveedor no respondió o su respuesta no cumple su esquema. ⚠️ Un timeout NO ' +
      'significa que no se ejecutara: la activación pudo enviarse igualmente.',
    type: ErrorResponseDto,
    example: errorExample(502, PROVIDER_UNREACHABLE_EXAMPLE, ACTIVATION_PATH),
  })
  @ApiServiceUnavailableResponse({
    description: 'La integración con el proveedor está caída por causa nuestra.',
    type: ErrorResponseDto,
    example: errorExample(503, PROVIDER_UNAVAILABLE_EXAMPLE, ACTIVATION_PATH),
  })
  @ApiStandardErrors()
  async activate(@CurrentUser() user: AuthenticatedUser): Promise<WalletResponseDto> {
    const wallet = await this.activateWallet.execute({ ownerId: user.sub, ownerRole: user.role });
    return WalletResponseDto.fromDomain(wallet);
  }

  @Auth()
  @Post('me/transfers')
  @UseFilters(WalletsDomainExceptionFilter)
  @HttpCode(HttpStatus.OK)
  // Mismo motivo y mismo límite que en la activación: créditos del proveedor y gas de la master
  // por llamada.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    operationId: 'transferFromMyWallet',
    summary: 'Envía un activo desde la dirección del usuario',
    description:
      'Envía moneda nativa, un token fungible, un NFT o un multi-token desde la dirección ' +
      'custodiada del usuario. El origen es SIEMPRE su dirección: la master firma y paga el ' +
      'gas, no envía. La fila del libro se escribe ANTES de llamar al proveedor, así que un ' +
      'timeout deja rastro con estado `unknown` en vez de desaparecer. La dirección debe estar ' +
      'activa (409 si no lo está) y el destinatario con checksum EIP-55 correcto si viene con ' +
      'la caja mezclada.',
  })
  // El contract guard NO valida los examples de request contra el schema: completos a mano.
  @ApiBody({
    type: TransferFromWalletDto,
    examples: {
      native: {
        summary: 'Moneda nativa: solo importe',
        value: {
          recipient: '0xe242ba5456b782919afc85687422eea2cb73b5d3',
          kind: 'native',
          amount: '1000000000000000000',
        },
      },
      nft: {
        summary: 'NFT: token e identificador, nunca importe',
        value: {
          recipient: '0xe242ba5456b782919afc85687422eea2cb73b5d3',
          kind: 'nft',
          tokenAddress: '0x782919afc85eea2cb736874225456bb5d3e242ba',
          tokenId: '100000',
        },
      },
      multiToken: {
        // La clave del ejemplo es un identificador y va en camelCase; el VALOR publicado lleva
        // guion, `multi-token`, que es la única grafía del vocabulario.
        summary: 'Multi-token: token, importe e identificador, los tres',
        value: {
          recipient: '0xe242ba5456b782919afc85687422eea2cb73b5d3',
          kind: 'multi-token',
          tokenAddress: '0x782919afc85eea2cb736874225456bb5d3e242ba',
          amount: '5',
          tokenId: '100000',
        },
      },
    },
  })
  @ApiEnvelope(WalletTransferResponseDto, {
    description: 'Fila del libro con lo que sabemos del envío.',
    example: { success: true, data: TRANSFER_EXAMPLE, request: requestMeta(TRANSFERS_PATH) },
  })
  // El límite que publica el ⚠️ de abajo no es una observación nueva: lo midió `tatum-http.client.ts`
  // y vive en el JSDoc de su `translateStatus`. ⚠️ **Es la MITAD que queda de `docs/backlog.md` #10**:
  // la otra —el 403, que publicaba una precondición de negocio como caída de la integración— se
  // cerró el 2026-09-02 y hoy sale como el 409 de aquí abajo. Se publica aquí porque este es el
  // único endpoint donde el cliente lo ve.
  @ApiBadRequestResponse({
    description:
      'El cuerpo no supera la validación de entrada, el dominio rechaza la combinación de ' +
      'campos para esa clase de activo, o el proveedor rechazó el cuerpo. ⚠️ Límite reconocido: ' +
      'el `errorCode` de su 400 es el mismo (`validation.failed`) cuando el destinatario es ' +
      'inválido —culpa del cliente— y cuando la master no tiene fondos —culpa nuestra—, así que ' +
      'algunos 503 salen hoy como 400.',
    type: ValidationErrorResponseDto,
    example: errorExample(
      400,
      'recipient must be an Ethereum address with a valid EIP-55 checksum',
      TRANSFERS_PATH,
    ),
  })
  @ApiConflictResponse({
    description:
      'La dirección todavía no está activa, el rol admin ha intentado enviar desde la master, o ' +
      'la cadena revirtió la operación. ⚠️ Este último caso NO es un fallo de la integración: la ' +
      'transacción no se minó y la fila del libro queda en `rejected`. La reversión que hemos ' +
      'observado es una dirección sin saldo suficiente, pero el proveedor no desglosa el motivo, ' +
      'así que la respuesta solo afirma lo que se sabe.',
    type: ErrorResponseDto,
    example: errorExample(409, WALLET_NOT_ACTIVATED_EXAMPLE, TRANSFERS_PATH),
  })
  @ApiForbiddenResponse({
    description: 'El usuario del token ya no existe o está inactivo.',
    type: ErrorResponseDto,
    example: errorExample(403, 'Forbidden', TRANSFERS_PATH),
  })
  @ApiNotFoundResponse({
    description: 'El usuario todavía no ha pedido su dirección con POST /wallets.',
    type: ErrorResponseDto,
    example: errorExample(404, WALLET_NOT_FOUND_EXAMPLE, TRANSFERS_PATH),
  })
  @ApiBadGatewayResponse({
    description:
      'El proveedor no respondió o su respuesta no cumple su esquema. ⚠️ El envío **pudo ' +
      'minarse o no**: la fila del libro queda en `unknown`, que es literalmente lo que sabemos.',
    type: ErrorResponseDto,
    example: errorExample(502, PROVIDER_UNREACHABLE_EXAMPLE, TRANSFERS_PATH),
  })
  @ApiServiceUnavailableResponse({
    description: 'La integración con el proveedor está caída por causa nuestra.',
    type: ErrorResponseDto,
    example: errorExample(503, PROVIDER_UNAVAILABLE_EXAMPLE, TRANSFERS_PATH),
  })
  @ApiStandardErrors()
  async transfer(
    @Body() dto: TransferFromWalletDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WalletTransferResponseDto> {
    // Partes primitivas, no un `TransferAsset`: el dominio construye el activo (§5.3) y la clase
    // viaja como `string` para que una desconocida muera en el dominio con un 400 con nombre.
    const transfer = await this.transferAsset.execute({
      ownerId: user.sub,
      ownerRole: user.role,
      recipient: dto.recipient,
      asset: {
        kind: dto.kind,
        tokenAddress: dto.tokenAddress,
        amount: dto.amount,
        tokenId: dto.tokenId,
      },
    });
    return WalletTransferResponseDto.fromDomain(transfer);
  }

  // ⚠️ **El único de los cinco SIN `@UseFilters`**, y no es un olvido: el JSDoc de la clase lo
  // razona y lo mide. Aquí no entra ni un campo de activo, así que un error de la familia que el
  // filtro publica como 400 solo puede venir de una fila nuestra y tiene que salir 500.
  @Auth()
  @Get('me/transfers')
  @ApiOperation({
    operationId: 'listMyWalletTransfers',
    summary: 'Lista el libro de transferencias del usuario, paginado',
    description:
      'Devuelve las transferencias del usuario del token, de la más reciente a la más antigua. ' +
      'No llama al proveedor: publica lo que el libro sabe. ⚠️ Una fila en `unknown` significa ' +
      'que el envío pudo minarse o no, y este ciclo no consulta la cadena para resolverlo. Al ' +
      'rol admin que nunca fue un usuario normal recibe una página vacía: la master no envía por ' +
      'gas pump, y el filtro es por el `sub` del token, no por el rol.',
  })
  @ApiPaginatedEnvelope(WalletTransferResponseDto, {
    description: 'Página del libro de transferencias.',
    example: {
      success: true,
      data: {
        items: [TRANSFER_EXAMPLE],
        meta: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      },
      request: requestMeta(TRANSFERS_PATH),
    },
  })
  @ApiBadRequestResponse({
    description: 'La paginación no supera la validación de entrada.',
    type: ValidationErrorResponseDto,
    example: errorExample(
      400,
      'page must not be less than 1, limit must not be greater than 100',
      `${TRANSFERS_PATH}?page=0&limit=101`,
    ),
  })
  @ApiStandardErrors()
  async listTransfers(
    @CurrentUser() user: AuthenticatedUser,
    @Query() pagination: PaginationDto,
  ): Promise<PaginatedResponseDto<WalletTransferResponseDto>> {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;

    // `page`/`limit` y no `skip`/`take` (§5 del spec): la aritmética del desplazamiento vive en
    // el caso de uso, que es quien conoce el orden con el que se lee el libro. Y sin `ownerRole`:
    // este es el único de los cinco cuya entrada no lo lleva, porque al admin le basta el filtro
    // por dueño para recibir la página vacía que le corresponde.
    const result = await this.listWalletTransfers.execute({ ownerId: user.sub, page, limit });

    return PaginatedResponseDto.of(
      result.items.map((transfer) => WalletTransferResponseDto.fromDomain(transfer)),
      result.total,
      page,
      limit,
    );
  }
}
