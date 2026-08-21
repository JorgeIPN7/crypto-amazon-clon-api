import { buildScalarConfig } from '../scalar-config';

describe('buildScalarConfig', () => {
  it('debería dejar proxyUrl vacío', () => {
    // Arrange
    const params = baseParams();

    // Act
    const config = buildScalarConfig(params);

    // Assert
    // El default del esquema de Scalar es `https://proxy.scalar.com`: sin anularlo, las
    // cabeceras que alguien escriba en el playground viajarían a un tercero.
    expect(config.proxyUrl).toBe('');
  });

  it('debería desactivar las fuentes externas y la telemetría', () => {
    // Arrange
    const params = baseParams();

    // Act
    const config = buildScalarConfig(params);

    // Assert
    expect(config.withDefaultFonts).toBe(false);
    expect(config.telemetry).toBe(false);
  });

  it('debería desactivar el agente, que se autoactiva en localhost', () => {
    // Arrange
    const params = baseParams();

    // Act
    const config = buildScalarConfig(params);

    // Assert
    // La clave es `agent.disabled`, no `agentEnabled` — esta última es estado interno del
    // componente Vue y Scalar la ignoraría en silencio.
    expect(config.agent?.disabled).toBe(true);
  });

  it('debería apuntar el bundle a una ruta del propio origen', () => {
    // Arrange
    const params = baseParams();

    // Act
    const config = buildScalarConfig(params);

    // Assert
    expect(config.cdn).toBe('/api/docs/scalar.abc123.js');
    expect(String(config.cdn)).not.toContain('jsdelivr');
  });

  it('debería descargar el documento por enlace directo, sin construir un Blob', () => {
    // Arrange
    const params = baseParams();

    // Act
    const config = buildScalarConfig(params);

    // Assert
    // `direct` enlaza a la URL del documento; las otras variantes lo arman en memoria con
    // `Blob`/`createObjectURL` y obligarían a abrir `blob:` en la CSP.
    expect(config.documentDownloadType).toBe('direct');
  });

  it('debería propagar el nonce recibido', () => {
    // Arrange
    const params = baseParams({ nonce: 'n-123' });

    // Act
    const config = buildScalarConfig(params);

    // Assert
    expect(config.nonce).toBe('n-123');
  });

  it('debería no mencionar ningún origen de terceros en toda la configuración', () => {
    // Arrange
    const params = baseParams();

    // Act
    const serialized = JSON.stringify(buildScalarConfig(params));

    // Assert
    // Barrido final: cubre cualquier opción futura que alguien añada apuntando fuera.
    expect(serialized).not.toContain('scalar.com');
    expect(serialized).not.toContain('jsdelivr');
  });
});

// Helpers

const baseParams = (overrides: Partial<Parameters<typeof buildScalarConfig>[0]> = {}) => ({
  bundleUrl: '/api/docs/scalar.abc123.js',
  documentUrl: '/api/docs/json',
  nonce: 'nonce-test',
  title: 'Test API',
  ...overrides,
});
