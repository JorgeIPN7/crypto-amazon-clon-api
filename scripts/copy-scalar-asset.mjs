import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

/**
 * Copia el bundle de Scalar a `public/`, hasheado por contenido y precomprimido.
 *
 * **`public/` en la raíz, no `dist/public/`.** `nest-cli.json` tiene `deleteOutDir: true`, y eso
 * no solo afecta a `nest build`: `nest start --watch` también vacía `dist` al arrancar. Con el
 * asset ahí dentro, cualquier hook que corriera antes de compilar quedaría en «copiar → borrar →
 * compilar» y el bundle desaparecería en desarrollo, mientras que en Docker sobreviviría por ir
 * en `postbuild`. Fuera de `dist`, `deleteOutDir` deja de importar y un solo script sirve para
 * dev, test y build.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public');

// `require.resolve('@scalar/api-reference/package.json')` NO funciona: el paquete declara
// `exports` y no expone `./package.json`. Se lee por ruta, resoluble porque es dependencia
// directa y pnpm deja el symlink en la raíz.
const packagePath = join(root, 'node_modules', '@scalar', 'api-reference', 'package.json');
const manifest = JSON.parse(readFileSync(packagePath, 'utf-8'));

// npm permite que `browser` sea un mapa de objeto. Hoy es string; si un día deja de serlo, esto
// revienta con un mensaje claro en vez de copiar "[object Object]".
if (typeof manifest.browser !== 'string') {
  throw new Error(
    `@scalar/api-reference: se esperaba que "browser" fuese string y es ${typeof manifest.browser}. ` +
      'Revisa el campo antes de subir la versión.',
  );
}

const bundle = readFileSync(join(dirname(packagePath), manifest.browser));

// Un `cp` que copia poco y devuelve 0 es exactamente el fallo que este script evita: el proceso
// diría «hecho» sin haber hecho nada, y el fallo aparecería al abrir la documentación.
const MIN_BYTES = 1_000_000;
if (bundle.byteLength < MIN_BYTES) {
  throw new Error(
    `El bundle de Scalar pesa ${bundle.byteLength} bytes, por debajo del mínimo de ${MIN_BYTES}. ` +
      'La copia habría producido un archivo inservible.',
  );
}

const hash = createHash('sha256').update(bundle).digest('hex').slice(0, 12);
const fileName = `scalar.${hash}.js`;

// Se limpia el directorio entero: el nombre lleva hash, así que sin esto cada actualización
// dejaría el bundle anterior acumulándose y servible.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

writeFileSync(join(outDir, fileName), bundle);
writeFileSync(join(outDir, `${fileName}.gz`), gzipSync(bundle, { level: 9 }));
writeFileSync(
  join(outDir, `${fileName}.br`),
  brotliCompressSync(bundle, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }),
);

// El runtime lee este manifiesto para saber qué nombre servir. Sin él tendría que escanear el
// directorio, que es más frágil y no distingue restos de una build anterior.
writeFileSync(
  join(outDir, 'scalar-asset.json'),
  `${JSON.stringify({ fileName, version: manifest.version, bytes: bundle.byteLength }, null, 2)}\n`,
);

const megabytes = (bundle.byteLength / 1024 / 1024).toFixed(1);
console.log(`[scalar] public/${fileName} (${megabytes} MB) + .gz + .br`);
