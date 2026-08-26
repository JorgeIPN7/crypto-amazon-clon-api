import { Injectable } from '@nestjs/common';

/**
 * Lo que un APM necesita para agrupar un incidente y poder correlacionarlo con los logs.
 *
 * `requestId` es la pieza que lo hace útil: es el mismo que viaja en el cuerpo de la respuesta de
 * error y el mismo que pino escribe en cada línea, así que un incidente del APM lleva a las
 * líneas de log de esa petición sin buscar por marca de tiempo.
 */
export type ReportedErrorContext = {
  requestId: string;
  path: string;
  statusCode: number;
};

/**
 * Puerto de salida para reportar incidentes a un APM (Sentry, Datadog, Bugsnag…).
 *
 * **Por qué un puerto y no la dependencia directa.** `bridge-fital-pti-api` decora su filtro con
 * `@SentryExceptionCaptured()`, lo que ata el filtro —una pieza de infraestructura del propio
 * repo— a un proveedor concreto y, sobre todo, mete `@sentry/nestjs` en el árbol de TODO el que
 * use la plantilla. Un APM envía datos fuera del proceso; esa es una decisión de quien despliega,
 * no de quien escribe el template. Con el puerto, el seam existe y el proveedor no.
 *
 * **Cómo enchufar Sentry**, si es lo que se quiere (cinco líneas, sin tocar el filtro):
 *
 * ```ts
 * // 1. pnpm add @sentry/nestjs   y  Sentry.init({ dsn }) antes de crear la app
 * @Injectable()
 * export class SentryErrorReporter implements ErrorReporter {
 *   report(error: unknown, context: ReportedErrorContext): void {
 *     Sentry.captureException(error, { tags: { path: context.path }, extra: context });
 *   }
 * }
 * // 2. en app.module.ts:  { provide: ErrorReporter, useClass: SentryErrorReporter }
 * ```
 *
 * Es `abstract class` y no `type` + `Symbol`, como todos los puertos del repo: sobrevive a la
 * compilación, así que la misma referencia es el tipo y el token de inyección.
 */
export abstract class ErrorReporter {
  /**
   * ⚠️ **No devuelve promesa y no debe lanzar.** Reportar es un efecto lateral de observabilidad:
   * si el APM está caído, el cliente tiene que recibir su 500 igual. `AllExceptionsFilter` lo
   * envuelve en `try/catch` por si un adaptador incumple esto, y hay un caso que lo fija.
   */
  abstract report(error: unknown, context: ReportedErrorContext): void;
}

/**
 * Adaptador por defecto: **no hace nada**, a propósito.
 *
 * No loguea porque `AllExceptionsFilter` ya escribe ese error con el mismo `requestId` y el mismo
 * `path` justo antes de llamar aquí; un adaptador que volviera a loguearlo duplicaría cada
 * incidente en el archivo de log y haría creer que ocurrieron dos.
 *
 * Su trabajo es que el seam exista y esté cableado —el filtro llama, el contenedor resuelve— para
 * que enchufar un APM real sea cambiar una línea del módulo y no ir a buscar dónde tocar.
 */
@Injectable()
export class NoopErrorReporter implements ErrorReporter {
  report(): void {
    // Intencionadamente vacío. Ver el JSDoc de la clase.
  }
}
