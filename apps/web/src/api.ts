import type { ApiType } from '@mirowler/worker/api'
import { hc } from 'hono/client'

export const client = hc<ApiType>('/', {
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await fetch(input, init)
    if (!res.ok) {
      throw new Error(`Request failed (${res.status})`, { cause: res.status })
    }
    return res
  },
})

/** The HTTP status of an error thrown by `client` for a non-2xx response. */
export const httpStatus = (error: Error | null) => (typeof error?.cause === 'number' ? error.cause : undefined)
