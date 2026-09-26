import { describe, expect, it } from 'vitest'
import { parseJpy, parseValue } from './parse'

describe('parseJpy', () => {
  it('normalizes full-width digits and strips currency marks', () => {
    expect(parseJpy('¥1,980')).toBe(1980)
    expect(parseJpy(' １，２３４ 円 ')).toBe(1234)
    expect(parseJpy('￥980')).toBe(980)
  })

  it('ignores parenthesized suffixes', () => {
    expect(parseJpy('123,456円（税込）')).toBe(123456)
    expect(parseJpy('1,000円(税抜)')).toBe(1000)
  })

  it('takes only the first amount', () => {
    expect(parseJpy('¥1,980 ¥1,580')).toBe(1980)
  })

  it('prefers the amount next to a yen mark over other numbers', () => {
    expect(parseJpy('残り3点 ¥1,980')).toBe(1980)
    expect(parseJpy('2点で3,000円')).toBe(3000)
  })

  it('rejects signed, decimal, exponent, and hex notations', () => {
    for (const text of ['0x1F', '1e3', '-500円', '1.980円']) {
      expect(parseJpy(text)).toBeNull()
    }
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
