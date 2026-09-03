import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { TransferFromWalletDto } from '../../../../infrastructure/http/dto/transfer-from-wallet.dto';

const RECIPIENT = '0xe242ba5456b782919afc85687422eea2cb73b5d3';
const CONTRACT = '0x782919afc85eea2cb736874225456bb5d3e242ba';

/**
 * La forma canónica EIP-55 de `CONTRACT` con su PRIMERA mayúscula bajada de caja. Se escribe
 * derivada y no a ojo porque un literal inventado podría ser canónico por casualidad y el caso
 * pasaría sin comprobar nada. La canónica es `0x782919aFc85eEA2cb736874225456bB5d3E242bA`.
 */
const CONTRACT_BAD_CHECKSUM = '0x782919afc85eEA2cb736874225456bB5d3E242bA';

/** Las mismas opciones del `ValidationPipe` global de `main.ts`: sin ellas esto no mide lo real. */
const PIPE_OPTIONS = { whitelist: true, forbidNonWhitelisted: true, stopAtFirstError: false };

describe('TransferFromWalletDto', () => {
  it('debería aceptar un envío nativo con destinatario e importe', () => {
    // Arrange
    const body = { recipient: RECIPIENT, kind: 'native', amount: '1000000000000000000' };

    // Act
    const errors = validate(body);

    // Assert
    expect(errors).toEqual([]);
  });

  it('debería aceptar un envío fungible con dirección de token e importe', () => {
    // Arrange
    const body = {
      recipient: RECIPIENT,
      kind: 'fungible',
      tokenAddress: CONTRACT,
      amount: '100000',
    };

    // Act
    const errors = validate(body);

    // Assert
    expect(errors).toEqual([]);
  });

  it('debería aceptar un NFT con dirección de token e identificador de token', () => {
    // Arrange
    const body = { recipient: RECIPIENT, kind: 'nft', tokenAddress: CONTRACT, tokenId: '0' };

    // Act
    const errors = validate(body);

    // Assert
    expect(errors).toEqual([]);
  });

  it('debería aceptar un multi-token con token, importe e identificador', () => {
    // Arrange
    // El literal publicado lleva GUION: `multi-token`. Es la misma cadena en el dominio, en el
    // mapper, en la columna `asset_kind` y aquí; la única forma camelCase del vocabulario es la
    // clave `multiToken` del matcher de `TransferAsset`, que es un identificador de TypeScript
    // y no un valor del contrato.
    const body = {
      recipient: RECIPIENT,
      kind: 'multi-token',
      tokenAddress: CONTRACT,
      amount: '5',
      tokenId: '3',
    };

    // Act
    const errors = validate(body);

    // Assert
    expect(errors).toEqual([]);
  });

  it('debería exigir el importe en un envío nativo', () => {
    // Arrange
    const body = { recipient: RECIPIENT, kind: 'native' };

    // Act
    const errors = validate(body);

    // Assert
    expect(errors.map((error) => error.property)).toEqual(['amount']);
  });

  it('debería exigir la dirección del token y el identificador en un NFT', () => {
    // Arrange
    const body = { recipient: RECIPIENT, kind: 'nft' };

    // Act
    const errors = validate(body);

    // Assert
    expect(errors.map((error) => error.property).sort()).toEqual(['tokenAddress', 'tokenId']);
  });

  it('debería rechazar una clase de activo que no está en la lista publicada', () => {
    // Arrange
    const body = { recipient: RECIPIENT, kind: 'erc-4337', amount: '1' };

    // Act
    const errors = validate(body);

    // Assert
    expect(errors.map((error) => error.property)).toContain('kind');
  });

  it('debería rechazar multitoken sin guion, que no es el vocabulario publicado', () => {
    // Arrange
    // La grafía sin guion no existe en ninguna capa. Este caso la fija en el borde para que un
    // cliente que la escriba reciba un 400 con nombre en vez de llegar al dominio con una clase
    // que ninguna rama del matcher conoce.
    const body = { recipient: RECIPIENT, kind: 'multitoken', tokenAddress: CONTRACT, amount: '5' };

    // Act
    const errors = validate(body);

    // Assert
    expect(errors.map((error) => error.property)).toContain('kind');
  });

  it('debería rechazar un destinatario cuyo checksum EIP-55 no cuadra', () => {
    // Arrange
    // Un solo carácter de caja cambiada respecto de la forma canónica: la clase de fallo por la
    // que existe el validador, porque el activo se iría a una dirección que no es de nadie.
    const body = {
      recipient: '0x5aaeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
      kind: 'native',
      amount: '1',
    };

    // Act
    const errors = validate(body);

    // Assert
    expect(errors.map((error) => error.property)).toEqual(['recipient']);
  });

  it('debería rechazar una dirección de token cuyo checksum EIP-55 no cuadra', () => {
    // Arrange
    // ⚠️ Caso AÑADIDO fuera del borrador del plan, y con motivo medido: sin él, quitar
    // `@IsChecksummedAddress()` de `tokenAddress` deja la suite entera en verde (73/73). El
    // destinatario sí tenía su caso; el contrato del token no, y un contrato con un carácter
    // cambiado manda el envío a una dirección que no implementa nada.
    const body = {
      recipient: RECIPIENT,
      kind: 'fungible',
      tokenAddress: CONTRACT_BAD_CHECKSUM,
      amount: '1',
    };

    // Act
    const errors = validate(body);

    // Assert
    expect(errors.map((error) => error.property)).toEqual(['tokenAddress']);
  });

  it.each([
    ['con ceros a la izquierda', '01'],
    ['con signo', '-1'],
    ['con parte decimal', '1.5'],
    ['que no es un número', 'siete'],
  ])('debería rechazar un identificador de token %s', (_caso, tokenId) => {
    // Arrange
    // Caso AÑADIDO por lo mismo: relajar `TOKEN_ID_SHAPE` a `/^.*$/` no tumbaba ni un caso. El
    // `'0'` sí se acepta —el token cero existe— y eso ya estaba cubierto; lo que faltaba era la
    // otra mitad, que es la que sostiene la forma.
    const body = { recipient: RECIPIENT, kind: 'nft', tokenAddress: CONTRACT, tokenId };

    // Act
    const errors = validate(body);

    // Assert
    expect(errors.map((error) => error.property)).toEqual(['tokenId']);
  });

  it('debería rechazar un importe más largo que el máximo declarado', () => {
    // Arrange
    // ⚠️ 80 nueves: satisface `AMOUNT_SHAPE` de sobra —empieza por `9`—, así que el ÚNICO
    // validador que puede tumbarlo es `@MaxLength(79)`. Con un valor que también rompiera la
    // forma, el caso pasaría igual sin el `@MaxLength` y no mediría nada.
    const body = { recipient: RECIPIENT, kind: 'native', amount: '9'.repeat(80) };

    // Act
    const errors = validate(body);

    // Assert
    expect(errors.map((error) => error.property)).toEqual(['amount']);
  });

  it('debería rechazar un identificador de token más largo que el máximo declarado', () => {
    // Arrange
    // 79 nueves, mismo razonamiento: la forma la cumple y solo `@MaxLength(78)` lo rechaza.
    const body = {
      recipient: RECIPIENT,
      kind: 'nft',
      tokenAddress: CONTRACT,
      tokenId: '9'.repeat(79),
    };

    // Act
    const errors = validate(body);

    // Assert
    expect(errors.map((error) => error.property)).toEqual(['tokenId']);
  });

  it.each([
    ['con signo', '+1'],
    ['sin parte entera', '.5'],
    ['sin parte decimal', '1.'],
    ['con ceros a la izquierda', '007'],
    ['que no es un número', 'mucho'],
  ])('debería rechazar un importe %s', (_caso, amount) => {
    // Arrange
    const body = { recipient: RECIPIENT, kind: 'native', amount };

    // Act
    const errors = validate(body);

    // Assert
    expect(errors.map((error) => error.property)).toEqual(['amount']);
  });

  it('debería rechazar un importe como número, que un token de 18 decimales no soporta', () => {
    // Arrange
    const body = { recipient: RECIPIENT, kind: 'native', amount: 1 };

    // Act
    const errors = validate(body);

    // Assert
    expect(errors.map((error) => error.property)).toEqual(['amount']);
  });

  it('debería aceptar un cuerpo con un campo cuya condición es falsa, que el dominio rechazará', () => {
    // Arrange
    // ⚠️ El caso que documenta la laguna a propósito: `@ValidateIf` hace OBLIGATORIO, no
    // PROHIBIDO. Un campo DECLARADO en el DTO no lo rechaza `forbidNonWhitelisted` aunque su
    // condición sea falsa, así que este cuerpo pasa el transporte y muere en `TransferAsset` con
    // `AssetFieldNotAllowedError` → 400 por el fallback del filtro. Quien «arregle» esta
    // aparente laguna metiendo la exclusividad en `class-validator` estará duplicando una
    // invariante de negocio en el transporte, donde nadie la puede sostener.
    const body = { recipient: RECIPIENT, kind: 'native', amount: '1', tokenId: '7' };

    // Act
    const errors = validate(body);

    // Assert
    expect(errors).toEqual([]);
  });

  it('debería rechazar un campo que el DTO no declara', () => {
    // Arrange
    // La otra mitad, para que la de arriba no se lea como «el DTO no rechaza nada»: lo NO
    // declarado sí lo rechaza `forbidNonWhitelisted`.
    const body = { recipient: RECIPIENT, kind: 'native', amount: '1', fromPrivateKey: '0xdead' };

    // Act
    const errors = validate(body);

    // Assert
    expect(errors.map((error) => error.property)).toEqual(['fromPrivateKey']);
  });
});

// Helpers

const validate = (body: object) =>
  validateSync(plainToInstance(TransferFromWalletDto, body), PIPE_OPTIONS);
