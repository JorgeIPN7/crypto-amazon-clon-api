import { ARGON2_PARAMS } from '@config/auth.config';

import { DUMMY_PASSWORD_HASH } from '../../../domain/ports/password-hasher';

/**
 * Casos acordados — Tabla H (`DUMMY_PASSWORD_HASH`, revisión adversarial del ciclo 4).
 *
 * | #   | Caso                                              | Esperado                                  |
 * | --- | ------------------------------------------------- | ----------------------------------------- |
 * | H1  | Cabecera PHC del dummy vs `ARGON2_PARAMS`         | `m`/`t`/`p` idénticos a la config         |
 * | H2  | Variante del dummy vs `ARGON2_PARAMS.type`        | `argon2id`, la misma que usa el hasher    |
 *
 * Por qué existe este spec. `argon2.verify()` deriva el costo del PROPIO string PHC que se le
 * pasa, no de la config: el dummy lleva `m=65536,p=4,t=3` incrustado y hasta ahora nada lo
 * ataba a `ARGON2_PARAMS`. Si alguien sube `memoryCost` siguiendo OWASP, el hasher real
 * empieza a costar el doble y el camino «sin credencial utilizable» de `LoginUseCase` —el que
 * verifica contra el dummy— se queda en el costo viejo. El oráculo de timing vuelve, y la
 * propiedad anti-enumeración de `login.use-case.spec.ts` sigue VERDE porque cuenta llamadas a
 * `verify`, no milisegundos. Este es el único gate que cierra ese hueco.
 *
 * El SUT es la constante, no el puerto: `PasswordHasher` solo declara miembros `abstract` y no
 * hay nada que probar en él. El archivo mantiene el 1:1 con `domain/ports/password-hasher.ts`.
 */

/**
 * `ARGON2_PARAMS.type` es el enum del paquete `argon2` por índice — `config/auth.config.ts` no
 * puede importar el paquete (lo dice su propio comentario), así que guarda el número. Este
 * mapa lo traduce al nombre que aparece en la cabecera PHC, para que el caso compare
 * significados y no dos literales sueltos.
 */
const ARGON2_VARIANTS = ['argon2d', 'argon2i', 'argon2id'] as const;

describe('DUMMY_PASSWORD_HASH', () => {
  it('debería llevar los mismos parámetros de costo que ARGON2_PARAMS', () => {
    // Arrange: `$argon2id$v=19$m=…,p=…,t=…$salt$hash` — el 4º segmento son los parámetros.
    const [, , , params = ''] = DUMMY_PASSWORD_HASH.split('$');

    // Act
    const parsed = Object.fromEntries(
      params.split(',').map((pair) => {
        const [key = '', value = ''] = pair.split('=');
        return [key, Number(value)];
      }),
    );

    // Assert
    expect(parsed).toEqual({
      m: ARGON2_PARAMS.memoryCost,
      t: ARGON2_PARAMS.timeCost,
      p: ARGON2_PARAMS.parallelism,
    });
  });

  it('debería ser de la misma variante de argon2 que la configurada', () => {
    // Arrange
    const [, variant] = DUMMY_PASSWORD_HASH.split('$');

    // Act
    const configured = ARGON2_VARIANTS[ARGON2_PARAMS.type];

    // Assert
    expect(variant).toBe(configured);
  });
});
