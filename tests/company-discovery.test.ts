// ============================================================
// Company Discovery — normalizeName / normalizeDomain
// ============================================================
// The search-engine discovery engine this file used to test
// (discoverCompanies() and its filtering/extraction/tiering machinery) was
// retired 2026-08-22 — Explee is now the sole discovery source. What
// remains here is the shared normalization surface lib/enrichment/
// explee-lookup.ts and the Explee route still depend on.

import { describe, it, expect } from 'vitest'
import { normalizeName, normalizeDomain } from '../lib/enrichment/company-discovery'

describe('normalizeDomain', () => {
  it('strips protocol, www, and path', () => {
    expect(normalizeDomain('https://www.Acme.com/about')).toBe('acme.com')
    expect(normalizeDomain('acme.com')).toBe('acme.com')
    expect(normalizeDomain('http://acme.com')).toBe('acme.com')
  })
})

describe('normalizeName', () => {
  it('lowercases and strips legal suffixes', () => {
    expect(normalizeName('Bharat Forge Ltd.')).toBe('bharat forge')
    expect(normalizeName('Acme Inc')).toBe('acme')
  })

  it('collapses whitespace and strips punctuation, keeping hyphens', () => {
    expect(normalizeName('A-1 Fence Products, Pvt. Ltd.')).toBe('a-1 fence products')
  })

  // 2026-07-24 fix: this used to strip [^\w\s-] (ASCII-only in JS), mangling
  // an accented name — \p{L}/\p{N} (Unicode letter/number) preserves it.
  it('preserves accented characters (Unicode-aware, not ASCII \\w)', () => {
    expect(normalizeName('Möller Group')).toBe('möller group')
  })
})
