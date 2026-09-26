import { type MonitorConfig, monitorConfigSchema } from '@mirowler/core'
import type { Child } from 'hono/jsx'
import { assertPublicHttpsUrl } from '../../adapters/httpFetcher'
import type { Channel } from '../../db/channels'

export type FormValues = Record<string, string> & { channelIds?: string[] }
export type FormErrors = Record<string, string[]>

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const num = (v: string) => (v === '' ? undefined : Number(v))

const evaluatorValue = (type?: string, op?: string, value = '') => {
  if (type === 'change') {
    return op === 'decreased_by_percent' ? num(value) : undefined
  }
  return op === 'lt' || op === 'lte' ? num(value) : value || undefined
}

export const readForm = (body: Record<string, unknown>): FormValues => {
  const { channelIds, ...rest } = body
  const values: FormValues = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, text(v)]))
  values.channelIds = [channelIds].flat().filter((v): v is string => typeof v === 'string')
  return values
}

const buildConfig = (v: FormValues) => ({
  name: v.name,
  schedule:
    v['schedule.type'] === 'daily'
      ? { type: 'daily', time: v['schedule.time'], timezone: v['schedule.timezone'] }
      : { type: v['schedule.type'], minutes: num(v['schedule.minutes'] ?? '') },
  source: { type: 'http', url: v['source.url'] },
  extractor: {
    type: v['extractor.type'],
    selector: v['extractor.selector'],
    parse: v['extractor.parse'],
    ...(v['extractor.type'] === 'css_attr' && { attribute: v['extractor.attribute'] }),
  },
  evaluator: {
    type: v['evaluator.type'],
    field: v['evaluator.field'],
    op: v['evaluator.op'],
    value: evaluatorValue(v['evaluator.type'], v['evaluator.op'], v['evaluator.value'] ?? ''),
  },
  trigger: { type: v['trigger.type'] },
  channelIds: v.channelIds,
})

/** Builds a monitor config from the create form fields and validates it; errors are keyed by the dotted field name. */
export const formToConfig = (
  values: FormValues,
): { config: MonitorConfig; errors?: never } | { config?: never; errors: FormErrors } => {
  const parsed = monitorConfigSchema.safeParse(buildConfig(values))
  if (!parsed.success) {
    const errors: FormErrors = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.')
      errors[key] = [...(errors[key] ?? []), issue.message]
    }
    return { errors }
  }
  try {
    assertPublicHttpsUrl(parsed.data.source.url)
  } catch (e) {
    return { errors: { 'source.url': [e instanceof Error ? e.message : String(e)] } }
  }
  return { config: parsed.data }
}

export const defaultFormValues: FormValues = {
  'schedule.type': 'interval',
  'schedule.minutes': '60',
  'schedule.timezone': 'Asia/Tokyo',
  'extractor.type': 'css_text',
  'extractor.parse': 'text',
  'evaluator.type': 'rule',
  'evaluator.op': 'contains',
  'trigger.type': 'on_enter',
}

const fieldNames = [
  'name',
  'schedule.type',
  'schedule.minutes',
  'schedule.time',
  'schedule.timezone',
  'source.url',
  'extractor.type',
  'extractor.selector',
  'extractor.attribute',
  'extractor.parse',
  'evaluator.type',
  'evaluator.field',
  'evaluator.op',
  'evaluator.value',
  'trigger.type',
  'channelIds',
]

export const MonitorForm = ({
  channels,
  values,
  errors = {},
}: {
  channels: Channel[]
  values: FormValues
  errors?: FormErrors
}) => {
  const Row = ({ name, label, children }: { name: string; label: string; children: Child }) => (
    <p>
      <label for={name}>{label}</label> {children}
      {errors[name] && (
        <small id={`${name}-error`} role="alert">
          {' '}
          {errors[name].join(', ')}
        </small>
      )}
    </p>
  )
  const input = (name: string, extra: Record<string, unknown> = {}) => (
    <input
      id={name}
      name={name}
      value={values[name] ?? ''}
      aria-describedby={errors[name] && `${name}-error`}
      {...extra}
    />
  )
  const select = (name: string, options: (string | [group: string, string[]])[]) => (
    <select id={name} name={name} aria-describedby={errors[name] && `${name}-error`}>
      {options.map((o) =>
        typeof o === 'string' ? (
          <option selected={values[name] === o}>{o}</option>
        ) : (
          <optgroup label={o[0]}>
            {o[1].map((v) => (
              <option selected={values[name] === v}>{v}</option>
            ))}
          </optgroup>
        ),
      )}
    </select>
  )
  const other = Object.entries(errors).filter(([k]) => !fieldNames.includes(k))
  return (
    <form method="post" action="/monitors">
      {other.length > 0 && (
        <ul role="alert">
          {other.map(([k, msgs]) => (
            <li>
              {k || 'config'}: {msgs.join(', ')}
            </li>
          ))}
        </ul>
      )}
      <Row name="name" label="Name">
        {input('name', { required: true })}
      </Row>
      <fieldset>
        <legend>Schedule</legend>
        <Row name="schedule.type" label="Type">
          {select('schedule.type', ['interval', 'daily'])}
        </Row>
        <Row name="schedule.minutes" label="Every (minutes, interval only)">
          {input('schedule.minutes', { type: 'number' })}
        </Row>
        <Row name="schedule.time" label="Time (HH:MM, daily only)">
          {input('schedule.time', { type: 'time' })}
        </Row>
        <Row name="schedule.timezone" label="Time zone (IANA, daily only)">
          {input('schedule.timezone')}
        </Row>
      </fieldset>
      <fieldset>
        <legend>Source</legend>
        <Row name="source.url" label="URL">
          {input('source.url', { type: 'url', required: true })}
        </Row>
      </fieldset>
      <fieldset>
        <legend>Extractor</legend>
        <Row name="extractor.type" label="Type">
          {select('extractor.type', ['css_text', 'css_attr'])}
        </Row>
        <Row name="extractor.selector" label="CSS selector">
          {input('extractor.selector')}
        </Row>
        <Row name="extractor.attribute" label="Attribute (css_attr only)">
          {input('extractor.attribute')}
        </Row>
        <Row name="extractor.parse" label="Parse as">
          {select('extractor.parse', ['text', 'jpy'])}
        </Row>
      </fieldset>
      <fieldset>
        <legend>Evaluator</legend>
        <Row name="evaluator.type" label="Type">
          {select('evaluator.type', ['rule', 'change'])}
        </Row>
        <Row name="evaluator.field" label="Field (text or jpy)">
          {input('evaluator.field')}
        </Row>
        <Row name="evaluator.op" label="Operator">
          {select('evaluator.op', [
            ['rule', ['contains', 'not_contains', 'lt', 'lte']],
            ['change', ['changed', 'decreased', 'decreased_by_percent']],
          ])}
        </Row>
        <Row name="evaluator.value" label="Value (for change, only decreased_by_percent)">
          {input('evaluator.value')}
        </Row>
      </fieldset>
      <Row name="trigger.type" label="Trigger">
        {select('trigger.type', ['on_enter', 'on_value_change'])}
      </Row>
      <fieldset>
        <legend>Channels</legend>
        {channels.length === 0 && (
          <p>
            No channels yet, <a href="/channels">add one</a> first
          </p>
        )}
        {channels.map((ch) => (
          <label>
            <input type="checkbox" name="channelIds" value={ch.id} checked={values.channelIds?.includes(ch.id)} />{' '}
            {ch.displayName}{' '}
          </label>
        ))}
        {errors.channelIds && (
          <small id="channelIds-error" role="alert">
            {' '}
            {errors.channelIds.join(', ')}
          </small>
        )}
      </fieldset>
      <button type="submit">Add</button>
    </form>
  )
}
