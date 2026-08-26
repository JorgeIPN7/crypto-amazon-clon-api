import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Añade el actor a la traza de auditoría: dos columnas por tabla —quién creó la fila y quién la
 * actualizó por última vez— en las tres tablas que tienen agregado detrás (`users`,
 * `auth_credentials`, `orders`). `orders_outbox` NO entra: sus filas no son un agregado, no
 * heredan de `Entity` y su única escritura posterior la hace el relay, que no tiene actor.
 *
 * **Es puramente ADITIVA, y por eso NO va partida en expand/contract.** La regla de `CLAUDE.md`
 * («Destructive migrations: expand/contract») acota su propio alcance en la primera línea: aplica
 * a lo que TIRA o RENOMBRA una columna o una tabla. Aquí no se toca nada existente:
 *
 *   - Las seis columnas son `NULL`ables y sin `DEFAULT`. El código antiguo no las nombra en sus
 *     `INSERT` —TypeORM enumera columna a columna, nunca `INSERT ... VALUES` posicional sobre
 *     toda la tabla—, así que sus filas entran con `NULL` y ninguna restricción las rechaza. Es
 *     exactamente el reverso del `DROP NOT NULL` obligatorio en un expand: allí hay que aflojar
 *     una restricción que el código nuevo dejaría de satisfacer; aquí no se crea ninguna.
 *   - Los `SELECT` del código antiguo tampoco se rompen: TypeORM enumera las columnas que su
 *     entidad conoce, así que una columna que no conoce simplemente no aparece en la lista.
 *
 * Consecuencia operativa: es segura con `DB_MIGRATIONS_RUN=true`, es decir corriendo en el
 * arranque del primer pod nuevo mientras todas las réplicas viejas siguen sirviendo tráfico. No
 * hay ventana que gestionar ni segunda release que planificar.
 *
 * **Sin `DEFAULT` a propósito.** Un `DEFAULT 'system'` rellenaría el pasado con una afirmación
 * falsa: de las filas que ya existen no se sabe quién las escribió, y `NULL` es la única
 * respuesta honesta. El dominio lee ese `NULL` como «el sistema / sin actor» (ver `AuditTrail` en
 * `src/shared/domain/entity.base.ts`), que es también lo que escriben el seed del admin y el alta
 * pública.
 *
 * **Las seis columnas van en snake_case, en las tres tablas.** No siempre fue así: hasta el
 * 2026-08-24 esta migración las creaba siguiendo la convención de cada tabla —camel en `users` y
 * `auth_credentials`, snake en `orders`— porque el esquema mezclaba ambas y unificar aquí habría
 * dejado `created_by` al lado de `"createdAt"` en la misma fila. Se unificó el esquema entero
 * reescribiendo las migraciones, algo barato solo mientras no hubiera datos ni despliegue.
 *
 * Comprobado con `pnpm migration:generate` tras aplicarla: TypeORM no encuentra diferencias entre
 * las entidades y el esquema, que es la prueba de que los seis nombres son los que el ORM espera.
 *
 * `character varying` sin longitud y no `uuid`: el actor es `string | null` en el dominio, y una
 * columna `uuid` obligaría a que cualquier cuenta de servicio futura tuviera forma de UUID. La
 * columna es más permisiva que el dato — el lado seguro del error.
 */
export class AddAuditActorColumns1787654321000 implements MigrationInterface {
  name = 'AddAuditActorColumns1787654321000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "created_by" character varying, ADD "updated_by" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_credentials" ADD "created_by" character varying, ADD "updated_by" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD "created_by" character varying, ADD "updated_by" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Sin cualificar el schema, como todas las migraciones del repo: ambos sentidos heredan el
    // `search_path` de la conexión (lección de `create-users-table`).
    //
    // ⚠️ Este `down()` SÍ es destructivo —tira columnas con datos— y eso no contradice que el
    // `up()` sea aditivo: revertir siempre lo es. Se ejecuta a mano con `pnpm migration:revert`,
    // nunca en el arranque de un pod, y a cambio deja el esquema exactamente como estaba.
    await queryRunner.query(
      `ALTER TABLE "orders" DROP COLUMN "updated_by", DROP COLUMN "created_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_credentials" DROP COLUMN "updated_by", DROP COLUMN "created_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "updated_by", DROP COLUMN "created_by"`,
    );
  }
}
