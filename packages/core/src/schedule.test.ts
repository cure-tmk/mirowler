import { describe, expect, it } from 'vitest'
import { computeNextRunAt, floorToMinute, nextRunAfterFailure } from './schedule'

const daily = (time: string, timezone: string, from: string) =>
  computeNextRunAt({ type: 'daily', time, timezone }, new Date(from))

describe('computeNextRunAt', () => {
  it('interval adds minutes', () => {
    expect(computeNextRunAt({ type: 'interval', minutes: 30 }, new Date('2026-01-01T00:00:00Z'))).toBe(
      '2026-01-01T00:30:00.000Z',
    )
  })

  it('daily picks the next occurrence strictly after from', () => {
    expect(daily('09:00', 'Asia/Tokyo', '2026-01-01T23:00:00Z')).toBe('2026-01-02T00:00:00.000Z')
    expect(daily('09:00', 'Asia/Tokyo', '2026-01-02T00:00:00Z')).toBe('2026-01-03T00:00:00.000Z')
    expect(daily('09:00', 'Asia/Tokyo', '2026-01-01T12:00:00Z')).toBe('2026-01-02T00:00:00.000Z')
  })

  it('skips a day when the local time does not exist (spring forward)', () => {
    expect(daily('02:30', 'America/New_York', '2026-03-07T12:00:00Z')).toBe('2026-03-09T06:30:00.000Z')
  })

  it('takes the first occurrence of an ambiguous local time (fall back)', () => {
    expect(daily('01:30', 'America/New_York', '2026-10-31T12:00:00Z')).toBe('2026-11-01T05:30:00.000Z')
  })
})

describe('nextRunAfterFailure', () => {
  const now = new Date('2026-01-01T00:00:00Z')
  const interval = (minutes: number, failures: number) =>
    nextRunAfterFailure({ schedule: { type: 'interval', minutes }, failures, now })

  it('doubles the interval per consecutive failure', () => {
    expect(interval(10, 1)).toBe('2026-01-01T00:20:00.000Z')
    expect(interval(10, 3)).toBe('2026-01-01T01:20:00.000Z')
  })

  it('caps at 6 hours but never below the interval', () => {
    expect(interval(10, 10)).toBe('2026-01-01T06:00:00.000Z')
    expect(interval(10, 5000)).toBe('2026-01-01T06:00:00.000Z')
    expect(interval(600, 1)).toBe('2026-01-01T10:00:00.000Z')
  })

  it('keeps the next daily occurrence', () => {
    const schedule = { type: 'daily', time: '09:00', timezone: 'Asia/Tokyo' } as const
    expect(nextRunAfterFailure({ schedule, failures: 3, now })).toBe(computeNextRunAt(schedule, now))
  })
})

describe('floorToMinute', () => {
  it('drops seconds and milliseconds', () => {
    expect(floorToMinute(new Date('2026-01-01T00:05:59.999Z')).toISOString()).toBe('2026-01-01T00:05:00.000Z')
    expect(floorToMinute(new Date('2026-01-01T00:05:00.000Z')).toISOString()).toBe('2026-01-01T00:05:00.000Z')
  })
})
