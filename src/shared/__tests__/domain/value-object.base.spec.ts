import { ValueObject } from '../../domain/value-object.base';

describe('ValueObject', () => {
  describe('equals()', () => {
    it('debería considerar iguales dos instancias de la misma clase con el mismo valor', () => {
      // Arrange
      const one = StringVo.of('same');
      const another = StringVo.of('same');
      // Act
      const result = one.equals(another);
      // Assert
      expect(result).toBe(true);
    });

    it('debería considerar distintas dos instancias de la misma clase con valores distintos', () => {
      // Arrange
      const one = StringVo.of('one');
      const another = StringVo.of('another');
      // Act
      const result = one.equals(another);
      // Assert
      expect(result).toBe(false);
    });

    // La igualdad es de VALOR, pero no solo de valor: dos VOs que envuelven el mismo string
    // y significan cosas distintas (un email y un nombre) no son el mismo objeto de dominio.
    it('debería considerar distintos dos value objects de clases distintas con el mismo valor', () => {
      // Arrange
      const one = StringVo.of('same');
      const another = TwinStringVo.of('same');
      // Act
      const result = one.equals(another);
      // Assert
      expect(result).toBe(false);
    });

    it('debería devolver false ante null', () => {
      // Arrange
      const one = StringVo.of('same');
      // Act
      const result = one.equals(null);
      // Assert
      expect(result).toBe(false);
    });

    it('debería devolver false ante undefined', () => {
      // Arrange
      const one = StringVo.of('same');
      // Act
      const result = one.equals(undefined);
      // Assert
      expect(result).toBe(false);
    });

    it('debería considerar igual a un value object consigo mismo', () => {
      // Arrange
      const one = StringVo.of('same');
      // Act
      const result = one.equals(one);
      // Assert
      expect(result).toBe(true);
    });
  });

  describe('toString()', () => {
    it('debería devolver el valor cuando envuelve un string', () => {
      // Arrange
      const vo = StringVo.of('maria@empresa.com');
      // Act
      const result = vo.toString();
      // Assert
      expect(result).toBe('maria@empresa.com');
    });

    it('debería devolver la representación decimal cuando envuelve un número', () => {
      // Arrange
      const vo = NumberVo.of(1250);
      // Act
      const result = vo.toString();
      // Assert
      expect(result).toBe('1250');
    });
  });

  describe('value', () => {
    it('debería exponer el valor que recibió el constructor', () => {
      // Arrange + Act
      const vo = NumberVo.of(42);
      // Assert
      expect(vo.value).toBe(42);
    });
  });
});

// Helpers
//
// Dobles de prueba y no VOs reales del dominio: la base se prueba contra sí misma, sin
// arrastrar la validación de `Email` ni la de `OrderAmount` — que es justo lo que la base
// NO factoriza. `of()` reemplaza al `static from` de un VO real porque el constructor es
// `protected` y solo la propia clase puede invocarlo.

class StringVo extends ValueObject<string> {
  static of(value: string): StringVo {
    return new StringVo(value);
  }
}

/** Misma forma y mismo valor que `StringVo`, clase distinta: el caso de igualdad nominal. */
class TwinStringVo extends ValueObject<string> {
  static of(value: string): TwinStringVo {
    return new TwinStringVo(value);
  }
}

class NumberVo extends ValueObject<number> {
  static of(value: number): NumberVo {
    return new NumberVo(value);
  }
}
