import type { ApiType } from '@mirowler/worker/api'
import { hc } from 'hono/client'

type ErrorBody = {
  error?: string
  monitors?: { id: string; name: string }[]
  issues?: { path: string; message: string }[]
}

type Failure = { status: number; body: ErrorBody | undefined }

export const client = hc<ApiType>('/', {
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await fetch(input, init)
    if (!res.ok) {
      const body: ErrorBody | undefined = await res.json().catch(() => undefined)
      const cause: Failure = { status: res.status, body }
      throw new Error(body?.error ?? `Request failed (${res.status})`, { cause })
    }
    return res
  },
})

const failure = (error: Error | null) => error?.cause as Failure | undefined

/** The HTTP status of an error thrown by `client` for a non-2xx response. */
export const httpStatus = (error: Error | null) => failure(error)?.status

/** The response body of an error thrown by `client` for a non-2xx response. */
export const errorBody = (error: Error | null) => failure(error)?.body
