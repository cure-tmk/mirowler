import type { ExtractorConfig, ObservedValue } from './monitor'

export function parseJpy(text: string): number | null {
  const normalized = text
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[¥￥,，円\s]/g, '')
  if (normalized === '') {
    return null
  }
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

export function parseValue(text: string, parse: ExtractorConfig['parse']): ObservedValue {
  return parse === 'jpy' ? { jpy: parseJpy(text) } : { text }
}
