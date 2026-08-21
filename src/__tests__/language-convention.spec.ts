// src/__tests__/language-convention.spec.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { SPANISH_ROOTS, scanSource, scanTree, segmentsOf } from './helpers/language-scanner';

const ROOT = path.resolve(__dirname, '../..');
const SCANNED_DIRS = ['src', 'test'] as const;
const ISSUE_FORMS = [
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/ISSUE_TEMPLATE/feature_request.yml',
] as const;

/** `file:line name (motivo)`, que es lo que se quiere leer cuando el gate se pone rojo. */
const render = (violations: ReturnType<typeof scanTree>): string[] =>
  violations.map((v) => `${v.file}:${v.line} ${v.name} (${v.reason})`);

/** Los `id:` de un issue form de GitHub, que es la clave con la que se lee cada campo. */
const formIds = (relative: string): { id: string; line: number }[] =>
  readFileSync(path.join(ROOT, relative), 'utf-8')
    .split('\n')
    .flatMap((text, index) => {
      const match = /^\s*id:\s*(\S+)\s*$/.exec(text);
      return match?.[1] === undefined ? [] : [{ id: match[1], line: index + 1 }];
    });

/**
 * Gate de la convención de idioma: **código en inglés, prosa en español**.
 *
 * Existía escrita solo para los tests (`describe` / `it`) y en ningún sitio para el resto, y
 * sin criterio ni gate el repo derivó por los bordes: `id: previo` junto a `id: node` en el
 * mismo issue form, `Mutación (auditor de casos)` junto a `Unit tests` en el mismo workflow, y
 * un `válido:` con tilde en `auth.controller.ts` que viajaba tal cual al `openapi.json`
 * publicado. Dos de aquellos ids (`descripcion`, `reproduccion`) iban además sin tilde: ni
 * código en inglés ni español correcto.
 *
 * Se afirma sobre los IDENTIFICADORES, nunca sobre las cadenas. Esa frontera es la que deja
 * pasar los 631 `it` en español y los `describe` anidados sin una sola excepción: no es que
 * estén exentos, es que el escáner no los mira. El detalle vive en `helpers/language-scanner.ts`.
 *
 * El bloque «detector» es control positivo Y negativo: un gate que solo comprueba que el árbol
 * está limpio pasa igual de verde si el detector no detecta nada, que es el modo de fallo que
 * `CLAUDE.md` obliga a descartar («un test debe fallar sin el arreglo»).
 */
describe('language convention gate', () => {
  describe('el detector', () => {
    it('debería marcar un identificador declarado con raíz española', () => {
      // Arrange
      const source = 'const nombreUsuario = 1;';

      // Act
      const violations = scanSource(source);

      // Assert
      expect(render(violations)).toEqual(['fixture.ts:1 nombreUsuario (nombre)']);
    });

    it('debería marcar una clave de objeto en español', () => {
      // Arrange — la forma exacta que tenían los `examples` de `@ApiBody` hasta este cambio.
      const source = 'const examples = { completo: {}, importeMinimo: {} };';

      // Act
      const violations = scanSource(source);

      // Assert
      expect(render(violations)).toEqual([
        'fixture.ts:1 completo (completo)',
        'fixture.ts:1 importeMinimo (importe)',
      ]);
    });

    it('debería marcar un identificador fuera de ASCII', () => {
      // Arrange — `válido:` era el único identificador no ASCII del repo, y una clave con
      // tilde llega literal al documento OpenAPI que consumen los generadores de cliente.
      const source = 'const examples = { válido: {} };';

      // Act
      const violations = scanSource(source);

      // Assert
      expect(render(violations)).toContain('fixture.ts:1 válido (non-ascii)');
    });

    it('debería aceptar palabras inglesas que contienen una raíz española como subcadena', () => {
      // Arrange — las cuatro que hunden este gate si se compara por subcadena en vez de por
      // segmento: «importe» en imported, «rol» en role, «limite» en limiter, «valido» en Invalid.
      const source = [
        'const imported = 1;',
        'const role = 2;',
        'const limiter = 3;',
        'class InvalidOrderAmountError {}',
      ].join('\n');

      // Act
      const violations = scanSource(source);

      // Assert
      expect(render(violations)).toEqual([]);
    });

    it('debería ignorar los textos de describe e it, que van en español a propósito', () => {
      // Arrange
      const source = [
        "describe('valores por defecto', () => {",
        "  it('debería crear un usuario con el nombre recortado', () => {",
        "    const user = { name: 'Usuario de Prueba' };",
        '  });',
        '});',
      ].join('\n');

      // Act
      const violations = scanSource(source);

      // Assert — ni el `describe` anidado, ni el `it`, ni el dato de fixture son identificadores.
      expect(render(violations)).toEqual([]);
    });

    it.each([
      ['USER_ROLES', ['user', 'roles']],
      ['DEFAULT_NOW', ['default', 'now']],
      ['HTTPServer', ['http', 'server']],
      ['nombreMinimo', ['nombre', 'minimo']],
      ['breaking-change', ['breaking', 'change']],
    ])('debería segmentar %s sin romper acrónimos ni SCREAMING_CASE', (name, expected) => {
      // Arrange & Act
      const segments = segmentsOf(name);

      // Assert
      expect(segments).toEqual(expected);
    });

    it('debería dejar fuera de la lista las palabras iguales en ambos idiomas', () => {
      // Arrange — meterlas pondría roja media base de código sin señalar nada real.
      const shared = ['total', 'error', 'final', 'local', 'normal', 'original', 'general'];

      // Act
      const wrongly = shared.filter((word) => SPANISH_ROOTS.has(word));

      // Assert
      expect(wrongly).toEqual([]);
    });
  });

  describe('el árbol', () => {
    it('debería declarar en inglés y en ASCII todos los identificadores de src/ y test/', () => {
      // Arrange & Act
      const violations = scanTree(ROOT, SCANNED_DIRS);

      // Assert
      expect(render(violations)).toEqual([]);
    });

    it.each(ISSUE_FORMS)('debería nombrar en inglés los id de %s', (form) => {
      // Arrange — el `id:` es la clave con la que se lee la respuesta del formulario, no texto
      // de interfaz: los `label:` y `description:` de esos mismos bloques siguen en español.
      const ids = formIds(form);

      // Act
      const offenders = ids.filter(
        ({ id }) => !/^[\x20-\x7E]*$/.test(id) || segmentsOf(id).some((s) => SPANISH_ROOTS.has(s)),
      );

      // Assert
      expect(ids.length).toBeGreaterThan(0);
      expect(offenders.map(({ id, line }) => `${form}:${line} ${id}`)).toEqual([]);
    });
  });
});
