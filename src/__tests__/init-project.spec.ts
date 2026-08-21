import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Gate del manifiesto de `scripts/init-project.mjs`.
 *
 * El script renombra el template a partir de una lista fija de archivos. Esa lista es lo único
 * que puede pudrirse: el día que alguien escriba `nest_base_template` en un archivo nuevo, el
 * script seguirá diciendo «hecho» y dejará una marca del template dentro del proyecto derivado
 * —normalmente un nombre de base de datos, que es de los restos que más tardan en dar la cara.
 *
 * Por eso este spec recorre el repositorio de verdad, igual que `eslint-boundaries.spec.ts`
 * ejercita la configuración real: busca los tokens y exige que TODO archivo que los contenga
 * esté declarado en el manifiesto, en una de sus tres listas.
 */

const REPO_ROOT = resolve(__dirname, '..', '..');

/**
 * Los tokens que delatan al template. Este archivo está en `exempt` precisamente porque los
 * necesita literales; si no, se encontraría a sí mismo.
 */
const TEMPLATE_TOKENS = [
  'nest_base_template',
  'nest-base-template',
  'template-nest-js-hexagonal-ddd-mudblood',
  'Nest Base Template',
];

/** Directorios que nunca contienen fuente versionada: artefactos, dependencias o caches. */
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.stryker-tmp',
  '.swc',
  '.temp',
  '.tmp',
  '_', // .husky/_ — internals que instala Husky
  'build',
  'coverage',
  'coverage-e2e',
  'dist',
  'logs',
  'node_modules',
  'public', // bundle de Scalar, generado
  'reports',
]);

/** Archivos grandes o binarios que no aportan y sí ralentizan. */
const MAX_BYTES = 5_000_000;

type Manifest = {
  replace: string[];
  optional: string[];
  handled: Record<string, string>;
  exempt: Record<string, string>;
};

describe('scripts/init-project.targets.json', () => {
  it('debería declarar todos los archivos del repositorio que contienen marcas del template', () => {
    // Arrange
    const declared = new Set(declaredPaths(readManifest()));
    const files = collectRepositoryFiles(REPO_ROOT);

    // Act
    const withTokens = files.filter((relativePath) => containsTemplateToken(relativePath));
    const undeclared = withTokens.filter((relativePath) => !declared.has(relativePath));

    // Assert
    expect(undeclared).toEqual([]);
  });

  it('debería listar en "replace" solo rutas que existen', () => {
    // Arrange
    const paths = readManifest().replace;

    // Act
    const missing = paths.filter((relativePath) => !existsSync(join(REPO_ROOT, relativePath)));

    // Assert
    expect(missing).toEqual([]);
  });

  it('debería listar en "handled" y "exempt" solo rutas que existen', () => {
    // Arrange
    const manifest = readManifest();
    const paths = [...Object.keys(manifest.handled), ...Object.keys(manifest.exempt)];

    // Act
    const missing = paths.filter((relativePath) => !existsSync(join(REPO_ROOT, relativePath)));

    // Assert
    expect(missing).toEqual([]);
  });

  it('debería mantener las tres listas sin solapamiento', () => {
    // Arrange
    const paths = declaredPaths(readManifest());

    // Act
    const duplicated = paths.filter((path, index) => paths.indexOf(path) !== index);

    // Assert
    expect(duplicated).toEqual([]);
  });
});

// Helpers

const declaredPaths = (manifest: Manifest): string[] => [
  ...manifest.replace,
  ...Object.keys(manifest.handled),
  ...Object.keys(manifest.exempt),
];

const readManifest = (): Manifest =>
  JSON.parse(
    readFileSync(join(REPO_ROOT, 'scripts', 'init-project.targets.json'), 'utf-8'),
  ) as Manifest;

/**
 * Los `.env` reales no se versionan y sí contienen el nombre de la base: incluirlos haría que
 * el gate fallara en la máquina de quien tiene el proyecto en marcha, y en ninguna otra.
 */
const isVersioned = (fileName: string): boolean =>
  !fileName.startsWith('.env') || fileName === '.env.example';

const collectRepositoryFiles = (directory: string, prefix = ''): string[] => {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        files.push(
          ...collectRepositoryFiles(join(directory, entry.name), `${prefix}${entry.name}/`),
        );
      }
      continue;
    }
    if (!entry.isFile() || !isVersioned(entry.name)) {
      continue;
    }
    if (statSync(join(directory, entry.name)).size > MAX_BYTES) {
      continue;
    }
    files.push(`${prefix}${entry.name}`);
  }

  return files;
};

const containsTemplateToken = (relativePath: string): boolean => {
  const content = readFileSync(join(REPO_ROOT, relativePath), 'utf-8');
  return TEMPLATE_TOKENS.some((token) => content.includes(token));
};
