import { ConfigService } from '@nestjs/config';
import { ApplicationConfig } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { AppModule } from '../app.module';
import type { AppConfig } from '../config/app.config';
import type { CorsConfig } from '../config/cors.config';
import type { LogConfig } from '../config/log.config';
import type { ThrottlerConfigValues } from '../config/throttler.config';
import { JwtAuthGuard } from '../modules/auth/infrastructure/http/jwt-auth.guard';
import { HealthController } from '../modules/health/health.controller';
import { UserRepository } from '../modules/users/domain/ports/user.repository';
import { UserTypeOrmRepository } from '../modules/users/infrastructure/persistence/user.typeorm.repository';

/**
 * E2E: compilar `AppModule` levanta también la conexión a PostgreSQL, así que necesita la
 * base arriba (`pnpm db:up`). Valida el grafo de DI completo: si un provider global, una
 * factory asíncrona (Throttler, CLS, Pino) o un token de módulo estuviera mal cableado,
 * `compile()` lanzaría aquí en vez de fallar al arrancar en producción.
 *
 * Lo que NO se comprueba aquí: que cada namespace de configuración devuelva algo. Eso lo
 * cubre `config/__tests__/` con aserciones sobre los valores, y sin necesitar Postgres.
 */
describe('AppModule', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('debería registrar ConfigService de forma global', () => {
    // Act
    const configService = moduleRef.get(ConfigService, { strict: false });

    // Assert
    expect(configService).toBeInstanceOf(ConfigService);
  });

  // El cableado más frágil de una arquitectura hexagonal. Desde el ciclo 2 el token ya no
  // es un `Symbol` aparte sino la propia `abstract class` del puerto: una clase sobrevive
  // a la compilación, así que la MISMA referencia es el tipo y el token. El riesgo se
  // desplaza pero no desaparece — un `import type` en un consumidor borraría esa
  // referencia y el fallo saldría al resolver en runtime, con lint y typecheck verdes.
  // Este test lo adelanta. (El texto del `it` conserva la palabra «Symbol» del ciclo 1:
  // renombrarlo queda fuera del alcance del refactor, que no toca textos de test.)
  it('debería resolver el puerto del repositorio por su token Symbol', () => {
    // Act
    const repository = moduleRef.get(UserRepository, { strict: false });

    // Assert
    expect(repository).toBeInstanceOf(UserTypeOrmRepository);
  });

  it('debería tener una conexión a la base establecida', () => {
    // Act
    const dataSource = moduleRef.get(DataSource, { strict: false });

    // Assert
    expect(dataSource.isInitialized).toBe(true);
  });

  it('debería exponer la configuración de throttler que consume el guard global', () => {
    // Arrange
    const configService = moduleRef.get(ConfigService, { strict: false });

    // Act
    const throttler = configService.getOrThrow<ThrottlerConfigValues>('throttler');

    // Assert
    expect(throttler.ttlMs).toBeGreaterThan(0);
    expect(throttler.limit).toBeGreaterThan(0);
  });

  it('debería resolver el HealthController del módulo de features', () => {
    // Act
    const controller = moduleRef.get(HealthController, { strict: false });

    // Assert
    expect(controller).toBeInstanceOf(HealthController);
  });

  it('debería dejar accesibles las configuraciones que usa el bootstrap', () => {
    // Arrange
    const configService = moduleRef.get(ConfigService, { strict: false });

    // Act
    const app = configService.getOrThrow<AppConfig>('app');
    const cors = configService.getOrThrow<CorsConfig>('cors');
    const log = configService.getOrThrow<LogConfig>('log');

    // Assert
    expect(app.globalPrefix).toBeTruthy();
    expect(cors.options).toBeDefined();
    expect(log.level).toBeTruthy();
  });

  // `APP_GUARD` es multi-provider y aquí hay TRES, repartidos entre módulos distintos, así que
  // el orden de la cadena no lo decide ninguna lista que alguien pueda leer:
  //
  //   [0] `ThrottlerGuard`  — `app.module.ts`, en los `providers` del módulo raíz.
  //   [1] un objeto anónimo `{ canActivate: () => true }` — el no-op que `nestjs-cls` mete por
  //       `useFactory` desde `ClsModule.forRoot` cuando `mount` es falsy (`clsGuardFactory` en
  //       `cls-root.module.js`). No es nuestro y no hace nada; cae en medio porque
  //       `ClsModule.forRoot` se importa antes de `AuthModule`.
  //   [2] `JwtAuthGuard` — `auth.module.ts`, que es donde tiene que estar: la regla 3 del gate
  //       de boundaries prohíbe a app-root importar internals de un módulo.
  //
  // Y el orden sale bien por un detalle de implementación de Nest, no por diseño: `scanner.js`
  // inserta el módulo RAÍZ en el contenedor antes de recursar a sus imports, así que el
  // throttler queda primero, y `guards-consumer.js` cortocircuita en el primer guard que
  // devuelve falsy. Si un minor pasara a recolectar enhancers por `calculateModulesDistance`
  // —que ya gobierna los hooks de ciclo de vida— los módulos importados irían delante,
  // `JwtAuthGuard` lanzaría el 401 antes de que el throttler contase, y `GET /users`,
  // `GET /users/:id`, `DELETE /users/:id` y `POST /orders` perderían el límite de peticiones
  // para todo el tráfico no autenticado. En silencio y en producción.
  //
  // La aserción es por POSICIÓN RELATIVA, no por longitud ni por índice absoluto, y es
  // deliberado: el invariante que protege el 429 es «el throttler antes que el JWT», y no
  // queremos que aparecer o desaparecer un enhancer de una librería ajena —como el no-op de
  // arriba— ponga rojo un test que no habla de eso.
  //
  // Lo que la hace posible sin arrancar un servidor HTTP: `testing-module.builder` llama a
  // `applyApplicationProviders()`, e `injector/module.js` registra en el contenedor la MISMA
  // instancia de `ApplicationConfig` que el scanner rellena. Y `getGlobalGuards()` devuelve
  // instancias, no clases, porque el scanner le pasa `instanceWrapper.instance`.
  it('debería ejecutar el ThrottlerGuard antes del JwtAuthGuard en la cadena global', () => {
    // Arrange
    const applicationConfig = moduleRef.get(ApplicationConfig, { strict: false });

    // Act
    const guards = applicationConfig.getGlobalGuards();
    const throttlerIndex = guards.findIndex((guard) => guard instanceof ThrottlerGuard);
    const jwtIndex = guards.findIndex((guard) => guard instanceof JwtAuthGuard);

    // Assert — los dos están, y el throttler va antes.
    expect(throttlerIndex).toBeGreaterThanOrEqual(0);
    expect(jwtIndex).toBeGreaterThanOrEqual(0);
    expect(throttlerIndex).toBeLessThan(jwtIndex);
  });
});
