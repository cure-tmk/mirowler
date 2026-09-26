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

const history = async (monitorId: string) => {
  const res = await app.request(
    `/api/monitors/${monitorId}/runs`,
    { headers: { Authorization: `Basic ${btoa('admin:s3cret')}` } },
    testEnv,
  )
  return ((await res.json()) as { runs: unknown[] }).runs
}

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
  it('gives up after the attempt cap and reports the failure in the run history', async () => {
    const { monitorId, eventId, channelId } = await seedEvent()
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('no_service', { status: 404 }))

    for (let i = 0; i < MAX_ATTEMPTS + 1; i++) {
      await retryNotifications(testEnv, new Date(Date.now() + i * 61 * 60_000))
    }

    expect(fetch).toHaveBeenCalledTimes(MAX_ATTEMPTS)
    const row = await env.DB.prepare(
      'SELECT status, attempts, last_error FROM notifications WHERE event_id = ? AND channel_id = ?',
    )
      .bind(eventId, channelId)
      .first()
    expect(row).toEqual({ status: 'failed', attempts: MAX_ATTEMPTS, last_error: '404 no_service' })

    expect(await history(monitorId)).toMatchObject([
      { events: [{ notifications: [{ channel: 'alerts', status: 'failed', lastError: '404 no_service' }] }] },
    ])
  })
})

describe('monitor history', () => {
  it('returns each run with its reason, events and per-channel notification status', async () => {
    const T1 = '2026-01-01T01:00:00.000Z'
    const monitorId = await insertMonitor(env.DB, config, T0)
    const unknownRun = `${monitorId}:${T0}`
    const eventRun = `${monitorId}:${T1}`
    await insertRun(env.DB, { runId: unknownRun, monitorId, configVersion: 1, scheduledAt: T0, startedAt: T0 })
    await insertRun(env.DB, { runId: eventRun, monitorId, configVersion: 1, scheduledAt: T1, startedAt: T1 })
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE runs SET status = 'done', state = 'unknown', reason = 'selector missed' WHERE run_id = ?`,
      ).bind(unknownRun),
      env.DB.prepare(
        `UPDATE runs SET status = 'done', state = 'matched', reason = 'price dropped' WHERE run_id = ?`,
      ).bind(eventRun),
      env.DB.prepare(
        'INSERT INTO events (id, run_id, monitor_id, kind, summary, occurred_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(`${eventRun}:entered`, eventRun, monitorId, 'entered', 'In stock', T1),
    ])
    const sent = await insertChannel(env.DB, { displayName: 'ok-channel', secretName: 'SLACK_TEST' }, T0)
    const failed = await insertChannel(env.DB, { displayName: 'broken-channel', secretName: 'SLACK_TEST' }, T0)
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO notifications (event_id, channel_id, status, attempts, sent_at) VALUES (?, ?, 'sent', 1, ?)`,
      ).bind(`${eventRun}:entered`, sent, T1),
      env.DB.prepare(
        `INSERT INTO notifications (event_id, channel_id, status, attempts, last_error) VALUES (?, ?, 'failed', ?, '500 oops')`,
      ).bind(`${eventRun}:entered`, failed, MAX_ATTEMPTS),
    ])

    expect(await history(monitorId)).toMatchObject([
      {
        reason: 'price dropped',
        events: [
          {
            kind: 'entered',
            notifications: expect.arrayContaining([
              expect.objectContaining({ channel: 'ok-channel', status: 'sent' }),
              expect.objectContaining({ channel: 'broken-channel', status: 'failed', lastError: '500 oops' }),
            ]),
          },
        ],
      },
      { reason: 'selector missed', events: [] },
    ])
  })
})

describe('slackNotifier', () => {
  const target = { kind: 'slack_webhook', webhookUrl: 'https://hooks.example.com/services/SECRET' } as const
  const event: MonitorEvent = {
    id: 'm:2026-01-01T00:00:00.000Z:entered',
    runId: 'm:2026-01-01T00:00:00.000Z',
    monitorId: 'm',
    kind: 'entered',
    summary: 'In stock',
    occurredAt: T0,
  }

  it('reports a thrown fetch error without the webhook URL', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError(`fetch failed: ${target.webhookUrl}`))

    expect(await slackNotifier(event, target)).toEqual({ ok: false, error: 'request failed: TypeError' })
  })

  it('escapes Slack control characters in the summary', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('ok'))

    await slackNotifier({ ...event, summary: '<!channel> A & B > C' }, target)

    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))
    expect(body.text).toMatch(/^&lt;!channel&gt; A &amp; B &gt; C\n/)
  })

  it('ends the message text with the event id', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('ok'))

    expect(await slackNotifier(event, target)).toEqual({ ok: true })

    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))
    expect(body.text).toMatch(/\(event: m:2026-01-01T00:00:00\.000Z:entered\)$/)
  })
})
