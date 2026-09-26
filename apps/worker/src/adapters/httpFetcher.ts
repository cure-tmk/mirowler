import type { Fetcher } from '@mirowler/core'

const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 5

/** Throws unless the URL is https with a public hostname. Rejects IP literals, localhost and `.internal`. */
export const assertPublicHttpsUrl = (raw: string): URL => {
  const url = new URL(raw)
  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'https:') {
    throw new Error(`only https is allowed: ${raw}`)
  }
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === 'internal' ||
    host.endsWith('.internal') ||
    host.startsWith('[') ||
    /^[\d.]+$/.test(host) ||
    !host.includes('.')
  ) {
    throw new Error(`only public hosts are allowed: ${host}`)
  }
  return url
}

const readLimited = async (res: Response): Promise<string> => {
  if (Number(res.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    throw new Error('body too large')
  }
  if (!res.body) {
    return ''
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    size += value.byteLength
    if (size > MAX_BODY_BYTES) {
      await reader.cancel()
      throw new Error('body too large')
    }
    chunks.push(value)
  }
  const charset = /charset=["']?([\w-]+)/i.exec(res.headers.get('content-type') ?? '')?.[1]
  const decoder = (() => {
    try {
      return new TextDecoder(charset ?? 'utf-8')
    } catch {
      return new TextDecoder()
    }
  })()
  return chunks.map((c) => decoder.decode(c, { stream: true })).join('') + decoder.decode()
}

export const httpFetcher: Fetcher = async (source) => {
  const signal = AbortSignal.timeout(15_000)
  let url = assertPublicHttpsUrl(source.url)
  for (let i = 0; ; i++) {
    const res = await fetch(url, { redirect: 'manual', signal, headers: { 'user-agent': 'mirowler' } })
    const location = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel()
      if (i >= MAX_REDIRECTS) {
        throw new Error('too many redirects')
      }
      url = assertPublicHttpsUrl(new URL(location, url).toString())
      continue
    }
    return {
      status: res.status,
      body: await readLimited(res),
      contentType: res.headers.get('content-type'),
      finalUrl: url.toString(),
      fetchedAt: new Date().toISOString(),
    }
  }
}
