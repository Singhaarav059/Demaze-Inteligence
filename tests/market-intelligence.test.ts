// ============================================================
// Market Intelligence Layer — categorization/tiering/filtering
// ============================================================
// Covers the pure, network-free pieces of discoverMarketIntelligence() (see
// lib/enrichment/market-intelligence.ts): category classification, the
// "strong indicator" check, confidence tiering, and statement-sanity
// rejection. The search calls themselves (searchTavily/searchSerper via
// searchWithFallback) are not unit-tested here — same reasoning as
// tests/competitor-discovery.test.ts / tests/icp-generator.test.ts.

import { describe, it, expect } from 'vitest'
import {
  classifyCategory,
  hasStrongIndicator,
  tierConfidence,
  classifyStatementRejection,
} from '../lib/enrichment/market-intelligence'

describe('classifyCategory — most-specific-first priority', () => {
  it('classifies a numeric growth claim as growth_indicator', () => {
    expect(classifyCategory('The market is projected to grow at a CAGR of 8.2% through 2030.')).toBe('growth_indicator')
    expect(classifyCategory('Market size is expected to reach $12 billion by 2028.')).toBe('growth_indicator')
  })

  it('classifies pressure/shortage language as challenge', () => {
    expect(classifyCategory('The sector faces a persistent labor shortage and rising costs.')).toBe('challenge')
    expect(classifyCategory('Manufacturers are under pressure from ongoing supply chain disruption.')).toBe('challenge')
  })

  it('classifies "shift toward" language as shift', () => {
    expect(classifyCategory('The industry is shifting toward automation and predictive maintenance.')).toBe('shift')
    expect(classifyCategory('Buyers are increasingly adopting cloud-based platforms.')).toBe('shift')
  })

  it('falls back to trend for generic explicit trend language', () => {
    expect(classifyCategory('A key trend in the sector is remote diagnostics.')).toBe('trend')
    expect(classifyCategory('Growing demand for sustainable packaging is an emerging trend.')).toBe('trend')
  })

  it('prefers growth_indicator over trend when both match', () => {
    expect(classifyCategory('This trend is driving market growth at a CAGR of 6%.')).toBe('growth_indicator')
  })

  it('returns null for sentences with no category-defining language', () => {
    expect(classifyCategory('The company was founded in 1998 and is headquartered in Pune.')).toBeNull()
  })
})

describe('hasStrongIndicator — concrete number/currency check', () => {
  it('detects a percentage', () => {
    expect(hasStrongIndicator('growing at 8.2% annually')).toBe(true)
  })

  it('detects a currency figure', () => {
    expect(hasStrongIndicator('expected to reach $12 billion by 2028')).toBe(true)
  })

  it('detects a bare CAGR mention', () => {
    expect(hasStrongIndicator('driven by strong CAGR across the region')).toBe(true)
  })

  it('returns false for prose with no figure', () => {
    expect(hasStrongIndicator('the industry is shifting toward automation')).toBe(false)
  })
})

describe('tierConfidence — mention_count + strong-indicator formula', () => {
  it('high: 2+ mentions and a strong indicator', () => {
    expect(tierConfidence(2, true)).toBe('high')
    expect(tierConfidence(3, true)).toBe('high')
  })

  it('medium: 2+ mentions without a strong indicator', () => {
    expect(tierConfidence(2, false)).toBe('medium')
  })

  it('medium: single mention with a strong indicator', () => {
    expect(tierConfidence(1, true)).toBe('medium')
  })

  it('low: single mention without a strong indicator', () => {
    expect(tierConfidence(1, false)).toBe('low')
  })
})

describe('classifyStatementRejection — sanity filter on already-classified sentences', () => {
  it('rejects statements that are too short', () => {
    expect(classifyStatementRejection('Growing fast.')).toMatch(/too short/)
  })

  it('rejects statements that are too few words even if long enough in characters', () => {
    expect(classifyStatementRejection('Automation-driven-industry-wide-transformation-trend-2026')).toMatch(/too few words/)
  })

  it('rejects all-caps navigation-style fragments', () => {
    expect(classifyStatementRejection('INDUSTRY TRENDS AND MARKET OUTLOOK REPORT')).toMatch(/navigation/)
  })

  it('accepts a real, well-formed statement', () => {
    expect(classifyStatementRejection('The market is projected to grow at a CAGR of 8.2% through 2030 as manufacturers adopt automation.')).toBeNull()
  })
})
