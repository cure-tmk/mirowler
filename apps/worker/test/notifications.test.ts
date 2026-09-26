import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import type { MonitorConfig, MonitorEvent } from '@mirowler/core'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { slackNotifier } from '../src/adapters/slackNotifier'
import { insertChannel } from '../src/db/channels'
import { insertMonitor } from '../src/db/monitors'
import { insertPending, MAX_ATTEMPTS } from '../src/db/notifications'
import { insertRun } from '../src/db/runs'
import { app } from '../src/http/app'
import { retryNotifications } from '../src/scheduled/retryNotifications'

const T0 = '2026-01-01T00:00:00.000Z'

const config: MonitorConfig = {
  name: 'notify',
  schedule: { type: 'interval', minutes: 60 },
  source: { type: 'http', url: 'https://example.com/' },
  extractor: { type: 'css_text', selector: 'h1', parse: 'text' },
  evaluator: { type: 'rule', field: 'text', op: 'contains', value: 'Example' },
  trigger: { type: 'on_enter' },
  channelIds: ['channel'],
}

const testEnv = { ...env, ADMIN_BASIC_AUTH: 'admin:s3cret', SLACK_TEST: 'https://hooks.example.com/test' }

const seedEvent = async () => {
  const monitorId = await insertMonitor(env.DB, config, T0)
  const runId = `${monitorId}:${T0}`
  await insertRun(env.DB, { runId, monitorId, configVersion: 1, scheduledAt: T0, startedAt: T0 })
  const eventId = `${runId}:entered`
  await env.DB.prepare(
    'INSERT INTO events (id, run_id, monitor_id, kind, summary, occurred_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(eventId, runId, monitorId, 'entered', 'In stock', T0)
    .run()
  const channelId = await insertChannel(env.DB, { displayName: 'alerts', secretName: 'SLACK_TEST' }, T0)
  await insertPending(env.DB, eventId, channelId)
  return { monitorId, eventId, channelId }
}

beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS))

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('notification failures', () => {
  it('gives up after the attempt cap and shows the failure on the monitor page', async () => {
    const { monitorId, eventId, channelId } = await seedEvent()
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('no_service', { status: 404 }))

    for (let i = 0; i < MAX_ATTEMPTS + 1; i++) {
      await retryNotifications(testEnv)
    }

    expect(fetch).toHaveBeenCalledTimes(MAX_ATTEMPTS)
    const row = await env.DB.prepare(
      'SELECT status, attempts, last_error FROM notifications WHERE event_id = ? AND channel_id = ?',
    )
      .bind(eventId, channelId)
      .first()
    expect(row).toEqual({ status: 'failed', attempts: MAX_ATTEMPTS, last_error: '404 no_service' })

    const res = await app.request(
      `/monitors/${monitorId}`,
      { headers: { Authorization: `Basic ${btoa('admin:s3cret')}` } },
      testEnv,
    )
    const html = await res.text()
    expect(html).toContain('<strong>FAILED</strong>')
    expect(html).toContain('404 no_service')
    expect(html).toContain('alerts')
  })
})

describe('slackNotifier', () => {
  it('ends the message text with the event id', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('ok'))
    const event: MonitorEvent = {
      id: 'm:2026-01-01T00:00:00.000Z:entered',
      runId: 'm:2026-01-01T00:00:00.000Z',
      monitorId: 'm',
      kind: 'entered',
      summary: 'In stock',
      occurredAt: T0,
    }

    expect(await slackNotifier(event, { kind: 'slack_webhook', webhookUrl: 'https://hooks.example.com/test' })).toEqual(
      {
        ok: true,
      },
    )

    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))
    expect(body.text).toMatch(/\(event: m:2026-01-01T00:00:00\.000Z:entered\)$/)
  })
})
