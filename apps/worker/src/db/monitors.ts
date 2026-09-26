import { type MatchState, type Monitor, type MonitorConfig, monitorConfigSchema } from '@mirowler/core'

export const STALE_MS = 10 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const HEALTH_WINDOW = 20

type MonitorRow = {
  id: string
  enabled: number
  config_json: string
  config_version: number
  next_run_at: string
  failure_count: number
  running_since: string | null
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

export type MonitorHealth = Monitor & {
  consecutiveUnknown: number
  failureRate: number | null
  lastRun: { at: string; state: MatchState | null } | null
  delayed: boolean
}

type HealthRunRow = {
  monitor_id: string
  scheduled_at: string
  finished_at: string | null
  status: string
  state: MatchState | null
}

const isDelayed = (m: Monitor, runningSince: string | null, now: Date) => {
  if (!m.enabled) {
    return false
  }
  if (runningSince && Date.parse(runningSince) < now.getTime() - STALE_MS) {
    return true
  }
  const allowedMs = m.schedule.type === 'interval' ? 2 * m.schedule.minutes * 60_000 : DAY_MS
  return now.getTime() - Date.parse(m.nextRunAt) > allowedMs
}

const toHealth = (row: MonitorRow, runs: HealthRunRow[], now: Date): MonitorHealth => {
  const monitor = toMonitor(row)
  const firstKnown = runs.findIndex((r) => r.state !== 'unknown')
  const failures = runs.filter((r) => r.state === 'unknown' || r.status === 'error').length
  const last = runs[0]
  return {
    ...monitor,
    consecutiveUnknown: firstKnown === -1 ? runs.length : firstKnown,
    failureRate: runs.length ? failures / runs.length : null,
    lastRun: last ? { at: last.finished_at ?? last.scheduled_at, state: last.state } : null,
    delayed: isDelayed(monitor, row.running_since, now),
  }
}

/** Monitors with health over their last 20 finished runs under the current config. `delayed` means the schedule or a claimed run is overdue. */
export const listMonitorHealth = async (db: D1Database, now: Date): Promise<MonitorHealth[]> => {
  const [monitors, runs] = await db.batch([
    db.prepare('SELECT * FROM monitors ORDER BY created_at'),
    db
      .prepare(
        `SELECT monitor_id, scheduled_at, finished_at, status, state FROM (
          SELECT runs.*, row_number() OVER (PARTITION BY runs.monitor_id ORDER BY runs.scheduled_at DESC) AS rn
          FROM runs JOIN monitors ON monitors.id = runs.monitor_id AND monitors.config_version = runs.config_version
          WHERE runs.status != 'running'
        ) WHERE rn <= ? ORDER BY monitor_id, rn`,
      )
      .bind(HEALTH_WINDOW),
  ])
  const byMonitor = new Map<string, HealthRunRow[]>()
  for (const r of (runs?.results ?? []) as HealthRunRow[]) {
    byMonitor.set(r.monitor_id, [...(byMonitor.get(r.monitor_id) ?? []), r])
  }
  return ((monitors?.results ?? []) as MonitorRow[]).map((row) => toHealth(row, byMonitor.get(row.id) ?? [], now))
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
