import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import type { MonitorConfig } from '@mirowler/core'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { insertMonitor } from '../src/db/monitors'
import { runNow } from '../src/scheduled'

const config: MonitorConfig = {
  name: 'manual',
  schedule: { type: 'interval', minutes: 60 },
  source: { type: 'http', url: 'https://example.com/' },
  extractor: { type: 'css_text', selector: 'h1', parse: 'text' },
  evaluator: { type: 'rule', field: 'text', op: 'contains', value: 'Example' },
  trigger: { type: 'on_enter' },
  channelIds: ['channel'],
}

const created = '2026-01-01T00:00:00.000Z'

const count = async (sql: string, id: string) => (await env.DB.prepare(sql).bind(id).first<{ n: number }>())?.n

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('<h1>Example Domain</h1>'))
})

describe('runNow', () => {
  it('records a run without an event, a baseline or a schedule change', async () => {
    const id = await insertMonitor(env.DB, config, created)

    expect(await runNow(env, id)).toBeTruthy()

    expect(await count(`SELECT COUNT(*) AS n FROM runs WHERE monitor_id = ? AND state = 'matched'`, id)).toBe(1)
    expect(await count('SELECT COUNT(*) AS n FROM events WHERE monitor_id = ?', id)).toBe(0)
    expect(await env.DB.prepare('SELECT * FROM monitors WHERE id = ?').bind(id).first()).toMatchObject({
      next_run_at: created,
      last_valid_run_id: null,
      running_since: null,
    })
  })

  it('does not run a monitor that is already running', async () => {
    const id = await insertMonitor(env.DB, config, created)
    await env.DB.prepare('UPDATE monitors SET running_since = ? WHERE id = ?').bind(new Date().toISOString(), id).run()

    expect(await runNow(env, id)).toBeNull()
    expect(await count('SELECT COUNT(*) AS n FROM runs WHERE monitor_id = ?', id)).toBe(0)
  })
})
