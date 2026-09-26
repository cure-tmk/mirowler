import type { Monitor, MonitorEvent, Observation } from './monitor'
import type { Evaluator, Extractor, Fetcher } from './ports'
import { decideEvent } from './trigger'

type RunCheckInput = {
  monitor: Monitor
  previousValid: Observation | null
  runId: string
  now: string
  fetcher: Fetcher
  extractor: Extractor
  evaluator: Evaluator
}

async function observe({
  monitor,
  previousValid,
  runId,
  now,
  fetcher,
  extractor,
  evaluator,
}: RunCheckInput): Promise<Observation> {
  const base = { runId, monitorId: monitor.id, configVersion: monitor.configVersion, observedAt: now }
  try {
    const fetched = await fetcher(monitor.source)
    if (fetched.status < 200 || fetched.status >= 300) {
      return { ...base, value: null, state: 'unknown', reason: `HTTP ${fetched.status}`, httpStatus: fetched.status }
    }
    const extracted = await extractor(fetched, monitor.extractor)
    if (extracted.value === null) {
      return { ...base, value: null, state: 'unknown', reason: extracted.reason ?? 'no value extracted' }
    }
    const evaluation = await evaluator({ value: extracted.value, previousValid, config: monitor.evaluator })
    return { ...base, value: extracted.value, state: evaluation.state, reason: evaluation.reason }
  } catch (error) {
    return { ...base, value: null, state: 'unknown', reason: error instanceof Error ? error.message : String(error) }
  }
}

/** Never throws; adapter failures become an observation with state `unknown`. */
export async function runCheck(
  input: RunCheckInput,
): Promise<{ observation: Observation; event: MonitorEvent | null }> {
  const observation = await observe(input)
  const event = decideEvent({
    monitorId: input.monitor.id,
    monitorName: input.monitor.name,
    runId: input.runId,
    previousValid: input.previousValid,
    current: observation,
    trigger: input.monitor.trigger,
    evaluatorType: input.monitor.evaluator.type,
    now: input.now,
  })
  return { observation, event }
}
