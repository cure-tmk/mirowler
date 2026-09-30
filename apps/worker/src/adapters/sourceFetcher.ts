import type { Fetcher } from '@mirowler/core'
import { browserFetcher } from './browserFetcher'
import { httpFetcher } from './httpFetcher'

/** Fetches with the adapter for the source type. */
export const sourceFetcher =
  (browser: BrowserRun): Fetcher =>
  (source) =>
    source.type === 'browser' ? browserFetcher(browser)(source) : httpFetcher(source)
