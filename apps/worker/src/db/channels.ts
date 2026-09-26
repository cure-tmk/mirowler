export type Channel = { id: string; kind: 'slack_webhook'; displayName: string; secretName: string; createdAt: string }

type ChannelRow = { id: string; kind: 'slack_webhook'; display_name: string; secret_name: string; created_at: string }

const toChannel = (r: ChannelRow): Channel => ({
  id: r.id,
  kind: r.kind,
  displayName: r.display_name,
  secretName: r.secret_name,
  createdAt: r.created_at,
})

export const listChannels = async (db: D1Database): Promise<Channel[]> => {
  const { results } = await db.prepare('SELECT * FROM channels ORDER BY created_at').all<ChannelRow>()
  return results.map(toChannel)
}

export const getChannel = async (db: D1Database, id: string): Promise<Channel | null> => {
  const row = await db.prepare('SELECT * FROM channels WHERE id = ?').bind(id).first<ChannelRow>()
  return row ? toChannel(row) : null
}

export const findUnknownChannelIds = async (db: D1Database, ids: string[]): Promise<string[]> => {
  const { results } = await db
    .prepare('SELECT DISTINCT value FROM json_each(?) WHERE value NOT IN (SELECT id FROM channels)')
    .bind(JSON.stringify(ids))
    .all<{ value: string }>()
  return results.map((r) => r.value)
}

export const insertChannel = async (
  db: D1Database,
  input: { displayName: string; secretName: string },
  now: string,
) => {
  const id = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO channels (id, kind, display_name, secret_name, created_at) VALUES (?, 'slack_webhook', ?, ?, ?)`,
    )
    .bind(id, input.displayName, input.secretName, now)
    .run()
  return id
}

export const updateChannel = async (db: D1Database, id: string, input: { displayName: string; secretName: string }) => {
  const { meta } = await db
    .prepare('UPDATE channels SET display_name = ?, secret_name = ? WHERE id = ?')
    .bind(input.displayName, input.secretName, id)
    .run()
  return meta.changes === 1
}

export type ChannelUser = { id: string; name: string }

/** Deletes the channel in one transaction unless a monitor config references it; its queued notifications become `failed`. */
export const deleteChannel = async (
  db: D1Database,
  id: string,
): Promise<{ status: 'deleted' | 'missing' } | { status: 'in_use'; monitors: ChannelUser[] }> => {
  const users = `SELECT m.id, m.name FROM monitors m, json_each(m.config_json, '$.channelIds') j WHERE j.value = ?1`
  const [exists, deleted, inUse] = await db.batch([
    db.prepare('SELECT 1 FROM channels WHERE id = ?1').bind(id),
    db.prepare(`DELETE FROM channels WHERE id = ?1 AND NOT EXISTS (${users})`).bind(id),
    db.prepare(`${users} ORDER BY m.created_at`).bind(id),
    db
      .prepare(
        `UPDATE notifications SET status = 'failed', next_attempt_at = NULL, last_error = 'channel deleted'
         WHERE channel_id = ?1 AND status IN ('pending', 'sending') AND NOT EXISTS (SELECT 1 FROM channels WHERE id = ?1)`,
      )
      .bind(id),
  ])
  if (deleted?.meta.changes === 1) {
    return { status: 'deleted' }
  }
  if (!exists?.results.length) {
    return { status: 'missing' }
  }
  return { status: 'in_use', monitors: (inUse?.results ?? []) as ChannelUser[] }
}
