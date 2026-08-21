-- Crea la base que usa `pnpm test:e2e`, junto a la de desarrollo, dentro de la misma
-- instancia. Así `pnpm db:up` sigue siendo el único comando para dejar el entorno listo.
--
-- El entrypoint de la imagen de Postgres solo ejecuta este directorio cuando inicializa
-- un volumen vacío: si ya tenías el contenedor levantado de antes, hace falta un
-- `pnpm db:reset` para que se aplique.
--
-- El nombre va literal porque un `.sql` no interpola variables de entorno. Si cambias
-- `DB_DATABASE`, cambia también este nombre y el de `test/setup-env.ts`.
CREATE DATABASE nest_base_template_test;
