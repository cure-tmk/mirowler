import type { Schedule } from './monitor'

export const minIntervalMinutes = 1

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const MAX_BACKOFF_MINUTES = 6 * 60

function wallClockAsUtc(t: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(t)
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value)
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
}

function resolveLocal(wall: number, timeZone: string): number | null {
  const offsets = [
    wallClockAsUtc(wall - DAY, timeZone) - (wall - DAY),
    wallClockAsUtc(wall + DAY, timeZone) - (wall + DAY),
  ]
  const candidates = offsets.map((o) => wall - o).sort((a, b) => a - b)
  return candidates.find((t) => wallClockAsUtc(t, timeZone) === wall) ?? null
}

/** Next run time as UTC ISO. For `daily`, the first `time` in `timezone` strictly after `from`; days where the local time does not exist are skipped, and an ambiguous local time resolves to its first occurrence. */
export function computeNextRunAt(schedule: Schedule, from: Date): string {
  if (schedule.type === 'interval') {
    return new Date(from.getTime() + schedule.minutes * MINUTE).toISOString()
  }
  const [hour, minute] = schedule.time.split(':').map(Number) as [number, number]
  const today = new Date(wallClockAsUtc(from.getTime(), schedule.timezone))
  for (let i = 0; ; i++) {
    const wall = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + i, hour, minute)
    const t = resolveLocal(wall, schedule.timezone)
    if (t !== null && t > from.getTime()) {
      return new Date(t).toISOString()
    }
  }
}

/** Next run after `failures` consecutive HTTP 429 or 5xx responses (including this one). Interval schedules back off to `min(interval * 2^failures, 6h)`, never shorter than the interval itself; daily schedules keep their next occurrence. */
export function nextRunAfterFailure({
  schedule,
  failures,
  now,
}: {
  schedule: Schedule
  failures: number
  now: Date
}): string {
  if (schedule.type === 'daily') {
    return computeNextRunAt(schedule, now)
  }
  const minutes = Math.min(schedule.minutes * 2 ** failures, Math.max(schedule.minutes, MAX_BACKOFF_MINUTES))
  return new Date(now.getTime() + minutes * MINUTE).toISOString()
}
