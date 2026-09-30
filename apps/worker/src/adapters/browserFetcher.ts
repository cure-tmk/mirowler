import type { BrowserSource, FetchResult } from '@mirowler/core'
import { assertPublicHttpsUrl, MAX_BODY_BYTES } from './httpFetcher'

const SELECTOR_TIMEOUT_MS = 20_000

// Billed by browser time; rejecting stylesheets or waiting for network idle instead breaks rendering on real targets
const TRACKERS = [
  'google-analytics\\.com',
  'analytics\\.google\\.com',
  'googletagmanager\\.com',
  'googleadservices\\.com',
  'doubleclick\\.net',
  'google\\.com/(rmkt|ccm|measurement)/',
  'clarity\\.ms',
]

const isThrottled = (status: number) => status === 429 || status >= 500

/** Renders the page with Browser Rendering once `waitForSelector` appears and returns the rendered HTML as the body. A 429 or 5xx from Browser Rendering is returned as that status; other failures throw. */
export const browserFetcher =
  (browser: BrowserRun) =>
  async (source: BrowserSource): Promise<FetchResult> => {
    const url = assertPublicHttpsUrl(source.url).toString()
    const res = await browser.quickAction('content', {
      url,
      waitForSelector: { selector: source.waitForSelector, timeout: SELECTOR_TIMEOUT_MS },
      rejectRequestPattern: TRACKERS,
    })
    const fetchedAt = new Date().toISOString()
    if (isThrottled(res.status)) {
      await res.body?.cancel()
      return { status: res.status, body: '', contentType: null, finalUrl: url, fetchedAt }
    }
    const data = await res.json<BrowserRunContentSuccessResponse | BrowserRunErrorResponse>().catch(() => undefined)
    if (!data?.success) {
      const error = data?.errors?.[0]
      throw new Error(`browser rendering failed: ${error?.detail ?? error?.message ?? `status ${res.status}`}`)
    }
    if (data.result.length > MAX_BODY_BYTES) {
      throw new Error('body too large')
    }
    return {
      status: data.meta.status,
      body: data.result,
      contentType: data.meta.headers?.['content-type'] ?? null,
      finalUrl: assertPublicHttpsUrl(data.meta.finalUrl ?? url).toString(),
      fetchedAt,
    }
  }
