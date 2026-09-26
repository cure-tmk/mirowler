import { monitorConfigSchema } from '@mirowler/core'
import { Hono } from 'hono'
import { assertPublicHttpsUrl } from '../../adapters/httpFetcher'
import { insertMonitor, listMonitors, setMonitorEnabled } from '../../db/monitors'
import type { AppEnv } from '../../env'

const readConfig = async (req: Request): Promise<unknown> => {
  if (req.headers.get('content-type')?.includes('application/json')) {
    return req.json()
  }
  const form = await req.formData()
  return JSON.parse(String(form.get('config') ?? ''))
}

export const monitorsApi = new Hono<AppEnv>()
  .get('/', async (c) => c.json(await listMonitors(c.env.DB)))
  .post('/', async (c) => {
    const parsed = monitorConfigSchema.safeParse(await readConfig(c.req.raw).catch(() => undefined))
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues }, 400)
    }
    try {
      assertPublicHttpsUrl(parsed.data.source.url)
    } catch (e) {
      return c.json({ error: String(e) }, 400)
    }
    const id = await insertMonitor(c.env.DB, parsed.data, new Date().toISOString())
    return c.req.header('content-type')?.includes('application/json')
      ? c.json({ id }, 201)
      : c.redirect(`/monitors/${id}`)
  })
  .post('/:id/:action{enable|disable}', async (c) => {
    const id = c.req.param('id')
    const enabled = c.req.param('action') === 'enable'
    const ok = await setMonitorEnabled(c.env.DB, id, enabled, new Date().toISOString())
    return ok ? c.json({ id, enabled }) : c.json({ error: 'not found' }, 404)
  })
  .post('/:id/run', (c) => c.json({ error: 'not implemented' }, 501))
