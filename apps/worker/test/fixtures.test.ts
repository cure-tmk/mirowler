import {
  decideEvent,
  type EvaluatorConfig,
  type ExtractorConfig,
  evaluateRule,
  type Monitor,
  type Observation,
  runCheck,
} from '@mirowler/core'
import { describe, expect, it } from 'vitest'
import { htmlRewriterExtractor } from '../src/adapters/htmlRewriterExtractor'
import blockPage from './fixtures/target-a/block-page.html?raw'
import inStock from './fixtures/target-a/in-stock.html?raw'
import missingElement from './fixtures/target-a/missing-element.html?raw'
import outOfStock from './fixtures/target-a/out-of-stock.html?raw'

const cartButton: ExtractorConfig = {
  type: 'css_attr',
  selector: '#goodsdetail_cart input.btn_cart_l_',
  attribute: 'value',
  parse: 'text',
}
const canAddToCart: EvaluatorConfig = { type: 'rule', field: 'text', op: 'contains', value: 'カートに入れる' }

const monitor = (
  extractor: ExtractorConfig,
  evaluator: EvaluatorConfig,
  schedule: Monitor['schedule'] = { type: 'interval', minutes: 60 },
): Monitor => ({
  id: 'm1',
  name: 'target-a',
  schedule,
  source: { type: 'http', url: 'https://example.com/item' },
  extractor,
  evaluator,
  trigger: { type: 'on_enter' },
  channelIds: ['c1'],
  enabled: true,
  configVersion: 1,
  nextRunAt: '2026-01-01T00:00:00.000Z',
  failureCount: 0,
})

const check = (
  body: string,
  {
    status = 200,
    extractor = cartButton,
    evaluator = canAddToCart,
    previousValid = null,
    schedule,
  }: {
    status?: number
    extractor?: ExtractorConfig
    evaluator?: EvaluatorConfig
    previousValid?: Observation | null
    schedule?: Monitor['schedule']
  } = {},
) =>
  runCheck({
    monitor: monitor(extractor, evaluator, schedule),
    previousValid,
    runId: 'r1',
    now: '2026-01-01T00:00:00.000Z',
    fetcher: async () => ({
      status,
      body,
      contentType: 'text/html',
      finalUrl: 'https://example.com/item',
      fetchedAt: '2026-01-01T00:00:00.000Z',
    }),
    extractor: htmlRewriterExtractor,
    evaluator: evaluateRule,
  })

describe('stock monitor on target-a fixtures', () => {
  it.each([
    ['in-stock', inStock, 'matched'],
    ['out-of-stock', outOfStock, 'not_matched'],
  ])('%s yields %s', async (_, body, state) => {
    const { observation, event } = await check(body)
    expect(observation.state).toBe(state)
    expect(event).toBeNull()
  })

  it('reads the cart button value on out-of-stock', async () => {
    const { observation } = await check(outOfStock)
    expect(observation.value).toEqual({ text: '在庫なし' })
  })

  it.each([
    ['missing-element', missingElement, 200],
    ['block-page', blockPage, 200],
    ['block-page', blockPage, 403],
  ])('%s with HTTP %i yields unknown with a reason', async (_, body, status) => {
    const { observation, event } = await check(body, { status })
    expect(observation.state).toBe('unknown')
    expect(observation.reason).toBeTruthy()
    expect(event).toBeNull()
  })

  it('explains a missing cart button by the selector', async () => {
    const { observation } = await check(missingElement)
    expect(observation.reason).toContain('no element matched')
  })

  it('reports the HTTP status of a blocked fetch', async () => {
    const { observation } = await check(blockPage, { status: 403 })
    expect(observation).toMatchObject({ reason: 'HTTP 403', httpStatus: 403 })
  })

  it('emits exactly one entered event on not_matched to matched', async () => {
    const first = await check(outOfStock)
    const second = await check(inStock, { previousValid: first.observation })
    expect(second.event).toMatchObject({ kind: 'entered' })
    const third = await check(inStock, { previousValid: second.observation })
    expect(third.event).toBeNull()
  })
})

describe('negative marker on target-a fixtures', () => {
  const activeVariation: ExtractorConfig = {
    type: 'css_text',
    selector: 'a.block-variation--item.active',
    parse: 'text',
  }
  const soldOut: EvaluatorConfig = { type: 'rule', field: 'text', op: 'contains', value: '在庫なし' }

  it.each([
    ['out-of-stock', outOfStock, 'matched'],
    ['in-stock', inStock, 'not_matched'],
    ['missing-element', missingElement, 'unknown'],
    ['block-page', blockPage, 'unknown'],
  ])('%s yields %s', async (_, body, state) => {
    const { observation } = await check(body, { extractor: activeVariation, evaluator: soldOut })
    expect(observation.state).toBe(state)
  })
})

describe('price on target-a fixtures', () => {
  const price: ExtractorConfig = { type: 'css_text', selector: '.price_box_0 p.price_', parse: 'jpy' }
  const below: EvaluatorConfig = { type: 'rule', field: 'jpy', op: 'lt', value: 200000 }

  it.each([
    ['in-stock', inStock],
    ['out-of-stock', outOfStock],
    ['missing-element', missingElement],
  ])('%s yields the price', async (_, body) => {
    const { observation } = await check(body, { extractor: price, evaluator: below })
    expect(observation).toMatchObject({ value: { jpy: 123456 }, state: 'matched' })
  })

  it('block-page yields no price and unknown', async () => {
    const { observation } = await check(blockPage, { extractor: price, evaluator: below })
    expect(observation.value).toBeNull()
    expect(observation.state).toBe('unknown')
    expect(observation.reason).toContain('no element matched')
  })

  it('an unparsable price yields unknown', async () => {
    const html = '<div class="price_box_0"><p class="price_">SOLD OUT</p></div>'
    const { observation } = await check(html, { extractor: price, evaluator: below })
    expect(observation.value).toEqual({ jpy: null })
    expect(observation.state).toBe('unknown')
  })
})

describe('price drop monitor on target-a fixtures', () => {
  const options = {
    extractor: { type: 'css_text', selector: '.price_box_0 p.price_', parse: 'jpy' },
    evaluator: { type: 'change', field: 'jpy', op: 'decreased_by_percent', value: 10 },
    schedule: { type: 'daily', time: '09:00', timezone: 'Asia/Tokyo' },
  } as const
  const priced = (text: string) => outOfStock.replace('123,456円', text)
  const baseline = () => check(outOfStock, options)

  it('records the first price as a baseline without an event', async () => {
    const { observation, event } = await baseline()
    expect(observation).toMatchObject({ value: { jpy: 123456 }, state: 'not_matched' })
    expect(event).toBeNull()
  })

  it('emits an event on every drop of 10% or more, and none while the price holds', async () => {
    const first = await baseline()
    const second = await check(priced('111,110円'), { ...options, previousValid: first.observation })
    expect(second.observation.state).toBe('matched')
    expect(second.event).toMatchObject({ kind: 'value_changed' })
    const third = await check(priced('111,110円'), { ...options, previousValid: second.observation })
    expect(third.event).toBeNull()
    const fourth = await check(priced('99,999円'), { ...options, previousValid: second.observation })
    expect(fourth.observation.state).toBe('matched')
    expect(fourth.event).toMatchObject({ kind: 'value_changed' })
  })

  it('ignores a 5% drop', async () => {
    const first = await baseline()
    const { observation, event } = await check(priced('117,283円'), { ...options, previousValid: first.observation })
    expect(observation.state).toBe('not_matched')
    expect(event).toBeNull()
  })

  it('a missing price is unknown and keeps the baseline', async () => {
    const first = await baseline()
    const missing = outOfStock.replace(/<p class="price_">.*?<\/p>/, '')
    const { observation, event } = await check(missing, { ...options, previousValid: first.observation })
    expect(observation.state).toBe('unknown')
    expect(event).toBeNull()
    expect(
      decideEvent({
        monitorId: 'm1',
        monitorName: 'm1',
        runId: 'r2',
        previousValid: first.observation,
        current: observation,
        trigger: { type: 'on_enter' },
        evaluatorType: 'change',
        now: '2026-01-01T00:00:00.000Z',
      }),
    ).toBeNull()
    const next = await check(priced('111,110円'), { ...options, previousValid: first.observation })
    expect(next.event).toMatchObject({ kind: 'value_changed' })
  })
})
