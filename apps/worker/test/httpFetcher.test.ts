import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpFetcher } from '../src/adapters/httpFetcher'

const get = (url: string) => httpFetcher({ type: 'http', url })

const redirect = (location: string) => new Response(null, { status: 302, headers: { location } })

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('httpFetcher', () => {
  it.each(['https://localhost./', 'https://127.0.0.1/', 'https://intranet/', 'https://user:pass@example.com/'])(
    'rejects %s before fetching',
    async (url) => {
      const fetch = vi.spyOn(globalThis, 'fetch')

      await expect(get(url)).rejects.toThrow()
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it('rejects a redirect to a private host', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(redirect('https://metadata.internal/'))

    await expect(get('https://example.com/')).rejects.toThrow('only public hosts are allowed')
  })

  it('gives up after too many redirects', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => redirect('https://example.com/next'))

    await expect(get('https://example.com/')).rejects.toThrow('too many redirects')
  })

  it('rejects a body over the cap', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array(2 * 1024 * 1024 + 1)))

    await expect(get('https://example.com/')).rejects.toThrow('body too large')
  })

  it('returns a 3xx without Location as-is', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('choose', { status: 300 }))

    expect(await get('https://example.com/')).toMatchObject({
      status: 300,
      body: 'choose',
      finalUrl: 'https://example.com/',
    })
  })

  it('decodes with the charset declared in a meta tag', async () => {
    const head = new TextEncoder().encode('<meta charset="Shift_JIS"><p>')
    const yen = new Uint8Array([0x89, 0x7e])
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Blob([head, yen]), { headers: { 'content-type': 'text/html' } }),
    )

    expect((await get('https://example.com/')).body).toBe('<meta charset="Shift_JIS"><p>円')
  })
})
