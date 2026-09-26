import { computeNextRunAt, evaluateRule, type Monitor, makeRunId, runCheck } from '@mirowler/core'
import { htmlRewriterExtractor } from '../adapters/htmlRewriterExtractor'
import { httpFetcher } from '../adapters/httpFetcher'
import { insertEvent } from '../db/events'
import { claimById, claimDue, finishRun } from '../db/monitors'
import { insertPending } from '../db/notifications'
import { completeRun, failRun, getLastValid, insertRun } from '../db/runs'
import type { Bindings } from '../env'
import { deliver, retryNotifications } from './retryNotifications'

const STALE_MS = 10 * 60 * 1000
const CLAIM_LIMIT = 20

const staleBefore = (now: Date) => new Date(now.getTime() - STALE_MS).toISOString()

const runMonitor = async (env: Bindings, monitor: Monitor, now: Date, manual = false) => {
  const scheduledAt = manual ? now.toISOString() : monitor.nextRunAt
  const runId = makeRunId(monitor.id, scheduledAt)
  let lastValidRunId: string | undefined
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
    const nextRunAt = manual ? monitor.nextRunAt : computeNextRunAt(monitor.schedule, now)
    await finishRun(env.DB, monitor.id, nextRunAt, lastValidRunId)
  }
  return runId
}

/** Runs one monitor now without events, notifications, baseline or schedule changes. Returns null when it is missing or already running. */
export const runNow = async (env: Bindings, monitorId: string): Promise<string | null> => {
  const now = new Date()
  const monitor = await claimById(env.DB, monitorId, now.toISOString(), staleBefore(now))
  return monitor && runMonitor(env, monitor, now, true)
}

export const scheduled: ExportedHandlerScheduledHandler<Bindings> = async (_controller, env) => {
  const now = new Date()
  const monitors = await claimDue(env.DB, now.toISOString(), staleBefore(now), CLAIM_LIMIT)
  await Promise.allSettled(monitors.map((m) => runMonitor(env, m, now)))
  await retryNotifications(env)
}
