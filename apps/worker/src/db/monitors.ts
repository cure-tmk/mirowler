import { type Monitor, type MonitorConfig, monitorConfigSchema } from '@mirowler/core'

type MonitorRow = {
  id: string
  enabled: number
  config_json: string
  config_version: number
  next_run_at: string
  failure_count: number
}

const toMonitor = (row: MonitorRow): Monitor => ({
  ...monitorConfigSchema.parse(JSON.parse(row.config_json)),
  id: row.id,
  enabled: row.enabled === 1,
  configVersion: row.config_version,
  nextRunAt: row.next_run_at,
  failureCount: row.failure_count,
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

/** Replaces the config, bumps its version and resets the baseline so the next tick re-baselines under the new config. */
export const updateMonitorConfig = async (db: D1Database, id: string, config: MonitorConfig, now: string) => {
  const { meta } = await db
    .prepare(
      'UPDATE monitors SET name = ?, config_json = ?, config_version = config_version + 1, last_valid_run_id = NULL, next_run_at = ?, updated_at = ? WHERE id = ?',
    )
    .bind(config.name, JSON.stringify(config), now, now, id)
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

export const claimById = async (db: D1Database, id: string, now: string, staleBefore: string) => {
  const row = await db
    .prepare(
      'UPDATE monitors SET running_since = ?1 WHERE id = ?2 AND (running_since IS NULL OR running_since < ?3) RETURNING *',
    )
    .bind(now, id, staleBefore)
    .first<MonitorRow>()
  return row ? toMonitor(row) : null
}

/** Leaves the schedule, failure count and baseline alone when the config was edited during the run. */
export const finishRun = async (
  db: D1Database,
  id: string,
  configVersion: number,
  { nextRunAt, failureCount, lastValidRunId }: { nextRunAt: string; failureCount: number; lastValidRunId?: string },
) => {
  await db
    .prepare(
      `UPDATE monitors SET running_since = NULL,
        next_run_at = CASE WHEN config_version = ?1 THEN ?2 ELSE next_run_at END,
        failure_count = CASE WHEN config_version = ?1 THEN ?3 ELSE failure_count END,
        last_valid_run_id = CASE WHEN config_version = ?1 THEN COALESCE(?4, last_valid_run_id) ELSE last_valid_run_id END
      WHERE id = ?5`,
    )
    .bind(configVersion, nextRunAt, failureCount, lastValidRunId ?? null, id)
    .run()
}
