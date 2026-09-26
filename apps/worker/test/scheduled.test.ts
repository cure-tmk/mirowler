/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { applyD1Migrations, createScheduledController, type D1Migration } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import type { MonitorConfig } from '@mirowler/core'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { insertMonitor } from '../src/db/monitors'
import { scheduled } from '../src/scheduled'

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[]
    }
  }
}

const T0 = new Date(Date.now() - 2 * 3_600_000).toISOString()
const T1 = new Date(Date.now() - 3_600_000).toISOString()

const config: MonitorConfig = {
  name: 'stock',
  schedule: { type: 'interval', minutes: 60 },
  source: { type: 'http', url: 'https://example.com/item' },
  extractor: { type: 'css_text', selector: '#stock', parse: 'text' },
  evaluator: { type: 'rule', field: 'text', op: 'contains', value: 'In stock' },
  trigger: { type: 'on_enter' },
  channelIds: ['ch-a', 'ch-b'],
}

const servePage = (stock: string, status = 200) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(`<p id="stock">${stock}</p>`, { status }))

const tick = () => scheduled(createScheduledController(), env, {} as ExecutionContext)

const setMonitor = (id: string, sql: string, ...values: unknown[]) =>
  env.DB.prepare(`UPDATE monitors SET ${sql} WHERE id = ?`)
    .bind(...values, id)
    .run()

const monitorRow = (id: string) =>
  env.DB.prepare('SELECT next_run_at, running_since, last_valid_run_id FROM monitors WHERE id = ?')
    .bind(id)
    .first<{ next_run_at: string; running_since: string | null; last_valid_run_id: string | null }>()

const count = async (table: 'runs' | 'events' | 'notifications') =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<number>('n')) ?? 0

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS))

beforeEach(async () => {
  vi.restoreAllMocks()
  await env.DB.batch(['notifications', 'events', 'runs', 'monitors'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)))
})

describe('scheduled', () => {
  it('skips a monitor claimed within the stale window', async () => {
    const id = await insertMonitor(env.DB, config, T0)
    const runningSince = minutesAgo(1)
    await setMonitor(id, 'running_since = ?', runningSince)
    const fetch = servePage('In stock')

    await tick()

    expect(fetch).not.toHaveBeenCalled()
    expect(await count('runs')).toBe(0)
    expect(await monitorRow(id)).toMatchObject({ next_run_at: T0, running_since: runningSince })
  })

  it('takes over a stale running_since', async () => {
    const id = await insertMonitor(env.DB, config, T0)
    await setMonitor(id, 'running_since = ?', minutesAgo(11))
    servePage('In stock')

    await tick()

    expect(await count('runs')).toBe(1)
    const row = await monitorRow(id)
    expect(row?.running_since).toBeNull()
    expect(Date.parse(row!.next_run_at)).toBeGreaterThan(Date.now())
  })

  it('creates no event for the first valid observation, then one per not_matched -> matched', async () => {
    const id = await insertMonitor(env.DB, config, T0)
    servePage('Sold out')
    await tick()

    expect(await monitorRow(id)).toMatchObject({ last_valid_run_id: `${id}:${T0}` })
    expect(await count('events')).toBe(0)

    await setMonitor(id, 'next_run_at = ?', T1)
    servePage('In stock')
    await tick()

    expect(await count('events')).toBe(1)
    const { results } = await env.DB.prepare('SELECT channel_id, status FROM notifications ORDER BY channel_id').all()
    expect(results).toEqual([
      { channel_id: 'ch-a', status: 'pending' },
      { channel_id: 'ch-b', status: 'pending' },
    ])
  })

  it('does not duplicate runs or events when the same run id is re-run', async () => {
    const id = await insertMonitor(env.DB, config, T0)
    servePage('Sold out')
    await tick()
    servePage('In stock')
    for (let i = 0; i < 2; i++) {
      await setMonitor(id, 'next_run_at = ?, last_valid_run_id = ?', T1, `${id}:${T0}`)
      await tick()
    }

    expect(await count('runs')).toBe(2)
    expect(await monitorRow(id)).toMatchObject({ last_valid_run_id: `${id}:${T1}` })
    expect(await count('events')).toBe(1)
    expect(await count('notifications')).toBe(2)
  })

  it('keeps the last valid run on an unknown observation', async () => {
    const id = await insertMonitor(env.DB, config, T0)
    servePage('Sold out')
    await tick()
    await setMonitor(id, 'next_run_at = ?', T1)
    servePage('', 500)
    await tick()

    expect(await monitorRow(id)).toMatchObject({ last_valid_run_id: `${id}:${T0}` })
    const state = await env.DB.prepare('SELECT state FROM runs WHERE run_id = ?').bind(`${id}:${T1}`).first('state')
    expect(state).toBe('unknown')
  })

  it('deletes rows older than the retention period except the last valid run', async () => {
    const id = await insertMonitor(env.DB, config, new Date(Date.now() + 86_400_000).toISOString())
    const daysAgo = (d: number) => minutesAgo(d * 24 * 60)
    const seed = (runId: string, scheduledAt: string) =>
      env.DB.batch([
        env.DB.prepare(
          `INSERT INTO runs (run_id, monitor_id, config_version, scheduled_at, status) VALUES (?, ?, 1, ?, 'done')`,
        ).bind(runId, id, scheduledAt),
        env.DB.prepare(
          `INSERT INTO events (id, run_id, monitor_id, kind, summary, occurred_at) VALUES (?, ?, ?, 'entered', '', ?)`,
        ).bind(`ev-${runId}`, runId, id, scheduledAt),
        env.DB.prepare(`INSERT INTO notifications (event_id, channel_id, status) VALUES (?, 'ch-a', 'sent')`).bind(
          `ev-${runId}`,
        ),
      ])
    await seed('old', daysAgo(31))
    await seed('old-valid', daysAgo(40))
    await seed('recent', daysAgo(29))
    await setMonitor(id, 'last_valid_run_id = ?', 'old-valid')

    await tick()

    const { results } = await env.DB.prepare(
      'SELECT runs.run_id, events.id AS event_id, notifications.channel_id FROM runs LEFT JOIN events ON events.run_id = runs.run_id LEFT JOIN notifications ON notifications.event_id = events.id ORDER BY runs.run_id',
    ).all()
    expect(results).toEqual([
      { run_id: 'old-valid', event_id: 'ev-old-valid', channel_id: 'ch-a' },
      { run_id: 'recent', event_id: 'ev-recent', channel_id: 'ch-a' },
    ])
    expect(await count('notifications')).toBe(2)
  })
})
