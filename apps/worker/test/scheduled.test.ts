/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { finishRun, insertMonitor } from '../src/db/monitors'
import { beginRun } from '../src/db/runs'
import { baseConfig as config, monitorRow, resetTables, tick } from './helpers'

const T0 = new Date(Date.now() - 2 * 3_600_000).toISOString()
const T1 = new Date(Date.now() - 3_600_000).toISOString()
const T2 = new Date(Date.now() - 30 * 60_000).toISOString()

const servePage = (stock: string, status = 200) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(`<p id="stock">${stock}</p>`, { status }))

const setMonitor = (id: string, sql: string, ...values: unknown[]) =>
  env.DB.prepare(`UPDATE monitors SET ${sql} WHERE id = ?`)
    .bind(...values, id)
    .run()

const count = async (table: 'runs' | 'events' | 'notifications') =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<number>('n')) ?? 0

const runs = async () =>
  (
    await env.DB.prepare(
      'SELECT run_id, monitor_id, scheduled_at, status, error FROM runs ORDER BY started_at, run_id',
    ).all<{
      run_id: string
      monitor_id: string
      scheduled_at: string
      status: string
      error: string | null
    }>()
  ).results

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

beforeEach(async () => {
  vi.restoreAllMocks()
  await resetTables()
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

    const [first] = await runs()
    expect(await monitorRow(id)).toMatchObject({ last_valid_run_id: first?.run_id })
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

  it('keeps the last valid run on an unknown observation', async () => {
    const id = await insertMonitor(env.DB, config, T0)
    servePage('Sold out')
    await tick()
    await setMonitor(id, 'next_run_at = ?', T1)
    servePage('', 500)
    await tick()

    const [first, second] = await runs()
    expect(await monitorRow(id)).toMatchObject({ last_valid_run_id: first?.run_id })
    const state = await env.DB.prepare('SELECT state FROM runs WHERE run_id = ?').bind(second?.run_id).first('state')
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

  it('backs off on consecutive 5xx and resets on success', async () => {
    const id = await insertMonitor(env.DB, config, T0)
    const minutesFromNow = async () => (Date.parse((await monitorRow(id))!.next_run_at) - Date.now()) / 60_000

    servePage('', 500)
    await tick()
    await setMonitor(id, 'next_run_at = ?', T1)
    await tick()

    expect(await monitorRow(id)).toMatchObject({ failure_count: 2 })
    expect(await minutesFromNow()).toBeGreaterThan(200)

    await setMonitor(id, 'next_run_at = ?', T2)
    servePage('In stock')
    await tick()

    expect(await monitorRow(id)).toMatchObject({ failure_count: 0 })
    expect(await minutesFromNow()).toBeLessThanOrEqual(60)
  })

  it('skips a monitor whose stored config is invalid without failing the tick', async () => {
    const broken = await insertMonitor(env.DB, config, T0)
    await setMonitor(broken, 'config_json = ?', '{"name":"broken"}')
    const valid = await insertMonitor(env.DB, config, T0)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    servePage('In stock')

    await tick()

    const runs = await env.DB.prepare('SELECT monitor_id FROM runs').all()
    expect(runs.results).toEqual([{ monitor_id: valid }])
    const row = await monitorRow(broken)
    expect(row?.running_since).toBeNull()
    expect(Date.parse(row!.next_run_at)).toBeGreaterThan(Date.now())
  })

  it('fetches monitors on the same host one after another', async () => {
    const urls = ['https://example.com/a', 'https://example.com/b', 'https://example.org/c']
    for (const url of urls) {
      await insertMonitor(env.DB, { ...config, source: { type: 'http', url } }, T0)
    }
    const inFlight = new Map<string, number>()
    let maxSameHost = 0
    const fetched: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input))
      const n = (inFlight.get(url.host) ?? 0) + 1
      inFlight.set(url.host, n)
      maxSameHost = Math.max(maxSameHost, n)
      await new Promise((r) => setTimeout(r, 20))
      inFlight.set(url.host, n - 1)
      fetched.push(url.toString())
      return new Response('<p id="stock">In stock</p>')
    })

    await tick()

    expect(fetched.sort()).toEqual(urls)
    expect(maxSameHost).toBe(1)
  })

  it('claims monitors on other hosts while a slow host still holds the previous claims', async () => {
    for (let i = 0; i < 20; i++) {
      await insertMonitor(env.DB, { ...config, source: { type: 'http', url: `https://slow.example/${i}` } }, T0)
    }
    const other = await insertMonitor(env.DB, { ...config, source: { type: 'http', url: 'https://example.org/' } }, T1)
    let release = () => {}
    const slow = new Promise<void>((r) => {
      release = r
    })
    let slowStarted = () => {}
    const started = new Promise<void>((r) => {
      slowStarted = r
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (new URL(String(input)).host === 'slow.example') {
        slowStarted()
        await slow
      }
      return new Response('<p id="stock">In stock</p>')
    })

    const first = tick()
    await started
    await tick()

    expect((await runs()).filter((r) => r.monitor_id === other)).toMatchObject([{ status: 'done' }])
    release()
    await first
  })

  it('marks the taken-over run and ignores its late finish', async () => {
    const id = await insertMonitor(env.DB, config, T0)
    const staleClaim = minutesAgo(11)
    const staleRunId = `${id}:${staleClaim}`
    await setMonitor(id, 'running_since = ?', staleClaim)
    await env.DB.prepare(
      `INSERT INTO runs (run_id, monitor_id, config_version, scheduled_at, started_at, status) VALUES (?, ?, 1, ?, ?, 'running')`,
    )
      .bind(staleRunId, id, T0, staleClaim)
      .run()
    servePage('In stock')

    await tick()

    const [old, current] = await runs()
    expect(old).toMatchObject({ run_id: staleRunId, status: 'error', error: 'taken over' })
    expect(current).toMatchObject({ status: 'done' })
    expect(current?.run_id).not.toBe(staleRunId)
    const before = await monitorRow(id)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const finished = await finishRun(
      env.DB,
      { id, claimedAt: staleClaim, configVersion: 1 },
      { nextRunAt: T0, failureCount: 3, lastValidRunId: staleRunId },
    )
    expect(finished).toBe(false)
    expect(await monitorRow(id)).toEqual(before)
  })

  it('does not record the same transition twice when a run dies after creating its event', async () => {
    const id = await insertMonitor(env.DB, config, T0)
    servePage('Sold out')
    await tick()
    const [baseline] = await runs()
    await setMonitor(id, 'next_run_at = ?, running_since = ?', T1, minutesAgo(11))
    await env.DB.prepare(
      `INSERT INTO events (id, run_id, monitor_id, kind, summary, occurred_at) VALUES (?, ?, ?, 'entered', '', ?)`,
    )
      .bind(`${baseline?.run_id}:entered`, baseline?.run_id, id, T1)
      .run()
    servePage('In stock')

    await tick()

    expect(await count('events')).toBe(1)
  })

  it('does not start a run whose claim was taken over before it began', async () => {
    const id = await insertMonitor(env.DB, config, T0)
    await setMonitor(id, 'running_since = ?', minutesAgo(1))

    const begun = await beginRun(
      env.DB,
      { runId: `${id}:late`, monitorId: id, configVersion: 1, scheduledAt: T0, startedAt: minutesAgo(0) },
      minutesAgo(11),
    )

    expect(begun).toBe(false)
    expect(await count('runs')).toBe(0)
  })

  it('runs a 1-minute monitor on every tick despite cron jitter', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const start = Math.floor(Date.now() / 60_000) * 60_000
      await insertMonitor(
        env.DB,
        { ...config, schedule: { type: 'interval', minutes: 1 } },
        new Date(start).toISOString(),
      )
      servePage('In stock')
      for (let i = 0; i < 30; i++) {
        vi.setSystemTime(start + i * 60_000 + Math.floor(Math.random() * 501))
        await tick()
      }
      expect(await count('runs')).toBe(30)
    } finally {
      vi.useRealTimers()
    }
  })

  it('dates the first run of a long-disabled monitor within one interval of now', async () => {
    await insertMonitor(env.DB, config, minutesAgo(40 * 24 * 60))
    servePage('In stock')

    await tick()

    const [run] = await runs()
    expect(Date.now() - Date.parse(run!.scheduled_at)).toBeLessThan(61 * 60_000)
  })
})
