/**
 * `role` se tipa `string` y no con el union `UserRole`: ese union pertenece a `users` (el rol
 * es del perfil, no de la credencial) y auth no puede importarlo — regla 3 del gate de
 * boundaries. Es el mismo criterio, y por la misma razón, que `AuthenticatedUser` en
 * `common/auth/`: el contexto dueño garantiza el contenido, el consumidor publica la forma.
 */
export type TokenClaims = { sub: string; email: string; role: string };
export type SignedToken = { accessToken: string; expiresInSeconds: number };

/**
 * Puerto de salida (driven): la firma del token es infraestructura (@nestjs/jwt).
 * `abstract class` —tipo y token en la misma referencia— por el mismo motivo que
 * `credential.repository.ts`. `TokenClaims` y `SignedToken` siguen siendo `type`: son datos.
 */
export abstract class TokenSigner {
  abstract sign(claims: TokenClaims): Promise<SignedToken>;
}
