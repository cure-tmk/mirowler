import type {
  EvaluatorConfig,
  ExtractorConfig,
  MatchState,
  Monitor,
  MonitorEvent,
  Observation,
  Source,
} from './monitor'
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

type ObserveInput = {
  source: Source
  extractorConfig: ExtractorConfig
  evaluatorConfig?: EvaluatorConfig
  previousValid: Observation | null
  fetcher: Fetcher
  extractor: Extractor
  evaluator: Evaluator
}

export type Observed = Pick<Observation, 'value' | 'reason' | 'httpStatus'> & { state?: MatchState }

/** One fetch, extract and evaluate. Never throws; failures become state `unknown`. Without `evaluatorConfig` an extracted value has no state. */
export function observe(
  input: ObserveInput & { evaluatorConfig: EvaluatorConfig },
): Promise<Observed & { state: MatchState }>
export function observe(input: ObserveInput): Promise<Observed>
export async function observe({
  source,
  extractorConfig,
  evaluatorConfig,
  previousValid,
  fetcher,
  extractor,
  evaluator,
}: ObserveInput): Promise<Observed> {
  try {
    const fetched = await fetcher(source)
    if (fetched.status < 200 || fetched.status >= 300) {
      return { value: null, state: 'unknown', reason: `HTTP ${fetched.status}`, httpStatus: fetched.status }
    }
    const extracted = await extractor(fetched, extractorConfig)
    if (extracted.value === null) {
      return { value: null, state: 'unknown', reason: extracted.reason ?? 'no value extracted' }
    }
    if (!evaluatorConfig) {
      return { value: extracted.value }
    }
    const evaluation = await evaluator({ value: extracted.value, previousValid, config: evaluatorConfig })
    return { value: extracted.value, state: evaluation.state, reason: evaluation.reason }
  } catch (error) {
    return { value: null, state: 'unknown', reason: error instanceof Error ? error.message : String(error) }
  }
}

/** Never throws; adapter failures become an observation with state `unknown`. */
export async function runCheck(
  input: RunCheckInput,
): Promise<{ observation: Observation; event: MonitorEvent | null }> {
  const { monitor } = input
  const observed = await observe({
    ...input,
    source: monitor.source,
    extractorConfig: monitor.extractor,
    evaluatorConfig: monitor.evaluator,
  })
  const observation: Observation = {
    runId: input.runId,
    monitorId: monitor.id,
    configVersion: monitor.configVersion,
    observedAt: input.now,
    ...observed,
  }
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
