import { type Context, Hono } from 'hono'
import { sendTestMessage } from '../../adapters/notify'
import { deleteChannel, insertChannel, listChannels, updateChannel } from '../../db/channels'
import { type AppEnv, readSecret } from '../../env'
import { badRequest } from './badRequest'

const isValidChannelInput = (input: {
  displayName?: unknown
  secretName?: unknown
}): input is { displayName: string; secretName: string } =>
  typeof input.displayName === 'string' &&
  input.displayName.trim() !== '' &&
  typeof input.secretName === 'string' &&
  /^SLACK_[A-Z0-9_]+$/.test(input.secretName)

const readChannelInput = async (c: Context<AppEnv>) => {
  const input = await c.req.json<{ displayName?: unknown; secretName?: unknown }>().catch(() => null)
  return input && isValidChannelInput(input) ? { displayName: input.displayName, secretName: input.secretName } : null
}

const invalidChannel = (c: Context<AppEnv>) =>
  badRequest(c, 'displayName and secretName (SLACK_ followed by A-Z, 0-9, _) are required')

export const channelsApi = new Hono<AppEnv>()
  .get('/', async (c) =>
    c.json(
      (await listChannels(c.env.DB)).map((ch) => ({
        ...ch,
        secretConfigured: readSecret(c.env, ch.secretName) !== undefined,
      })),
    ),
  )
  .post('/', async (c) => {
    const input = await readChannelInput(c)
    if (!input) {
      return invalidChannel(c)
    }
    return c.json({ id: await insertChannel(c.env.DB, input, new Date().toISOString()) }, 201)
  })
  .put('/:id', async (c) => {
    const id = c.req.param('id')
    const input = await readChannelInput(c)
    if (!input) {
      return invalidChannel(c)
    }
    return (await updateChannel(c.env.DB, id, input)) ? c.json({ id }) : c.json({ error: 'not found' }, 404)
  })
  .delete('/:id', async (c) => {
    const id = c.req.param('id')
    const result = await deleteChannel(c.env.DB, id)
    if (result.status === 'missing') {
      return c.json({ error: 'not found' }, 404)
    }
    if (result.status === 'in_use') {
      return c.json({ error: 'channel is used by monitors', monitors: result.monitors }, 409)
    }
    return c.json({ id })
  })
  .post('/:id/test', async (c) => {
    const result = await sendTestMessage(c.env, c.req.param('id'))
    if (!result) {
      return c.json({ error: 'not found' }, 404)
    }
    return result.ok ? c.json({ ok: true }) : c.json({ ok: false, error: result.error }, 502)
  })
