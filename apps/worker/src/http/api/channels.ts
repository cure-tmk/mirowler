import { Hono } from 'hono'
import { insertChannel, listChannels } from '../../db/channels'
import type { AppEnv } from '../../env'

export const channelsApi = new Hono<AppEnv>()
  .get('/', async (c) => c.json(await listChannels(c.env.DB)))
  .post('/', async (c) => {
    const { displayName, secretName } = await c.req
      .json<{ displayName?: unknown; secretName?: unknown }>()
      .catch(() => ({ displayName: undefined, secretName: undefined }))
    if (
      typeof displayName !== 'string' ||
      !displayName ||
      typeof secretName !== 'string' ||
      !/^[A-Z0-9_]+$/.test(secretName)
    ) {
      return c.json({ error: 'displayName and secretName (A-Z, 0-9, _) are required' }, 400)
    }
    return c.json({ id: await insertChannel(c.env.DB, { displayName, secretName }, new Date().toISOString()) }, 201)
  })
