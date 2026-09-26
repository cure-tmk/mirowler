import {
  computeNextRunAt,
  evaluateRule,
  type Monitor,
  makeRunId,
  nextRunAfterFailure,
  type Observation,
  runCheck,
} from '@mirowler/core'
import { htmlRewriterExtractor } from '../adapters/htmlRewriterExtractor'
import { httpFetcher } from '../adapters/httpFetcher'
import { insertEvent } from '../db/events'
import { claimById, claimDue, finishRun } from '../db/monitors'
import { insertPending } from '../db/notifications'
import { completeRun, deleteRunsBefore, failRun, getLastValid, insertRun } from '../db/runs'
import type { Bindings } from '../env'
import { deliver, retryNotifications } from './retryNotifications'

const STALE_MS = 10 * 60 * 1000
const CLAIM_LIMIT = 20
const DAY_MS = 24 * 60 * 60 * 1000

const staleBefore = (now: Date) => new Date(now.getTime() - STALE_MS).toISOString()

const isThrottled = (o: Observation) => o.httpStatus !== undefined && (o.httpStatus === 429 || o.httpStatus >= 500)

const nextSchedule = (monitor: Monitor, now: Date, manual: boolean, throttled: boolean) => {
  if (manual) {
    return { nextRunAt: monitor.nextRunAt, failureCount: monitor.failureCount }
  }
  if (!throttled) {
    return { nextRunAt: computeNextRunAt(monitor.schedule, now), failureCount: 0 }
  }
  const failureCount = monitor.failureCount + 1
  return { nextRunAt: nextRunAfterFailure({ schedule: monitor.schedule, failures: failureCount, now }), failureCount }
}

const runMonitor = async (env: Bindings, monitor: Monitor, now: Date, manual = false) => {
  const scheduledAt = manual ? now.toISOString() : monitor.nextRunAt
  const runId = makeRunId(monitor.id, scheduledAt)
  let lastValidRunId: string | undefined
  let throttled = false
  try {
    await insertRun(env.DB, {
      runId,
      monitorId: monitor.id,
      configVersion: monitor.configVersion,
      scheduledAt,
      startedAt: now.toISOString(),
    })
    const previousValid = await getLastValid(env.DB, monitor.id)
    const { observation, event } = await runCheck({
      monitor,
      previousValid,
      runId,
      now: now.toISOString(),
      fetcher: httpFetcher,
      extractor: htmlRewriterExtractor,
      evaluator: evaluateRule,
    })
    await completeRun(env.DB, observation, new Date().toISOString())
    throttled = isThrottled(observation)
    if (manual) {
      return runId
    }
    if (event) {
      await insertEvent(env.DB, event)
      for (const channelId of monitor.channelIds) {
        await insertPending(env.DB, event.id, channelId)
      }
    }
    if (observation.state !== 'unknown') {
      lastValidRunId = runId
    }
    if (event) {
      for (const channelId of monitor.channelIds) {
        await deliver(env, event, channelId)
      }
    }
  } catch (e) {
    await failRun(env.DB, runId, String(e), new Date().toISOString())
  } finally {
    await finishRun(env.DB, monitor.id, monitor.configVersion, {
      ...nextSchedule(monitor, now, manual, throttled),
      lastValidRunId,
    })
  }
  return runId
}

/** Runs one monitor now without events, notifications, baseline or schedule changes. Returns null when it is missing or already running. */
export const runNow = async (env: Bindings, monitorId: string): Promise<string | null> => {
  const now = new Date()
  const monitor = await claimById(env.DB, monitorId, now.toISOString(), staleBefore(now))
  return monitor && runMonitor(env, monitor, now, true)
}

/** Within one tick, runs monitors sharing a URL host one after another; different hosts run concurrently. */
export const runByHost = async (monitors: Monitor[], run: (m: Monitor) => Promise<unknown>) => {
  const byHost = new Map<string, Monitor[]>()
  for (const m of monitors) {
    const host = new URL(m.source.url).host
    byHost.set(host, [...(byHost.get(host) ?? []), m])
  }
  await Promise.allSettled(
    [...byHost.values()].map(async (group) => {
      for (const m of group) {
        await run(m).catch(() => {})
      }
    }),
  )
}

export const scheduled: ExportedHandlerScheduledHandler<Bindings> = async (_controller, env) => {
  const now = new Date()
  const monitors = await claimDue(env.DB, now.toISOString(), staleBefore(now), CLAIM_LIMIT)
  await runByHost(monitors, (m) => runMonitor(env, m, now))
  await retryNotifications(env)
  await deleteRunsBefore(env.DB, new Date(now.getTime() - env.RETENTION_DAYS * DAY_MS).toISOString())
}
