import type { EventKind, MonitorEvent, Observation, ObservedValue, TriggerConfig } from './monitor'

type DecideInput = {
  monitorId: string
  monitorName: string
  runId: string
  previousValid: Observation | null
  current: Observation
  trigger: TriggerConfig
  now: string
}

function sameValue(a: ObservedValue | null, b: ObservedValue | null): boolean {
  if (a === null || b === null) {
    return a === b
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].every((k) => a[k] === b[k])
}

/** Returns null for the baseline (first valid observation) and for any transition involving `unknown`. */
export function decideEvent({
  monitorId,
  monitorName,
  runId,
  previousValid,
  current,
  trigger,
  now,
}: DecideInput): MonitorEvent | null {
  if (previousValid === null || previousValid.state === 'unknown' || current.state === 'unknown') {
    return null
  }
  let kind: EventKind | null = null
  if (trigger.type === 'on_enter') {
    if (previousValid.state === 'not_matched' && current.state === 'matched') {
      kind = 'entered'
    }
  } else if (
    previousValid.state === 'matched' &&
    current.state === 'matched' &&
    !sameValue(previousValid.value, current.value)
  ) {
    kind = 'value_changed'
  }
  if (kind === null) {
    return null
  }
  return {
    id: `${runId}:${kind}`,
    runId,
    monitorId,
    kind,
    summary: `${monitorName}: ${kind} ${JSON.stringify(current.value)}`,
    occurredAt: now,
  }
}
