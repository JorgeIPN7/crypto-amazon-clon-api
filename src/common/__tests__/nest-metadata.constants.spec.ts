import { Req, Sse } from '@nestjs/common';

import { ROUTE_ARGS_METADATA, SSE_METADATA } from '../nest-metadata.constants';

/**
 * Ancla los literales copiados de las internals de Nest a los decoradores públicos que los
 * escriben. Es lo que convierte la copia en algo mantenible: si un minor de Nest renombra la
 * clave, este spec se pone rojo, mientras que el `reflector.get()` de los interceptores se
 * limitaría a devolver `undefined` sin quejarse.
 *
 * La derivación tiene que salir del API público (`@Sse`, `@Req`), nunca de
 * `@nestjs/common/constants`: comparar el literal contra el mismo sitio del que se copió sería
 * tautológico y volvería a meter el import profundo, esta vez en la suite.
 */
describe('nest metadata keys', () => {
  describe('SSE_METADATA', () => {
    it('debería ser la clave que @Sse() escribe sobre el método', () => {
      // Arrange
      class Probe {
        stream(): string {
          return 'event';
        }
      }
      const descriptor = Object.getOwnPropertyDescriptor(Probe.prototype, 'stream');

      // Act
      Sse()(Probe.prototype, 'stream', descriptor!);

      // Assert
      expect(Reflect.getMetadataKeys(Probe.prototype.stream)).toContain(SSE_METADATA);
    });
  });

  describe('ROUTE_ARGS_METADATA', () => {
    it('debería ser la clave que un decorador de parámetro escribe sobre la clase', () => {
      // Arrange
      class Probe {
        handle(request: unknown): unknown {
          return request;
        }
      }

      // Act — los decoradores de parámetro anotan la CLASE indexada por el nombre del método,
      // no el método, que es por lo que el `Reflect.getMetadataKeys` lleva dos argumentos.
      Req()(Probe.prototype, 'handle', 0);

      // Assert
      expect(Reflect.getMetadataKeys(Probe, 'handle')).toContain(ROUTE_ARGS_METADATA);
    });
  });
});
