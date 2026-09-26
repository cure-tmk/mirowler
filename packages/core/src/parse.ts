import type { ExtractorConfig, ObservedValue } from './monitor'

const amount = '[-+.\\w]*\\d[\\d,.\\w]*'
const markedAmount = new RegExp(`[¥￥]\\s*(${amount})|(${amount})\\s*円`)
const anyAmount = new RegExp(amount)

/** Parses the first amount next to a yen mark (or the first amount when there is no mark) as whole yen; null when that amount has a sign, decimal point, exponent, or hex prefix. */
export function parseJpy(text: string): number | null {
  const normalized = text
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[０-９，]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  const marked = markedAmount.exec(normalized)
  const token = marked ? (marked[1] ?? marked[2]) : anyAmount.exec(normalized)?.[0]
  if (token === undefined || !/^\d[\d,]*$/.test(token)) {
    return null
  }
  return Number(token.replace(/,/g, ''))
}

export function parseValue(text: string, parse: ExtractorConfig['parse']): ObservedValue {
  return parse === 'jpy' ? { jpy: parseJpy(text) } : { text }
}
