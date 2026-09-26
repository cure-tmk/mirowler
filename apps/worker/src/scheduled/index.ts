import {
  computeNextRunAt,
  evaluateRule,
  floorToMinute,
  type Monitor,
  makeRunId,
  nextRunAfterFailure,
  type Observation,
  runCheck,
} from '@mirowler/core'
import { htmlRewriterExtractor } from '../adapters/htmlRewriterExtractor'
import { httpFetcher } from '../adapters/httpFetcher'
import { insertEvent } from '../db/events'
import { type ClaimedMonitor, claimById, claimDue, DAY_MS, finishRun, STALE_MS } from '../db/monitors'
import { insertPending } from '../db/notifications'
import { beginRun, completeRun, deleteRunsBefore, failRun, getLastValid } from '../db/runs'
import type { Bindings } from '../env'
import { deliver, retryNotifications } from './retryNotifications'

const CLAIM_LIMIT = 20

const staleBefore = (now: Date) => new Date(now.getTime() - STALE_MS).toISOString()

const isThrottled = (o: Observation) => o.httpStatus !== undefined && (o.httpStatus === 429 || o.httpStatus >= 500)

const intervalMs = (monitor: Monitor) =>
  monitor.schedule.type === 'interval' ? monitor.schedule.minutes * 60_000 : DAY_MS

const nextSchedule = (monitor: Monitor, now: Date, manual: boolean, throttled: boolean) => {
  if (manual) {
    return { nextRunAt: monitor.nextRunAt, failureCount: monitor.failureCount }
  }
  if (!throttled) {
    const from = monitor.schedule.type === 'interval' ? floorToMinute(now) : now
    return { nextRunAt: computeNextRunAt(monitor.schedule, from), failureCount: 0 }
  }
  const failureCount = monitor.failureCount + 1
  return { nextRunAt: nextRunAfterFailure({ schedule: monitor.schedule, failures: failureCount, now }), failureCount }
}

const finish = async (
  env: Bindings,
  monitor: ClaimedMonitor,
  update: { nextRunAt: string; failureCount: number; lastValidRunId?: string },
) => {
  if (
    !(await finishRun(
      env.DB,
      { id: monitor.id, claimedAt: monitor.claimedAt, configVersion: monitor.configVersion },
      update,
    ))
  ) {
    console.warn('claim was taken over before the run finished', monitor.id, monitor.claimedAt)
  }
}

const execute = async (env: Bindings, monitor: ClaimedMonitor, now: Date, manual: boolean, runId: string) => {
  let lastValidRunId: string | undefined
  let throttled = false
  try {
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
    if (!(await completeRun(env.DB, observation, new Date().toISOString()))) {
      return
    }
    throttled = isThrottled(observation)
    if (manual) {
      return
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
    console.error('run failed', monitor.id, runId, e)
    await failRun(env.DB, runId, String(e), new Date().toISOString())
  } finally {
    await finish(env, monitor, { ...nextSchedule(monitor, now, manual, throttled), lastValidRunId })
  }
}

/** Records the run row for a claimed monitor and returns the rest of the run as `done`, or null when the claim was already taken over. `scheduled_at` is the due time clamped to one interval ago so a long-disabled monitor is not retention-deleted. */
const startRun = async (env: Bindings, monitor: ClaimedMonitor, now: Date, manual: boolean) => {
  const runId = makeRunId(monitor.id, monitor.claimedAt)
  const earliest = new Date(now.getTime() - intervalMs(monitor)).toISOString()
  const due = monitor.nextRunAt > earliest ? monitor.nextRunAt : earliest
  let begun: boolean
  try {
    begun = await beginRun(
      env.DB,
      {
        runId,
        monitorId: monitor.id,
        configVersion: monitor.configVersion,
        scheduledAt: manual ? monitor.claimedAt : due,
        startedAt: now.toISOString(),
      },
      monitor.claimedAt,
    )
  } catch (e) {
    await finish(env, monitor, nextSchedule(monitor, now, manual, false))
    throw e
  }
  if (!begun) {
    console.warn('claim was taken over before the run started', monitor.id, monitor.claimedAt)
    return null
  }
  return { runId, done: execute(env, monitor, now, manual, runId) }
}

/** Starts one monitor now without events, notifications, baseline or schedule changes. Returns null when it is missing or already running; `done` settles when the run finishes. */
export const runNow = async (env: Bindings, monitorId: string) => {
  const now = new Date()
  const monitor = await claimById(env.DB, monitorId, now.toISOString(), staleBefore(now))
  return monitor && startRun(env, monitor, now, true)
}

/** Within one tick, runs monitors sharing a URL host one after another; different hosts run concurrently. */
const runByHost = async (monitors: ClaimedMonitor[], run: (m: ClaimedMonitor) => Promise<unknown>) => {
  const byHost = new Map<string, ClaimedMonitor[]>()
  for (const m of monitors) {
    const host = new URL(m.source.url).host
    byHost.set(host, [...(byHost.get(host) ?? []), m])
  }
  await Promise.all(
    [...byHost.values()].map(async (group) => {
      for (const m of group) {
        await run(m).catch((e) => console.error('monitor run failed', m.id, e))
      }
    }),
  )
}

export const scheduled: ExportedHandlerScheduledHandler<Bindings> = async (_controller, env) => {
  const now = new Date()
  const monitors = await claimDue(env.DB, now.toISOString(), staleBefore(now), CLAIM_LIMIT)
  await runByHost(monitors, async (m) => (await startRun(env, m, now, false))?.done)
  await retryNotifications(env)
  await deleteRunsBefore(env.DB, new Date(now.getTime() - (Number(env.RETENTION_DAYS) || 30) * DAY_MS).toISOString())
}
