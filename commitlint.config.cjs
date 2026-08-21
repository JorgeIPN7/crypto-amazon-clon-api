/**
 * Configuración de commitlint para validar mensajes de commit.
 *
 * Se ejecuta vía Husky en el hook `commit-msg` (ver .husky/commit-msg).
 * Aplica el estándar Conventional Commits con las siguientes ajustes:
 *   - Sin límite de longitud en body/footer (permite pegar URLs, stack traces, etc.).
 *   - `type-enum` restringe los tipos permitidos a la lista de abajo.
 *   - `scope-enum` restringe los scopes permitidos para mantener consistencia
 *     y habilitar autocompletar en IDEs. Ajustar según evolucione el repo.
 *
 * Formato esperado del mensaje:
 *   <type>(<scope opcional>): <descripción>
 *
 *   <body opcional>
 *
 *   <footer opcional>
 *
 * Ejemplos válidos:
 *   feat(auth): agregar login con Google
 *   fix(health): corregir timeout en liveness
 *   chore(deps): bump @nestjs/core a 11.1.20
 *
 * Tipos permitidos:
 *   feat     – nueva funcionalidad para el usuario final.
 *   fix      – corrección de bug.
 *   docs     – cambios solo en documentación (README, JSDoc, comentarios).
 *   style    – formato, espacios, comas; sin cambio funcional.
 *   refactor – reestructuración sin cambiar comportamiento ni arreglar bug.
 *   perf     – mejora de rendimiento.
 *   test     – agregar o ajustar tests.
 *   build    – cambios al build, dependencias, tsconfig, package.json.
 *   ci       – cambios en pipelines de CI/CD.
 *   chore    – mantenimiento que no encaja en otros tipos.
 *   revert   – revertir un commit anterior.
 *
 * Severidades en las reglas: 0 = off, 1 = warning, 2 = error.
 *
 * @type {import('@commitlint/types').UserConfig}
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'body-max-line-length': [0, 'always'],
    'footer-max-line-length': [0, 'always'],
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'style',
        'refactor',
        'perf',
        'test',
        'build',
        'ci',
        'chore',
        'revert',
      ],
    ],
    // Un scope por cada carpeta real del repo, más los transversales. Si falta el de una
    // carpeta que existe, commitlint rechaza commits legítimos y se acaba commiteando sin
    // scope — que es lo que pasó con la reestructuración hexagonal, hecha sin `users` ni
    // `database` en esta lista. Al añadir un bounded context, añade aquí su scope.
    'scope-enum': [
      2,
      'always',
      [
        // Bounded contexts (src/modules/<context>/)
        'health',
        'users',
        'auth',
        'orders',
        // Infraestructura y transversales
        'config',
        'database',
        'logger',
        'common',
        'shared',
        'main',
        'bootstrap',
        'openapi',
        'cors',
        'throttler',
        // Tooling
        'test',
        'docker',
        'deps',
        'docs',
        'ci',
        'release',
      ],
    ],
  },
};
