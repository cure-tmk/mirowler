import { type Monitor, type MonitorConfig, monitorConfigSchema } from '@mirowler/core'

type MonitorRow = {
  id: string
  enabled: number
  config_json: string
  config_version: number
  next_run_at: string
}

const toMonitor = (row: MonitorRow): Monitor => ({
  ...monitorConfigSchema.parse(JSON.parse(row.config_json)),
  id: row.id,
  enabled: row.enabled === 1,
  configVersion: row.config_version,
  nextRunAt: row.next_run_at,
})

export const listMonitors = async (db: D1Database): Promise<Monitor[]> => {
  const { results } = await db.prepare('SELECT * FROM monitors ORDER BY created_at').all<MonitorRow>()
  return results.map(toMonitor)
}

export const getMonitor = async (db: D1Database, id: string): Promise<Monitor | null> => {
  const row = await db.prepare('SELECT * FROM monitors WHERE id = ?').bind(id).first<MonitorRow>()
  return row ? toMonitor(row) : null
}

export const insertMonitor = async (db: D1Database, config: MonitorConfig, now: string): Promise<string> => {
  const id = crypto.randomUUID()
  await db
    .prepare(
      'INSERT INTO monitors (id, name, config_json, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(id, config.name, JSON.stringify(config), now, now, now)
    .run()
  return id
}

export const setMonitorEnabled = async (db: D1Database, id: string, enabled: boolean, now: string) => {
  const { meta } = await db
    .prepare('UPDATE monitors SET enabled = ?, updated_at = ? WHERE id = ?')
    .bind(enabled ? 1 : 0, now, id)
    .run()
  return meta.changes === 1
}

/** Claims due monitors with one conditional UPDATE per row. A `running_since` older than `staleBefore` counts as abandoned and is taken over. */
export const claimDue = async (db: D1Database, now: string, staleBefore: string, limit: number): Promise<Monitor[]> => {
  const { results } = await db
    .prepare('SELECT * FROM monitors WHERE enabled = 1 AND next_run_at <= ? ORDER BY next_run_at LIMIT ?')
    .bind(now, limit)
    .all<MonitorRow>()
  const claim = db.prepare(
    'UPDATE monitors SET running_since = ?1 WHERE id = ?2 AND next_run_at <= ?1 AND (running_since IS NULL OR running_since < ?3)',
  )
  const claimed: Monitor[] = []
  for (const row of results) {
    const { meta } = await claim.bind(now, row.id, staleBefore).run()
    if (meta.changes === 1) {
      claimed.push(toMonitor(row))
    }
  }
  return claimed
}

export const finishRun = async (db: D1Database, id: string, nextRunAt: string, lastValidRunId?: string) => {
  await db
    .prepare(
      'UPDATE monitors SET running_since = NULL, next_run_at = ?, last_valid_run_id = COALESCE(?, last_valid_run_id) WHERE id = ?',
    )
    .bind(nextRunAt, lastValidRunId ?? null, id)
    .run()
}
