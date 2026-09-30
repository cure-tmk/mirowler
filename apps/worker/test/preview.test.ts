import { env } from 'cloudflare:workers'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../src/http/app'
import inStock from './fixtures/target-a/in-stock.html?raw'
import { authedInit, resetTables, TEST_ADMIN } from './helpers'

const source = { type: 'http', url: 'https://example.com/item' }
const cartButton = {
  type: 'css_attr',
  selector: '#goodsdetail_cart input.btn_cart_l_',
  attribute: 'value',
  parse: 'text',
}
const price = { type: 'css_text', selector: '.price_box_0 p.price_', parse: 'jpy' }

const preview = (body: unknown, bindings: Partial<Env> = {}) =>
  app.request(
    '/api/preview',
    authedInit({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    { ...env, ADMIN_BASIC_AUTH: TEST_ADMIN, ...bindings },
  )

const totalRows = async () => {
  const counts = await Promise.all(
    ['monitors', 'runs', 'events', 'notifications'].map((t) =>
      env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<number>('n'),
    ),
  )
  return counts.reduce((sum: number, n) => sum + (n ?? 0), 0)
}

beforeAll(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(inStock))
})

afterAll(() => vi.restoreAllMocks())

beforeEach(() => resetTables())

describe('POST /api/preview', () => {
  it('returns the extracted value and state of a fixture page without writing rows', async () => {
    const res = await preview({
      source,
      extractor: cartButton,
      evaluator: { type: 'rule', field: 'text', op: 'contains', value: 'カートに入れる' },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ value: { text: 'カートに入れる' }, state: 'matched' })
    expect(await totalRows()).toBe(0)
    expect(fetch).toHaveBeenLastCalledWith(new URL(source.url), expect.objectContaining({ redirect: 'manual' }))
  })

  it('extracts from the rendered HTML of a browser source', async () => {
    const quickAction = async () => Response.json({ success: true, result: inStock, meta: { status: 200, title: '' } })
    const res = await preview(
      { source: { type: 'browser', url: source.url, waitForSelector: price.selector }, extractor: price },
      { BROWSER: { quickAction } as unknown as BrowserRun },
    )

    expect(await res.json()).toEqual({ value: { jpy: 123456 } })
  })

  it('rejects a non-public URL with the monitor create 400 shape', async () => {
    const res = await preview({ source: { type: 'http', url: 'https://localhost/' }, extractor: price })

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.any(String), issues: [{ path: 'source.url' }] })
  })

  it('returns the value without a state for a change evaluator', async () => {
    const res = await preview({
      source,
      extractor: price,
      evaluator: { type: 'change', field: 'jpy', op: 'decreased' },
    })

    expect(await res.json()).toEqual({ value: { jpy: 123456 } })
  })

  it('keeps unknown for a change evaluator whose value is unusable', async () => {
    const res = await preview({
      source,
      extractor: { ...price, selector: 'h1.goods_name_' },
      evaluator: { type: 'change', field: 'jpy', op: 'decreased' },
    })

    expect(await res.json()).toMatchObject({ value: { jpy: null }, state: 'unknown', reason: expect.any(String) })
  })

  it('returns the reason when the selector matches nothing', async () => {
    const res = await preview({ source, extractor: { ...price, selector: '#missing' } })

    expect(await res.json()).toMatchObject({
      value: null,
      state: 'unknown',
      reason: expect.stringContaining('#missing'),
    })
  })
})
