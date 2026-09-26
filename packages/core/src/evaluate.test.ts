import { describe, expect, it } from 'vitest'
import { evaluateRule } from './evaluate'
import type { EvaluatorConfig, Observation, ObservedValue } from './monitor'

const prev = (value: ObservedValue | null): Observation => ({
  runId: 'r0',
  monitorId: 'm',
  configVersion: 1,
  observedAt: '2026-01-01T00:00:00.000Z',
  value,
  state: 'not_matched',
})

const run = (config: EvaluatorConfig, value: ObservedValue | null, previousValid: Observation | null = null) =>
  evaluateRule({ value, previousValid, config })

describe('evaluateRule: rule', () => {
  it('contains / not_contains', async () => {
    const c = { type: 'rule', field: 'text', value: 'in stock' } as const
    expect((await run({ ...c, op: 'contains' }, { text: 'in stock!' })).state).toBe('matched')
    expect((await run({ ...c, op: 'contains' }, { text: 'sold out' })).state).toBe('not_matched')
    expect((await run({ ...c, op: 'not_contains' }, { text: 'sold out' })).state).toBe('matched')
  })

  it('lt / lte', async () => {
    const c = { type: 'rule', field: 'jpy', value: 1000 } as const
    expect((await run({ ...c, op: 'lt' }, { jpy: 1000 })).state).toBe('not_matched')
    expect((await run({ ...c, op: 'lte' }, { jpy: 1000 })).state).toBe('matched')
  })

  it('unknown on null value, missing field, or wrong type', async () => {
    const c = { type: 'rule', field: 'jpy', op: 'lt', value: 1000 } as const
    expect((await run(c, null)).state).toBe('unknown')
    expect((await run(c, { text: 'x' })).state).toBe('unknown')
    expect((await run(c, { jpy: null })).state).toBe('unknown')
    expect((await run({ ...c, op: 'contains' }, { jpy: 1 })).reason).toBeDefined()
  })
})

describe('evaluateRule: change', () => {
  it('changed', async () => {
    const c = { type: 'change', field: 'text', op: 'changed' } as const
    expect((await run(c, { text: 'b' }, prev({ text: 'a' }))).state).toBe('matched')
    expect((await run(c, { text: 'a' }, prev({ text: 'a' }))).state).toBe('not_matched')
    expect(await run(c, { text: null }, prev({ text: 'a' }))).toEqual({ state: 'unknown', reason: 'value missing' })
    expect(await run(c, { text: 'a' }, prev({ text: null }))).toEqual({ state: 'unknown', reason: 'value missing' })
  })

  it('decreased', async () => {
    const c = { type: 'change', field: 'jpy', op: 'decreased' } as const
    expect((await run(c, { jpy: 900 }, prev({ jpy: 1000 }))).state).toBe('matched')
    expect((await run(c, { jpy: 1000 }, prev({ jpy: 1000 }))).state).toBe('not_matched')
  })

  it('decreased_by_percent', async () => {
    const c = { type: 'change', field: 'jpy', op: 'decreased_by_percent', value: 10 } as const
    expect((await run(c, { jpy: 900 }, prev({ jpy: 1000 }))).state).toBe('matched')
    expect((await run(c, { jpy: 901 }, prev({ jpy: 1000 }))).state).toBe('not_matched')
    expect((await run(c, { jpy: 0 }, prev({ jpy: 1000 }))).state).toBe('unknown')
    expect((await run(c, { jpy: -1 }, prev({ jpy: 1000 }))).state).toBe('unknown')
  })

  it('a first observation is a not_matched baseline unless a numeric op gets an unusable value', async () => {
    expect((await run({ type: 'change', field: 'jpy', op: 'changed' }, { jpy: 1 })).state).toBe('not_matched')
    const c = { type: 'change', field: 'jpy', op: 'decreased_by_percent', value: 10 } as const
    expect((await run(c, { jpy: 1 })).state).toBe('not_matched')
    expect((await run(c, { jpy: null })).state).toBe('unknown')
    expect((await run(c, { jpy: 0 })).state).toBe('unknown')
  })

  it('unknown on non-numeric or missing percent', async () => {
    expect((await run({ type: 'change', field: 'jpy', op: 'decreased' }, { jpy: 1 }, prev({ jpy: null }))).state).toBe(
      'unknown',
    )
    expect(
      (await run({ type: 'change', field: 'jpy', op: 'decreased_by_percent' }, { jpy: 1 }, prev({ jpy: 2 }))).state,
    ).toBe('unknown')
  })
})
