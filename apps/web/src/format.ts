type ObservedValue = Record<string, string | number | boolean | null>

const yen = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'JPY' })

export const formatTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—')

const formatField = ([key, v]: [string, string | number | boolean | null]) => {
  if (v === null) {
    return key === 'jpy' ? 'No price found' : 'No value'
  }
  return key === 'jpy' && typeof v === 'number' ? yen.format(v) : String(v)
}

export const formatValue = (value: ObservedValue | null | undefined) =>
  value ? Object.entries(value).map(formatField).join(', ') : '—'

const stateLabels: Record<string, string> = { matched: 'Matched', not_matched: 'Not matched', unknown: 'Unknown' }

export const formatState = (state: string | null | undefined) => (state ? (stateLabels[state] ?? state) : '—')

export const formatRate = (rate: number | null) => (rate === null ? '—' : `${Math.round(rate * 100)}%`)
