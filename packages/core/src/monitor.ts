import { z } from 'zod'

const isValidTimeZone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export const scheduleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('interval'), minutes: z.number().int().min(1).max(525600) }),
  z.object({
    type: z.literal('daily'),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timezone: z.string().refine(isValidTimeZone, 'must be a valid IANA time zone name'),
  }),
])

const httpsUrl = z.url({ protocol: /^https$/ })

export const sourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('http'), url: httpsUrl }),
  z.object({
    type: z.literal('browser'),
    url: httpsUrl,
    waitForSelector: z
      .string()
      .min(1)
      .describe('CSS selector the page renders once the watched content has loaded; the render waits for it'),
  }),
])

/** Shortest interval schedule for a `browser` source; each run is billed browser time. */
export const BROWSER_MIN_INTERVAL_MINUTES = 15

const parseModeSchema = z.enum(['text', 'jpy'])

export const extractorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('css_text'), selector: z.string().min(1), parse: parseModeSchema }),
  z.object({
    type: z.literal('css_attr'),
    selector: z.string().min(1),
    attribute: z.string().min(1),
    parse: parseModeSchema,
  }),
])

export const evaluatorSchema = z
  .discriminatedUnion('type', [
    z.object({
      type: z.literal('rule'),
      field: z.string().min(1),
      op: z.enum(['contains', 'not_contains', 'lt', 'lte']),
      value: z.union([z.string(), z.number()]),
    }),
    z.object({
      type: z.literal('change'),
      field: z.string().min(1),
      op: z.enum(['changed', 'decreased', 'decreased_by_percent']),
      value: z.number().positive().max(100).optional(),
    }),
  ])
  .refine(
    (e) => {
      if (e.type === 'rule') {
        const wantsNumber = e.op === 'lt' || e.op === 'lte'
        return wantsNumber ? typeof e.value === 'number' : typeof e.value === 'string'
      }
      return e.op === 'decreased_by_percent' ? e.value !== undefined : e.value === undefined
    },
    { message: 'value type does not match the operator', path: ['value'] },
  )

export const triggerSchema = z.object({ type: z.enum(['on_enter', 'on_value_change']) })

const fieldMatchesParse = {
  message: 'field must match the extractor parse mode',
  path: ['evaluator', 'field'],
}

const monitorConfigShape = z.object({
  name: z.string().min(1),
  schedule: scheduleSchema,
  source: sourceSchema,
  extractor: extractorSchema,
  evaluator: evaluatorSchema,
  trigger: triggerSchema,
  channelIds: z
    .array(z.string().min(1))
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, 'must be unique'),
})

const browserSchedule = z.object({ source: z.object({ type: z.literal('browser') }), schedule: scheduleSchema })

/** Monitor configuration accepted by the admin API and stored as-is. */
export const monitorConfigSchema = monitorConfigShape
  .refine((c) => c.evaluator.field === c.extractor.parse, fieldMatchesParse)
  .refine(
    (c) =>
      c.source.type !== 'browser' ||
      c.schedule.type !== 'interval' ||
      c.schedule.minutes >= BROWSER_MIN_INTERVAL_MINUTES,
    {
      message: `must be at least ${BROWSER_MIN_INTERVAL_MINUTES} minutes for a browser source`,
      path: ['schedule', 'minutes'],
      when: (payload) => browserSchedule.safeParse(payload.value).success,
    },
  )

/** Input of a one-off preview: the parts of a monitor config that fetch, extract and evaluate. */
export const previewInputSchema = z
  .object({ source: sourceSchema, extractor: extractorSchema, evaluator: evaluatorSchema.optional() })
  .refine((c) => c.evaluator === undefined || c.evaluator.field === c.extractor.parse, fieldMatchesParse)

export type Schedule = z.infer<typeof scheduleSchema>
export type Source = z.infer<typeof sourceSchema>
export type BrowserSource = Extract<Source, { type: 'browser' }>
export type ExtractorConfig = z.infer<typeof extractorSchema>
export type EvaluatorConfig = z.infer<typeof evaluatorSchema>
export type TriggerConfig = z.infer<typeof triggerSchema>
export type MonitorConfig = z.infer<typeof monitorConfigSchema>

/** A stored monitor: its config plus scheduling state. */
export type Monitor = MonitorConfig & {
  id: string
  enabled: boolean
  configVersion: number
  /** UTC ISO 8601 */
  nextRunAt: string
  /** Consecutive throttled failures */
  failureCount: number
}

export type MatchState = 'matched' | 'not_matched' | 'unknown'

export type ObservedValue = Record<string, string | number | boolean | null>

export type Observation = {
  runId: string
  monitorId: string
  configVersion: number
  /** UTC ISO 8601 */
  observedAt: string
  value: ObservedValue | null
  state: MatchState
  reason?: string
  /** Set when the fetch returned a non-2xx status */
  httpStatus?: number
}

export type Evaluation = {
  state: MatchState
  reason?: string
}

export type EventKind = 'entered' | 'value_changed'

export type MonitorEvent = {
  id: string
  runId: string
  monitorId: string
  kind: EventKind
  summary: string
  /** UTC ISO 8601 */
  occurredAt: string
}
