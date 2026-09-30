import type { EvaluatorConfig, ExtractorConfig, MonitorConfig, Source } from '@mirowler/core'

type ParseMode = ExtractorConfig['parse']
type EvaluatorType = EvaluatorConfig['type']
type Op = EvaluatorConfig['op']

export type FormValues = {
  name: string
  schedule: { type: 'interval' | 'daily'; minutes: string; time: string; timezone: string }
  source: { type: Source['type']; url: string; waitForSelector: string }
  extractor: { type: ExtractorConfig['type']; selector: string; attribute: string; parse: ParseMode }
  evaluator: { type: EvaluatorType; op: Op; value: string }
  trigger: MonitorConfig['trigger']
  channelIds: string[]
}

export const defaultValues: FormValues = {
  name: '',
  schedule: { type: 'interval', minutes: '60', time: '09:00', timezone: 'Asia/Tokyo' },
  source: { type: 'http', url: '', waitForSelector: '' },
  extractor: { type: 'css_text', selector: '', attribute: '', parse: 'text' },
  evaluator: { type: 'rule', op: 'contains', value: '' },
  trigger: { type: 'on_enter' },
  channelIds: [],
}

// Operators the evaluator can decide for the parsed value type; the others always evaluate to unknown
const opsByType: Record<EvaluatorType, Record<ParseMode, [Op, ...Op[]]>> = {
  rule: { text: ['contains', 'not_contains'], jpy: ['lt', 'lte'] },
  change: { text: ['changed'], jpy: ['changed', 'decreased', 'decreased_by_percent'] },
}

export const opsFor = (type: EvaluatorType, parse: ParseMode) => opsByType[type][parse]

export const valueKind = (type: EvaluatorType, op: Op) => {
  if (type === 'change') {
    return op === 'decreased_by_percent' ? 'percent' : undefined
  }
  return op === 'lt' || op === 'lte' ? 'amount' : 'text'
}

const toNumber = (v: string) => (v.trim() === '' ? undefined : Number(v))

const evaluatorValue = ({ type, op, value }: FormValues['evaluator']) => {
  const kind = valueKind(type, op)
  if (kind === 'text') {
    return value.trim() || undefined
  }
  return kind ? toNumber(value) : undefined
}

export const toEvaluator = (v: FormValues) => ({
  type: v.evaluator.type,
  field: v.extractor.parse,
  op: v.evaluator.op,
  value: evaluatorValue(v.evaluator),
})

export const toExtractor = ({ extractor: e }: FormValues) =>
  e.type === 'css_attr'
    ? { type: e.type, selector: e.selector.trim(), attribute: e.attribute.trim(), parse: e.parse }
    : { type: e.type, selector: e.selector.trim(), parse: e.parse }

export const toSource = ({ source: s }: FormValues) =>
  s.type === 'browser'
    ? { type: s.type, url: s.url.trim(), waitForSelector: s.waitForSelector.trim() }
    : { type: s.type, url: s.url.trim() }

/** Builds the config candidate from the form, keeping only the fields that apply to the chosen types. */
export const toConfig = (v: FormValues) => ({
  name: v.name.trim(),
  schedule:
    v.schedule.type === 'daily'
      ? { type: 'daily', time: v.schedule.time, timezone: v.schedule.timezone.trim() }
      : { type: 'interval', minutes: toNumber(v.schedule.minutes) },
  source: toSource(v),
  extractor: toExtractor(v),
  evaluator: toEvaluator(v),
  trigger: v.trigger,
  channelIds: v.channelIds,
})

export const fromConfig = (c: MonitorConfig): FormValues => ({
  name: c.name,
  schedule:
    c.schedule.type === 'daily'
      ? { ...defaultValues.schedule, ...c.schedule }
      : { ...defaultValues.schedule, type: 'interval', minutes: String(c.schedule.minutes) },
  source: { ...defaultValues.source, ...c.source },
  extractor: { attribute: '', ...c.extractor },
  evaluator: { type: c.evaluator.type, op: c.evaluator.op, value: String(c.evaluator.value ?? '') },
  trigger: c.trigger,
  channelIds: c.channelIds,
})

/** Where a server issue path is shown; the evaluator field is derived from the parse mode, so its issues go there. */
export const fieldForIssue = (path: string) => (path === 'evaluator.field' ? 'extractor.parse' : path)
