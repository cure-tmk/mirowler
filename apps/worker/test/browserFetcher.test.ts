import { describe, expect, it, vi } from 'vitest'
import { browserFetcher } from '../src/adapters/browserFetcher'

const source = { type: 'browser', url: 'https://example.com/booking', waitForSelector: '.total' } as const

const stub = (res: Response) => {
  const quickAction = vi.fn(async () => res)
  return { browser: { quickAction } as unknown as BrowserRun, quickAction }
}

const rendered = (html: string, finalUrl: string = source.url) =>
  Response.json({
    success: true,
    result: html,
    meta: { status: 200, title: '', headers: { 'content-type': 'text/html' }, finalUrl },
  })

describe('browserFetcher', () => {
  it('returns the rendered HTML and the page status once the selector appears', async () => {
    const { browser, quickAction } = stub(rendered('<p class="total">¥ 24,790</p>'))

    const fetched = await browserFetcher(browser)(source)

    expect(fetched).toMatchObject({ status: 200, body: '<p class="total">¥ 24,790</p>', contentType: 'text/html' })
    expect(quickAction).toHaveBeenCalledWith(
      'content',
      expect.objectContaining({ url: source.url, waitForSelector: expect.objectContaining({ selector: '.total' }) }),
    )
  })

  it('returns a rate limit as status 429 so the run backs off', async () => {
    const { browser } = stub(
      Response.json({ success: false, errors: [{ code: 2001, message: 'Rate limit exceeded' }] }, { status: 429 }),
    )

    expect(await browserFetcher(browser)(source)).toMatchObject({ status: 429, body: '' })
  })

  it('throws the detail when the selector never appears', async () => {
    const detail = 'Waiting for selector `.total` failed'
    const { browser } = stub(
      Response.json(
        { success: false, errors: [{ code: 6002, message: 'A timeout was reached', detail }] },
        { status: 422 },
      ),
    )

    await expect(browserFetcher(browser)(source)).rejects.toThrow(detail)
  })

  it('throws the status when an error body is not JSON', async () => {
    const { browser } = stub(new Response('Forbidden', { status: 403 }))

    await expect(browserFetcher(browser)(source)).rejects.toThrow('status 403')
  })

  it('rejects a non-public URL before rendering', async () => {
    const { browser, quickAction } = stub(rendered(''))

    await expect(browserFetcher(browser)({ ...source, url: 'https://localhost/' })).rejects.toThrow()
    expect(quickAction).not.toHaveBeenCalled()
  })

  it('rejects a page the browser was redirected to on a private host', async () => {
    const { browser } = stub(rendered('<p>internal</p>', 'https://metadata.internal/'))

    await expect(browserFetcher(browser)(source)).rejects.toThrow('only public hosts are allowed')
  })
})
