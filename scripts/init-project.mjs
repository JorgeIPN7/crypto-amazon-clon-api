#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

/**
 * Convierte este clon del template en el proyecto de quien lo clonó.
 *
 * Se ejecuta UNA vez, justo después de «Use this template» / `git clone`:
 *
 *     pnpm init:project --name mi-api --dry-run     # ver qué cambiaría
 *     pnpm init:project --name mi-api
 *
 * Qué NO hace, y por qué:
 *
 *   - **No borra los bounded contexts de ejemplo** (`users`, `auth`, `orders`). Quitar uno
 *     toca su carpeta, `app.module.ts`, las migraciones que ya crearon sus tablas, el
 *     `scope-enum` de commitlint, los umbrales de `stryker.config.mjs` —el 85 está calibrado
 *     sobre el peso en mutantes de los módulos ACTUALES— y varias secciones de README y
 *     CLAUDE.md. Un script que lo hiciera a ciegas entregaría un repo que no compila, y el
 *     autor lo descubriría en el primer `pnpm build`. La checklist manual, por módulo, está
 *     en el README (§«Quitar los módulos de ejemplo»).
 *
 *   - **No toca git**: ni commit, ni tag, ni remote. Decisión del autor del proyecto.
 *
 *   - **No se autoelimina** salvo con `--self-destruct`. Si el renombrado se queda a medias
 *     —un archivo bloqueado por el editor en Windows es suficiente— hay que poder reintentar.
 */

const HELP = `
Uso: pnpm init:project --name <slug> [opciones]

  --name <slug>          Nombre del proyecto en kebab-case. Sin él, se deriva del nombre de la
                         carpeta y se pide confirmación.
  --title <texto>        Título legible para la documentación OpenAPI. Default: el slug en
                         Title Case.
  --description <texto>  Descripción para package.json. Default: el título.
  --author <texto>       Campo "author" de package.json. Default: vacío.
  --repo <url>           URL del repositorio nuevo. Sin ella, se ELIMINAN los campos
                         repository/bugs/homepage en vez de dejarlos apuntando al template.
  --dry-run              Muestra el plan y no escribe nada.
  --yes                  No pide confirmación.
  --force                Ejecuta aunque no queden ocurrencias del template (repo ya iniciado).
  --self-destruct        Borra este script, su manifiesto y su test al terminar.
  --help                 Esto.
`;

// --- Tokens del template ---------------------------------------------------------------------
// El orden IMPORTA y es el motivo de que esto sea una lista y no un objeto: cada token debe ir
// antes que cualquier otro del que sea prefijo o subcadena. `nest_base_template_test` antes que
// `nest_base_template`, y la URL completa antes que el nombre del repositorio que contiene.
const buildReplacements = ({ kebab, snake, docTitle, repoUrl }) => [
  ['https://github.com/JorgeIPN7/template-nest-js-hexagonal-ddd-mudblood', repoUrl],
  ['template-nest-js-hexagonal-ddd-mudblood', kebab],
  ['nest_base_template_test', `${snake}_test`],
  ['nest_base_template', snake],
  ['_nest-base-template', kebab],
  ['nest-base-template', kebab],
  ['Nest Base Template API', docTitle],
];

// Bloques del README que solo tienen sentido MIENTRAS el repo es el template: cómo clonarlo,
// cómo ejecutar este script. En el proyecto derivado sobran, así que se recortan enteros.
const TEMPLATE_ONLY_BLOCK = /[ \t]*<!-- template-only:start -->[\s\S]*?<!-- template-only:end -->\n?/g;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'scripts', 'init-project.targets.json'), 'utf-8'));

// --- Argumentos ------------------------------------------------------------------------------

const parseArgs = (argv) => {
  const flags = { dryRun: false, yes: false, force: false, selfDestruct: false, help: false };
  const values = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--dry-run':
        flags.dryRun = true;
        break;
      case '--yes':
      case '-y':
        flags.yes = true;
        break;
      case '--force':
        flags.force = true;
        break;
      case '--self-destruct':
        flags.selfDestruct = true;
        break;
      case '--help':
      case '-h':
        flags.help = true;
        break;
      case '--name':
      case '--title':
      case '--description':
      case '--author':
      case '--repo': {
        const value = argv[i + 1];
        if (value === undefined || value.startsWith('--')) {
          fail(`La opción ${arg} necesita un valor.`);
        }
        values[arg.slice(2)] = value;
        i += 1;
        break;
      }
      default:
        fail(`Opción desconocida: ${arg}\n${HELP}`);
    }
  }
  return { flags, values };
};

const fail = (message) => {
  console.error(`\n[init:project] ${message}\n`);
  process.exit(1);
};

// --- Derivación y validación del nombre ------------------------------------------------------

/**
 * Dos validaciones distintas sobre el mismo nombre, porque los dos consumidores no aceptan lo
 * mismo: npm admite puntos y empezar por dígito; un identificador de PostgreSQL sin comillar,
 * no. Se comprueban las dos aquí y no en el primer `docker compose up`, que es donde el error
 * aparecería si no.
 */
const deriveNames = (rawName, rawTitle) => {
  const kebab = rawName.trim().toLowerCase();

  if (!/^[a-z][a-z0-9-]*$/.test(kebab)) {
    fail(
      `«${rawName}» no sirve como nombre de proyecto.\n` +
        'Debe empezar por letra minúscula y contener solo letras minúsculas, dígitos y guiones ' +
        '(a-z, 0-9, -). Es el nombre del paquete npm, del proyecto de Docker Compose y —con los ' +
        'guiones vueltos guion bajo— el de la base de datos.',
    );
  }
  if (kebab.length > 200) {
    fail('El nombre supera los 200 caracteres; npm corta en 214 y PostgreSQL en 63.');
  }

  const snake = kebab.replace(/-/g, '_');
  if (snake.length > 58) {
    // 63 es el límite de un identificador en PostgreSQL, y la base de tests le añade `_test`.
    fail(
      `«${snake}_test» tendría ${snake.length + 5} caracteres y PostgreSQL trunca los ` +
        'identificadores en 63. Usa un nombre más corto.',
    );
  }

  const title =
    rawTitle?.trim() ||
    kebab
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');

  // El título del documento OpenAPI del template es «Nest Base Template API». Concatenar
  // «API» a ciegas produce «Mi API API» en cuanto el nombre ya la lleva, que es el caso
  // normal en un proyecto que es una API.
  const docTitle = /\bapi$/i.test(title) ? title : `${title} API`;

  return { kebab, snake, title, docTitle };
};

const askName = async (suggestion) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`Nombre del proyecto [${suggestion}]: `);
    return answer.trim() || suggestion;
  } finally {
    rl.close();
  }
};

const confirm = async (question) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} [y/N]: `);
    return /^(y|s|yes|si|sí)$/i.test(answer.trim());
  } finally {
    rl.close();
  }
};

// --- Operaciones sobre archivos --------------------------------------------------------------

/** Sustituye los tokens y recorta los bloques `template-only`. Devuelve cuántos cambios hizo. */
const rewriteFile = (relativePath, replacements, { dryRun }) => {
  const absolute = join(root, relativePath);
  const before = readFileSync(absolute, 'utf-8');

  let after = before.replace(TEMPLATE_ONLY_BLOCK, '');
  let hits = before.length === after.length ? 0 : 1;

  for (const [from, to] of replacements) {
    const occurrences = after.split(from).length - 1;
    if (occurrences > 0) {
      hits += occurrences;
      after = after.split(from).join(to);
    }
  }

  // Recortar un bloque deja tres saltos seguidos donde había dos. Prettier normaliza esto en
  // `format:check`, pero el archivo debe quedar bien antes de que nadie lo mire.
  after = after.replace(/\n{3,}/g, '\n\n');

  if (hits > 0 && !dryRun) writeFileSync(absolute, after);
  return hits;
};

/**
 * `package.json` no pasa por sustitución de texto: se reescribe campo a campo. Un reemplazo
 * ciego dejaría `homepage` y `bugs` apuntando al repositorio del template, que es exactamente
 * el tipo de resto que nadie revisa hasta que un usuario abre una issue en el sitio equivocado.
 */
const rewritePackageJson = ({ kebab, title }, { description, author, repo }, { dryRun }) => {
  const absolute = join(root, 'package.json');
  const pkg = JSON.parse(readFileSync(absolute, 'utf-8'));

  pkg.name = kebab;
  pkg.version = '0.1.0';
  pkg.description = description?.trim() || title;
  pkg.author = author?.trim() ?? '';

  if (repo) {
    const clean = repo.replace(/\.git$/, '').replace(/\/$/, '');
    pkg.repository = { type: 'git', url: `git+${clean}.git` };
    pkg.bugs = { url: `${clean}/issues` };
    pkg.homepage = `${clean}#readme`;
  } else {
    delete pkg.repository;
    delete pkg.bugs;
    delete pkg.homepage;
  }

  if (!dryRun) writeFileSync(absolute, `${JSON.stringify(pkg, null, 2)}\n`);
  return repo
    ? 'name, version, description, author, repository, bugs, homepage'
    : 'name, version, description, author; repository/bugs/homepage eliminados';
};

const CHANGELOG_HEADER = (title) => `# Changelog

Todo lo notable de ${title} se registra aquí. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el versionado
[Semantic Versioning](https://semver.org/lang/es/).

El historial del template del que nace este proyecto está archivado en
[\`docs/template-history/changelog.md\`](./docs/template-history/changelog.md).

---

## [Unreleased]
`;

const BACKLOG_HEADER = (title) => `# Backlog de ${title}

Trabajo **pospuesto con una decisión ya tomada**, no olvidado. Cada entrada registra qué pasa,
qué enfoque se eligió y cómo se sabrá que está cerrada — para no reabrir la discusión desde cero.
También se anota lo que se cerró al verificar que no era un problema, para que nadie lo
reinvestigue.

El backlog del template, con las decisiones que ya vienen tomadas en esta base de código, está
archivado en [\`docs/template-history/backlog.md\`](./template-history/backlog.md).

---
`;

/**
 * El CHANGELOG y el backlog del template son historia de OTRO proyecto. No se renombran —
 * reescribir un registro histórico lo falsea— sino que se archivan bajo `docs/template-history/`
 * y se crean vacíos. Siguen siendo útiles: explican por qué la base de código es como es.
 */
const archiveHistory = (title, { dryRun }) => {
  const archived = [];
  const historyDir = join(root, 'docs', 'template-history');

  const moves = [
    { from: join(root, 'CHANGELOG.md'), to: join(historyDir, 'changelog.md') },
    { from: join(root, 'docs', 'backlog.md'), to: join(historyDir, 'backlog.md') },
  ];

  if (!dryRun) mkdirSync(historyDir, { recursive: true });

  for (const { from, to } of moves) {
    if (!existsSync(from)) continue;
    if (existsSync(to)) {
      fail(`${to} ya existe: parece que este script ya se ejecutó. Revísalo antes de repetir.`);
    }
    if (!dryRun) renameSync(from, to);
    archived.push(to.slice(root.length + 1).replace(/\\/g, '/'));
  }

  if (!dryRun) {
    writeFileSync(join(root, 'CHANGELOG.md'), CHANGELOG_HEADER(title));
    writeFileSync(join(root, 'docs', 'backlog.md'), BACKLOG_HEADER(title));
  }
  return archived;
};

const selfDestruct = ({ dryRun }) => {
  const targets = [
    join(root, 'scripts', 'init-project.mjs'),
    join(root, 'scripts', 'init-project.targets.json'),
    join(root, 'src', '__tests__', 'init-project.spec.ts'),
  ];
  if (dryRun) return targets.map((t) => t.slice(root.length + 1).replace(/\\/g, '/'));

  const pkgPath = join(root, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  delete pkg.scripts['init:project'];
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  for (const target of targets) rmSync(target, { force: true });
  return targets.map((t) => t.slice(root.length + 1).replace(/\\/g, '/'));
};

// --- Programa --------------------------------------------------------------------------------

const main = async () => {
  const { flags, values } = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(HELP);
    return;
  }

  const folderName = root.split(/[\\/]/).pop();
  let rawName = values.name;

  if (!rawName) {
    if (!process.stdin.isTTY || flags.yes) {
      fail('Falta --name. Sin terminal interactiva no se puede preguntar.\n' + HELP);
    }
    rawName = await askName(folderName);
  }

  const names = deriveNames(rawName, values.title);
  const repoUrl = values.repo?.replace(/\.git$/, '').replace(/\/$/, '') ?? '<URL-DE-TU-REPOSITORIO>';
  const replacements = buildReplacements({ ...names, repoUrl });

  console.log('\n[init:project] Plan\n');
  console.table({
    'Paquete npm': names.kebab,
    'Base de datos': `${names.snake} (+ ${names.snake}_test)`,
    'Proyecto Docker Compose': names.kebab,
    'Título OpenAPI': names.docTitle,
    Repositorio: values.repo ?? '(se eliminan repository/bugs/homepage)',
  });

  if (flags.dryRun) console.log('Modo --dry-run: no se escribirá nada.\n');
  else if (!flags.yes && process.stdin.isTTY) {
    if (!(await confirm('¿Aplicar?'))) {
      console.log('Cancelado. No se ha tocado nada.');
      return;
    }
  }

  const targets = [...manifest.replace, ...manifest.optional.filter((p) => existsSync(join(root, p)))];
  const missing = manifest.replace.filter((p) => !existsSync(join(root, p)));
  if (missing.length > 0) {
    fail(`Estos archivos del manifiesto no existen: ${missing.join(', ')}`);
  }

  let total = 0;
  const report = {};
  for (const relativePath of targets) {
    const hits = rewriteFile(relativePath, replacements, flags);
    total += hits;
    report[relativePath] = hits;
  }

  if (total === 0 && !flags.force) {
    fail(
      'No se ha encontrado ni una sola marca del template. O ya ejecutaste este script, o el ' +
        'repo se renombró a mano. Usa --force si aun así quieres continuar.',
    );
  }

  const pkgSummary = rewritePackageJson(names, values, flags);
  const archived = archiveHistory(names.title, flags);

  console.log('\n[init:project] Archivos reescritos\n');
  console.table(report);
  console.log(`package.json: ${pkgSummary}`);
  if (archived.length > 0) console.log(`Historial del template archivado en: ${archived.join(', ')}`);

  if (flags.selfDestruct) {
    const removed = selfDestruct(flags);
    console.log(`Eliminados: ${removed.join(', ')}`);
  }

  if (flags.dryRun) {
    console.log('\nNada se ha escrito (--dry-run).\n');
    return;
  }

  // El secreto se imprime, nunca se escribe: `.env.example` está versionado y `secretlint`
  // —que corre en pre-commit sobre TODO archivo staged— bloquearía el commit, con razón.
  const secret = randomBytes(32).toString('hex');

  console.log(`
[init:project] Listo. Lo que queda, por orden:

  1. pnpm install
  2. cp .env.example .env
  3. Pega este JWT_SECRET recién generado en tu .env (NO lo commitees):

     JWT_SECRET=${secret}

  4. pnpm db:reset      # el nombre de la base cambió: el volumen viejo tiene la base anterior
  5. pnpm migration:run
  6. pnpm typecheck && pnpm lint:check && pnpm test && pnpm build

  Y cuando lo necesites:
  - Ajusta el 'scope-enum' de commitlint.config.cjs a tus módulos.
  - Revisa LICENSE, SECURITY.md y renovate.json.
  - Para quitar los bounded contexts de ejemplo, sigue la checklist del README.
`);
};

await main();
