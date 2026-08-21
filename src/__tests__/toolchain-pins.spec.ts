// src/__tests__/toolchain-pins.spec.ts
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');

const read = (relative: string): string => readFileSync(path.join(ROOT, relative), 'utf-8');

const packageJson = JSON.parse(read('package.json')) as {
  engines: { node: string };
  packageManager: string;
  devDependencies: Record<string, string>;
};

// Los dos documentos que le dicen a una persona qué instalar. No son decoración: el de
// incidencias existe para descartar «runtime equivocado» como causa, y con la versión
// equivocada prerellenada hace lo contrario de su trabajo.
const DOCS_THAT_CITE_VERSIONS = ['README.md', '.github/ISSUE_TEMPLATE/bug_report.yml'];

/**
 * Contrato del toolchain. El repo declara su runtime en CUATRO sitios que se mueven juntos y
 * su compilador en DOS, y hasta el 2026-08-19 nada lo verificaba. Las dos veces que se movió
 * quedó a medias, y las dos veces en verde:
 *
 *   - `bdfe609` (Node 22.23.2 → 24.19.0) tocó `.nvmrc`, `.node-version` y el `FROM` del
 *     Dockerfile, y dejó `engines.node` en `>=22.23.2 <25.0.0`: un manifiesto anunciando tres
 *     majors de los que se ejercita uno. `CHANGELOG.md` ya nombraba los cuatro archivos.
 *   - `2723d87` (pnpm 11.17.0 → 11.22.0) movió `packageManager` y dejó `README.md` y la
 *     plantilla de incidencias citando la versión vieja como si fuera la que fija el repo.
 *
 * Ninguno rompió nada, y ahí está el problema: `engines` no bloquea la instalación —no hay
 * `engine-strict`, y el propio README lo dice—, la CI toma la versión de `.nvmrc` sin matriz, y
 * ningún spec leía estos archivos. El coste se cobra fuera del repo, en quien deriva la
 * plantilla.
 *
 * Se afirma sobre el RESULTADO, no sobre la intención: qué versión resuelve de verdad, no qué
 * versión pretendía el literal.
 */
describe('toolchain pins', () => {
  describe('Node', () => {
    const nvmrc = read('.nvmrc').trim();

    it('debería declarar la misma versión en .nvmrc y en .node-version', () => {
      // Arrange
      const nodeVersion = read('.node-version').trim();

      // Act & Assert
      expect(nodeVersion).toBe(nvmrc);
    });

    it('debería construir la imagen sobre esa misma versión', () => {
      // Arrange — el pin viaja con digest desde que Renovate lo gestiona (`docker:pinDigests`),
      // así que el patrón exige las dos mitades: sin digest no hay reproducibilidad, y sin
      // versión legible nadie sabe qué está desplegando.
      const dockerfile = read('Dockerfile');

      // Act
      const from = /^FROM node:([^-]+)-alpine@sha256:[0-9a-f]{64} AS base$/m.exec(dockerfile);

      // Assert
      expect(from?.[1]).toBe(nvmrc);
    });

    it('debería usar esa versión como suelo de engines.node, con techo en el major siguiente', () => {
      // Arrange
      const nextMajor = Number(nvmrc.split('.')[0]) + 1;

      // Act
      const range = packageJson.engines.node;

      // Assert
      expect(range).toBe(`>=${nvmrc} <${nextMajor}.0.0`);
    });

    it.each(DOCS_THAT_CITE_VERSIONS)('debería citar esa versión en %s', (doc) => {
      // Arrange
      const contents = read(doc);

      // Act & Assert
      expect(contents).toContain(nvmrc);
    });
  });

  describe('pnpm', () => {
    // `packageManager` es la única autoridad: con `corepack enable`, el pnpm global la respeta.
    const pinned = packageJson.packageManager.replace(/^pnpm@/, '');

    it('debería fijar la versión en packageManager con el prefijo del gestor', () => {
      // Arrange & Act
      const declared = packageJson.packageManager;

      // Assert
      expect(declared).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
    });

    it.each(DOCS_THAT_CITE_VERSIONS)('debería citar esa versión en %s', (doc) => {
      // Arrange
      const contents = read(doc);

      // Act & Assert
      expect(contents).toContain(pinned);
    });
  });

  describe('typescript', () => {
    // El override de `pnpm-workspace.yaml` está scoped a `@nestjs/cli>typescript` desde el
    // 2026-08-19. Estas dos aserciones son la mitad que hace que ese scope sea seguro: con el
    // override global el bump de `package.json` era inerte, y con el override scoped y los dos
    // literales divergiendo habría DOS compiladores validando el mismo código —`nest build`
    // usa el suyo porque `nest-cli.json` lleva `typeCheck: true`—. Las dos formas de
    // equivocarse quedan cubiertas: una copia, y que sea la que anuncia el manifiesto.
    it('debería resolver una sola copia de typescript en el árbol', () => {
      // Arrange — layout aislado de pnpm. Ya es dependencia asumida en el comentario de
      // `stryker.config.mjs` y en `transformIgnorePatterns` de `jest.config.mjs`. El `@` del
      // patrón no es opcional: sin él, `typescript-eslint@…` entraría en la cuenta.
      const store = readdirSync(path.join(ROOT, 'node_modules/.pnpm'));

      // Act
      const copies = store.filter((entry) => entry.startsWith('typescript@'));

      // Assert
      expect(copies).toHaveLength(1);
    });

    it('debería resolver la versión que declara package.json', () => {
      // Arrange
      const declared = packageJson.devDependencies.typescript;

      // Act
      const resolved = (
        JSON.parse(read('node_modules/typescript/package.json')) as { version: string }
      ).version;

      // Assert
      expect(resolved).toBe(declared);
    });
  });
});
