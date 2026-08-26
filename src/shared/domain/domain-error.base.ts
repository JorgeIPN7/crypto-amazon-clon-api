/**
 * Raíz de los errores de negocio de TODOS los contextos. Son de dominio, no de transporte:
 * no heredan de `HttpException` ni conocen códigos HTTP — traducirlos es tarea del filtro
 * del módulo, en `infrastructure/http/`.
 *
 * Cada contexto declara su propio marcador abstracto (`UserDomainError`,
 * `AuthDomainError`, `OrderDomainError`) que hereda de aquí. Compartir abuelo NO ensancha
 * el `instanceof`: `@Catch(UserDomainError)` sigue sin ver un error de `auth`, porque los
 * marcadores siguen siendo clases distintas. Es el caso A4 de la tabla, y está probado.
 *
 * ⚠️ **No añadas un `static [Symbol.hasInstance]` aquí ni en ningún marcador.** Los miembros
 * estáticos se heredan por la cadena estática de prototipos, así que uno solo en esta clase
 * lo heredarían los tres marcadores sin declarar el suyo, e `instanceof` dejaría de mirar la
 * cadena real: un error de `auth` pasaría el `@Catch(UserDomainError)` de `users`. Rompe A4
 * **en silencio** —A1, A2, A3 y A5 siguen verdes— y ninguna corrida de mutación lo
 * detectaría jamás, porque los mutadores de Stryker mutan código existente y no pueden
 * AÑADIR un miembro estático. Medido, no supuesto: con ese método puesto,
 * `OtherConcreteError instanceof MarkerA` pasa de `false` a `true`.
 *
 * `new.target.name` y no `this.constructor.name`: es la clase invocada con `new`, así que
 * devuelve el nombre CONCRETO por muchos niveles que tenga la cadena. `name` viaja a los
 * logs, y ahí lo útil es `EmailAlreadyTakenError`, no `DomainError`.
 */
export abstract class DomainError extends Error {
  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
