import { SYSTEM_ACTOR_PREFIX, SYSTEM_ACTORS } from '../../domain/system-actor';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const actors = Object.values(SYSTEM_ACTORS);

describe('SYSTEM_ACTORS', () => {
  describe('la garantía que hace seguro compartir columna con los ids de usuario', () => {
    // `created_by` es una sola columna `varchar` para actores humanos y automáticos. Si un
    // actor de sistema pudiera tener forma de UUID v4, una consulta de auditoría por id de
    // usuario podría atribuirle a una persona lo que hizo un proceso.
    it.each(actors)('debería no tener forma de UUID v4: %s', (actor) => {
      // Arrange & Act
      const looksLikeUserId = UUID_V4.test(actor);

      // Assert
      expect(looksLikeUserId).toBe(false);
    });

    it.each(actors)('debería llevar el prefijo que lo identifica como automático: %s', (actor) => {
      // Arrange & Act
      const prefixed = actor.startsWith(SYSTEM_ACTOR_PREFIX);

      // Assert
      expect(prefixed).toBe(true);
    });

    it('debería no repetir ningún valor entre actores distintos', () => {
      // Arrange & Act
      const unique = new Set(actors);

      // Assert
      // Dos claves con el mismo valor harían indistinguibles dos orígenes en la traza, que es
      // exactamente lo que este catálogo existe para evitar.
      expect(unique.size).toBe(actors.length);
    });
  });

  describe('el catálogo', () => {
    it('debería nombrar los tres orígenes automáticos que hoy escriben filas', () => {
      // Arrange & Act
      const names = Object.keys(SYSTEM_ACTORS).sort();

      // Assert
      // Cerrado a propósito: un origen nuevo añade su constante Y esta lista, en el mismo
      // cambio. Sin la lista, un actor añadido a medias pasaría inadvertido.
      expect(names).toEqual(['ADMIN_SEED', 'OUTBOX_RELAY', 'PUBLIC_REGISTRATION']);
    });
  });
});
