import { envSchema, type Env } from './env.schema';

/**
 * Variables retiradas y su reemplazo.
 *
 * La comprobación vive aquí y no en un `.refine()` del schema porque `z.object()` hace *strip*
 * de las claves desconocidas **antes** de ejecutar los refines: dentro del refine,
 * `SWAGGER_ENABLED` ya no existe. Y relajar el objeto a `passthrough` para verla dejaría pasar
 * todo `process.env` —PATH, HOME…—, rompiendo el test que garantiza que el schema solo emite
 * escalares. Aquí el objeto crudo todavía está entero.
 */
const RENAMED_VARIABLES: Readonly<Record<string, string>> = {
  SWAGGER_ENABLED: 'DOCS_ENABLED',
  SWAGGER_PATH: 'DOCS_PATH',
};

export function validateEnv(raw: Record<string, unknown>): Env {
  // Error duro, no warning: un warning en el arranque de un contenedor no lo lee nadie.
  //
  // El mensaje dice «renombrada», no «por seguridad», porque el riesgo real es el inverso al
  // que parece: `DOCS_ENABLED` hereda el default `false`, así que nada se publica solo. Lo que
  // pasa es lo contrario — quien tenía la documentación encendida en staging se queda sin ella,
  // y quien personalizó la ruta ve cambiarla. Las dos cosas, en silencio.
  const renamed = Object.keys(RENAMED_VARIABLES).filter((key) => key in raw);
  if (renamed.length > 0) {
    const lines = renamed.map(
      (key) => `  - ${key} is no longer read: it was renamed to ${RENAMED_VARIABLES[key] ?? ''}.`,
    );
    throw new Error(`Invalid environment variables:\n${lines.join('\n')}`);
  }

  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }

  return result.data;
}
