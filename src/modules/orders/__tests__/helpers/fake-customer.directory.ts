import type { CustomerDirectory } from '../../domain/ports/customer.directory';

/** Directorio de mentira: conoce los ids con los que se construye y registra las consultas. */
export class FakeCustomerDirectory implements CustomerDirectory {
  readonly existsCalls: string[] = [];

  constructor(private readonly knownIds: readonly string[] = []) {}

  exists(customerId: string): Promise<boolean> {
    this.existsCalls.push(customerId);
    return Promise.resolve(this.knownIds.includes(customerId));
  }
}
