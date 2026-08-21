import type { DataSource } from 'typeorm';

// Imports relativos a propósito, como data-source.ts y seed-admin.ts: este archivo corre
// bajo ts-node vía `pnpm outbox:relay`, fuera del contenedor de Nest.
import cliDataSource from '../data-source';

type OutboxRow = {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
};

/**
 * Relay del outbox de orders (spec §6): lee las filas con `processed_at IS NULL`, las
 * «publica» —hoy, un log estructurado por stdout; cuando BullMQ entre (Tier 2, backlog
 * #10) solo cambia esta línea— y las marca procesadas.
 *
 * Semántica at-least-once A PROPÓSITO: se publica ANTES de marcar, así que un proceso que
 * muera entre ambas re-publicará esa fila en la siguiente corrida. Para un log es inocuo
 * y para un broker real es la semántica correcta (la deduplicación es del consumidor).
 *
 * Sin `FOR UPDATE SKIP LOCKED`: es una CLI manual de proceso único, no un dispatcher
 * concurrente — añadirlo hoy sería fingir un problema que el diseño excluye (sin demonio
 * residente hasta el trigger de Tier 2).
 */
export async function relayOrdersOutbox(dataSource: DataSource): Promise<number> {
  const rows = await dataSource.query<OutboxRow[]>(
    `SELECT id, event_type, payload
       FROM orders_outbox
      WHERE processed_at IS NULL
      ORDER BY occurred_at ASC`,
  );

  for (const row of rows) {
    // El único log del módulo fuera del bloque CLI: ES la publicación, no un adorno.
    // `no-console` está apagado para esta carpeta en `eslint.config.mjs`, con el motivo
    // escrito allí — mismo precedente que seed-admin.
    console.log(`[outbox:relay] ${row.event_type} ${JSON.stringify(row.payload)}`);
    await dataSource.query(`UPDATE orders_outbox SET processed_at = now() WHERE id = $1`, [row.id]);
  }

  return rows.length;
}

// CLI entry (patrón require.main de main.ts y seed-admin.ts).
if (require.main === module) {
  cliDataSource
    .initialize()
    .then(() => relayOrdersOutbox(cliDataSource))
    .then((count) => {
      console.log(`[outbox:relay] ${count} evento(s) publicados`);
      return cliDataSource.destroy();
    })
    .catch((error: unknown) => {
      console.error('[outbox:relay] failed:', error);
      process.exit(1);
    });
}
