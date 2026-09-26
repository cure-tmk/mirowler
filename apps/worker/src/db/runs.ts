import type { MatchState, Observation, ObservedValue } from '@mirowler/core'

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
  content_hash: string | null
  error: string | null
}

export type Run = {
  runId: string
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
       ON CONFLICT (run_id) DO UPDATE SET started_at = excluded.started_at, status = 'running'`,
    )
    .bind(run.runId, run.monitorId, run.configVersion, run.scheduledAt, run.startedAt)
    .run()
}

export const completeRun = async (db: D1Database, observation: Observation, finishedAt: string) => {
  await db
    .prepare(
      `UPDATE runs SET finished_at = ?, status = 'done', value_json = ?, state = ?, reason = ?, content_hash = ? WHERE run_id = ?`,
    )
    .bind(
      finishedAt,
      observation.value ? JSON.stringify(observation.value) : null,
      observation.state,
      observation.reason ?? null,
      observation.contentHash ?? null,
      observation.runId,
    )
    .run()
}

export const failRun = async (db: D1Database, runId: string, error: string, finishedAt: string) => {
  await db
    .prepare(
      `UPDATE runs SET finished_at = ?, status = 'error', state = 'unknown', error = ? WHERE run_id = ? AND status = 'running'`,
    )
    .bind(finishedAt, error, runId)
    .run()
}

export const listRunsByMonitor = async (db: D1Database, monitorId: string, limit = 50): Promise<Run[]> => {
  const { results } = await db
    .prepare('SELECT * FROM runs WHERE monitor_id = ? ORDER BY scheduled_at DESC LIMIT ?')
    .bind(monitorId, limit)
    .all<RunRow>()
  return results.map((r) => ({
    runId: r.run_id,
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

export const getLastValid = async (db: D1Database, monitorId: string): Promise<Observation | null> => {
  const r = await db
    .prepare('SELECT runs.* FROM runs JOIN monitors ON runs.run_id = monitors.last_valid_run_id WHERE monitors.id = ?')
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
    ...(r.content_hash ? { contentHash: r.content_hash } : {}),
  }
}
