import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  HealthCheckService,
  MemoryHealthIndicator,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';

import { buildAppConfig } from '@test/helpers/config.factory';

import { HealthController } from '../health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheck: { check: jest.Mock };
  let memory: { checkHeap: jest.Mock; checkRSS: jest.Mock };
  let database: { pingCheck: jest.Mock };

  beforeEach(async () => {
    healthCheck = { check: jest.fn().mockResolvedValue({ status: 'ok' }) };
    memory = {
      checkHeap: jest.fn().mockResolvedValue({ memory_heap: { status: 'up' } }),
      checkRSS: jest.fn().mockResolvedValue({ memory_rss: { status: 'up' } }),
    };
    database = { pingCheck: jest.fn().mockResolvedValue({ database: { status: 'up' } }) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: healthCheck },
        { provide: MemoryHealthIndicator, useValue: memory },
        { provide: TypeOrmHealthIndicator, useValue: database },
        { provide: ConfigService, useValue: { getOrThrow: () => buildAppConfig() } },
      ],
    }).compile();

    controller = module.get(HealthController);
  });

  describe('liveness()', () => {
    // Liveness contesta "¿hay que reiniciar el proceso?". Consultar la base aquí haría
    // que una caída de Postgres provocara reinicios en cadena que no arreglan nada.
    it('debería invocar check() sin indicadores, sin tocar la base', async () => {
      // Act
      const result = await controller.liveness();

      // Assert
      expect(result.status).toBe('ok');
      expect(healthCheck.check).toHaveBeenCalledWith([]);
      expect(database.pingCheck).not.toHaveBeenCalled();
    });
  });

  // `readiness()` y `check()` comparten indicadores, así que se verifican en paralelo:
  // duplicar el cuerpo hacía que una divergencia entre ambos pasara desapercibida.
  describe.each([
    ['readiness', (c: HealthController) => c.readiness()],
    ['check', (c: HealthController) => c.check()],
  ])('%s()', (_name, invoke) => {
    it('debería comprobar memoria y base con los límites configurados', async () => {
      // Act
      await invoke(controller);

      // Assert
      expect(healthCheck.check).toHaveBeenCalledTimes(1);
      const indicators = healthCheck.check.mock.calls[0][0] as (() => Promise<unknown>)[];
      expect(indicators).toHaveLength(3);
      await Promise.all(indicators.map((fn) => fn()));
      expect(memory.checkHeap).toHaveBeenCalledWith('memory_heap', 300 * 1024 * 1024);
      expect(memory.checkRSS).toHaveBeenCalledWith('memory_rss', 600 * 1024 * 1024);
      expect(database.pingCheck).toHaveBeenCalledWith('database');
    });

    it('debería propagar el rechazo cuando la base no responde', async () => {
      // Arrange
      database.pingCheck.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      healthCheck.check.mockImplementationOnce(async (indicators: (() => Promise<unknown>)[]) => {
        await Promise.all(indicators.map((fn) => fn()));
        return { status: 'ok' };
      });

      // Act + Assert
      await expect(invoke(controller)).rejects.toThrow('ECONNREFUSED');
    });

    it('debería propagar el rechazo cuando el indicador de memoria falla', async () => {
      // Arrange
      memory.checkHeap.mockRejectedValueOnce(new Error('OOM'));
      healthCheck.check.mockImplementationOnce(async (indicators: (() => Promise<unknown>)[]) => {
        await Promise.all(indicators.map((fn) => fn()));
        return { status: 'ok' };
      });

      // Act + Assert
      await expect(invoke(controller)).rejects.toThrow('OOM');
    });
  });
});
