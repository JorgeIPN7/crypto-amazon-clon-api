/**
 * Forma laxa del solicitante autenticado que JwtAuthGuard adjunta a `request.user`.
 * Deliberadamente `string` y no `UserRole` (criterio D1-a): `common` no puede importar de
 * `modules/users`, así que publica la forma; el dominio garantiza el contenido. La
 * asignabilidad TokenClaims → AuthenticatedUser la fija un chequeo de compilación en
 * `__tests__/decorators/current-user.decorator.spec.ts`.
 */
export type AuthenticatedUser = { sub: string; email: string; role: string };
