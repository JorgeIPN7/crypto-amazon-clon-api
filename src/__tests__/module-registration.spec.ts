import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');

/**
 * Contrato administrativo de un bounded context: existir en `src/modules/` no basta para estar
 * en la aplicación.
 *
 * Nombra el FALLO que evita, que es doble y silencioso en las dos mitades:
 *
 *   1. Un módulo ausente de `app.module.ts` compila, pasa lint y typecheck, y sus tests
 *      unitarios siguen verdes — porque instancian las clases a mano. Lo único que falla es la
 *      aplicación: la ruta devuelve 404 y nadie sabe por qué. `openapi-runtime-contract` sí lo
 *      cazaría, pero solo después de que alguien escriba su escenario, y ese escenario se
 *      escribe DESPUÉS.
 *   2. Un scope ausente de `commitlint.config.cjs` no rompe nada hasta el `git commit`, y
 *      entonces el camino de menor resistencia es commitear sin scope. Es literalmente lo que
 *      pasó con la reestructuración hexagonal, y por eso el comentario de ese archivo lo pide.
 *
 * Se deriva del disco y no de una lista escrita aquí: una lista habría que mantenerla, y sería
 * el mismo olvido una capa más arriba.
 *
 * ⚠️ Lo que este spec NO comprueba, dicho en voz alta para que nadie lo dé por cubierto: que el
 * grafo de inyección del módulo resuelva. Aquí solo se leen dos ficheros de texto; un
 * `import type` de un puerto en un archivo con decoradores deja estos dos casos VERDES y revienta
 * al arrancar. Eso lo mide `src/modules/wallets/__tests__/wallets.module.e2e-spec.ts`, que compila
 * el `AppModule` real.
 */
describe('registro de un bounded context', () => {
  const MODULES_DIR = path.join(ROOT, 'src', 'modules');

  const contexts = readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const appModuleSource = readFileSync(path.join(ROOT, 'src', 'app.module.ts'), 'utf-8');
  const commitlintSource = readFileSync(path.join(ROOT, 'commitlint.config.cjs'), 'utf-8');

  it('debería importar en app.module.ts el module file de cada contexto', () => {
    // Arrange
    const expected = contexts.map((context) => `@modules/${context}/${context}.module`);

    // Act
    const missing = expected.filter((specifier) => !appModuleSource.includes(specifier));

    // Assert
    expect(missing).toEqual([]);
  });

  it('debería declarar en commitlint.config.cjs el scope de cada contexto', () => {
    // Arrange
    // El bloque se recorta desde `'scope-enum'` hasta el final del archivo: después de esa
    // regla no queda nada más, así que el recorte captura la lista entera sin parsear JS.
    const scopeBlock = commitlintSource.slice(commitlintSource.indexOf("'scope-enum'"));
    const declared = new Set([...scopeBlock.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]));

    // Act
    const missing = contexts.filter((context) => !declared.has(context));

    // Assert
    expect(missing).toEqual([]);
  });
});
