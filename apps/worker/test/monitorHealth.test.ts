import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import type { MatchState, MonitorConfig } from '@mirowler/core'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { insertMonitor } from '../src/db/monitors'
import { app } from '../src/http/app'

const testEnv = { ...env, ADMIN_BASIC_AUTH: 'admin:s3cret' }
const authorization = `Basic ${btoa('admin:s3cret')}`

const config = (name: string): MonitorConfig => ({
  name,
  schedule: { type: 'interval', minutes: 60 },
  source: { type: 'http', url: 'https://example.com/item' },
  extractor: { type: 'css_text', selector: '#stock', parse: 'text' },
  evaluator: { type: 'rule', field: 'text', op: 'contains', value: 'In stock' },
  trigger: { type: 'on_enter' },
  channelIds: ['ch-a'],
})

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()

const seedRuns = async (monitorId: string, states: MatchState[]) => {
  for (const [i, state] of states.entries()) {
    const at = minutesAgo((i + 1) * 60)
    await env.DB.prepare(
      `INSERT INTO runs (run_id, monitor_id, config_version, scheduled_at, finished_at, status, state) VALUES (?, ?, 1, ?, ?, 'done', ?)`,
    )
      .bind(`${monitorId}-${i}`, monitorId, at, at, state)
      .run()
  }
}

const rowFor = (html: string, name: string) => html.match(new RegExp(`<tr><td><a[^>]*>${name}</a>.*?</tr>`))?.[0]

const listPage = async () => (await app.request('/', { headers: { Authorization: authorization } }, testEnv)).text()

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM runs').run()
  await env.DB.prepare('DELETE FROM monitors').run()
})

describe('monitor health on the list page', () => {
  it('flags only the monitor with 3 consecutive unknown runs', async () => {
    const healthy = await insertMonitor(env.DB, config('healthy'), minutesAgo(1))
    const flaky = await insertMonitor(env.DB, config('flaky'), minutesAgo(1))
    await seedRuns(healthy, ['matched', 'unknown', 'not_matched'])
    await seedRuns(flaky, ['unknown', 'unknown', 'unknown', 'matched'])

    const html = await listPage()

    expect(rowFor(html, 'healthy')).not.toContain('ATTENTION')
    expect(rowFor(html, 'flaky')).toContain('<strong>ATTENTION</strong>')
    expect(rowFor(html, 'flaky')).toContain('<td>3</td><td>75%</td>')
  })

  it('marks a monitor whose next run is far in the past as delayed', async () => {
    await insertMonitor(env.DB, config('stuck'), minutesAgo(3 * 60))

    const row = rowFor(await listPage(), 'stuck')

    expect(row).toContain('delayed')
    expect(row).toContain('ATTENTION')
  })
})
