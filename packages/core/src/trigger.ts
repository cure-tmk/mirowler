import type { EvaluatorConfig, EventKind, MonitorEvent, Observation, ObservedValue, TriggerConfig } from './monitor'

type DecideInput = {
  monitorId: string
  monitorName: string
  runId: string
  previousValid: Observation | null
  current: Observation
  trigger: TriggerConfig
  evaluatorType: EvaluatorConfig['type']
  now: string
}

function sameValue(a: ObservedValue | null, b: ObservedValue | null): boolean {
  if (a === null || b === null) {
    return a === b
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].every((k) => a[k] === b[k])
}

/**
 * Returns null for the baseline (first valid observation) and for any transition involving `unknown`.
 * For `change` evaluators every `matched` observation is an event and `trigger` is ignored.
 * The event id is keyed on the baseline run, so re-observing the same transition from the same baseline yields the same id.
 */
export function decideEvent({
  monitorId,
  monitorName,
  runId,
  previousValid,
  current,
  trigger,
  evaluatorType,
  now,
}: DecideInput): MonitorEvent | null {
  if (previousValid === null || previousValid.state === 'unknown' || current.state === 'unknown') {
    return null
  }
  let kind: EventKind | null = null
  if (evaluatorType === 'change') {
    if (current.state === 'matched') {
      kind = 'value_changed'
    }
  } else if (trigger.type === 'on_enter') {
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
    id: `${previousValid.runId}:${kind}`,
    runId,
    monitorId,
    kind,
    summary:
      evaluatorType === 'change'
        ? `${monitorName}: ${kind} ${JSON.stringify(previousValid.value)} -> ${JSON.stringify(current.value)}`
        : `${monitorName}: ${kind} ${JSON.stringify(current.value)}`,
    occurredAt: now,
  }
}
