import { describe, expect, it } from 'vitest'
import type { EvaluatorConfig, MatchState, Observation, ObservedValue, TriggerConfig } from './monitor'
import { decideEvent } from './trigger'

const obs = (state: MatchState, value: ObservedValue | null = { jpy: 1 }): Observation => ({
  runId: 'r',
  monitorId: 'm',
  configVersion: 1,
  observedAt: '2026-01-01T00:00:00.000Z',
  value,
  state,
})

const decide = (
  previousValid: Observation | null,
  current: Observation,
  type: TriggerConfig['type'] = 'on_enter',
  evaluatorType: EvaluatorConfig['type'] = 'rule',
) =>
  decideEvent({
    monitorId: 'm',
    monitorName: 'Shop',
    runId: 'run1',
    previousValid,
    current,
    trigger: { type },
    evaluatorType,
    now: 'now',
  })

describe('decideEvent', () => {
  it('on_enter fires only on not_matched -> matched', () => {
    const e = decide(obs('not_matched'), obs('matched'))
    expect(e?.kind).toBe('entered')
    expect(e?.id).toBe('run1:entered')
    expect(e?.summary).toBe('Shop: entered {"jpy":1}')
    expect(decide(obs('matched'), obs('matched'))).toBeNull()
    expect(decide(obs('matched'), obs('not_matched'))).toBeNull()
  })

  it('baseline and unknown never fire', () => {
    expect(decide(null, obs('matched'))).toBeNull()
    expect(decide(obs('unknown'), obs('matched'))).toBeNull()
    expect(decide(obs('not_matched'), obs('unknown'))).toBeNull()
  })

  it('on_value_change fires when matched on both and value differs', () => {
    expect(decide(obs('matched', { jpy: 1 }), obs('matched', { jpy: 2 }), 'on_value_change')?.kind).toBe(
      'value_changed',
    )
    expect(decide(obs('matched', { jpy: 1 }), obs('matched', { jpy: 1 }), 'on_value_change')).toBeNull()
    expect(decide(obs('not_matched', { jpy: 1 }), obs('matched', { jpy: 2 }), 'on_value_change')).toBeNull()
  })

  describe('change evaluator', () => {
    const change = (
      previousValid: Observation | null,
      current: Observation,
      type: TriggerConfig['type'] = 'on_enter',
    ) => decide(previousValid, current, type, 'change')

    it('fires on every matched observation, so consecutive drops both notify', () => {
      const p1000 = obs('not_matched', { jpy: 1000 })
      const p900 = obs('matched', { jpy: 900 })
      const p800 = obs('matched', { jpy: 800 })
      expect(change(p1000, p900)?.summary).toBe('Shop: value_changed {"jpy":1000} -> {"jpy":900}')
      expect(change(p900, p800)).toMatchObject({ kind: 'value_changed', id: 'run1:value_changed' })
    })

    it('fires on the first change regardless of trigger type', () => {
      expect(change(obs('not_matched'), obs('matched'), 'on_value_change')?.kind).toBe('value_changed')
      expect(change(obs('not_matched'), obs('matched'), 'on_enter')?.kind).toBe('value_changed')
    })

    it('baseline, not_matched, and unknown never fire', () => {
      expect(change(null, obs('matched'))).toBeNull()
      expect(change(obs('matched'), obs('not_matched'))).toBeNull()
      expect(change(obs('unknown'), obs('matched'))).toBeNull()
      expect(change(obs('matched'), obs('unknown'))).toBeNull()
    })
  })
})
