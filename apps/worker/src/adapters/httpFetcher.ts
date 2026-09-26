import type { Fetcher } from '@mirowler/core'

const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 5
const CHARSET_SNIFF_BYTES = 2048

/** Throws unless the URL is https with a public hostname and no credentials. Rejects IP literals, localhost and `.internal`. */
export const assertPublicHttpsUrl = (raw: string): URL => {
  const url = new URL(raw)
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (url.protocol !== 'https:') {
    throw new Error(`only https is allowed: ${raw}`)
  }
  if (url.username || url.password) {
    throw new Error('credentials in the URL are not allowed')
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

const charsetOf = (contentType: string | null, bytes: Uint8Array): string =>
  /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1] ??
  /<meta[^>]+charset=["']?([\w-]+)/i.exec(String.fromCharCode(...bytes.subarray(0, CHARSET_SNIFF_BYTES)))?.[1] ??
  'utf-8'

const decode = (bytes: Uint8Array, charset: string): string => {
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    return new TextDecoder().decode(bytes)
  }
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
  const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer())
  return decode(bytes, charsetOf(res.headers.get('content-type'), bytes))
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
