import { describe, expect, it } from 'vitest'
import { evaluateRule } from './evaluate'
import type { Monitor, Observation } from './monitor'
import { runCheck } from './pipeline'
import type { Extractor, Fetcher } from './ports'

const monitor: Monitor = {
  id: 'm',
  enabled: true,
  configVersion: 2,
  nextRunAt: '2026-01-01T00:00:00.000Z',
  name: 'price',
  schedule: { type: 'interval', minutes: 60 },
  source: { type: 'http', url: 'https://example.com' },
  extractor: { type: 'css_text', selector: '.price', parse: 'jpy' },
  evaluator: { type: 'rule', field: 'jpy', op: 'lt', value: 1000 },
  trigger: { type: 'on_enter' },
  channelIds: ['c'],
}

const previousValid: Observation = {
  runId: 'r0',
  monitorId: 'm',
  configVersion: 2,
  observedAt: '2026-01-01T00:00:00.000Z',
  value: { jpy: 1200 },
  state: 'not_matched',
}

const fetchOk =
  (status = 200): Fetcher =>
  async () => ({ status, body: '', contentType: null, finalUrl: 'https://example.com', fetchedAt: 'now' })

const extract =
  (jpy: number): Extractor =>
  async () => ({ value: { jpy } })

const run = (fetcher: Fetcher, extractor: Extractor = extract(900)) =>
  runCheck({ monitor, previousValid, runId: 'r1', now: 'now', fetcher, extractor, evaluator: evaluateRule })

describe('runCheck', () => {
  it('emits entered when the condition is entered', async () => {
    const { observation, event } = await run(fetchOk())
    expect(observation).toMatchObject({ state: 'matched', value: { jpy: 900 }, configVersion: 2 })
    expect(event?.id).toBe('r1:entered')
  })

  it('non-2xx becomes unknown without event', async () => {
    const { observation, event } = await run(fetchOk(503))
    expect(observation).toMatchObject({ state: 'unknown', reason: 'HTTP 503', value: null })
    expect(event).toBeNull()
  })

  it('adapter errors become unknown instead of throwing', async () => {
    const { observation } = await run(async () => {
      throw new Error('timeout')
    })
    expect(observation).toMatchObject({ state: 'unknown', reason: 'timeout' })
  })

  it('missing extracted value keeps extractor reason', async () => {
    const { observation } = await run(fetchOk(), async () => ({ value: null, reason: 'selector not found' }))
    expect(observation).toMatchObject({ state: 'unknown', reason: 'selector not found' })
  })
})
