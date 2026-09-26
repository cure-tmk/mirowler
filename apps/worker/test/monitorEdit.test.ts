import { applyD1Migrations, createScheduledController } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import type { MonitorConfig } from '@mirowler/core'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { insertMonitor, updateMonitorConfig } from '../src/db/monitors'
import { app } from '../src/http/app'
import { scheduled } from '../src/scheduled'

const T0 = new Date(Date.now() - 3_600_000).toISOString()

const config: MonitorConfig = {
  name: 'stock',
  schedule: { type: 'interval', minutes: 60 },
  source: { type: 'http', url: 'https://example.com/item' },
  extractor: { type: 'css_text', selector: '#stock', parse: 'text' },
  evaluator: { type: 'rule', field: 'text', op: 'contains', value: 'In stock' },
  trigger: { type: 'on_enter' },
  channelIds: ['ch-a'],
}
const soldOutConfig: MonitorConfig = {
  ...config,
  evaluator: { type: 'rule', field: 'text', op: 'contains', value: 'Sold out' },
}

const withSecret = { ...env, ADMIN_BASIC_AUTH: 'admin:s3cret' }
const authorization = `Basic ${btoa('admin:s3cret')}`

const edit = (id: string, body: unknown) =>
  app.request(
    `/api/monitors/${id}`,
    {
      method: 'PUT',
      headers: { Authorization: authorization, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    withSecret,
  )

const tick = () => scheduled(createScheduledController(), env, {} as ExecutionContext)

const monitorRow = (id: string) =>
  env.DB.prepare('SELECT config_json, config_version, last_valid_run_id, next_run_at FROM monitors WHERE id = ?')
    .bind(id)
    .first<{ config_json: string; config_version: number; last_valid_run_id: string | null; next_run_at: string }>()

const runVersions = async (id: string) =>
  (
    await env.DB.prepare('SELECT config_version, state FROM runs WHERE monitor_id = ? ORDER BY scheduled_at')
      .bind(id)
      .all()
  ).results

const eventCount = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM events').first<number>('n')) ?? 0

beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS))

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('<p id="stock">Sold out</p>'))
  await env.DB.batch(['notifications', 'events', 'runs', 'monitors'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)))
})

describe('monitor edit', () => {
  it('re-baselines under the new config version even when the new condition already matches', async () => {
    const id = await insertMonitor(env.DB, config, T0)
    await tick()

    expect((await edit(id, soldOutConfig)).status).toBe(200)
    const edited = await monitorRow(id)
    expect(edited).toMatchObject({ config_version: 2, last_valid_run_id: null })
    expect(Date.parse(edited!.next_run_at)).toBeLessThanOrEqual(Date.now())

    await tick()

    expect(await eventCount()).toBe(0)
    expect(await runVersions(id)).toEqual([
      { config_version: 1, state: 'not_matched' },
      { config_version: 2, state: 'matched' },
    ])
  })

  it('never compares against a baseline from an older config version', async () => {
    const id = await insertMonitor(env.DB, config, T0)
    await tick()
    await edit(id, soldOutConfig)
    await env.DB.prepare('UPDATE monitors SET last_valid_run_id = ? WHERE id = ?').bind(`${id}:${T0}`, id).run()

    await tick()

    expect(await eventCount()).toBe(0)
  })

  it('keeps an edit made while a run is in flight', async () => {
    const id = await insertMonitor(env.DB, config, T0)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      await updateMonitorConfig(env.DB, id, soldOutConfig, T0)
      return new Response('<p id="stock">Sold out</p>')
    })

    await tick()

    expect(await monitorRow(id)).toMatchObject({ config_version: 2, last_valid_run_id: null, next_run_at: T0 })
  })

  it('rejects an invalid config and changes nothing', async () => {
    const id = await insertMonitor(env.DB, config, T0)
    const before = await monitorRow(id)

    const res = await edit(id, { ...config, schedule: { type: 'interval', minutes: 0 } })

    expect(res.status).toBe(400)
    expect(await res.json()).toHaveProperty('error')
    expect(await monitorRow(id)).toEqual(before)
  })

  it('returns 404 for an unknown monitor', async () => {
    expect((await edit('missing', config)).status).toBe(404)
  })
})
