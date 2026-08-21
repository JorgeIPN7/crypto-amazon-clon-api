import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';

import { appConfig } from '@config/app.config';

import { HealthController } from '../health.controller';
import { HealthModule } from '../health.module';

describe('HealthModule', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    // `ConfigModule` se declara global igual que en `AppModule`: `HealthModule` no lo
    // importa, depende de que `ConfigService` esté disponible globalmente.
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [appConfig] }),
        HealthModule,
      ],
    }).compile();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  // Único test del módulo: que el controller resuelve pese a no importar `ConfigModule`
  // ni declarar `TypeOrmHealthIndicator`, que llegan de `TerminusModule` y del contenedor
  // global. El contenido de la config lo verifica `config/__tests__/`, no este archivo.
  it('debería resolver el HealthController con sus indicadores', () => {
    // Act
    const controller = moduleRef.get(HealthController);

    // Assert
    expect(controller).toBeInstanceOf(HealthController);
  });
});
