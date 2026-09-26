import type { MatchState, MonitorEvent, Observation, ObservedValue } from '@mirowler/core'
import { listEventsByRuns } from './events'
import { listNotificationsByEvents, type MonitorNotification } from './notifications'

type RunRow = {
  run_id: string
  monitor_id: string
  config_version: number
  scheduled_at: string
  started_at: string | null
  finished_at: string | null
  status: string
  value_json: string | null
  state: MatchState | null
  reason: string | null
  error: string | null
}

export type Run = {
  runId: string
  configVersion: number
  scheduledAt: string
  startedAt: string | null
  finishedAt: string | null
  status: string
  value: ObservedValue | null
  state: MatchState | null
  reason: string | null
  error: string | null
}

const parseValue = (json: string | null): ObservedValue | null => (json ? JSON.parse(json) : null)

export const insertRun = async (
  db: D1Database,
  run: { runId: string; monitorId: string; configVersion: number; scheduledAt: string; startedAt: string },
) => {
  await db
    .prepare(
      `INSERT INTO runs (run_id, monitor_id, config_version, scheduled_at, started_at, status) VALUES (?, ?, ?, ?, ?, 'running')
       ON CONFLICT (run_id) DO UPDATE SET started_at = excluded.started_at, status = 'running',
         finished_at = NULL, value_json = NULL, state = NULL, reason = NULL, content_hash = NULL, error = NULL`,
    )
    .bind(run.runId, run.monitorId, run.configVersion, run.scheduledAt, run.startedAt)
    .run()
}

/** Returns false when the run is no longer `running`, e.g. it was taken over. */
export const completeRun = async (db: D1Database, observation: Observation, finishedAt: string) => {
  const { meta } = await db
    .prepare(
      `UPDATE runs SET finished_at = ?, status = 'done', value_json = ?, state = ?, reason = ?, error = NULL WHERE run_id = ? AND status = 'running'`,
    )
    .bind(
      finishedAt,
      observation.value ? JSON.stringify(observation.value) : null,
      observation.state,
      observation.reason ?? null,
      observation.runId,
    )
    .run()
  return meta.changes === 1
}

export const failRun = async (db: D1Database, runId: string, error: string, finishedAt: string) => {
  await db
    .prepare(
      `UPDATE runs SET finished_at = ?, status = 'error', state = 'unknown', error = ? WHERE run_id = ? AND status = 'running'`,
    )
    .bind(finishedAt, error, runId)
    .run()
}

/**
 * Inserts the run for a claim only while the monitor is still held since `claimedAt`, first marking the monitor's other `running` rows as taken over.
 * Returns false when the claim has been lost.
 */
export const beginRun = async (
  db: D1Database,
  run: { runId: string; monitorId: string; configVersion: number; scheduledAt: string; startedAt: string },
  claimedAt: string,
) => {
  const held = 'EXISTS (SELECT 1 FROM monitors WHERE id = ?2 AND running_since = ?3)'
  const [, inserted] = await db.batch([
    db
      .prepare(
        `UPDATE runs SET status = 'error', state = 'unknown', error = 'taken over', finished_at = ?1 WHERE monitor_id = ?2 AND status = 'running' AND ${held}`,
      )
      .bind(run.startedAt, run.monitorId, claimedAt),
    db
      .prepare(
        `INSERT INTO runs (run_id, monitor_id, config_version, scheduled_at, started_at, status) SELECT ?4, ?2, ?5, ?6, ?1, 'running' WHERE ${held}`,
      )
      .bind(run.startedAt, run.monitorId, claimedAt, run.runId, run.configVersion, run.scheduledAt),
  ])
  return inserted?.meta.changes === 1
}

export type RunPosition = { scheduledAt: string; runId: string }

/** Runs newest first by `scheduled_at` then `run_id`; `after` continues strictly past that position. */
export const listRunsByMonitor = async (
  db: D1Database,
  monitorId: string,
  limit = 50,
  after?: RunPosition,
): Promise<Run[]> => {
  const { results } = await db
    .prepare(
      `SELECT * FROM runs WHERE monitor_id = ?1
        AND (?3 IS NULL OR scheduled_at < ?3 OR (scheduled_at = ?3 AND run_id < ?4))
       ORDER BY scheduled_at DESC, run_id DESC LIMIT ?2`,
    )
    .bind(monitorId, limit, after?.scheduledAt ?? null, after?.runId ?? null)
    .all<RunRow>()
  return results.map((r) => ({
    runId: r.run_id,
    configVersion: r.config_version,
    scheduledAt: r.scheduled_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    status: r.status,
    value: parseValue(r.value_json),
    state: r.state,
    reason: r.reason,
    error: r.error,
  }))
}

export type HistoryEvent = MonitorEvent & { notifications: MonitorNotification[] }

export type HistoryRun = Run & { events: HistoryEvent[] }

export const listHistoryByMonitor = async (
  db: D1Database,
  monitorId: string,
  limit = 50,
  after?: RunPosition,
): Promise<HistoryRun[]> => {
  const runs = await listRunsByMonitor(db, monitorId, limit, after)
  const events = await listEventsByRuns(
    db,
    runs.map((r) => r.runId),
  )
  const notifications = await listNotificationsByEvents(
    db,
    events.map((e) => e.id),
  )
  return runs.map((r) => ({
    ...r,
    events: events
      .filter((e) => e.runId === r.runId)
      .map((e) => ({ ...e, notifications: notifications.filter((n) => n.eventId === e.id) })),
  }))
}

export const getLastValid = async (db: D1Database, monitorId: string): Promise<Observation | null> => {
  const r = await db
    .prepare(
      'SELECT runs.* FROM runs JOIN monitors ON runs.run_id = monitors.last_valid_run_id AND runs.config_version = monitors.config_version WHERE monitors.id = ?',
    )
    .bind(monitorId)
    .first<RunRow>()
  if (!r?.state) {
    return null
  }
  return {
    runId: r.run_id,
    monitorId: r.monitor_id,
    configVersion: r.config_version,
    observedAt: r.finished_at ?? r.scheduled_at,
    value: parseValue(r.value_json),
    state: r.state,
    ...(r.reason ? { reason: r.reason } : {}),
  }
}

/** Deletes runs scheduled before `cutoff` with their events and notifications, keeping every monitor's last valid run. */
export const deleteRunsBefore = async (db: D1Database, cutoff: string) => {
  const expired = `SELECT run_id FROM runs WHERE scheduled_at < ?1
    AND run_id NOT IN (SELECT last_valid_run_id FROM monitors WHERE last_valid_run_id IS NOT NULL)`
  await db.batch([
    db
      .prepare(`DELETE FROM notifications WHERE event_id IN (SELECT id FROM events WHERE run_id IN (${expired}))`)
      .bind(cutoff),
    db.prepare(`DELETE FROM events WHERE run_id IN (${expired})`).bind(cutoff),
    db.prepare(`DELETE FROM runs WHERE run_id IN (${expired})`).bind(cutoff),
  ])
}
