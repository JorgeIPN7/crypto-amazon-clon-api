import { PlaceOrderUseCase } from '../../../application/use-cases/place-order.use-case';
import { OrdersController } from '../../../infrastructure/http/orders.controller';
import { FakeCustomerDirectory } from '../../helpers/fake-customer.directory';
import { InMemoryOrderRepository } from '../../helpers/in-memory-order.repository';

const CUSTOMER_ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const CLAIMS = { sub: CUSTOMER_ID, email: 'maria.gonzalez@empresa.com.mx', role: 'user' };

describe('OrdersController', () => {
  describe('place()', () => {
    it('debería colocar la orden con el customerId del token, no del body', async () => {
      // Arrange
      const controller = buildController();

      // Act
      const result = await controller.place(
        { concept: 'Suscripción anual plan Pro', amountCents: 149_900 },
        CLAIMS,
      );

      // Assert
      expect(result.customerId).toBe(CUSTOMER_ID);
      expect(result.concept).toBe('Suscripción anual plan Pro');
      expect(result.amountCents).toBe(149_900);
    });

    // Impide que un campo nuevo del agregado se filtre a la respuesta sin decidirlo.
    it('debería exponer solo los campos del DTO, nunca el agregado', async () => {
      // Arrange
      const controller = buildController();

      // Act
      const result = await controller.place(
        { concept: 'Suscripción anual plan Pro', amountCents: 149_900 },
        CLAIMS,
      );

      // Assert
      expect(Object.keys(result).sort()).toEqual([
        'amountCents',
        'concept',
        'customerId',
        'id',
        'placedAt',
      ]);
    });
  });
});

// Helpers

const buildController = (): OrdersController =>
  new OrdersController(
    new PlaceOrderUseCase(new FakeCustomerDirectory([CUSTOMER_ID]), new InMemoryOrderRepository()),
  );
