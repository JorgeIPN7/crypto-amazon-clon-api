import { spawn } from 'node:child_process';
import path from 'node:path';

export type SecretlintMessage = { ruleId: string; message: string };

/**
 * Forma real de `SecretLintCoreResult` (paquete `@secretlint/types@13.0.4`), tal como la
 * produce `--format=json` de la CLI, un objeto por archivo escaneado.
 */
type SecretlintFormattedResult = {
  messages: { ruleId: string; message: string }[];
};

const ROOT = path.resolve(__dirname, '../../..');
const CONFIG_PATH = path.join(ROOT, '.secretlintrc.json');

/**
 * Fallback CLI (plan `2026-08-06-supply-chain.md`, Task 1 Step 2, activado en Task 2 Step 2):
 * la API en memoria (`createEngine` del paquete `@secretlint/node`) se probó desde `ts-node`
 * en el spike de la Task 1 y cargó sin problema — Node 22.12+ resuelve `require(esm)` de forma
 * nativa. Pero Jest **no** usa el `require` de Node: tiene su propio loader CJS (ver el mismo
 * comentario en `jest.config.mjs` sobre `@scalar/*`), y `@secretlint/config-loader` usa
 * `import.meta` a secas (no solo `import.meta.url`) en un punto que `@swc/jest` no reescribe al
 * transformar a CommonJS — deja el token `import.meta` literal en el JS emitido, y Node lo
 * rechaza fuera de un módulo ES. Ampliar `transformIgnorePatterns` no lo resuelve: no es un
 * paquete sin transformar, es una forma que la propia transformación no cubre.
 *
 * Por eso este helper lanza un proceso Node real (no pasa por el `require` de Jest) que ejecuta
 * el binario de secretlint tal cual lo instala pnpm, resuelto vía `require.resolve` para no
 * asumir su ruta interna. El contrato público (`lintContent(content, virtualPath)` →
 * `SecretlintMessage[]`) no cambia — la suite de `secretlint.spec.ts` no se entera de este
 * cambio interno. `@secretlint/node` ya no es devDependency directa del repo (el fallback no
 * la importa) — sigue disponible solo de forma transitiva, como dependencia de `secretlint`.
 */
const SECRETLINT_BIN = path.join(
  path.dirname(require.resolve('secretlint/package.json')),
  'bin',
  'secretlint.js',
);

/**
 * Linta contenido en memoria con la config REAL del repo (.secretlintrc.json de la raíz),
 * nunca una copia — mismo principio que eslint-boundaries.spec.ts con eslint.boundaries.js.
 * Mientras la config no exista (ROJO de la Task 2), la CLI termina con exit code 2 y este
 * helper rechaza con un error que incluye «secretlint config is not found» (stderr real de
 * secretlint).
 */
export async function lintContent(
  content: string,
  virtualPath = 'fixture.txt',
): Promise<SecretlintMessage[]> {
  const { stdout, stderr, exitCode } = await runSecretlintCli(content, virtualPath);
  // exit 0 = limpio, 1 = secretos encontrados — ambos son un resultado válido con JSON en
  // stdout. Cualquier otro código (2 = error fatal, p. ej. config ausente) no produce JSON
  // usable: se rechaza con el stderr real de secretlint, no con un JSON.parse críptico.
  if (exitCode !== 0 && exitCode !== 1) {
    throw new Error(`secretlint terminó con código ${exitCode}:\n${stderr}`);
  }
  // exit 1 también lo devuelve un Node que muere ANTES de llegar a secretlint (bin inexistente,
  // módulo no encontrado por un install parcial): mismo código que "secretos encontrados", pero
  // stdout queda vacío y el stack real cae en stderr. Sin este try/catch, `JSON.parse('')` lo
  // enmascara con un `SyntaxError: Unexpected end of JSON input` que no dice nada del fallo real
  // (verificado apuntando el bin a una ruta inexistente: exit 1, stdout '', stderr con el
  // `MODULE_NOT_FOUND` de Node).
  let parsed: SecretlintFormattedResult[];
  try {
    parsed = JSON.parse(stdout) as SecretlintFormattedResult[];
  } catch (parseError) {
    throw new Error(
      `secretlint (exit ${exitCode}) no devolvió JSON válido en stdout — probable fallo de Node antes de ejecutar secretlint. stderr:\n${stderr}`,
      { cause: parseError },
    );
  }
  return parsed.flatMap((fileResult) =>
    fileResult.messages.map((m) => ({ ruleId: m.ruleId, message: m.message })),
  );
}

function runSecretlintCli(
  content: string,
  virtualPath: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        SECRETLINT_BIN,
        `--stdinFileName=${virtualPath}`,
        '--format=json',
        `--secretlintrc=${CONFIG_PATH}`,
      ],
      { cwd: ROOT },
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? -1 }));

    child.stdin.write(content);
    child.stdin.end();
  });
}
