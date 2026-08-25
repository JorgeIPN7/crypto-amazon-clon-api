import { DefaultNamingStrategy, type NamingStrategyInterface } from 'typeorm';

/**
 * `camelCase` → `snake_case`, en dos pasadas y no en una.
 *
 * La primera separa una minúscula o un dígito de la mayúscula que le sigue (`createdAt` →
 * `created_At`). La segunda separa un acrónimo de la palabra que arranca detrás
 * (`HTTPStatusCode` → `HTTP_StatusCode`), que la primera NO puede ver porque delante de la `S`
 * no hay minúscula. Sin la segunda, `HTTPStatusCode` daría `httpstatus_code`.
 *
 * El dígito va en la PRIMERA clase de caracteres a propósito: así `auth0Id` da `auth0_id` y no
 * `auth_0_id`. Es el nombre real de una columna de `bridge-fital-pti-api`, y con el corte de más
 * no habría casado con su tabla.
 *
 * Es idempotente —`toSnakeCase(toSnakeCase(x)) === toSnakeCase(x)`, fijado por una propiedad—,
 * y eso es lo que hace segura la convivencia con los `name:` explícitos que quedan en el árbol.
 */
export const toSnakeCase = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();

/**
 * Estrategia de nombres de TypeORM: toda columna nace en `snake_case` sin que nadie escriba
 * `name:`.
 *
 * **Qué problema cierra.** Sin estrategia, TypeORM usa el nombre de la propiedad tal cual, así
 * que `createdAt` nacía como `"createdAt"` —entre comillas y en camel— salvo que alguien
 * recordara el `name:`. Eso ya pasó: hasta el 2026-08-24 el esquema mezclaba las dos
 * convenciones, y `auth_credentials` llegaba a mezclarlas DENTRO DE LA MISMA TABLA (`user_id` y
 * `password_hash` en snake junto a `"createdAt"` en camel). Se arregló reescribiendo migraciones,
 * que solo fue barato porque no había datos ni despliegue. Esta estrategia es lo que impide que
 * vuelva a pasar, y por eso entra ahora y no cuando duela.
 *
 * **Extiende `DefaultNamingStrategy` en vez de implementar la interfaz a pelo.** Son ~25 métodos
 * (índices, claves foráneas, tablas de unión, chequeos, exclusiones…) y solo dos nos importan.
 * Implementar la interfaz obligaría a escribir los otros veintitrés, y cada uno sería una
 * oportunidad de divergir del comportamiento que TypeORM espera.
 *
 * **`name` explícito siempre gana, y no se convierte.** Es lo que permite adoptarla sin tocar
 * nada: los `name:` que hoy están en las ORM entities siguen mandando y quitarlos no cambia el
 * resultado —verificado con `migration:generate`, que no encuentra diferencias—. También es el
 * escape para una columna heredada cuyo nombre no siga la convención.
 *
 * ⚠️ **`@Entity({ name })` NO es opcional en este repo.** Sin él, `UserOrmEntity` daría
 * `user_orm_entity`: la estrategia no sabe que `OrmEntity` es decoración nuestra. Lo fija un
 * caso del spec para que quede escrito y no se descubra al crear la quinta tabla.
 */
export class SnakeNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  override tableName(className: string, customName: string | undefined): string {
    return customName ?? toSnakeCase(className);
  }

  override columnName(
    propertyName: string,
    customName: string | undefined,
    embeddedPrefixes: string[],
  ): string {
    const prefix = embeddedPrefixes.map(toSnakeCase).join('_');
    const own = customName ?? toSnakeCase(propertyName);
    return prefix ? `${prefix}_${own}` : own;
  }
}
