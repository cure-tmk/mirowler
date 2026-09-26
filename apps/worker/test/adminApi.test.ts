import { env } from 'cloudflare:workers'
import type { MonitorConfig } from '@mirowler/core'
import { beforeEach, describe, expect, it } from 'vitest'
import { insertChannel } from '../src/db/channels'
import { insertMonitor } from '../src/db/monitors'
import { app } from '../src/http/app'
import { authedInit, baseConfig, resetTables, TEST_ADMIN } from './helpers'

const SECRET_VALUE = 'https://hooks.slack.invalid/services/FAKE/ADMIN/API'
const testEnv = { ...env, ADMIN_BASIC_AUTH: TEST_ADMIN, SLACK_ADMIN_SET: SECRET_VALUE }
const T0 = '2026-01-01T00:00:00.000Z'

const api = (path: string, init: RequestInit = {}) => app.request(`/api${path}`, authedInit(init), testEnv)
const sendJson = (method: string, path: string, body: unknown) =>
  api(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

const count = async (sql: string, ...params: string[]) =>
  (await env.DB.prepare(sql)
    .bind(...params)
    .first<number>('n')) ?? 0

const seedRun = async (monitorId: string, runId: string, scheduledAt: string, state = 'matched') => {
  await env.DB.prepare(
    `INSERT INTO runs (run_id, monitor_id, config_version, scheduled_at, finished_at, status, state, value_json) VALUES (?, ?, 1, ?, ?, 'done', ?, '{"text":"In stock"}')`,
  )
    .bind(runId, monitorId, scheduledAt, scheduledAt, state)
    .run()
}

const seedHistory = async (monitorId: string) => {
  const runId = `${monitorId}-run`
  await seedRun(monitorId, runId, T0)
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO events (id, run_id, monitor_id, kind, summary, occurred_at) VALUES (?, ?, ?, 'entered', 'In stock', ?)`,
    ).bind(`${runId}-event`, runId, monitorId, T0),
    env.DB.prepare(`INSERT INTO notifications (event_id, channel_id, status) VALUES (?, 'ch-a', 'sent')`).bind(
      `${runId}-event`,
    ),
  ])
}

const rowsOf = (monitorId: string) =>
  Promise.all([
    count('SELECT COUNT(*) AS n FROM monitors WHERE id = ?', monitorId),
    count('SELECT COUNT(*) AS n FROM runs WHERE monitor_id = ?', monitorId),
    count('SELECT COUNT(*) AS n FROM events WHERE monitor_id = ?', monitorId),
    count(
      'SELECT COUNT(*) AS n FROM notifications WHERE event_id IN (SELECT id FROM events WHERE monitor_id = ?)',
      monitorId,
    ),
  ])

beforeEach(async () => {
  await resetTables()
})

describe('monitor detail', () => {
  it('returns health, attention and the baseline under the current config', async () => {
    const id = await insertMonitor(env.DB, baseConfig, new Date().toISOString())

    const empty = await (await api(`/monitors/${id}`)).json()
    expect(empty).toMatchObject({ id, consecutiveUnknown: 0, attention: false, lastRun: null, baseline: null })

    await seedRun(id, `${id}-1`, T0)
    await env.DB.prepare('UPDATE monitors SET last_valid_run_id = ? WHERE id = ?').bind(`${id}-1`, id).run()
    const detail = await (await api(`/monitors/${id}`)).json()
    expect(detail).toMatchObject({ baseline: { runId: `${id}-1`, state: 'matched', value: { text: 'In stock' } } })

    const [listed] = (await (await api('/monitors')).json()) as { id: string; attention: boolean }[]
    expect(listed).toMatchObject({ id, attention: false, lastRun: { state: 'matched' } })
  })

  it('returns 404 for an unknown monitor', async () => {
    expect((await api('/monitors/missing')).status).toBe(404)
  })
})

describe('run history paging', () => {
  it('returns each run exactly once when runs share a scheduled time', async () => {
    const id = await insertMonitor(env.DB, baseConfig, T0)
    const tied = '2026-01-01T02:00:00.000Z'
    await seedRun(id, 'r-a', '2026-01-01T01:00:00.000Z')
    for (const runId of ['r-b', 'r-c', 'r-d']) {
      await seedRun(id, runId, tied)
    }
    await seedRun(id, 'r-e', '2026-01-01T03:00:00.000Z')

    const seen: string[] = []
    let cursor: string | null = null
    do {
      const query: string = cursor ? `&cursor=${cursor}` : ''
      const page = (await (await api(`/monitors/${id}/runs?limit=2${query}`)).json()) as {
        runs: { runId: string }[]
        nextCursor: string | null
      }
      seen.push(...page.runs.map((r) => r.runId))
      cursor = page.nextCursor
    } while (cursor)

    expect(seen).toEqual(['r-e', 'r-d', 'r-c', 'r-b', 'r-a'])
  })

  it('nests events and per-channel delivery under each run', async () => {
    const id = await insertMonitor(env.DB, baseConfig, T0)
    await seedHistory(id)

    const { runs } = (await (await api(`/monitors/${id}/runs`)).json()) as { runs: unknown[] }

    expect(runs).toMatchObject([{ events: [{ kind: 'entered', notifications: [{ status: 'sent' }] }] }])
  })

  it('rejects a malformed cursor', async () => {
    const res = await api('/monitors/any/runs?cursor=not-a-cursor')
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ issues: [{ path: 'cursor' }] })
  })
})

describe('monitor delete', () => {
  it('removes the monitor with its runs, events and notifications only', async () => {
    const id = await insertMonitor(env.DB, baseConfig, T0)
    const other = await insertMonitor(env.DB, baseConfig, T0)
    await seedHistory(id)
    await seedHistory(other)

    expect((await api(`/monitors/${id}`, { method: 'DELETE' })).status).toBe(200)

    expect(await rowsOf(id)).toEqual([0, 0, 0, 0])
    expect(await rowsOf(other)).toEqual([1, 1, 1, 1])
    expect((await api(`/monitors/${id}`, { method: 'DELETE' })).status).toBe(404)
  })

  it('returns 409 and changes nothing while the monitor holds a live claim', async () => {
    const id = await insertMonitor(env.DB, baseConfig, T0)
    await seedHistory(id)
    await env.DB.prepare('UPDATE monitors SET running_since = ? WHERE id = ?').bind(new Date().toISOString(), id).run()

    expect((await api(`/monitors/${id}`, { method: 'DELETE' })).status).toBe(409)
    expect(await rowsOf(id)).toEqual([1, 1, 1, 1])
  })
})

describe('channels', () => {
  it('creates a channel only with a SLACK_ secret name', async () => {
    const create = (secretName: string) => sendJson('POST', '/channels', { displayName: 'prefix', secretName })

    expect((await create('WEBHOOK_MAIN')).status).toBe(400)
    expect((await create('SLACK_WEBHOOK_MAIN')).status).toBe(201)
  })

  it('reports whether the secret is set without returning its value', async () => {
    const set = await insertChannel(env.DB, { displayName: 'set', secretName: 'SLACK_ADMIN_SET' }, T0)
    const unset = await insertChannel(env.DB, { displayName: 'unset', secretName: 'SLACK_ADMIN_UNSET' }, T0)

    const res = await api('/channels')
    const body = await res.text()
    const channels = JSON.parse(body) as { id: string; secretConfigured: boolean }[]

    expect(body).not.toContain(SECRET_VALUE)
    expect(channels.find((ch) => ch.id === set)?.secretConfigured).toBe(true)
    expect(channels.find((ch) => ch.id === unset)?.secretConfigured).toBe(false)
  })

  it('edits the display name and secret name with the create validation', async () => {
    const id = await insertChannel(env.DB, { displayName: 'before', secretName: 'SLACK_BEFORE' }, T0)

    expect((await sendJson('PUT', `/channels/${id}`, { displayName: 'x', secretName: 'lower' })).status).toBe(400)
    expect((await sendJson('PUT', `/channels/${id}`, null)).status).toBe(400)
    expect((await sendJson('PUT', `/channels/${id}`, { displayName: 'after', secretName: 'SLACK_AFTER' })).status).toBe(
      200,
    )
    expect(
      await env.DB.prepare('SELECT display_name, secret_name FROM channels WHERE id = ?').bind(id).first(),
    ).toEqual({ display_name: 'after', secret_name: 'SLACK_AFTER' })
    expect((await sendJson('PUT', '/channels/missing', { displayName: 'a', secretName: 'SLACK_A' })).status).toBe(404)
  })

  it('refuses to delete a channel a monitor uses and names the monitor', async () => {
    const used = await insertChannel(env.DB, { displayName: 'used', secretName: 'SLACK_USED' }, T0)
    const unused = await insertChannel(env.DB, { displayName: 'unused', secretName: 'SLACK_UNUSED' }, T0)
    const monitorId = await insertMonitor(env.DB, { ...baseConfig, name: 'user', channelIds: [used] }, T0)

    const res = await api(`/channels/${used}`, { method: 'DELETE' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ monitors: [{ id: monitorId, name: 'user' }] })
    expect(await count('SELECT COUNT(*) AS n FROM channels WHERE id = ?', used)).toBe(1)

    await env.DB.prepare(`INSERT INTO notifications (event_id, channel_id, status) VALUES ('e-queued', ?, 'pending')`)
      .bind(unused)
      .run()
    expect((await api(`/channels/${unused}`, { method: 'DELETE' })).status).toBe(200)
    expect(await env.DB.prepare(`SELECT status FROM notifications WHERE event_id = 'e-queued'`).first('status')).toBe(
      'failed',
    )
    expect((await api(`/channels/${unused}`, { method: 'DELETE' })).status).toBe(404)
  })
})

describe('monitor create', () => {
  const create = (config: MonitorConfig) => sendJson('POST', '/monitors', config)

  const validConfig = async () => ({
    ...baseConfig,
    channelIds: [await insertChannel(env.DB, { displayName: 'create', secretName: 'SLACK_CREATE' }, T0)],
  })

  it('stores a valid config', async () => {
    const res = await create(await validConfig())

    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }
    expect(await (await api(`/monitors/${id}`)).json()).toMatchObject({ id, name: baseConfig.name })
  })

  it('rejects a form-encoded body and inserts nothing', async () => {
    const res = await api('/monitors', {
      method: 'POST',
      body: new URLSearchParams({ config: JSON.stringify(await validConfig()) }),
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: expect.any(String) })
    expect(await count('SELECT COUNT(*) AS n FROM monitors')).toBe(0)
  })

  it.each([
    ['schedule.minutes', { ...baseConfig, schedule: { type: 'interval', minutes: 0 } }],
    ['source.url', { ...baseConfig, source: { type: 'http', url: 'https://localhost/' } }],
    ['channelIds', { ...baseConfig, channelIds: ['ch-missing'] }],
  ] as [string, MonitorConfig][])('keys the issue by %s', async (path, config) => {
    const res = await create(config)

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.any(String), issues: [{ path }] })
  })
})
