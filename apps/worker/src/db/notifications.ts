import type { MonitorEvent } from '@mirowler/core'

export const MAX_ATTEMPTS = 8

/** A `sending` claim older than this is treated as abandoned by a dead isolate. */
export const SENDING_STALE_MS = 10 * 60_000

const MINUTE_MS = 60_000

const staleBefore = (now: Date) => new Date(now.getTime() - SENDING_STALE_MS).toISOString()

const CLAIMABLE = `(status = 'pending' OR (status = 'sending' AND claimed_at < ?2 AND attempts < ${MAX_ATTEMPTS}))
  AND (next_attempt_at IS NULL OR next_attempt_at <= ?1)`

/** Retry delay after the given attempt: 1, 2, 4, ... minutes, capped at 60. */
export const retryDelayMs = (attempts: number) => Math.min(2 ** (attempts - 1), 60) * MINUTE_MS

export const insertPending = async (db: D1Database, eventId: string, channelId: string) => {
  await db
    .prepare(`INSERT OR IGNORE INTO notifications (event_id, channel_id, status) VALUES (?, ?, 'pending')`)
    .bind(eventId, channelId)
    .run()
}

export const listPending = async (
  db: D1Database,
  now: Date,
  limit = 50,
): Promise<{ event: MonitorEvent; channelId: string }[]> => {
  const { results } = await db
    .prepare(
      `SELECT e.id, e.run_id AS runId, e.monitor_id AS monitorId, e.kind, e.summary, e.occurred_at AS occurredAt,
       n.channel_id AS channelId
       FROM notifications n JOIN events e ON e.id = n.event_id
       WHERE ${CLAIMABLE} ORDER BY e.occurred_at LIMIT ?3`,
    )
    .bind(now.toISOString(), staleBefore(now), limit)
    .all<MonitorEvent & { channelId: string }>()
  return results.map(({ channelId, ...event }) => ({ event, channelId }))
}

export type Claim = { claimedAt: string; attempts: number }

/** Marks the row `sending` and counts the attempt. Returns null when another tick holds it or it is not due. */
export const claimNotification = async (
  db: D1Database,
  eventId: string,
  channelId: string,
  now: Date,
): Promise<Claim | null> => {
  const claimedAt = now.toISOString()
  const { results, meta } = await db
    .prepare(
      `UPDATE notifications SET status = 'sending', claimed_at = ?1, attempts = attempts + 1
       WHERE event_id = ?3 AND channel_id = ?4 AND ${CLAIMABLE} RETURNING attempts`,
    )
    .bind(claimedAt, staleBefore(now), eventId, channelId)
    .all<{ attempts: number }>()
  const row = results[0]
  return meta.changes === 1 && row ? { claimedAt, attempts: row.attempts } : null
}

const OWNED = `event_id = ? AND channel_id = ? AND status = 'sending' AND claimed_at = ?`

export const markSent = async (db: D1Database, eventId: string, channelId: string, claim: Claim, now: Date) => {
  await db
    .prepare(`UPDATE notifications SET status = 'sent', sent_at = ?, last_error = NULL WHERE ${OWNED}`)
    .bind(now.toISOString(), eventId, channelId, claim.claimedAt)
    .run()
}

export const markFailed = async (
  db: D1Database,
  eventId: string,
  channelId: string,
  claim: Claim,
  error: string,
  now: Date,
) => {
  const giveUp = claim.attempts >= MAX_ATTEMPTS
  const nextAttemptAt = giveUp ? null : new Date(now.getTime() + retryDelayMs(claim.attempts)).toISOString()
  await db
    .prepare(`UPDATE notifications SET status = ?, next_attempt_at = ?, last_error = ? WHERE ${OWNED}`)
    .bind(giveUp ? 'failed' : 'pending', nextAttemptAt, error, eventId, channelId, claim.claimedAt)
    .run()
}

const HISTORY_SELECT = `SELECT n.event_id AS eventId, e.occurred_at AS occurredAt,
  COALESCE(c.display_name, n.channel_id) AS channel, n.status, n.attempts, n.last_error AS lastError, n.sent_at AS sentAt
  FROM notifications n JOIN events e ON e.id = n.event_id LEFT JOIN channels c ON c.id = n.channel_id`

export type MonitorNotification = {
  eventId: string
  occurredAt: string
  channel: string
  status: string
  attempts: number
  lastError: string | null
  sentAt: string | null
}

export const listNotificationsByMonitor = async (
  db: D1Database,
  monitorId: string,
  limit = 50,
): Promise<MonitorNotification[]> => {
  const { results } = await db
    .prepare(`${HISTORY_SELECT} WHERE e.monitor_id = ? ORDER BY e.occurred_at DESC, n.channel_id LIMIT ?`)
    .bind(monitorId, limit)
    .all<MonitorNotification>()
  return results
}

export const listNotificationsByEvents = async (db: D1Database, eventIds: string[]): Promise<MonitorNotification[]> => {
  const { results } = await db
    .prepare(`${HISTORY_SELECT} WHERE n.event_id IN (SELECT value FROM json_each(?)) ORDER BY n.channel_id`)
    .bind(JSON.stringify(eventIds))
    .all<MonitorNotification>()
  return results
}
