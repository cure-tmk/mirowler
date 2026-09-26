import { computeNextRunAt, evaluateRule, type Monitor, makeRunId, runCheck } from '@mirowler/core'
import { htmlRewriterExtractor } from '../adapters/htmlRewriterExtractor'
import { httpFetcher } from '../adapters/httpFetcher'
import { insertEvent } from '../db/events'
import { claimDue, finishRun } from '../db/monitors'
import { insertPending } from '../db/notifications'
import { completeRun, failRun, getLastValid, insertRun } from '../db/runs'
import type { Bindings } from '../env'
import { deliver, retryNotifications } from './retryNotifications'

const STALE_MS = 10 * 60 * 1000
const CLAIM_LIMIT = 20

const runMonitor = async (env: Bindings, monitor: Monitor, now: Date) => {
  const runId = makeRunId(monitor.id, monitor.nextRunAt)
  let lastValidRunId: string | undefined
  try {
    await insertRun(env.DB, {
      runId,
      monitorId: monitor.id,
      configVersion: monitor.configVersion,
      scheduledAt: monitor.nextRunAt,
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
    await finishRun(env.DB, monitor.id, computeNextRunAt(monitor.schedule, now), lastValidRunId)
  }
}

export const scheduled: ExportedHandlerScheduledHandler<Bindings> = async (_controller, env) => {
  const now = new Date()
  const monitors = await claimDue(
    env.DB,
    now.toISOString(),
    new Date(now.getTime() - STALE_MS).toISOString(),
    CLAIM_LIMIT,
  )
  await Promise.allSettled(monitors.map((m) => runMonitor(env, m, now)))
  await retryNotifications(env)
}
