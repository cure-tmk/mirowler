import { describe, expect, it } from 'vitest'
import { parseJpy, parseValue } from './parse'

describe('parseJpy', () => {
  it('normalizes full-width digits and strips currency marks', () => {
    expect(parseJpy('¥1,980')).toBe(1980)
    expect(parseJpy(' １，２３４ 円 ')).toBe(1234)
    expect(parseJpy('￥980')).toBe(980)
  })

  it('returns null when unparsable', () => {
    expect(parseJpy('sold out')).toBeNull()
    expect(parseJpy('')).toBeNull()
    expect(parseJpy('円')).toBeNull()
  })
})

describe('parseValue', () => {
  it('shapes the value by parse mode', () => {
    expect(parseValue(' in stock ', 'text')).toEqual({ text: ' in stock ' })
    expect(parseValue('¥100', 'jpy')).toEqual({ jpy: 100 })
    expect(parseValue('n/a', 'jpy')).toEqual({ jpy: null })
  })
})
