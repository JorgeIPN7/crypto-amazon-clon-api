import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

import type { AppConfig } from '@config/app.config';

/**
 * Construye el documento OpenAPI. **Es el único `createDocument` del repositorio.**
 *
 * Existe por la misma razón que `buildScalarConfig`: había dos sitios construyendo el documento
 * —el runtime y el guardián del contrato— y el guardián auditaba uno mientras la aplicación
 * publicaba otro. Se descubrió porque sus `operationIdFactory` divergían, pero el formato del
 * `operationId` era el síntoma, no la causa: con dos llamadas, el título, la versión, el
 * `addBearerAuth` o cualquier `extraModels` que alguien añada en un solo lado vuelven a
 * separarlos, y el guardián seguiría dando el visto bueno a un documento que nadie publica.
 *
 * Cualquier cambio en el documento entra aquí, y `openapi-document.spec.ts` comprueba que no
 * aparezca un segundo `createDocument` en `src/`.
 */
export function buildOpenApiDocument(app: INestApplication, appCfg: AppConfig): OpenAPIObject {
  return SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Nest Base Template API')
      .setDescription('Production-ready NestJS 11 service')
      .setVersion(appCfg.apiVersion)
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
      .build(),
    {
      // Con la clave del controller delante, como el factory por defecto de `@nestjs/swagger`.
      // Devolver solo `methodKey` invita a colisiones en cuanto exista un segundo controller
      // con un `findOne`, y el guardián fallaría por `operationId` duplicado señalando un sitio
      // que ese cambio no tocó.
      operationIdFactory: (controllerKey, methodKey) => `${controllerKey}_${methodKey}`,
    },
  );
}
