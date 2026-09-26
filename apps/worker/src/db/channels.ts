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
