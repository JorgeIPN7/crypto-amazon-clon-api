/**
 * Prefijo de todo actor automático. Es lo que hace que `created_by` pueda ser UNA columna
 * para personas y procesos sin ambigüedad: un id de usuario es un UUID v4, y `system:` no
 * puede serlo (un UUID no lleva `:`). Lo fija un caso del spec, no la buena intención.
 */
export const SYSTEM_ACTOR_PREFIX = 'system:';

/**
 * Catálogo de actores automáticos de la traza de auditoría.
 *
 * **Por qué existe: `null` significaba dos cosas.** Antes de este catálogo, `createdBy: null`
 * cubría a la vez «lo escribió un proceso, no una persona» y «no se sabe quién lo escribió»
 * —que es lo que legítimamente vale `null` en las filas anteriores a `AddAuditActorColumns`—.
 * Con las dos colapsadas, la pregunta que una traza existe para responder («¿quién creó esta
 * cuenta?») no tenía respuesta distinguible: un alta pública y una fila histórica sin datos se
 * leían igual.
 *
 * `null` NO desaparece, y es importante que no lo haga: sigue siendo la respuesta correcta
 * para «no se sabe». Lo que cambia es que deja de ser la respuesta para «fue el sistema»,
 * porque ahí sí se sabe — y ahora se dice cuál.
 *
 * **Son `string` sin más envoltura.** No hay VO: `AuditTrail.createdBy` es `string | null` en
 * `shared/domain/entity.base.ts`, y estos valores encajan sin ensanchar el tipo, así que
 * adoptarlos costó cero cambios de firma. Es también el motivo de que la columna sea `varchar`
 * y no `uuid`, decisión anterior a este catálogo y tomada exactamente para dejarle sitio (ver
 * la cabecera de `user.orm-entity.ts`).
 *
 * **Cómo crece:** un origen automático nuevo añade su constante aquí Y la lista cerrada del
 * spec, en el mismo cambio. Nunca se reutiliza uno existente «porque se parece»: dos orígenes
 * con el mismo nombre son otra vez dos cosas indistinguibles, que es el defecto que este
 * archivo cierra.
 */
export const SYSTEM_ACTORS = {
  /** Alta por `POST /auth/register`, que es `@Public()`: no hay token, luego no hay persona. */
  PUBLIC_REGISTRATION: `${SYSTEM_ACTOR_PREFIX}public-registration`,
  /** `pnpm seed:admin`: la cuenta administradora inicial y sus promociones posteriores. */
  ADMIN_SEED: `${SYSTEM_ACTOR_PREFIX}admin-seed`,
  /** `pnpm outbox:relay`. Reservado: hoy el relay solo marca `processed_at`, sin traza. */
  OUTBOX_RELAY: `${SYSTEM_ACTOR_PREFIX}outbox-relay`,
  /**
   * Curación perezosa de la activación de una gas pump address (`wallets`, spec §5.4): el
   * proveedor dice que la dirección ya puede enviar y nuestra fila seguía en `receive-only` o
   * `activating`, así que pasa a `active` sin que nadie lo haya pedido.
   *
   * ⚠️ **NO se atribuye al dueño que hizo la petición.** Él no activó nada: su transacción de
   * activación se perdió o la respuesta no llegó, y quien decide el cambio es la reconciliación.
   * Ponerle su id dejaría la traza afirmando que activó una wallet que ya estaba activada por un
   * intento anterior — y esa traza es lo único que queda para reconstruir qué pasó en el fallo
   * parcial que esta curación existe para tapar.
   *
   * Es el `by` que recibe `Wallet.confirmActivated(now, by)` cuando quien la llama es la
   * reconciliación, y no cuando la llama el camino normal de una activación que sí pidió alguien.
   */
  ACTIVATION_RECONCILIATION: `${SYSTEM_ACTOR_PREFIX}activation-reconciliation`,
} as const;

export type SystemActor = (typeof SYSTEM_ACTORS)[keyof typeof SYSTEM_ACTORS];
