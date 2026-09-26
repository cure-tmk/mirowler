import { describe, expect, it } from 'vitest'
import { extractorSchema, type MonitorConfig, monitorConfigSchema, previewInputSchema } from './monitor'

describe('extractorSchema', () => {
  it('accepts css_text and css_attr', () => {
    expect(extractorSchema.safeParse({ type: 'css_text', selector: 'h1', parse: 'text' }).success).toBe(true)
    expect(
      extractorSchema.safeParse({ type: 'css_attr', selector: 'input', attribute: 'value', parse: 'text' }).success,
    ).toBe(true)
  })

  it('rejects css_attr without an attribute', () => {
    expect(extractorSchema.safeParse({ type: 'css_attr', selector: 'input', parse: 'text' }).success).toBe(false)
  })
})

describe('monitorConfigSchema', () => {
  const valid: MonitorConfig = {
    name: 'price',
    schedule: { type: 'interval', minutes: 60 },
    source: { type: 'http', url: 'https://example.com' },
    extractor: { type: 'css_text', selector: '.price', parse: 'jpy' },
    evaluator: { type: 'change', field: 'jpy', op: 'decreased_by_percent', value: 10 },
    trigger: { type: 'on_enter' },
    channelIds: ['c1'],
  }
  const rejects = (patch: Record<string, unknown>) =>
    expect(monitorConfigSchema.safeParse({ ...valid, ...patch }).success).toBe(false)

  it('accepts a valid config', () => {
    expect(monitorConfigSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an interval outside 1 minute to 1 year', () => {
    rejects({ schedule: { type: 'interval', minutes: 0 } })
    rejects({ schedule: { type: 'interval', minutes: 525601 } })
  })

  it('rejects an unknown time zone', () => {
    rejects({ schedule: { type: 'daily', time: '09:00', timezone: 'Mars/Olympus' } })
  })

  it('rejects a non-https url', () => {
    rejects({ source: { type: 'http', url: 'http://example.com' } })
  })

  it('rejects duplicate channel ids', () => {
    rejects({ channelIds: ['c1', 'c1'] })
  })

  it('rejects a percent above 100', () => {
    rejects({ evaluator: { ...valid.evaluator, value: 101 } })
  })

  it('rejects a value type that does not match the operator', () => {
    rejects({ evaluator: { type: 'rule', field: 'jpy', op: 'lt', value: '1000' } })
  })

  it('rejects a field that differs from the parse mode', () => {
    const result = monitorConfigSchema.safeParse({ ...valid, evaluator: { ...valid.evaluator, field: 'text' } })
    expect(result.error?.issues[0]).toMatchObject({
      path: ['evaluator', 'field'],
      message: 'field must match the extractor parse mode',
    })
  })
})

describe('previewInputSchema', () => {
  const source = { type: 'http', url: 'https://example.com' }
  const extractor = { type: 'css_text', selector: '.price', parse: 'jpy' }

  it('rejects an evaluator field that differs from the parse mode', () => {
    const evaluator = { type: 'rule', field: 'text', op: 'contains', value: 'x' }
    const result = previewInputSchema.safeParse({ source, extractor, evaluator })
    expect(result.error?.issues[0]?.path).toEqual(['evaluator', 'field'])
  })
})
