import { describe, expect, it } from 'vitest'
import type { MatchState, Observation, ObservedValue, TriggerConfig } from './monitor'
import { decideEvent } from './trigger'

const obs = (state: MatchState, value: ObservedValue | null = { jpy: 1 }): Observation => ({
  runId: 'r',
  monitorId: 'm',
  configVersion: 1,
  observedAt: '2026-01-01T00:00:00.000Z',
  value,
  state,
})

const decide = (previousValid: Observation | null, current: Observation, type: TriggerConfig['type'] = 'on_enter') =>
  decideEvent({ monitorId: 'm', runId: 'run1', previousValid, current, trigger: { type }, now: 'now' })

describe('decideEvent', () => {
  it('on_enter fires only on not_matched -> matched', () => {
    const e = decide(obs('not_matched'), obs('matched'))
    expect(e?.kind).toBe('entered')
    expect(e?.id).toBe('run1:entered')
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
})
