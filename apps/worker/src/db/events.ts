import type { MonitorEvent } from '@mirowler/core'

export const insertEvent = async (db: D1Database, e: MonitorEvent) => {
  await db
    .prepare(
      'INSERT OR IGNORE INTO events (id, run_id, monitor_id, kind, summary, occurred_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(e.id, e.runId, e.monitorId, e.kind, e.summary, e.occurredAt)
    .run()
}

export const listEventsByRuns = async (db: D1Database, runIds: string[]): Promise<MonitorEvent[]> => {
  const { results } = await db
    .prepare(
      `SELECT id, run_id AS runId, monitor_id AS monitorId, kind, summary, occurred_at AS occurredAt
       FROM events WHERE run_id IN (SELECT value FROM json_each(?)) ORDER BY occurred_at`,
    )
    .bind(JSON.stringify(runIds))
    .all<MonitorEvent>()
  return results
}
