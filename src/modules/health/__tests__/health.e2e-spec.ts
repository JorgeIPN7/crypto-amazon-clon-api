import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';

import { createTestApp } from '@test/helpers/create-test-app';

describe('HealthController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/v1/health', () => {
    it('debería responder 200 con la cabecera x-request-id', async () => {
      // Arrange
      // (app is bootstrapped in beforeAll)

      // Act
      const response = await request(app.getHttpServer()).get('/api/v1/health');

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.headers['x-request-id']).toBeDefined();
    });

    it('debería devolver al cliente el x-request-id recibido', async () => {
      // Arrange
      const correlation = 'e2e-corr-id-123';

      // Act
      const response = await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('x-request-id', correlation);

      // Assert
      expect(response.status).toBe(200);
      expect(response.headers['x-request-id']).toBe(correlation);
    });
  });

  describe('GET /api/v1/health/liveness', () => {
    it('debería responder 200 con status ok', async () => {
      // Arrange
      // (app is bootstrapped in beforeAll)

      // Act
      const response = await request(app.getHttpServer()).get('/api/v1/health/liveness');

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
    });
  });

  describe('GET /api/v1/health/readiness', () => {
    it('debería responder 200 con status ok', async () => {
      // Arrange
      // (app is bootstrapped in beforeAll)

      // Act
      const response = await request(app.getHttpServer()).get('/api/v1/health/readiness');

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
    });
  });
});
