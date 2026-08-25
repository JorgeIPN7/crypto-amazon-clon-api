import type { UuidId } from './uuid-id.base';

/**
 * Traza de auditoría de una entidad: cuándo nació, cuándo se tocó por última vez, y QUIÉN hizo
 * cada una de las dos cosas.
 *
 * ⚠️ **La fase anterior predijo mal el coste del crecimiento y conviene corregirlo aquí, no
 * borrarlo.** Decía: «cada campo nuevo cambia la aridad del constructor de `Entity` y la de los
 * constructores de los tres agregados que lo llaman; agrupada, esas cuatro firmas se quedan como
 * están». Medido al añadir `createdBy`/`updatedBy`: la de `Entity` sí se quedó como estaba (dos
 * parámetros), pero las de los tres agregados NO — pasaron a recibir la `AuditTrail` entera en
 * vez de las dos fechas sueltas, y con ello `User` bajó de 7 parámetros a 6, `Credential` de 5 a
 * 4 y `Order` de 7 a 6. Lo que el agrupamiento ahorra es UNA firma, la de la base; las de los
 * agregados cambian igual, y la elección real era «crecen a 9 posicionales» o «reciben el
 * objeto». Se eligió el objeto.
 *
 * Lo que sí se cumplió tal cual: los sitios que CONSTRUYEN la traza —`create`, `rehydrate`,
 * `place`, sus mappers— tienen que aportar los campos nuevos, porque `AuditTrail` no tiene
 * opcionales. El cambio no es gratis, es acotado.
 *
 * **`createdBy`/`updatedBy` son `string | null`, NO un value object de identidad.** Mismo
 * criterio ya escrito y medido en `Order.customerId` y en `Credential.userId`: el identificador
 * del actor pertenece a `users`, y ni `auth` ni `orders` ni este kernel pueden importar `UserId`
 * sin romper la regla 3 del gate de boundaries — `shared/` menos que nadie, porque no importa
 * NADA de `src/modules/`. Copiar aquí esa invariante la duplicaría sin poder mantenerla
 * sincronizada.
 *
 * **`null` significa EL SISTEMA, no «se me olvidó».** Hay escrituras sin actor humano y son
 * legítimas: el seed del primer admin (`src/database/seeds/seed-admin.ts`, que corre por CLI), el
 * relay del outbox (`src/database/outbox/relay-orders-outbox.ts`) y el alta pública de
 * `POST /auth/register`, donde quien firma la petición todavía no es nadie. No hay centinela
 * `'system'`: una cadena mágica colisionaría el día que exista una cuenta de servicio con id
 * propio, y `NULL` es además lo que la columna guarda sin ayuda de nadie.
 *
 * La traza va SEPARADA del estado de negocio y en un campo privado (ver `Entity`), no dentro de
 * un objeto `props` común con el resto: un mutador que pudiera escribir la traza a mano se
 * saltaría `touch()`, que es justo la puerta por la que debe pasar.
 *
 * Los cuatro campos son `readonly`, pero el `readonly` de TypeScript se borra al compilar y no
 * protege en ejecución. Las garantías reales son tres, y hacen falta las tres porque tapan
 * agujeros distintos:
 *
 *   1. **Copiar al construir** (C12) cierra la ENTRADA: sin la copia, quien pasó el objeto sigue
 *      teniendo mando sobre el agregado.
 *   2. **Reemplazar al tocar** (C13) cierra la escritura en sitio, que dejaría cambiar bajo los
 *      pies la traza que otro ya tiene en la mano.
 *   3. **`Object.freeze` + copiar los `Date`** (ver `sealAudit`) cierra la SALIDA. Las dos
 *      mitades se añadieron después de MEDIR que faltaban, en dos rondas:
 *        - El getter `audit` devuelve la referencia interna, así que sin congelar bastaba
 *          `(entity.audit as { updatedAt: Date }).updatedAt = otra` para mover el sello.
 *        - Y **congelar no basta**: `Object.freeze` no protege un `Date`, cuyo valor vive en un
 *          slot interno y no en una propiedad. Con el objeto ya congelado,
 *          `entity.audit.updatedAt.setUTCFullYear(2099)` seguía moviendo el sello, y quien
 *          construyó la entidad conservaba la misma instancia. Ambos caminos verificados
 *          ejecutándolos; los cierra la copia, no el congelado.
 *
 * ⚠️ Consecuencia para los tests: las marcas que salen de la entidad **no son las instancias que
 * entraron**. Las aserciones sobre fechas comparan valor (`toEqual`), no identidad (`toBe`). El
 * `toBe` sigue siendo correcto sobre el OBJETO `audit` —es lo que C13 usa para comprobar que
 * `touch` lo reemplaza en vez de mutarlo—, nunca sobre las fechas de dentro.
 */
export type AuditTrail = {
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly createdBy: string | null;
  readonly updatedBy: string | null;
};

/**
 * Base de las entidades: identidad, traza de auditoría e igualdad. Sin `props`, sin factorías
 * genéricas, sin eventos — eso lo añade `AggregateRoot`, que extiende de aquí.
 *
 * Conviene distinguir qué es extracción y qué es capacidad nueva, porque no es lo mismo:
 *   - `id`, `createdAt`, `updatedAt` y el patrón de mutación SÍ estaban duplicados en las tres
 *     entidades. Aquí se consolidan.
 *   - `equals()` es **nuevo**. Ninguna de las tres lo tenía. Se añade por paridad con
 *     `ValueObject.equals` y porque la igualdad por identidad es parte de la definición del
 *     patrón Entity, no un extra; y de paso fija por test el defecto medido en el kernel que
 *     sirvió de referencia, donde `equals` compara solo el id y dos agregados de tipos
 *     distintos con el mismo UUID salen «iguales».
 *
 * `id` sigue siendo una parameter property pública y de solo lectura: no cambia en la vida de la
 * entidad. La traza, en cambio, vive ENTERA dentro de `_audit` —las dos fechas y los dos
 * actores—, aunque solo la mitad «updated» se reescriba. Agruparla es lo que deja que crezca sin
 * tocar esta firma (y solo esta: ver el aviso medido en `AuditTrail`).
 *
 * `_audit` es **`private`, no `protected`**: con `protected`, cualquier subclase podría escribir
 * `this._audit = {…}` y colocar el `updatedAt` que quisiera sin pasar por `touch()`. Lo comprueba
 * el compilador —hay un `@ts-expect-error` apuntando a ese asignamiento en `entity.base.spec.ts`—,
 * no un caso de la tabla: `pnpm test` no verifica tipos.
 *
 * ⚠️ Es barrera de **compilación**, igual que el `readonly`: un `as unknown as { _audit: … }`
 * la salta en ejecución. No se pretende otra cosa. Lo que sí se sostiene en ejecución es el
 * `Object.freeze` de más abajo, que protege la traza ya publicada aunque alguien fuerce el tipo.
 *
 * `{ ...audit }` en el constructor **no es una copia defensiva de cortesía, es necesaria**: sin
 * ella la entidad guarda el mismo objeto que sigue en manos de quien la construyó, y mutarlo
 * desde fuera mueve el `updatedAt` del agregado. Caso C12.
 *
 * `touch()` REEMPLAZA la traza en vez de escribir dentro de ella por el mismo motivo, visto
 * desde el otro lado: la traza que ya salió por el getter `audit` no debe cambiar bajo los pies
 * de quien la tiene. Caso C13.
 *
 * `TId extends UuidId` y no `ValueObject<unknown>`: todos los ids del repo son UUID, y el
 * bound estrecho evita depender de la bivarianza de métodos de TypeScript para que la
 * asignación compile. Se generaliza el día que exista un id que no sea UUID, no antes.
 *
 * `touch(now, by)` RECIBE el instante y el actor, nunca llama a `new Date()` ni sale a buscar
 * quién está autenticado. Es divergencia deliberada con el kernel que sirvió de referencia: aquí
 * el dominio no lee el reloj —lo inyecta el caso de uso—, y un `touch()` que lo leyera obligaría
 * a fake timers para testear cualquier mutador. Con el actor el argumento es aún más fuerte:
 * leerlo aquí exigiría que `shared/domain` conociera el request scope de Nest, que es
 * exactamente lo que la regla de dependencias prohíbe.
 *
 * El kernel tampoco legisla sobre los valores: `touch` no rechaza un `now` anterior ni un `by`
 * nulo, porque el reloj y el actor los controla quien los inyecta (decisión de la fase de
 * contrato, Tabla C). `by` es obligatorio y no opcional a propósito — con `by?: string | null`
 * un mutador que se olvidara de propagarlo compilaría y dejaría el `updatedBy` anterior en pie,
 * afirmando que el último que tocó la fila fue alguien que no la tocó.
 *
 * `equals()` compara la CLASE antes que el id. Sin esa comprobación, dos agregados distintos
 * que compartieran UUID serían «iguales» — el defecto exacto que tiene el kernel de
 * referencia. El criterio (`constructor !==`, no `instanceof`) es el mismo que ya usa
 * `ValueObject.equals`: coherencia dentro del kernel.
 */
export abstract class Entity<TId extends UuidId> {
  private _audit: AuditTrail;

  protected constructor(
    readonly id: TId,
    audit: AuditTrail,
  ) {
    this._audit = Entity.sealAudit(audit);
  }

  /**
   * Congela la traza **y copia sus `Date`**. Las dos mitades hacen falta y tapan agujeros
   * distintos:
   *
   *   - `Object.freeze` impide añadir, quitar o reasignar campos del objeto.
   *   - `new Date(...)` corta el hilo con las instancias del llamante. **`Object.freeze` NO
   *     protege un `Date`**: su valor vive en un slot interno, no en una propiedad, así que
   *     `setUTCFullYear` lo mueve igual sobre un objeto congelado. Medido — y sin la copia había
   *     dos caminos abiertos para saltarse `touch()` por completo: el `Date` que conserva quien
   *     construyó la entidad, y el que el getter `audit` publica.
   */
  private static sealAudit(audit: AuditTrail): AuditTrail {
    return Object.freeze({
      createdAt: new Date(audit.createdAt),
      updatedAt: new Date(audit.updatedAt),
      createdBy: audit.createdBy,
      updatedBy: audit.updatedBy,
    });
  }

  get audit(): AuditTrail {
    return this._audit;
  }

  get createdAt(): Date {
    return this._audit.createdAt;
  }

  get updatedAt(): Date {
    return this._audit.updatedAt;
  }

  get createdBy(): string | null {
    return this._audit.createdBy;
  }

  get updatedBy(): string | null {
    return this._audit.updatedBy;
  }

  protected touch(now: Date, by: string | null): void {
    this._audit = Entity.sealAudit({ ...this._audit, updatedAt: now, updatedBy: by });
  }

  equals(other: Entity<TId> | null | undefined): boolean {
    if (other === null || other === undefined) {
      return false;
    }
    if (other.constructor !== this.constructor) {
      return false;
    }
    return this.id.equals(other.id);
  }
}
