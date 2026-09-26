import { monitorConfigSchema } from '@mirowler/core'
import { type Context, Hono } from 'hono'
import { assertPublicHttpsUrl } from '../../adapters/httpFetcher'
import { findUnknownChannelIds } from '../../db/channels'
import { getMonitor, insertMonitor, listMonitors, setMonitorEnabled, updateMonitorConfig } from '../../db/monitors'
import type { AppEnv } from '../../env'
import { runNow } from '../../scheduled'

const readConfig = async (req: Request, json: boolean): Promise<unknown> => {
  if (json) {
    return req.json()
  }
  const form = await req.formData()
  return JSON.parse(String(form.get('config') ?? ''))
}

const isJson = (c: Context<AppEnv>) => c.req.header('content-type')?.includes('application/json') ?? false

const parseConfig = async (c: Context<AppEnv>, json: boolean) => {
  const parsed = monitorConfigSchema.safeParse(await readConfig(c.req.raw, json).catch(() => undefined))
  if (!parsed.success) {
    return { error: c.json({ error: parsed.error.issues }, 400) }
  }
  try {
    assertPublicHttpsUrl(parsed.data.source.url)
  } catch (e) {
    return { error: c.json({ error: String(e) }, 400) }
  }
  const unknown = await findUnknownChannelIds(c.env.DB, parsed.data.channelIds)
  if (unknown.length > 0) {
    return { error: c.json({ error: `unknown channelIds: ${unknown.join(', ')}` }, 400) }
  }
  return { config: parsed.data }
}

const update = async (c: Context<AppEnv>) => {
  const id = c.req.param('id')!
  const json = isJson(c)
  const { config, error } = await parseConfig(c, json)
  if (!config) {
    return error
  }
  if (!(await updateMonitorConfig(c.env.DB, id, config, new Date().toISOString()))) {
    return c.json({ error: 'not found' }, 404)
  }
  return json ? c.json({ id }) : c.redirect(`/monitors/${id}`)
}

export const monitorsApi = new Hono<AppEnv>()
  .get('/', async (c) => c.json(await listMonitors(c.env.DB)))
  .post('/', async (c) => {
    const json = isJson(c)
    const { config, error } = await parseConfig(c, json)
    if (!config) {
      return error
    }
    const id = await insertMonitor(c.env.DB, config, new Date().toISOString())
    return json ? c.json({ id }, 201) : c.redirect(`/monitors/${id}`)
  })
  .put('/:id', update)
  .post('/:id/edit', update)
  .post('/:id/:action{enable|disable}', async (c) => {
    const id = c.req.param('id')
    const enabled = c.req.param('action') === 'enable'
    const ok = await setMonitorEnabled(c.env.DB, id, enabled, new Date().toISOString())
    return ok ? c.json({ id, enabled }) : c.json({ error: 'not found' }, 404)
  })
  .post('/:id/run', async (c) => {
    const id = c.req.param('id')
    const runId = await runNow(c.env, id)
    if (runId) {
      return c.json({ runId })
    }
    return (await getMonitor(c.env.DB, id))
      ? c.json({ error: 'already running' }, 409)
      : c.json({ error: 'not found' }, 404)
  })
