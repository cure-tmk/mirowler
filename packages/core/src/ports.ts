import type {
  Evaluation,
  EvaluatorConfig,
  ExtractorConfig,
  MonitorEvent,
  Observation,
  ObservedValue,
  Source,
} from './monitor'

export type FetchResult = {
  status: number
  body: string
  contentType: string | null
  finalUrl: string
  /** UTC ISO 8601 */
  fetchedAt: string
}

export type Fetcher = (source: Source) => Promise<FetchResult>

export type ExtractResult = {
  value: ObservedValue | null
  reason?: string
}

export type Extractor = (fetched: FetchResult, config: ExtractorConfig) => Promise<ExtractResult>

export type EvaluateInput = {
  value: ObservedValue | null
  previousValid: Observation | null
  config: EvaluatorConfig
}

export type Evaluator = (input: EvaluateInput) => Promise<Evaluation>

export type ChannelTarget = { kind: 'slack_webhook'; webhookUrl: string }

export type NotifyResult = { ok: true } | { ok: false; error: string }

export type Notifier = (event: MonitorEvent, target: ChannelTarget) => Promise<NotifyResult>
