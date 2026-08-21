// src/__tests__/secretlint.spec.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { DUMMY_PASSWORD_HASH } from '@modules/auth/domain/ports/password-hasher';

import { lintContent } from './helpers/secretlint-runner';

const ROOT = path.resolve(__dirname, '../..');

describe('secretlint gate', () => {
  describe('rechazos', () => {
    it('debería rechazar una access key de AWS', async () => {
      // Arrange — sintética y NO en la lista de ignorados embebida (AKIAIOSFODNN7EXAMPLE lo
      // está); concatenada para no disparar el propio hook sobre este spec. Solo dispara con
      // `enableIDScanRule: true` en `.secretlintrc.json`: el escaneo de IDs de acceso viene
      // apagado por defecto en @secretlint/secretlint-rule-aws (de serie el preset solo
      // detecta `aws_secret_access_key = <40 chars>`, caso S1b) — hallazgo del spike de la
      // Task 1, ver su enmienda en el plan de supply-chain
      const content = `aws_access_key_id = ${'AKIA' + 'QWERTYUIOPASDFGH'}`;
      // Act
      const messages = await lintContent(content, 'credentials.txt');
      // Assert
      expect(messages.length).toBeGreaterThanOrEqual(1);
    });

    it('debería rechazar una secret access key de AWS', async () => {
      // Arrange — forma asignación de 40 chars, la detección de serie del preset (spike T1)
      const content = `aws_secret_access_key = ${'A1b2C3d4E5f6G7h8I9j0' + 'K1l2M3n4O5p6Q7r8S9t0'}`;
      // Act
      const messages = await lintContent(content, 'credentials.txt');
      // Assert
      expect(messages.length).toBeGreaterThanOrEqual(1);
    });

    it('debería rechazar un token personal de GitHub', async () => {
      // Arrange
      const content = `token: ${'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'}`;
      // Act
      const messages = await lintContent(content, 'ci-notes.md');
      // Assert
      expect(messages.length).toBeGreaterThanOrEqual(1);
    });

    it('debería rechazar una clave privada PEM', async () => {
      // Arrange — el cuerpo base64 necesita ≥100 chars: @secretlint/secretlint-rule-privatekey
      // trata bloques más cortos como placeholder por diseño (heurística anti-falso-positivo
      // documentada en su fuente: la clave real más corta, ECDSA-256, ronda 288 chars), así que
      // una sola línea de 64 no dispara la regla — se añade una segunda línea sintética
      // (alfabeto base64 en orden, para que quede obvio que no es una clave real) solo para
      // cruzar el umbral de longitud, sin tocar el texto del caso
      const content = [
        '-----BEGIN RSA PRIVATE KEY-----',
        'MIIEpAIBAAKCAQEA7qF5o5W5x9J1kx3M2H8mJ9YV5T6C2b1u8Qq3fJ4dK7nL2wXz',
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
        '-----END RSA PRIVATE KEY-----',
      ].join('\n');
      // Act
      const messages = await lintContent(content, 'deploy-key.pem');
      // Assert
      expect(messages.length).toBeGreaterThanOrEqual(1);
    });

    it('debería rechazar una URL con credenciales embebidas', async () => {
      // Arrange — concatenada por el mismo motivo que S1/S1b/S2: como literal contiguo,
      // secretlint la detecta también al escanear este propio archivo fuente (Step 4 del plan)
      const content = `DATABASE_URL=${'https://user:S3cretPass' + '@example.com/db'}`;
      // Act
      const messages = await lintContent(content, 'notes.txt');
      // Assert
      expect(messages.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('aceptaciones (anti-falso-positivo)', () => {
    it('debería aceptar texto y código sin secretos', async () => {
      // Arrange
      const content = `export const sum = (a: number, b: number): number => a + b;`;
      // Act
      const messages = await lintContent(content, 'sum.ts');
      // Assert
      expect(messages).toEqual([]);
    });

    it('debería aceptar el hash dummy argon2id del árbol', async () => {
      // Arrange — importado del puerto real: si ese archivo se edita y stagea, se re-escanea
      const content = `const DUMMY_PASSWORD_HASH = '${DUMMY_PASSWORD_HASH}';`;
      // Act
      const messages = await lintContent(content, 'password-hasher.ts');
      // Assert
      expect(messages).toEqual([]);
    });

    it('debería aceptar el contenido actual de .env.example', async () => {
      // Arrange — fixture dinámico: protege el flujo real de añadir variables
      const content = readFileSync(path.join(ROOT, '.env.example'), 'utf8');
      // Act
      const messages = await lintContent(content, '.env.example');
      // Assert
      expect(messages).toEqual([]);
    });
  });
});
