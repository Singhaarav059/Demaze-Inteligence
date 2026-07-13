import { describe, it, expect } from 'vitest'
import { humanizeText, humanizeList } from '../lib/text/humanize'

describe('humanizeText — AI dash removal', () => {
  it('replaces a spaced em dash connector with a comma', () => {
    expect(humanizeText('Bharat Forge is scaling — moving beyond forging.'))
      .toBe('Bharat Forge is scaling, moving beyond forging.')
  })

  it('replaces a spaced en dash connector with a comma', () => {
    expect(humanizeText('Active hiring – budget exists now.'))
      .toBe('Active hiring, budget exists now.')
  })

  it('replaces a doubled-hyphen connector with a comma', () => {
    expect(humanizeText('We infer it -- from their model.'))
      .toBe('We infer it, from their model.')
  })

  it('leaves in-word hyphens untouched', () => {
    expect(humanizeText('multi-plant, tier-1 supplier with 30-50% rework'))
      .toBe('Multi-plant, tier-1 supplier with 30-50% rework')
  })

  it('does not leave a double comma when dash follows a comma', () => {
    expect(humanizeText('Automotive, defence, and aerospace — sharing the same presses.'))
      .toBe('Automotive, defence, and aerospace, sharing the same presses.')
  })
})

describe('humanizeText — filler removal', () => {
  it('strips the "hope this finds you well" opener', () => {
    expect(humanizeText('I hope this email finds you well. Saw your new plant.'))
      .toBe('Saw your new plant.')
  })

  it('swaps leverage/utilize for use', () => {
    expect(humanizeText('You can leverage AI to utilize your data.'))
      .toBe('You can use AI to use your data.')
  })

  it('re-capitalizes after removing a leading filler', () => {
    expect(humanizeText('Furthermore, the plant is expanding.'))
      .toBe('Also, the plant is expanding.')
  })
})

describe('humanizeText — edge cases', () => {
  it('returns empty string for nullish input', () => {
    expect(humanizeText(null)).toBe('')
    expect(humanizeText(undefined)).toBe('')
    expect(humanizeText('')).toBe('')
  })

  it('coerces non-strings', () => {
    expect(humanizeText(42)).toBe('42')
  })
})

describe('humanizeList', () => {
  it('humanizes each item and drops empties', () => {
    expect(humanizeList(['A — B', '', 'C -- D', null]))
      .toEqual(['A, B', 'C, D'])
  })

  it('returns [] for non-arrays', () => {
    expect(humanizeList('nope')).toEqual([])
  })
})
