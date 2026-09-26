import { type Extractor, parseValue } from '@mirowler/core'

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', yen: '¥' }

const decodeEntities = (raw: string): string =>
  raw.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1]?.toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1))
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match
  })

export const htmlRewriterExtractor: Extractor = async (fetched, config) => {
  let phase: 'before' | 'inside' | 'done' = 'before'
  let text = ''
  await new HTMLRewriter()
    .on(config.selector, {
      element(el) {
        if (phase !== 'before') {
          return
        }
        phase = 'inside'
        try {
          el.onEndTag(() => {
            phase = 'done'
          })
        } catch {
          phase = 'done'
        }
      },
      text(chunk) {
        if (phase === 'inside') {
          text += chunk.text
        }
      },
    })
    .transform(new Response(fetched.body))
    .arrayBuffer()
  if (phase === 'before') {
    return { value: null, reason: `no element matched selector: ${config.selector}` }
  }
  return { value: parseValue(decodeEntities(text).trim(), config.parse) }
}
