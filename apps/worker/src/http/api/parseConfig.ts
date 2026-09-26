import type { Context } from 'hono'
import type { z } from 'zod'
import { assertPublicHttpsUrl } from '../../adapters/httpFetcher'
import { badRequest } from './badRequest'

/** Parses `input` with `schema` and runs the fetcher's public URL check on `source.url`, answering 400 on failure. */
export const parseConfig = <T extends { source: { url: string } }>(
  c: Context,
  schema: z.ZodType<T>,
  input: unknown,
) => {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    return { error: badRequest(c, 'invalid config', issues) }
  }
  try {
    assertPublicHttpsUrl(parsed.data.source.url)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { error: badRequest(c, 'invalid config', [{ path: 'source.url', message }]) }
  }
  return { config: parsed.data }
}
