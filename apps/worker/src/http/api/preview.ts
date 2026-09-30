import { evaluateRule, observe, previewInputSchema } from '@mirowler/core'
import { Hono } from 'hono'
import { htmlRewriterExtractor } from '../../adapters/htmlRewriterExtractor'
import { sourceFetcher } from '../../adapters/sourceFetcher'
import type { AppEnv } from '../../env'
import { parseConfig } from './parseConfig'

export const previewApi = new Hono<AppEnv>().post('/', async (c) => {
  const { config, error } = parseConfig(c, previewInputSchema, await c.req.json().catch(() => undefined))
  if (!config) {
    return error
  }
  const { state, ...observed } = await observe({
    source: config.source,
    extractorConfig: config.extractor,
    evaluatorConfig: config.evaluator,
    previousValid: null,
    fetcher: sourceFetcher(c.env.BROWSER),
    extractor: htmlRewriterExtractor,
    evaluator: evaluateRule,
  })
  // Without a baseline a change evaluator can only say not_matched, which would mislead; unknown still carries its reason
  const judged = state === 'unknown' || config.evaluator?.type === 'rule'
  return c.json(judged ? { ...observed, state } : observed)
})
