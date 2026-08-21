import { PlaceOrderUseCase } from '../../../application/use-cases/place-order.use-case';
import { CustomerGoneError } from '../../../domain/errors/order.errors';
import { OrderPlaced } from '../../../domain/events/order-placed.event';
import { FakeCustomerDirectory } from '../../helpers/fake-customer.directory';
import { InMemoryOrderRepository } from '../../helpers/in-memory-order.repository';

const CUSTOMER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';

describe('PlaceOrderUseCase', () => {
  describe('execute()', () => {
    it('debería colocar la orden cuando el cliente existe', async () => {
      // Arrange
      const { useCase, repository } = buildUseCase([CUSTOMER_ID]);

      // Act
      const order = await useCase.execute({
        customerId: CUSTOMER_ID,
        concept: 'Suscripción anual plan Pro',
        amountCents: 149_900,
      });

      // Assert
      expect(repository.saveCalls).toHaveLength(1);
      expect(repository.saveCalls[0]?.order).toBe(order);
      expect(repository.saveCalls[0]?.events).toEqual([
        new OrderPlaced(order.id.value, CUSTOMER_ID, 149_900, order.placedAt),
      ]);
    });

    it('debería rechazar cuando el cliente no existe o está inactivo', async () => {
      // Arrange: el directorio no conoce a nadie.
      const { useCase, repository } = buildUseCase([]);

      // Act + Assert
      await expect(
        useCase.execute({
          customerId: CUSTOMER_ID,
          concept: 'Suscripción anual',
          amountCents: 149_900,
        }),
      ).rejects.toThrow(CustomerGoneError);
      expect(repository.saveCalls).toHaveLength(0);
    });

    it('debería entregar los eventos drenados al repositorio en la misma llamada', async () => {
      // Arrange
      const { useCase, repository } = buildUseCase([CUSTOMER_ID]);

      // Act
      const order = await useCase.execute({
        customerId: CUSTOMER_ID,
        concept: 'Suscripción anual',
        amountCents: 149_900,
      });

      // Assert: una sola llamada, con eventos dentro; el agregado quedó drenado ANTES de
      // guardarse — un segundo pull ya no devuelve nada.
      expect(repository.saveCalls).toHaveLength(1);
      expect(repository.saveCalls[0]?.events.length).toBeGreaterThan(0);
      expect(order.pullEvents()).toEqual([]);
    });

    it('debería devolver la orden colocada', async () => {
      // Arrange
      const { useCase } = buildUseCase([CUSTOMER_ID]);

      // Act
      const order = await useCase.execute({
        customerId: CUSTOMER_ID,
        concept: '  Suscripción anual  ',
        amountCents: 149_900,
      });

      // Assert: snapshot correcto — el concepto llega recortado por el VO.
      const snapshot = order.toSnapshot();
      expect(snapshot.id).toEqual(expect.any(String));
      expect(snapshot.customerId).toBe(CUSTOMER_ID);
      expect(snapshot.concept).toBe('Suscripción anual');
      expect(snapshot.amountCents).toBe(149_900);
      expect(snapshot.placedAt).toBeInstanceOf(Date);
    });

    it('debería consultar el directorio antes de guardar', async () => {
      // Arrange: jest.spyOn sobre métodos del fake — permitido para afirmar llamadas.
      const { useCase, repository, directory } = buildUseCase([CUSTOMER_ID]);
      const calls: string[] = [];
      jest.spyOn(directory, 'exists').mockImplementation(() => {
        calls.push('exists');
        return Promise.resolve(true);
      });
      jest.spyOn(repository, 'save').mockImplementation(() => {
        calls.push('save');
        return Promise.resolve();
      });

      // Act
      await useCase.execute({
        customerId: CUSTOMER_ID,
        concept: 'Suscripción anual',
        amountCents: 149_900,
      });

      // Assert
      expect(calls).toEqual(['exists', 'save']);
    });
  });
});

// Helpers

const buildUseCase = (knownCustomerIds: readonly string[]) => {
  const repository = new InMemoryOrderRepository();
  const directory = new FakeCustomerDirectory(knownCustomerIds);
  return { useCase: new PlaceOrderUseCase(directory, repository), repository, directory };
};
