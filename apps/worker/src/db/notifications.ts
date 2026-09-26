import type { MonitorEvent } from '@mirowler/core'

export const MAX_ATTEMPTS = 5

export const insertPending = async (db: D1Database, eventId: string, channelId: string) => {
  await db
    .prepare(`INSERT OR IGNORE INTO notifications (event_id, channel_id, status) VALUES (?, ?, 'pending')`)
    .bind(eventId, channelId)
    .run()
}

export const listPending = async (
  db: D1Database,
  limit = 50,
): Promise<{ event: MonitorEvent; channelId: string }[]> => {
  const { results } = await db
    .prepare(
      `SELECT e.id, e.run_id AS runId, e.monitor_id AS monitorId, e.kind, e.summary, e.occurred_at AS occurredAt,
       n.channel_id AS channelId
       FROM notifications n JOIN events e ON e.id = n.event_id
       WHERE n.status = 'pending' AND n.attempts < ? ORDER BY e.occurred_at LIMIT ?`,
    )
    .bind(MAX_ATTEMPTS, limit)
    .all<MonitorEvent & { channelId: string }>()
  return results.map(({ channelId, ...event }) => ({ event, channelId }))
}

export const markSent = async (db: D1Database, eventId: string, channelId: string, now: string) => {
  await db
    .prepare(
      `UPDATE notifications SET status = 'sent', attempts = attempts + 1, sent_at = ?, last_error = NULL WHERE event_id = ? AND channel_id = ?`,
    )
    .bind(now, eventId, channelId)
    .run()
}

export const markFailed = async (db: D1Database, eventId: string, channelId: string, error: string) => {
  await db
    .prepare(
      `UPDATE notifications SET attempts = attempts + 1, last_error = ?,
       status = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE 'pending' END
       WHERE event_id = ? AND channel_id = ?`,
    )
    .bind(error, MAX_ATTEMPTS, eventId, channelId)
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
