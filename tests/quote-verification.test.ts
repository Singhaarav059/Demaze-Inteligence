// ============================================================
// Quote Verification — evidence-grounding for the LLM opportunity path
// ============================================================
// Covers verifyQuoteInContent()/isQuoteGrounded() (see
// lib/pipeline/quote-verification.ts), the check that gates Session 2's
// evidence-grounded LLM opportunity path (normalize.ts) — an LLM-proposed
// opportunity only surfaces if its claimed evidence quote genuinely appears
// in the real content the LLM was shown.
// ============================================================

import { describe, it, expect } from 'vitest'
import { verifyQuoteInContent, isQuoteGrounded } from '../lib/pipeline/quote-verification'

const REAL_CONTENT = `
Established in 1951, Ador is one of the leading welding companies in India,
manufacturing high-quality welding equipment, consumables, and welding
automation solutions. With a strong focus on "Make in India," Ador produces
world-class products across six manufacturing facilities nationwide.

Our team currently relies on SAP MM for inventory management across all
plants, though the regional dealer network still coordinates orders manually
via phone and email each week.
`

describe('verifyQuoteInContent', () => {
  it('returns none for a quote under 30 chars', () => {
    expect(verifyQuoteInContent('SAP MM inventory', REAL_CONTENT).tier).toBe('none')
  })

  it('returns none for a quote with fewer than 8 significant words', () => {
    // Short quote, few significant (>3 char, non-stopword) tokens
    expect(verifyQuoteInContent('Ador is one of the leading welding companies here today', REAL_CONTENT).tier).toBe('none')
  })

  it('returns exact for a genuine verbatim quote', () => {
    const quote = 'Ador produces world-class products across six manufacturing facilities nationwide.'
    const result = verifyQuoteInContent(quote, REAL_CONTENT)
    expect(result.tier).toBe('exact')
    expect(result.matchedSnippet).toContain('manufacturing facilities')
  })

  it('is tolerant of whitespace/case differences (still exact tier)', () => {
    const quote = '  ADOR produces   world-class products across six manufacturing facilities nationwide.  '
    expect(verifyQuoteInContent(quote, REAL_CONTENT).tier).toBe('exact')
  })

  it('returns close for a paraphrased quote sharing a real 4-gram and high word overlap', () => {
    const quote = 'The team relies on SAP MM for inventory management, while the regional dealer network still coordinates orders manually each week'
    const result = verifyQuoteInContent(quote, REAL_CONTENT)
    expect(result.tier).toBe('close')
    expect(result.matchedSnippet).toContain('SAP MM')
  })

  it('returns none for a fabricated quote that shares only common words with real content', () => {
    const quote = 'The company recently announced a major new partnership with a global cloud computing provider'
    expect(verifyQuoteInContent(quote, REAL_CONTENT).tier).toBe('none')
  })

  it('returns none for a real-sounding but entirely unrelated long quote', () => {
    const quote = 'Reliance Industries operates the largest single-location oil refinery complex in the world today'
    expect(verifyQuoteInContent(quote, REAL_CONTENT).tier).toBe('none')
  })
})

describe('isQuoteGrounded', () => {
  const exactQuote = 'Ador produces world-class products across six manufacturing facilities nationwide.'
  const fabricatedQuote = 'The company recently announced a major new partnership with a global cloud provider'

  it('accepts an exact match at the default (close) threshold', () => {
    expect(isQuoteGrounded(exactQuote, REAL_CONTENT)).toBe(true)
  })

  it('rejects a fabricated quote', () => {
    expect(isQuoteGrounded(fabricatedQuote, REAL_CONTENT)).toBe(false)
  })

  it('requires exact tier when minTier is exact, rejecting a close-only match', () => {
    const closeQuote = 'The team relies on SAP MM for inventory management, while the regional dealer network still coordinates orders manually each week'
    expect(isQuoteGrounded(closeQuote, REAL_CONTENT, 'close')).toBe(true)
    expect(isQuoteGrounded(closeQuote, REAL_CONTENT, 'exact')).toBe(false)
  })
})
