import util from 'node:util';

import fc from 'fast-check';

import { SecretValueObject } from '../../domain/secret-value-object.base';
import { ValueObject } from '../../domain/value-object.base';

const REDACTED = '***REDACTED***';

/** Doble de prueba: el kernel no puede importar un VO de `modules/`. */
class Secret extends SecretValueObject<string> {
  static from(value: string): Secret {
    return new Secret(value);
  }
}

/** Un VO normal, para contrastar que la redacción es de `SecretValueObject` y no de la base. */
class Plain extends ValueObject<string> {
  static from(value: string): Plain {
    return new Plain(value);
  }
}

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$REALHASHBYTES';

describe('SecretValueObject', () => {
  describe('las tres superficies por las que un valor llega a un log', () => {
    it('debería redactar el valor al interpolarlo en una plantilla', () => {
      // Arrange
      const secret = Secret.from(HASH);

      // Act
      // El disable es el PUNTO del caso: la regla prohíbe interpolar un objeto justamente
      // porque suele filtrar `[object Object]` o algo peor, y lo que aquí se comprueba es que
      // este objeto en concreto es seguro de interpolar. Escribirlo con `String(secret)` probaría
      // otra cosa: la conversión explícita, no la plantilla que alguien teclea en un log.
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      const rendered = `${secret}`;

      // Assert
      expect(rendered).toBe(REDACTED);
      expect(rendered).not.toContain(HASH);
    });

    it('debería redactar el valor al serializarlo con JSON.stringify', () => {
      // Arrange
      const secret = Secret.from(HASH);

      // Act
      const serialized = JSON.stringify(secret);

      // Assert
      expect(serialized).toBe(`"${REDACTED}"`);
      expect(serialized).not.toContain(HASH);
    });

    it('debería redactar el valor al inspeccionarlo con util.inspect', () => {
      // Arrange
      const secret = Secret.from(HASH);

      // Act
      const inspected = util.inspect(secret);

      // Assert
      expect(inspected).not.toContain(HASH);
    });

    // Es el caso REAL: nadie loguea el VO suelto, lo loguea dentro del objeto que lo contiene.
    // `JSON.stringify` recorre el árbol y llama a `toJSON()` de cada nodo, así que la redacción
    // viaja hacia arriba sin que el contenedor tenga que saber nada.
    it('debería redactar el valor cuando viaja anidado dentro de otro objeto', () => {
      // Arrange
      const payload = { userId: 'u-1', credential: { hash: Secret.from(HASH) } };

      // Act
      const serialized = JSON.stringify(payload);

      // Assert
      expect(serialized).not.toContain(HASH);
      expect(serialized).toContain(REDACTED);
    });
  });

  describe('lo que la redacción NO puede romper', () => {
    it('debería seguir devolviendo el valor real por .value, que es lo que el adaptador persiste', () => {
      // Arrange
      const secret = Secret.from(HASH);

      // Act
      const value = secret.value;

      // Assert
      expect(value).toBe(HASH);
    });

    it('debería seguir comparando por el valor real y no por el texto redactado', () => {
      // Arrange
      const one = Secret.from(HASH);
      const same = Secret.from(HASH);
      const other = Secret.from(`${HASH}-distinto`);

      // Act
      const equalToSame = one.equals(same);
      const equalToOther = one.equals(other);

      // Assert
      // Sin esta pareja, redactar `toString()` pasaría inadvertido aunque hubiera roto la
      // igualdad: dos secretos distintos rendan el MISMO texto, así que una comparación
      // que se apoyara en él daría `true` para todo.
      expect(equalToSame).toBe(true);
      expect(equalToOther).toBe(false);
    });
  });

  describe('el alcance de la base', () => {
    it('debería dejar intacto un ValueObject normal, que no redacta nada', () => {
      // Arrange
      const plain = Plain.from('dato-publico');

      // Act
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      const rendered = `${plain}`;
      const serialized = JSON.stringify(plain);

      // Assert
      expect(rendered).toBe('dato-publico');
      expect(serialized).toContain('dato-publico');
    });
  });

  describe('propiedades', () => {
    it('debería no revelar NINGÚN valor por ninguna de las tres superficies', () => {
      // Arrange
      const nonTrivial = fc.string({ minLength: 8, maxLength: 120 });

      // Act & Assert
      fc.assert(
        fc.property(nonTrivial, (value) => {
          const secret = Secret.from(value);
          return (
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            !`${secret}`.includes(value) &&
            !JSON.stringify(secret).includes(value) &&
            !util.inspect(secret).includes(value)
          );
        }),
      );
    });
  });
});
