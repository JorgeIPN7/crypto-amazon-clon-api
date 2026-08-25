import { DomainError } from '../../domain/domain-error.base';

describe('DomainError', () => {
  describe('name', () => {
    it('debería exponer como name el nombre de la clase concreta, no el de la base', () => {
      // Arrange + Act
      const error = new ConcreteError('cualquier cosa');

      // Assert
      expect(error.name).toBe('ConcreteError');
    });
  });

  describe('message', () => {
    it('debería conservar el mensaje recibido', () => {
      // Arrange + Act
      const error = new ConcreteError('texto exacto');

      // Assert
      expect(error.message).toBe('texto exacto');
    });
  });

  describe('instanceof', () => {
    it('debería ser instancia de su marcador de módulo y de DomainError', () => {
      // Arrange + Act
      const error = new ConcreteError('x');

      // Assert
      expect(error).toBeInstanceOf(MarkerA);
      expect(error).toBeInstanceOf(DomainError);
    });

    it('debería no ser capturado por el marcador de otro módulo', () => {
      // Arrange + Act
      const error = new OtherConcreteError('x');

      // Assert
      expect(error).toBeInstanceOf(MarkerB);
      expect(error).not.toBeInstanceOf(MarkerA);
    });

    it('debería seguir siendo un Error nativo con stack', () => {
      // Arrange + Act
      const error = new ConcreteError('x');

      // Assert
      expect(error).toBeInstanceOf(Error);
      expect(error.stack).toBeDefined();
    });

    // A6. Cierra el único agujero conocido que ni los tests ni Stryker pueden atrapar. Un
    // `static [Symbol.hasInstance]` en `DomainError` lo heredarían los tres marcadores por la
    // cadena ESTÁTICA de prototipos, e `instanceof` dejaría de mirar la cadena real: A4 caería
    // en silencio mientras A1, A2, A3 y A5 siguen verdes. Medido durante el Lote 1.
    //
    // Stryker no lo ve porque sus mutadores mutan código existente y no pueden AÑADIR un miembro
    // estático. Y no es un ataque rebuscado: es una adición de buena fe plausible —alguien podría
    // ponerla para que los filtros capturen también errores de librerías externas.
    //
    // El caso mira los símbolos PROPIOS, no `DomainError[Symbol.hasInstance]`: eso último
    // siempre existe, heredado de `Function.prototype`, y la aserción pasaría siempre.
    it('debería no declarar un Symbol.hasInstance propio', () => {
      // Arrange + Act
      const ownSymbols = Object.getOwnPropertySymbols(DomainError);

      // Assert
      expect(ownSymbols).not.toContain(Symbol.hasInstance);
    });
  });
});

// Helpers
//
// Dos marcadores sintéticos, no los reales de `users` y `auth`, porque lo que A4 afirma —que
// compartir abuelo NO ensancha el `instanceof`— es una propiedad de la jerarquía y no de
// ningún módulo concreto: con los errores reales, el test se rompería el día que `users`
// reorganice los suyos por razones que nada tienen que ver con el kernel.
//
// El motivo NO es el gate de fronteras: `eslint.boundaries.js` lleva
// `'boundaries/ignore': ['src/**/__tests__/**', …]`, así que este archivo podría importar de
// `modules/` sin violar ninguna regla. La restricción real vive en el CÓDIGO de producción
// del kernel, no en su spec.

abstract class MarkerA extends DomainError {}
abstract class MarkerB extends DomainError {}

class ConcreteError extends MarkerA {
  constructor(message: string) {
    super(message);
  }
}

class OtherConcreteError extends MarkerB {
  constructor(message: string) {
    super(message);
  }
}
