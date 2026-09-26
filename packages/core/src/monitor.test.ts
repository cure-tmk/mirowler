import { describe, expect, it } from 'vitest'
import { extractorSchema } from './monitor'

describe('extractorSchema', () => {
  it('accepts css_text and css_attr', () => {
    expect(extractorSchema.safeParse({ type: 'css_text', selector: 'h1', parse: 'text' }).success).toBe(true)
    expect(
      extractorSchema.safeParse({ type: 'css_attr', selector: 'input', attribute: 'value', parse: 'text' }).success,
    ).toBe(true)
  })

  it('rejects css_attr without an attribute', () => {
    expect(extractorSchema.safeParse({ type: 'css_attr', selector: 'input', parse: 'text' }).success).toBe(false)
  })
})
