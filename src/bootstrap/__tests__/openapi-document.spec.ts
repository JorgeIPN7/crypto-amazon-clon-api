import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

describe('buildOpenApiDocument', () => {
  it('debería ser el único sitio del repositorio que construye el documento', () => {
    // Arrange
    const sourceRoot = resolve(__dirname, '..', '..');

    // Act
    const callers = collectFiles(sourceRoot)
      .filter((file) => readFileSync(file, 'utf-8').includes('SwaggerModule.createDocument'))
      .map((file) => file.replace(sourceRoot, 'src').replace(/\\/g, '/'));

    // Assert
    // Dos llamadas a `createDocument` fue un defecto real: el guardián del contrato auditaba un
    // documento construido con opciones distintas a las que la aplicación publicaba. Alinear las
    // opciones arreglaba la instancia; centralizar la llamada elimina la clase entera.
    expect(callers).toEqual(['src/bootstrap/openapi-document.ts']);
  });
});

// Helpers

/** Todos los `.ts` bajo un directorio, saltando los tests para no contarse a sí mismo. */
const collectFiles = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') {
        continue;
      }
      found.push(...collectFiles(full));
    } else if (entry.endsWith('.ts')) {
      found.push(full);
    }
  }
  return found;
};
