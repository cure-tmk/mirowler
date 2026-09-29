import type { ApiType } from '@mirowler/worker/api'
import { hc } from 'hono/client'

type Failure = { status: number; body: string }

/** An `hc` client for the Worker at `url` that sends Basic auth and throws on a non-2xx response. */
export const createClient = (url: string, auth: string) =>
  hc<ApiType>(url, {
    headers: { authorization: `Basic ${Buffer.from(auth).toString('base64')}` },
    fetch: async (input: string | URL | Request, init?: RequestInit) => {
      const res = await fetch(input, init)
      if (!res.ok) {
        const body = await res.text()
        const cause: Failure = { status: res.status, body }
        throw new Error(`Request failed (${res.status}): ${body}`, { cause })
      }
      return res
    },
  })

export type Client = ReturnType<typeof createClient>

/** The raw response body of an error thrown by `createClient` for a non-2xx response. */
export const errorBody = (error: unknown) => {
  const cause = error instanceof Error ? error.cause : undefined
  return typeof cause === 'object' && cause !== null && 'body' in cause ? (cause as Failure).body : undefined
}
