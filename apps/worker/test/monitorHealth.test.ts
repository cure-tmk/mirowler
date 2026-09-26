import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import type { MatchState, MonitorConfig } from '@mirowler/core'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ATTENTION_THRESHOLD, insertMonitor, type MonitorHealth } from '../src/db/monitors'
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

const health = async (name: string) => {
  const res = await app.request('/api/monitors', { headers: { Authorization: authorization } }, testEnv)
  const monitors = (await res.json()) as MonitorHealth[]
  return monitors.find((m) => m.name === name)
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM runs').run()
  await env.DB.prepare('DELETE FROM monitors').run()
})

describe('monitor health in the monitor list', () => {
  it('flags only the monitor with consecutive unknown runs at the threshold', async () => {
    const healthy = await insertMonitor(env.DB, config('healthy'), minutesAgo(1))
    const flaky = await insertMonitor(env.DB, config('flaky'), minutesAgo(1))
    await seedRuns(healthy, ['matched', 'unknown', 'not_matched'])
    await seedRuns(flaky, [...Array<MatchState>(ATTENTION_THRESHOLD).fill('unknown'), 'matched'])

    expect(await health('healthy')).toMatchObject({ attention: false })
    expect(await health('flaky')).toMatchObject({
      attention: true,
      consecutiveUnknown: ATTENTION_THRESHOLD,
      failureRate: ATTENTION_THRESHOLD / (ATTENTION_THRESHOLD + 1),
    })
  })

  it('marks a monitor whose next run is far in the past as delayed', async () => {
    await insertMonitor(env.DB, config('stuck'), minutesAgo(3 * 60))

    expect(await health('stuck')).toMatchObject({ delayed: true, attention: true })
  })
})
