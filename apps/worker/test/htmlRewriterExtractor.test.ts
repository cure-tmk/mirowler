import type { FetchResult } from '@mirowler/core'
import { describe, expect, it } from 'vitest'
import { htmlRewriterExtractor } from '../src/adapters/htmlRewriterExtractor'

const page = (body: string): FetchResult => ({
  status: 200,
  body,
  contentType: 'text/html',
  finalUrl: 'https://example.com/',
  fetchedAt: '2026-01-01T00:00:00.000Z',
})

describe('htmlRewriterExtractor', () => {
  it('returns the text of the first match', async () => {
    const html = '<div class="s"> In <b>stock</b> </div><div class="s">second</div>'
    expect(await htmlRewriterExtractor(page(html), { type: 'css_text', selector: '.s', parse: 'text' })).toEqual({
      value: { text: 'In stock' },
    })
  })

  it('returns a null value when nothing matches', async () => {
    const result = await htmlRewriterExtractor(page('<p>x</p>'), { type: 'css_text', selector: '.none', parse: 'text' })
    expect(result.value).toBeNull()
    expect(result.reason).toBeDefined()
  })

  it('decodes HTML entities before parsing', async () => {
    const html = '<span id="price">&yen;1,000&nbsp;&#x5186;</span>'
    expect(await htmlRewriterExtractor(page(html), { type: 'css_text', selector: '#price', parse: 'jpy' })).toEqual({
      value: { jpy: 1000 },
    })
  })

  it('parses jpy into a number', async () => {
    const html = '<span id="price">¥12,800</span>'
    expect(await htmlRewriterExtractor(page(html), { type: 'css_text', selector: '#price', parse: 'jpy' })).toEqual({
      value: { jpy: 12800 },
    })
  })
})
