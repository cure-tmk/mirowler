import { monitorConfigSchema } from '@mirowler/core'
import { type Context, Hono } from 'hono'
import { assertPublicHttpsUrl } from '../../adapters/httpFetcher'
import { findUnknownChannelIds } from '../../db/channels'
import {
  deleteMonitor,
  getMonitor,
  getMonitorHealth,
  insertMonitor,
  listMonitorHealth,
  setMonitorEnabled,
  updateMonitorConfig,
} from '../../db/monitors'
import { getLastValid } from '../../db/runs'
import type { AppEnv } from '../../env'
import { runNow } from '../../scheduled'
import { badRequest } from './badRequest'

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
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    return { error: badRequest(c, 'invalid config', issues) }
  }
  try {
    assertPublicHttpsUrl(parsed.data.source.url)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { error: badRequest(c, 'invalid config', [{ path: 'source.url', message }]) }
  }
  const unknown = await findUnknownChannelIds(c.env.DB, parsed.data.channelIds)
  if (unknown.length > 0) {
    return {
      error: badRequest(c, 'invalid config', [
        { path: 'channelIds', message: `unknown channel ids: ${unknown.join(', ')}` },
      ]),
    }
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
  .get('/', async (c) => c.json(await listMonitorHealth(c.env.DB, new Date())))
  .get('/:id', async (c) => {
    const id = c.req.param('id')
    const [monitor, baseline] = await Promise.all([
      getMonitorHealth(c.env.DB, id, new Date()),
      getLastValid(c.env.DB, id),
    ])
    return monitor ? c.json({ ...monitor, baseline }) : c.json({ error: 'not found' }, 404)
  })
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
  .delete('/:id', async (c) => {
    const id = c.req.param('id')
    const result = await deleteMonitor(c.env.DB, id, new Date())
    if (result === 'missing') {
      return c.json({ error: 'not found' }, 404)
    }
    return result === 'claimed' ? c.json({ error: 'monitor is running' }, 409) : c.json({ id })
  })
  .post('/:id/edit', update)
  .post('/:id/:action{enable|disable}', async (c) => {
    const id = c.req.param('id')
    const enabled = c.req.param('action') === 'enable'
    const ok = await setMonitorEnabled(c.env.DB, id, enabled, new Date().toISOString())
    return ok ? c.json({ id, enabled }) : c.json({ error: 'not found' }, 404)
  })
  .post('/:id/run', async (c) => {
    const id = c.req.param('id')
    const run = await runNow(c.env, id)
    if (run) {
      c.executionCtx.waitUntil(run.done)
      return c.json({ runId: run.runId }, 202)
    }
    return (await getMonitor(c.env.DB, id))
      ? c.json({ error: 'already running' }, 409)
      : c.json({ error: 'not found' }, 404)
  })
