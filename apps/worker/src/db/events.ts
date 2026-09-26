import type { MonitorEvent } from '@mirowler/core'

export const insertEvent = async (db: D1Database, e: MonitorEvent) => {
  await db
    .prepare(
      'INSERT OR IGNORE INTO events (id, run_id, monitor_id, kind, summary, occurred_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(e.id, e.runId, e.monitorId, e.kind, e.summary, e.occurredAt)
    .run()
}
