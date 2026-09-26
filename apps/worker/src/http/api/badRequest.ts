import type { Context } from 'hono'

export type Issue = { path: string; message: string }

/** The body of every 400 response from the API. `issues` are keyed by the dotted field path. */
export type ApiError = { error: string; issues?: Issue[] }

export const badRequest = (c: Context, error: string, issues?: Issue[]) => {
  const body: ApiError = issues ? { error, issues } : { error }
  return c.json(body, 400)
}
