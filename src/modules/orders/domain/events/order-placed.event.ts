/**
 * Evento de dominio. Clase plana con datos primitivos (más `Date`, que serializa a ISO en
 * JSON): el payload viaja tal cual a la fila del outbox, sin mapper intermedio.
 */
export class OrderPlaced {
  constructor(
    readonly orderId: string,
    readonly customerId: string,
    readonly amountCents: number,
    readonly occurredAt: Date,
  ) {}
}
