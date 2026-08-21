import { ApiProperty } from '@nestjs/swagger';

import {
  modelPropertiesOf,
  type ModelPropertyEntry,
} from '@common/__tests__/helpers/swagger-metadata';

import { UserResponseDto } from '@modules/users/infrastructure/http/dto/user-response.dto';

import { AuthenticatedUserDto } from '../../../../infrastructure/http/dto/authenticated-user.dto';

/**
 * Sello de paridad entre los DOS DTO gemelos del repo.
 *
 * `AuthenticatedUserDto` (auth) y `UserResponseDto` (users) publican el mismo objeto en el
 * contrato HTTP —el usuario— desde contextos distintos, porque ninguno puede importar el DTO
 * del otro (regla 3 del gate de boundaries). Esa duplicación es correcta por arquitectura y
 * peligrosa por mantenimiento: nada impide que una gane un campo y la otra no, y el cliente
 * vería dos formas distintas del mismo concepto según el endpoint.
 *
 * Este spec cierra ese hueco comparando la metadata REAL de `@ApiProperty` de ambas clases.
 * El import cruzado a `@modules/users` es legal aquí y solo aquí: los tests están exentos de
 * la matriz de boundaries (`boundaries/ignore`), y es el mismo precedente que
 * `current-user.decorator.spec.ts`.
 */
describe('AuthenticatedUserDto', () => {
  it('debería declarar exactamente los mismos campos que UserResponseDto', () => {
    // Arrange
    const auth = modelPropertiesOf(AuthenticatedUserDto);
    const users = modelPropertiesOf(UserResponseDto);

    // Act
    const authFields = Object.keys(auth).sort();
    const usersFields = Object.keys(users).sort();

    // Assert
    expect(authFields).toEqual(usersFields);
    // Guarda contra el falso verde: si la lectura de metadata dejara de funcionar, ambos
    // serían `[]` y la comparación de arriba pasaría sin comprobar nada.
    expect(authFields).toEqual(['active', 'createdAt', 'email', 'id', 'name', 'role', 'updatedAt']);
  });

  // El texto se quedó corto a propósito y no se toca: lo que compara ya no son tres claves
  // sino la metadata ENTERA salvo `type`. Ver `publishedDivergences()` al pie del archivo.
  it('debería publicar la misma description, example y format en cada campo', () => {
    // Arrange
    const auth = modelPropertiesOf(AuthenticatedUserDto);
    const users = modelPropertiesOf(UserResponseDto);

    // Act
    const divergences = Object.keys(users).flatMap((field) =>
      publishedDivergences(auth[field], users[field]).map((key) => `${field}.${key}`),
    );

    // Assert
    expect(divergences).toEqual([]);
  });

  /**
   * El caso que demuestra que el sello muerde, convertido en test permanente.
   *
   * Medido con mutantes sobre la versión anterior del comparador —lista blanca de cuatro
   * claves—: `phone` de más en un DTO daba 2 rojos (bien), pero `maxLength: 254` en uno solo
   * daba 4 VERDES, y `required: false, nullable: true` en uno solo, otros 4 verdes. Las tres
   * llegan a `components.schemas`, así que el contrato publicado divergía y nadie se enteraba.
   *
   * Sin este caso, alguien puede volver a estrechar el comparador a cuatro claves y la suite
   * seguiría verde: los dos DTO reales coinciden, y un comparador que no mira nada también
   * dice que coinciden.
   */
  it('debería detectar divergencias en claves que van al schema pero no dan nombre al caso anterior', () => {
    // Arrange
    class WithConstraints {
      @ApiProperty({ description: 'Correo.', maxLength: 254, required: false, nullable: true })
      email!: string;
    }
    class WithoutConstraints {
      @ApiProperty({ description: 'Correo.' })
      email!: string;
    }
    const left = modelPropertiesOf(WithConstraints);
    const right = modelPropertiesOf(WithoutConstraints);

    // Act
    const divergences = publishedDivergences(left.email, right.email);

    // Assert
    expect(divergences).toEqual(['maxLength', 'nullable', 'required']);
  });

  /**
   * `UserResponseDto` deriva el enum de `USER_ROLES`, la constante del dominio de users, que
   * `auth` no puede importar y por eso escribe a mano. Esta comparación es lo que convierte
   * esa copia en algo verificado: añadir un rol en users y no aquí rompe el gate.
   */
  it('debería publicar los mismos valores de rol que la constante del dominio de users', () => {
    // Arrange
    const auth = modelPropertiesOf(AuthenticatedUserDto);
    const users = modelPropertiesOf(UserResponseDto);

    // Act
    const authRoles = auth.role?.enum;
    const usersRoles = users.role?.enum;

    // Assert
    expect(authRoles).toEqual(usersRoles);
    expect(authRoles).toEqual(['admin', 'user']);
  });

  describe('fromDirectory()', () => {
    it('debería mapear campo a campo sin filtrar nada del directorio', () => {
      // Arrange
      const now = new Date('2026-08-07T10:00:00.000Z');

      // Act
      const dto = AuthenticatedUserDto.fromDirectory({
        id: '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012',
        email: 'maria@example.com',
        name: 'María González',
        role: 'user',
        active: true,
        createdAt: now,
        updatedAt: now,
      });

      // Assert
      expect({ ...dto }).toEqual({
        id: '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012',
        email: 'maria@example.com',
        name: 'María González',
        role: 'user',
        active: true,
        createdAt: now,
        updatedAt: now,
      });
    });
  });
});

// Helpers

/**
 * `type` es la ÚNICA clave exenta, y por un motivo que no vale para ninguna otra: no la
 * escribe el autor sino `createPropertyDecorator`, que la rellena con el `design:type` cuando
 * el `@ApiProperty` no la trae. Hoy coincide —`role!: string` en auth y `role!: UserRole` en
 * users se borran los dos a `String`—, pero una divergencia de tipo TypeScript no es una
 * divergencia de contrato, y comparar el constructor pondría roja una diferencia que el
 * cliente no ve.
 *
 * Es una lista negra deliberada, no una blanca. La versión anterior comparaba cuatro claves
 * elegidas a mano (`description`, `example`, `format`, `enum`) y todo lo demás pasaba: una
 * clave que llegue a `components.schemas` y no esté en esas cuatro divergía en silencio. La
 * dirección importa — con lista negra, una opción nueva de `@ApiProperty` entra comparada por
 * defecto y hay que decidir explícitamente eximirla.
 */
const EXEMPT_KEYS = new Set(['type']);

/**
 * Los nombres de las claves en las que dos entradas de metadata difieren, ya ordenados. Se
 * devuelven las claves y no un booleano para que el fallo diga QUÉ divergió: con `[]` como
 * expectativa, Jest imprime la lista entera.
 */
const publishedDivergences = (
  a: ModelPropertyEntry | undefined,
  b: ModelPropertyEntry | undefined,
): string[] =>
  [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])]
    .filter((key) => !EXEMPT_KEYS.has(key))
    .filter((key) => stableJson(a?.[key]) !== stableJson(b?.[key]))
    .sort();

/**
 * `JSON.stringify` a secas no sirve como comparación: devuelve `undefined` para una función,
 * así que dos `type` distintos (o dos `items.type` anidados) darían "iguales". El replacer las
 * baja a su nombre, y el `?? 'undefined'` distingue "clave ausente" de la cadena `"undefined"`.
 */
const stableJson = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'function' ? `[Function ${item.name}]` : item,
  ) ?? 'undefined';
