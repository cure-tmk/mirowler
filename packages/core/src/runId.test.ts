import { expect, it } from 'vitest'
import { makeRunId } from './runId'

it('is deterministic per monitor and schedule slot', () => {
  expect(makeRunId('m1', '2026-01-01T00:00:00.000Z')).toBe(makeRunId('m1', '2026-01-01T00:00:00.000Z'))
  expect(makeRunId('m1', 'a')).not.toBe(makeRunId('m2', 'a'))
})
