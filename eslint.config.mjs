// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import boundariesBlocks from './eslint.boundaries.js';

export default tseslint.config(
  {
    ignores: [
      'eslint.config.mjs',
      // config CJS compartida con su suite; se auto-excluye del lint como eslint.config.mjs
      'eslint.boundaries.js',
      'commitlint.config.cjs',
      'dist/**',
      'coverage/**',
      'node_modules/**',
      '*.tsbuildinfo',
      'src/metadata.ts',
      // Las skills son documentación, no código del proyecto: no entran en `tsconfig.json`
      // —cuyo `include` es solo `src/` y `test/`— así que el `projectService` de más abajo no
      // puede darles tipos y las rechaza con «was not found by the project service». El lint
      // del DoD nunca las vio (su glob es `{src,test}/**/*.ts`), pero `lint-staged` sí, con su
      // `*.ts` universal: bastaba con stagear `.claude/skills/**/scripts/*.ts` para que el
      // pre-commit reventara sin que la CI se enterara jamás.
      '.claude/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'module',
      parserOptions: {
        projectService: {
          allowDefaultProject: ['jest.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'no-duplicate-imports': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      curly: ['error', 'all'],

      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],

      // `@nestjs/common/constants` es un entrypoint NO declarado: medido sobre
      // @nestjs/common@11.2.1, el paquete no publica `exports`, ni `main`, ni `types`, así que
      // resuelve solo por el algoritmo legacy de Node. El día que Nest publique un mapa de
      // `exports` —minor rutinario y compatible— el proceso muere al arrancar con
      // `ERR_PACKAGE_PATH_NOT_EXPORTED` con typecheck en verde, porque los tipos viajan por el
      // mismo camino que se rompe. Y si en vez de desaparecer la clave se RENOMBRA, nada lanza:
      // `reflector.get(undefined, …)` devuelve `undefined` y el interceptor deja de detectar
      // SSE en silencio. Las dos claves que hacían falta viven copiadas y ancladas al
      // decorador público que las escribe en `src/common/nest-metadata.constants.ts`.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@nestjs/common/constants',
              message:
                'Entrypoint no declarado de @nestjs/common. Usa src/common/nest-metadata.constants.ts, cuyos literales están anclados al API público por su spec.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', '**/__tests__/**/*.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    // `src/database/seeds/` y `src/database/outbox/` no son código de la aplicación: son
    // programas de línea de comandos (`pnpm seed:admin`, `pnpm outbox:relay`). En un CLI la
    // salida estándar ES la interfaz de usuario, no el rastro de una depuración olvidada. En el
    // relay va aún más lejos: el `console.log` de cada fila ES la publicación del evento —el
    // único efecto observable que el outbox tiene hoy, hasta que llegue BullMQ—, y su spec lo
    // espía justamente por eso, así que también nombra `console.log` en las aserciones.
    //
    // Acotado a esas dos carpetas y a ese spec, NUNCA a `src/database/**`: ahí viven también
    // `data-source.ts`, `typeorm-options.ts` y las migraciones, donde un `console.log` sí sería
    // un olvido y la regla debe seguir avisando.
    files: [
      'src/database/seeds/**/*.ts',
      'src/database/outbox/**/*.ts',
      'src/database/__tests__/relay-orders-outbox.e2e-spec.ts',
    ],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Blindaje del ÚNICO fallo silencioso que introduce el ciclo 2 (puertos como
    // `abstract class`, sin `@Inject`). El token de inyección ES la referencia a la clase,
    // y viaja hasta el runtime dentro de `design:paramtypes`. Un `import type` borra esa
    // referencia al compilar: TypeScript la considera una elisión legítima, así que
    // `typecheck` y `lint` quedan VERDES y el fallo aparece al arrancar Nest —
    // «Nest can't resolve dependencies of X. Please make sure that the argument
    // dependency at index [0] is available». Es el peor perfil de defecto posible: cero
    // señal en los gates, explosión en producción. De ahí esta regla.
    //
    // El emit se borra por SPECIFIER, no por declaración, así que hacen falta DOS selectores
    // —lo contrario deja dos huecos comprobados—:
    //
    //   (1) La forma de DECLARACIÓN `import type { … } from '…'`. Su `source` cubre tanto
    //       `ports/` como `*.module`: `UsersFacade` es un puerto a todos los efectos (la
    //       fachada es una `abstract class` que se inyecta) y su ruta NO contiene `ports/`,
    //       que era el hueco (b).
    //   (2) La forma MIXTA `import { VALOR, type Puerto } from '…'`. Aquí el `importKind` de
    //       la DECLARACIÓN es `"value"` y el del SPECIFIER es `"type"`, así que el selector
    //       (1) no la ve — hueco (a). El emit se borra igual y Nest revienta igual.
    //
    // El `type` INLINE sigue siendo legal y necesario para los datos que acompañan al puerto,
    // que no son inyectables: `import { UserRepository, type UserPage } from '…'`. Por eso
    // (2) lleva una LISTA CERRADA de esos nombres. Falla en cerrado a propósito: un dato
    // nuevo que viaje con un puerto obliga a añadirlo aquí —una línea, revisada— mientras que
    // un puerto marcado `type` por descuido se pone rojo solo. La lista está también en
    // CLAUDE.md; si divergen, manda esta.
    //
    // Solo `application/` e `infrastructure/`: son las capas que declaran clases con
    // decoradores. `domain/` define los puertos y no los inyecta; los fakes de
    // `__tests__/` viven fuera de estos globs y ahí la asimetría se invierte —sin
    // decoradores, `consistent-type-imports` EXIGE `import type`.
    files: ['src/modules/*/{application,infrastructure}/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportDeclaration[importKind="type"][source.value=/(ports\\/|\\.module$)/]',
          message:
            'Un puerto es una `abstract class` y su referencia ES el token de inyección: `import type` la borra del emit y Nest falla EN RUNTIME con lint y typecheck en verde. Importa el puerto como valor y deja `type` inline solo para los datos que lo acompañan (UserPage, SignedToken…).',
        },
        {
          selector:
            'ImportDeclaration[source.value=/(ports\\/|\\.module$)/] > ImportSpecifier[importKind="type"]:not([imported.name=/^(CreateProfileResult|DirectoryUser|FindUsersCriteria|SignedToken|TokenClaims|UserPage|UserSummary)$/])',
          message:
            'El `type` INLINE borra ese specifier del emit igual que `import type`: si el nombre es un puerto (`UserRepository`, `PasswordHasher`, `UsersFacade`…), Nest fallará EN RUNTIME con los gates en verde. Impórtalo como valor. Si de verdad es un DATO que acompaña al puerto y no algo inyectable, añádelo a la lista cerrada de este selector en `eslint.config.mjs`.',
        },
      ],
    },
  },
  // Al final a propósito: si un bloque futuro repitiera una clave de regla,
  // ganaría el gate (merge por clave de flat config).
  ...boundariesBlocks,
);
