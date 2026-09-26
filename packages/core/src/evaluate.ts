import type { Evaluation } from './monitor'
import type { Evaluator } from './ports'

const unknown = (reason: string): Evaluation => ({ state: 'unknown', reason })
const result = (matched: boolean): Evaluation => ({ state: matched ? 'matched' : 'not_matched' })

export const evaluateRule: Evaluator = async ({ value, previousValid, config }) => {
  if (value === null) {
    return unknown('value is null')
  }
  const current = value[config.field]
  if (current === undefined) {
    return unknown(`field "${config.field}" is missing`)
  }

  if (config.type === 'rule') {
    if (config.op === 'contains' || config.op === 'not_contains') {
      if (typeof current !== 'string' || typeof config.value !== 'string') {
        return unknown(`${config.op} requires string field and value`)
      }
      return result(current.includes(config.value) === (config.op === 'contains'))
    }
    if (typeof current !== 'number' || typeof config.value !== 'number') {
      return unknown(`${config.op} requires numeric field and value`)
    }
    return result(config.op === 'lt' ? current < config.value : current <= config.value)
  }

  if (config.op === 'changed') {
    if (current === null) {
      return unknown('value missing')
    }
  } else if (typeof current !== 'number' || !Number.isFinite(current) || current <= 0) {
    return unknown(`${config.op} requires a positive finite number`)
  }
  if (previousValid === null) {
    return result(false)
  }
  const previous = previousValid.value?.[config.field]
  if (previous === undefined || previous === null) {
    return unknown('value missing')
  }
  if (config.op === 'changed') {
    return result(current !== previous)
  }
  if (typeof current !== 'number' || typeof previous !== 'number') {
    return unknown(`${config.op} requires numeric values`)
  }
  if (config.op === 'decreased') {
    return result(current < previous)
  }
  if (config.value === undefined) {
    return unknown('decreased_by_percent requires value')
  }
  if (previous <= 0) {
    return unknown('previous value must be positive for percent change')
  }
  return result(((previous - current) / previous) * 100 >= config.value)
}
