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
  z.object({ type: z.literal('interval'), minutes: z.number().int().min(1) }),
  z.object({
    type: z.literal('daily'),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timezone: z.string().refine(isValidTimeZone, 'must be a valid IANA time zone name'),
  }),
])

export const sourceSchema = z.object({ type: z.literal('http'), url: z.url() })

export const extractorSchema = z.object({
  type: z.literal('css_text'),
  selector: z.string().min(1),
  parse: z.enum(['text', 'jpy']),
})

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
      value: z.number().positive().optional(),
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

/** Monitor configuration accepted by the admin API and stored as-is in the D1 `config_json` column. */
export const monitorConfigSchema = z.object({
  name: z.string().min(1),
  schedule: scheduleSchema,
  source: sourceSchema,
  extractor: extractorSchema,
  evaluator: evaluatorSchema,
  trigger: triggerSchema,
  channelIds: z.array(z.string().min(1)).min(1),
})

export type Schedule = z.infer<typeof scheduleSchema>
export type Source = z.infer<typeof sourceSchema>
export type ExtractorConfig = z.infer<typeof extractorSchema>
export type EvaluatorConfig = z.infer<typeof evaluatorSchema>
export type TriggerConfig = z.infer<typeof triggerSchema>
export type MonitorConfig = z.infer<typeof monitorConfigSchema>

/** Persisted Monitor, mirroring a row of the D1 `monitors` table. */
export type Monitor = MonitorConfig & {
  id: string
  enabled: boolean
  configVersion: number
  /** UTC ISO 8601 */
  nextRunAt: string
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
  contentHash?: string
}

export type Evaluation = {
  state: MatchState
  reason?: string
  /** 0..1, reported by semantic evaluators; omitted by deterministic rules */
  confidence?: number
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
