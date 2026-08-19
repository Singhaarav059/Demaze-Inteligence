// ============================================================
// Evidence cache tests (plan §42 G6; plan §43 "Cache tests: hit, miss, TTL,
// content hash, stale refresh").
// getCachedAttribution/saveCachedAttribution are pure Map operations
// (injectable `now`), tested directly — no network, no LLM.
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest'
import {
  getCachedAttribution,
  saveCachedAttribution,
  clearEvidenceCache,
  EVIDENCE_CACHE_TTL_HOURS,
} from '../lib/cache/evidence-cache'
import { attributeQuoteToSourceCached } from '../lib/pipeline/evidence-ledger'

const HOUR_MS = 60 * 60 * 1000

describe('getCachedAttribution / saveCachedAttribution (pure)', () => {
  beforeEach(() => clearEvidenceCache())

  it('miss: returns null for a never-cached (quote, contentPool) pair', () => {
    expect(getCachedAttribution('some quote', 'some content pool')).toBeNull()
  })

  it('hit: returns the cached attribution for an identical (quote, contentPool) pair', () => {
    const now = 1_000_000
    saveCachedAttribution('quote text', 'pool text', { sourceUrl: 'https://example.com/about', sourceType: 'corporate_website' }, now)
    const hit = getCachedAttribution('quote text', 'pool text', now + HOUR_MS)
    expect(hit).toEqual({ sourceUrl: 'https://example.com/about', sourceType: 'corporate_website' })
  })

  it('content hash: a different content pool is a genuine cache miss (correct key isolation)', () => {
    const now = 1_000_000
    saveCachedAttribution('quote text', 'pool A', { sourceUrl: 'https://a.com', sourceType: 'corporate_website' }, now)
    expect(getCachedAttribution('quote text', 'pool B', now)).toBeNull()
  })

  it('content hash: a different quote against the same pool is a genuine cache miss', () => {
    const now = 1_000_000
    saveCachedAttribution('quote A', 'shared pool', { sourceUrl: 'https://a.com', sourceType: 'corporate_website' }, now)
    expect(getCachedAttribution('quote B', 'shared pool', now)).toBeNull()
  })

  it('TTL: expires past EVIDENCE_CACHE_TTL_HOURS, not before', () => {
    const now = 1_000_000
    saveCachedAttribution('q', 'p', { sourceUrl: null, sourceType: 'unknown' }, now)
    expect(getCachedAttribution('q', 'p', now + EVIDENCE_CACHE_TTL_HOURS * HOUR_MS)).not.toBeNull()
    expect(getCachedAttribution('q', 'p', now + EVIDENCE_CACHE_TTL_HOURS * HOUR_MS + 1)).toBeNull()
  })

  it('honestly caches a null-sourceUrl attribution too (not fabricated on replay)', () => {
    saveCachedAttribution('unlocatable quote', 'pool', { sourceUrl: null, sourceType: 'unknown' })
    expect(getCachedAttribution('unlocatable quote', 'pool')).toEqual({ sourceUrl: null, sourceType: 'unknown' })
  })
})

describe('attributeQuoteToSourceCached (evidence-ledger.ts integration)', () => {
  beforeEach(() => clearEvidenceCache())

  const contentPool = '--- PAGE: /about (https://example.com/about) ---\nWe manufacture welding equipment across six facilities.'

  it('first call computes and caches; second call with identical inputs hits the cache with the same result', () => {
    const first = attributeQuoteToSourceCached('We manufacture welding equipment across six facilities.', undefined, contentPool)
    expect(first.sourceUrl).toBe('https://example.com/about')
    expect(first.sourceType).toBe('corporate_website')

    const second = attributeQuoteToSourceCached('We manufacture welding equipment across six facilities.', undefined, contentPool)
    expect(second).toEqual(first)
  })

  it('a genuinely unlocatable quote still returns an honest null sourceUrl (never fabricated)', () => {
    const result = attributeQuoteToSourceCached('this text does not appear anywhere in the pool', undefined, contentPool)
    expect(result.sourceUrl).toBeNull()
    expect(result.sourceType).toBe('unknown')
  })
})
