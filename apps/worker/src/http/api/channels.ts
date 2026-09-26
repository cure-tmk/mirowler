import { Hono } from 'hono'
import { insertChannel, listChannels } from '../../db/channels'
import type { AppEnv } from '../../env'
import { sendTestMessage } from '../../scheduled/retryNotifications'

export const isValidChannelInput = (input: {
  displayName?: unknown
  secretName?: unknown
}): input is { displayName: string; secretName: string } =>
  typeof input.displayName === 'string' &&
  input.displayName.trim() !== '' &&
  typeof input.secretName === 'string' &&
  /^[A-Z0-9_]+$/.test(input.secretName)

export const channelsApi = new Hono<AppEnv>()
  .get('/', async (c) => c.json(await listChannels(c.env.DB)))
  .post('/', async (c) => {
    const input = await c.req.json<{ displayName?: unknown; secretName?: unknown }>().catch(() => ({}))
    if (!isValidChannelInput(input)) {
      return c.json({ error: 'displayName and secretName (A-Z, 0-9, _) are required' }, 400)
    }
    const { displayName, secretName } = input
    return c.json({ id: await insertChannel(c.env.DB, { displayName, secretName }, new Date().toISOString()) }, 201)
  })
  .post('/:id/test', async (c) => {
    const result = await sendTestMessage(c.env, c.req.param('id'))
    if (!result) {
      return c.json({ error: 'not found' }, 404)
    }
    return result.ok ? c.json({ ok: true }) : c.json({ ok: false, error: result.error }, 502)
  })
