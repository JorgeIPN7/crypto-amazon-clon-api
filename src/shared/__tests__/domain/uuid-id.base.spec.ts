import fc from 'fast-check';

import { UuidId } from '../../domain/uuid-id.base';

describe('UuidId', () => {
  describe('assertUuid()', () => {
    it('debería aceptar un UUID v4 bien formado y conservar el valor', () => {
      // Arrange
      const value = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';

      // Act
      const id = SampleId.from(value);

      // Assert
      expect(id.value).toBe(value);
    });

    it('debería lanzar el error que le pasa el llamante, no uno genérico', () => {
      // Arrange
      const value = 'no-soy-uuid';

      // Act + Assert
      expect(() => SampleId.from(value)).toThrow(SampleIdError);
    });

    it('debería rechazar un UUID de otra versión', () => {
      // Arrange — UUID v1: el dígito de versión es `1`, no `4`.
      const value = '2c5ea4c0-4067-11e9-8bad-9b1deb4d3b7d';

      // Act + Assert
      expect(() => SampleId.from(value)).toThrow(SampleIdError);
    });

    it('debería aceptar indistintamente mayúsculas y minúsculas', () => {
      // Arrange
      const value = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012'.toUpperCase();

      // Act + Assert
      expect(() => SampleId.from(value)).not.toThrow();
    });

    // Este caso vigila los ANCLAJES `^` y `$` del regex, que son la diferencia entre «esto es
    // un UUID» y «esto contiene un UUID en alguna parte». Sin `^`, `'DROP TABLE users;<uuid>'`
    // se acepta; sin `$`, `'<uuid>-mas-cosas'`. Medido, no supuesto. Nada lo probaba hasta
    // ahora —Stryker dejaba vivos exactamente esos dos mutantes— y por aquí entran los ids que
    // `UserId.from()` recibe desde HTTP.
    it('debería rechazar un valor que solo CONTIENE un UUID válido', () => {
      // Arrange
      const uuid = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';

      // Act + Assert
      expect(() => SampleId.from(`prefijo${uuid}`)).toThrow(SampleIdError);
      expect(() => SampleId.from(`${uuid}sufijo`)).toThrow(SampleIdError);
    });
  });

  describe('equals()', () => {
    it('debería distinguir ids de clases distintas con el mismo valor', () => {
      // Arrange
      const value = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
      const one = SampleId.from(value);
      const another = OtherSampleId.from(value);

      // Act
      const result = one.equals(another);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('assertUuid() (property-based)', () => {
    it('debería aceptar cualquier UUID v4 bien formado', () => {
      fc.assert(
        fc.property(fc.uuid({ version: 4 }), (value) => {
          // Act
          const id = SampleId.from(value);

          // Assert
          expect(id.value).toBe(value);
        }),
      );
    });

    it('debería rechazar cualquier cadena que no tenga la forma de un UUID', () => {
      fc.assert(
        fc.property(
          fc.string().filter((value) => !/^[0-9a-f-]{36}$/i.test(value)),
          (value) => {
            // Act + Assert
            expect(() => SampleId.from(value)).toThrow(SampleIdError);
          },
        ),
      );
    });
  });
});

// Helpers
//
// Subclases sintéticas y un error propio: el CÓDIGO del kernel no conoce
// `InvalidUserIdError` —vive en un módulo— y por eso `assertUuid` recibe la fábrica del
// error. Usar aquí `UserId` real probaría la composición de `users`, no el contrato del
// kernel, y ataría este spec a decisiones de otro contexto.
//
// El gate de fronteras no entra en esto: `boundaries/ignore` excluye `src/**/__tests__/**`,
// así que importar de `modules/` desde un spec es legal. La razón es de diseño del test.

class SampleIdError extends Error {}

class SampleId extends UuidId {
  static from(value: string): SampleId {
    return new SampleId(UuidId.assertUuid(value, () => new SampleIdError()));
  }
}

class OtherSampleId extends UuidId {
  static from(value: string): OtherSampleId {
    return new OtherSampleId(UuidId.assertUuid(value, () => new SampleIdError()));
  }
}
