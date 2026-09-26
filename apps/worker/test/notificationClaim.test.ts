import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { insertMonitor } from '../src/db/monitors'
import { insertPending, MAX_ATTEMPTS } from '../src/db/notifications'
import { insertRun } from '../src/db/runs'
import { retryNotifications } from '../src/scheduled/retryNotifications'
import { baseConfig, resetTables } from './helpers'

const HOOK = 'https://hooks.example.com/claim'
const testEnv = { ...env, SLACK_TEST: HOOK }
const config = { ...baseConfig, channelIds: ['ch-a'] }
const T0 = '2026-01-01T00:00:00.000Z'
const NOW = new Date('2026-01-01T01:00:00.000Z')
const minutesAfter = (base: Date, m: number) => new Date(base.getTime() + m * 60_000)

const mockFetch = (slack: () => Response = () => new Response('ok'), page = 'In stock') =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input) !== HOOK) {
      return new Response(`<p id="stock">${page}</p>`)
    }
    await new Promise((r) => setTimeout(r, 10))
    return slack()
  })

const slackCalls = (fetch: ReturnType<typeof mockFetch>) => fetch.mock.calls.filter(([u]) => String(u) === HOOK).length

const seedPending = async () => {
  const monitorId = await insertMonitor(env.DB, config, T0)
  const runId = `${monitorId}:${T0}`
  await insertRun(env.DB, { runId, monitorId, configVersion: 1, scheduledAt: T0, startedAt: T0 })
  const eventId = `${runId}:entered`
  await env.DB.prepare(
    `INSERT INTO events (id, run_id, monitor_id, kind, summary, occurred_at) VALUES (?, ?, ?, 'entered', 'In stock', ?)`,
  )
    .bind(eventId, runId, monitorId, T0)
    .run()
  await insertPending(env.DB, eventId, 'ch-a')
  return eventId
}

const row = (eventId: string) =>
  env.DB.prepare('SELECT status, attempts, next_attempt_at FROM notifications WHERE event_id = ?')
    .bind(eventId)
    .first<{ status: string; attempts: number; next_attempt_at: string | null }>()

beforeEach(async () => {
  vi.restoreAllMocks()
  await resetTables()
  await env.DB.batch([
    env.DB.prepare('DELETE FROM channels'),
    env.DB.prepare(
      `INSERT INTO channels (id, kind, display_name, secret_name, created_at) VALUES ('ch-a', 'slack_webhook', 'a', 'SLACK_TEST', ?)`,
    ).bind(T0),
  ])
})

describe('notification claim', () => {
  it('sends a pending row once when two retries overlap', async () => {
    const eventId = await seedPending()
    const fetch = mockFetch()

    await Promise.all([retryNotifications(testEnv, NOW), retryNotifications(testEnv, NOW)])

    expect(slackCalls(fetch)).toBe(1)
    expect(await row(eventId)).toMatchObject({ status: 'sent', attempts: 1 })
  })

  it('backs off while Slack fails and delivers on the next success', async () => {
    const eventId = await seedPending()
    let failures = 3
    const fetch = mockFetch(() => (failures-- > 0 ? new Response('down', { status: 503 }) : new Response('ok')))
    let now = NOW
    const delays: number[] = []

    for (let i = 0; i < 3; i++) {
      await retryNotifications(testEnv, now)
      const r = await row(eventId)
      expect(r).toMatchObject({ status: 'pending', attempts: i + 1 })
      await retryNotifications(testEnv, now)
      const next = new Date(r!.next_attempt_at!)
      delays.push((next.getTime() - now.getTime()) / 60_000)
      now = next
    }
    await retryNotifications(testEnv, now)

    expect(delays).toEqual([1, 2, 4])
    expect(slackCalls(fetch)).toBe(4)
    expect(await row(eventId)).toMatchObject({ status: 'sent', attempts: 4 })
  })

  it('marks the row failed after the attempt cap', async () => {
    const eventId = await seedPending()
    const fetch = mockFetch(() => new Response('down', { status: 503 }))

    for (let i = 0; i <= MAX_ATTEMPTS; i++) {
      await retryNotifications(testEnv, minutesAfter(NOW, i * 61))
    }

    expect(slackCalls(fetch)).toBe(MAX_ATTEMPTS)
    expect(await row(eventId)).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS, next_attempt_at: null })
  })

  it('reclaims a sending row only after the stale window', async () => {
    const eventId = await seedPending()
    const fetch = mockFetch()
    const setClaimedAt = (at: Date) =>
      env.DB.prepare(`UPDATE notifications SET status = 'sending', claimed_at = ? WHERE event_id = ?`)
        .bind(at.toISOString(), eventId)
        .run()

    await setClaimedAt(minutesAfter(NOW, -9))
    await retryNotifications(testEnv, NOW)
    expect(slackCalls(fetch)).toBe(0)

    await setClaimedAt(minutesAfter(NOW, -11))
    await retryNotifications(testEnv, NOW)
    expect(slackCalls(fetch)).toBe(1)
    expect(await row(eventId)).toMatchObject({ status: 'sent' })
  })
})
