import { test as fcTest, fc } from '@fast-check/jest';
import { ESLint, type Linter } from 'eslint';

// `require` y no `import`: allowJs está apagado y un .js sin .d.ts no resuelve
// estáticamente desde TS (TS7016). `eslint.config.mjs` sí puede importarlo directo.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const boundariesBlocks = require('../../eslint.boundaries.js') as Linter.Config[];

const D = 'src/modules/users/domain/f.ts';
const A = 'src/modules/users/application/f.ts';
const SD = 'src/shared/domain/f.ts';

describe('eslint.boundaries (gate de fronteras — spec 2026-08-04)', () => {
  describe('regla 1: pureza de dominio', () => {
    it('debería rechazar `@nestjs/common` en domain', async () => {
      // Arrange + Act
      const messages = await lint(D, "import { Injectable } from '@nestjs/common';");
      // Assert
      expect(ruleIds(messages)).toContain('boundaries/dependencies');
    });

    it('debería rechazar `typeorm` en domain', async () => {
      // Arrange + Act
      const messages = await lint(D, "import { Entity } from 'typeorm';");
      // Assert
      expect(ruleIds(messages)).toContain('boundaries/dependencies');
    });

    it('debería rechazar `class-validator` en domain', async () => {
      // Arrange + Act
      const messages = await lint(D, "import { IsString } from 'class-validator';");
      // Assert
      expect(ruleIds(messages)).toContain('boundaries/dependencies');
    });

    it('debería rechazar `pino` en domain', async () => {
      // Arrange + Act
      const messages = await lint(D, "import pino from 'pino';");
      // Assert
      expect(ruleIds(messages)).toContain('boundaries/dependencies');
    });

    it('debería rechazar que domain importe de infrastructure propia', async () => {
      // Arrange + Act
      const messages = await lint(
        D,
        "import { UserOrmEntity } from '../infrastructure/persistence/user.orm-entity';",
      );
      // Assert
      expect(ruleIds(messages)).toContain('boundaries/dependencies');
    });

    it('debería rechazar que domain importe cross-cutting', async () => {
      // Arrange + Act
      const messages = await lint(D, "import { PaginationDto } from '@common/dto/pagination.dto';");
      // Assert
      expect(ruleIds(messages)).toContain('boundaries/dependencies');
    });

    it('debería aceptar que domain importe su propio domain', async () => {
      // Arrange + Act
      const messages = await lint(D, "import { Email } from './value-objects/email.vo';");
      // Assert
      expect(messages).toHaveLength(0);
    });

    it('debería rechazar `argon2` en domain', async () => {
      // Arrange + Act
      const messages = await lint(D, "import * as argon2 from 'argon2';");
      // Assert
      expect(ruleIds(messages)).toContain('boundaries/dependencies');
    });

    // Documental: pasa porque el wildcard `@nestjs/*` de domain ya cubre `@nestjs/jwt`; si ese
    // wildcard se acota algún día, este caso lo detectará.
    it('debería rechazar `@nestjs/jwt` en domain', async () => {
      // Arrange + Act
      const messages = await lint(D, "import { JwtService } from '@nestjs/jwt';");
      // Assert
      expect(ruleIds(messages)).toContain('boundaries/dependencies');
    });

    // Tabla K (ciclo 1 del refactor de arquitectura, vía JIT): el shared kernel.
    // `src/shared/domain` es la única excepción a «domain no importa nada de fuera del
    // módulo». Este caso fija además el ORDEN de `elements`: si `shared` fuese antes que
    // `shared-domain`, el destino clasificaría como `shared`, el permiso no matchearía y
    // esto se pondría rojo.
    it('debería aceptar que domain importe shared-domain', async () => {
      // Arrange + Act
      const messages = await lint(
        D,
        "import { ValueObject } from '@shared/domain/value-object.base';",
      );
      // Assert
      expect(messages).toHaveLength(0);
    });

    // La contrapartida del permiso anterior: el kernel es dominio, así que carga con la MISMA
    // lista de externals prohibidos. Sin esto, abrirlo a los tres layers habría sido abrir un
    // agujero por el que `domain/` volvería a ver framework. Fija el orden de `elements` por
    // el otro lado: con `shared` delante, el origen clasificaría como `shared` y la
    // prohibición —que es `from: shared-domain`— no llegaría a aplicarse.
    it('debería rechazar `@nestjs/common` en shared-domain', async () => {
      // Arrange + Act
      const messages = await lint(SD, "import { Injectable } from '@nestjs/common';");
      // Assert
      expect(ruleIds(messages)).toContain('boundaries/dependencies');
    });

    // Partir el element type `shared` en dos abrió un hueco que no existía: hasta ahora
    // `shared → shared` cubría al kernel consigo mismo, y al reclasificarlo dejó de hacerlo.
    // Sin la policy `shared-domain → shared-domain` este caso se pone rojo.
    it('debería aceptar que shared-domain importe shared-domain', async () => {
      // Arrange + Act
      const messages = await lint(SD, "import { ValueObject } from './value-object.base';");
      // Assert
      expect(messages).toHaveLength(0);
    });

    // Documental: hoy ya lo bloqueaba `shared → shared`, y sigue bloqueado tras partir el
    // element type. Vale la fila porque el kernel no tiene dueño: si pudiera importar el
    // dominio de un módulo acoplaría por la puerta de atrás a TODOS los contextos que lo
    // usan. La dirección es de una sola vía y este caso la fija por escrito.
    it('debería rechazar que shared-domain importe el domain de un módulo', async () => {
      // Arrange + Act
      const messages = await lint(
        SD,
        "import { User } from '@modules/users/domain/entities/user.entity';",
      );
      // Assert
      expect(ruleIds(messages)).toContain('boundaries/dependencies');
    });
  });

  describe('regla 2: aplicación sin infraestructura', () => {
    it('debería rechazar que application importe infrastructure propia', async () => {
      // Arrange + Act
      const messages = await lint(
        A,
        "import { UsersController } from '../infrastructure/http/users.controller';",
      );
      // Assert
      expect(ruleIds(messages)).toContain('boundaries/dependencies');
    });

    it('debería rechazar `typeorm` en application', async () => {
      // Arrange + Act
      const messages = await lint(A, "import { Repository } from 'typeorm';");
      // Assert
      expect(ruleIds(messages)).toContain('boundaries/dependencies');
    });

    it('debería aceptar `@nestjs/common` en application', async () => {
      // Arrange + Act
      const messages = await lint(A, "import { Injectable, Inject } from '@nestjs/common';");
      // Assert
      expect(messages).toHaveLength(0);
    });

    it('debería aceptar que application importe su domain', async () => {
      // Arrange + Act
      const messages = await lint(A, "import { User } from '../domain/entities/user.entity';");
      // Assert
      expect(messages).toHaveLength(0);
    });

    it('debería rechazar `argon2` en application', async () => {
      // Arrange + Act
      const messages = await lint(A, "import * as argon2 from 'argon2';");
      // Assert
      expect(ruleIds(messages)).toContain('boundaries/dependencies');
    });

    it('debería rechazar `@nestjs/jwt` en application', async () => {
      // Arrange + Act
      const messages = await lint(A, "import { JwtService } from '@nestjs/jwt';");
      // Assert
      expect(ruleIds(messages)).toContain('boundaries/dependencies');
    });
  });

  describe('regla 3: aislamiento entre módulos', () => {
    it('debería rechazar internals de otro módulo vía alias', async () => {
      // Arrange + Act
      const messages = await lint(
        A,
        "import { HealthController } from '@modules/health/health.controller';",
      );
      // Assert
      expect(ruleIds(messages)).toContain('boundaries/dependencies');
    });

    it('debería rechazar internals de otro módulo vía ruta relativa', async () => {
      // Arrange + Act
      const messages = await lint(
        A,
        "import { HealthController } from '../../health/health.controller';",
      );
      // Assert
      expect(ruleIds(messages)).toContain('boundaries/dependencies');
    });

    it('debería aceptar que app-root importe el .module.ts de un módulo', async () => {
      // Arrange + Act
      const messages = await lint(
        'src/app.module.ts',
        "import { UsersModule } from '@modules/users/users.module';",
      );
      // Assert
      expect(messages).toHaveLength(0);
    });

    it('debería rechazar que app-root importe internals de un módulo', async () => {
      // Arrange + Act
      const messages = await lint(
        'src/app.module.ts',
        "import { User } from '@modules/users/domain/entities/user.entity';",
      );
      // Assert
      expect(ruleIds(messages)).toContain('boundaries/dependencies');
    });

    // Tabla G (plan 2026-08-06-orders-minimal, vía JIT): el lado permitido de la regla 3
    // para orígenes de módulo. Hasta esta enmienda solo app-root podía entrar por el
    // *.module.ts ajeno — el primer cruce real entre módulos (orders → users) lo destapó.
    it('debería aceptar que el .module.ts de un módulo importe el .module.ts de otro', async () => {
      // Arrange + Act
      const messages = await lint(
        'src/modules/orders/orders.module.ts',
        "import { UsersModule } from '../users/users.module';",
      );
      // Assert
      expect(messages).toHaveLength(0);
    });

    it('debería aceptar que infrastructure importe el .module.ts de otro módulo', async () => {
      // Arrange + Act
      const messages = await lint(
        'src/modules/orders/infrastructure/f.ts',
        "import { UsersLookup } from '../../users/users.module';",
      );
      // Assert
      expect(messages).toHaveLength(0);
    });

    it('debería rechazar que application importe el .module.ts de otro módulo', async () => {
      // Arrange + Act
      const messages = await lint(
        'src/modules/orders/application/f.ts',
        "import { UsersLookup } from '../../users/users.module';",
      );
      // Assert
      expect(ruleIds(messages)).toContain('boundaries/dependencies');
    });

    it('debería rechazar que domain importe el .module.ts de otro módulo', async () => {
      // Arrange + Act
      const messages = await lint(
        'src/modules/orders/domain/f.ts',
        "import { UsersModule } from '../../users/users.module';",
      );
      // Assert
      expect(ruleIds(messages)).toContain('boundaries/dependencies');
    });
  });

  describe('regla 4: TypeORM acotado', () => {
    it('debería aceptar `typeorm` en infrastructure/persistence', async () => {
      // Arrange + Act
      const messages = await lint(
        'src/modules/users/infrastructure/persistence/f.ts',
        "import { Repository } from 'typeorm';",
      );
      // Assert
      expect(messages).toHaveLength(0);
    });

    it('debería aceptar `typeorm` en database/', async () => {
      // Arrange + Act
      const messages = await lint('src/database/f.ts', "import { DataSource } from 'typeorm';");
      // Assert
      expect(messages).toHaveLength(0);
    });

    it('debería rechazar `typeorm` en common/', async () => {
      // Arrange + Act
      const messages = await lint('src/common/f.ts', "import { Entity } from 'typeorm';");
      // Assert
      expect(ruleIds(messages)).toContain('boundaries/dependencies');
    });
  });

  describe('regla 5: sin barrels, y direcciones cross-cutting', () => {
    it('debería rechazar la existencia de un index.ts bajo src/', async () => {
      // Arrange + Act
      const messages = await lint('src/modules/users/index.ts', 'export {};');
      // Assert
      expect(ruleIds(messages)).toContain('no-restricted-syntax');
    });

    it('debería tolerar un index.ts fuera de src/', async () => {
      // Arrange + Act
      const messages = await lint('test/helpers/index.ts', 'export {};');
      // Assert
      expect(messages).toHaveLength(0);
    });

    it('debería aceptar que un módulo flat importe common y config', async () => {
      // Arrange + Act
      const messages = await lint(
        'src/modules/health/f.ts',
        "import { ApiStandardErrors } from '@common/decorators/api-standard-errors.decorator';\nimport { appConfig } from '@config/app.config';",
      );
      // Assert
      expect(messages).toHaveLength(0);
    });

    it('debería aceptar que common importe config', async () => {
      // Arrange + Act
      const messages = await lint(
        'src/common/f.ts',
        "import { appConfig } from '@config/app.config';",
      );
      // Assert
      expect(messages).toHaveLength(0);
    });

    it('debería rechazar que config importe de un módulo', async () => {
      // Arrange + Act
      const messages = await lint(
        'src/config/f.ts',
        "import { UsersModule } from '@modules/users/users.module';",
      );
      // Assert
      expect(ruleIds(messages)).toContain('boundaries/dependencies');
    });
  });

  describe('propiedad', () => {
    fcTest.prop([sourceLocation(), fc.boolean()])(
      'debería rechazar internals ajenos desde cualquier ubicación',
      async (source, useAlias) => {
        // Arrange
        const specifier = useAlias
          ? '@modules/health/health.controller'
          : `${'../'.repeat(source.depthToModules)}health/health.controller`;
        // Act
        const messages = await lint(
          source.filePath,
          `import { HealthController } from '${specifier}';`,
        );
        // Assert
        expect(ruleIds(messages)).toContain('boundaries/dependencies');
      },
    );
  });
});

// Helpers

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: boundariesBlocks,
  cwd: process.cwd(),
});

const lint = async (filePath: string, code: string): Promise<Linter.LintMessage[]> => {
  // `warnIgnored: false`: un aviso «File ignored» no es un veredicto de lint; el caso 20 mide que
  // la regla de barrels NO alcanza fuera de src/, no la advertencia administrativa de ESLint.
  const [result] = await eslint.lintText(code, { filePath, warnIgnored: false });
  return result?.messages ?? [];
};

const ruleIds = (messages: Linter.LintMessage[]): (string | null)[] =>
  messages.map((m) => m.ruleId);

// Declaración `function` y no `const` con arrow: `describe('propiedad', …)` la invoca de forma
// síncrona durante la fase de colección de Jest (a diferencia de los `it`, que se difieren a la
// fase de ejecución) — en el orden textual del archivo, eso ocurre antes de llegar a esta línea.
// Una `const` seguiría en su temporal dead zone y lanzaría `ReferenceError`; una `function`
// se hoistea completa (binding + cuerpo) al principio del scope del módulo, así que resuelve
// aunque el uso quede más arriba en el archivo que esta declaración.
/** Ubicaciones reales de origen dentro de `users`, con la profundidad exacta hasta `src/modules/`. */
function sourceLocation() {
  return fc.constantFrom(
    { filePath: 'src/modules/users/domain/f.ts', depthToModules: 2 },
    { filePath: 'src/modules/users/application/f.ts', depthToModules: 2 },
    { filePath: 'src/modules/users/application/use-cases/f.ts', depthToModules: 3 },
    { filePath: 'src/modules/users/infrastructure/http/f.ts', depthToModules: 3 },
    { filePath: 'src/modules/users/infrastructure/persistence/f.ts', depthToModules: 3 },
    { filePath: 'src/modules/users/f.ts', depthToModules: 1 },
  );
}
