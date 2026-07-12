// ============================================================
// Batch Quota-Pause Detection — tests
// ============================================================
// Closes out the "Research Selected" verification from the live batch run
// (2026-07-12): that run completed 3/3 companies successfully and never hit
// a real quota signature, so the pause path was never exercised end-to-end.
// Rather than deliberately burning real Firecrawl/Tavily quota to force it,
// this feeds simulated quota-exceeded response shapes as fixed input and
// confirms the pause logic fires correctly with no network calls involved.
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  quotaSignatureIn,
  nextConsecutiveHits,
  shouldPauseBatch,
  QUOTA_PAUSE_THRESHOLD,
  type QuotaCheckInput,
} from '../lib/batch/quota-pause'

describe('quotaSignatureIn', () => {
  it('detects Firecrawl "insufficient credits" in scrapeResult.debug.errors', () => {
    const data: QuotaCheckInput = {
      scrapeResult: { debug: { errors: ['Firecrawl error: insufficient credits remaining'] } },
    }
    expect(quotaSignatureIn(data)).toBe('Firecrawl error: insufficient credits remaining')
  })

  it('detects Tavily "exceeds your plan" in a validation gate reason', () => {
    const data: QuotaCheckInput = {
      validation: { gates: [{ reason: 'Tavily search failed: This request exceeds your plan\'s set usage limit' }] },
    }
    expect(quotaSignatureIn(data)).toContain('exceeds your plan')
  })

  it('detects "quota exceeded" inside stringified gate diagnostics', () => {
    const data: QuotaCheckInput = {
      validation: { gates: [{ diagnostics: { provider: 'tavily', message: 'quota exceeded for this billing period' } }] },
    }
    expect(quotaSignatureIn(data)).toContain('quota exceeded')
  })

  it('detects generic "rate limit" in the top-level error field', () => {
    const data: QuotaCheckInput = { error: 'Request failed: rate limit hit, try again later' }
    expect(quotaSignatureIn(data)).toContain('rate limit')
  })

  it('detects a bare HTTP 429 status', () => {
    const data: QuotaCheckInput = { error: 'Upstream returned 429 Too Many Requests' }
    expect(quotaSignatureIn(data)).toContain('429')
  })

  it('detects a bare HTTP 432 status (Tavily-specific)', () => {
    const data: QuotaCheckInput = { error: 'Upstream returned HTTP 432' }
    expect(quotaSignatureIn(data)).toContain('432')
  })

  it('does NOT match a generic LLM_PARSE_FAIL / truncation error', () => {
    // This is the exact failure class hit live during the 2026-07-12 batch
    // run (finishReason=length, Unterminated string in JSON) — it retried
    // and succeeded, and correctly did not count toward a quota pause.
    const data: QuotaCheckInput = {
      error: 'LLM_PARSE_FAIL attempt=1 finishReason=length Unterminated string in JSON at position 7175',
    }
    expect(quotaSignatureIn(data)).toBeNull()
  })

  it('does NOT match a generic network/DNS failure', () => {
    const data: QuotaCheckInput = { error: 'fetch failed: getaddrinfo ENOTFOUND example.com' }
    expect(quotaSignatureIn(data)).toBeNull()
  })

  it('returns null for a clean success response with no error/scrapeResult/validation', () => {
    expect(quotaSignatureIn({})).toBeNull()
  })

  it('does not throw when scrapeResult has no debug field', () => {
    const data: QuotaCheckInput = { scrapeResult: { successfulUrls: ['https://example.com'] } }
    expect(quotaSignatureIn(data)).toBeNull()
  })
})

describe('nextConsecutiveHits', () => {
  it('increments on a hit', () => {
    expect(nextConsecutiveHits(0, 'quota exceeded')).toBe(1)
    expect(nextConsecutiveHits(1, 'quota exceeded')).toBe(2)
    expect(nextConsecutiveHits(2, 'quota exceeded')).toBe(3)
  })

  it('resets to zero on a non-hit, breaking the streak', () => {
    expect(nextConsecutiveHits(2, null)).toBe(0)
    expect(nextConsecutiveHits(5, null)).toBe(0)
  })
})

describe('shouldPauseBatch', () => {
  it(`is false below the ${QUOTA_PAUSE_THRESHOLD}-hit threshold`, () => {
    expect(shouldPauseBatch(0)).toBe(false)
    expect(shouldPauseBatch(1)).toBe(false)
    expect(shouldPauseBatch(2)).toBe(false)
  })

  it(`is true at and above the ${QUOTA_PAUSE_THRESHOLD}-hit threshold`, () => {
    expect(shouldPauseBatch(3)).toBe(true)
    expect(shouldPauseBatch(4)).toBe(true)
  })
})

describe('end-to-end pause simulation (mirrors the real researchSelected loop)', () => {
  function runBatch(results: Array<QuotaCheckInput>): { pausedAt: number | null; finalHits: number } {
    let consecutiveHits = 0
    for (let i = 0; i < results.length; i++) {
      const quotaMsg = quotaSignatureIn(results[i])
      consecutiveHits = nextConsecutiveHits(consecutiveHits, quotaMsg)
      if (quotaMsg && shouldPauseBatch(consecutiveHits)) {
        return { pausedAt: i, finalHits: consecutiveHits }
      }
    }
    return { pausedAt: null, finalHits: consecutiveHits }
  }

  it('pauses at the 3rd company when 3 consecutive quota hits occur', () => {
    const results: QuotaCheckInput[] = [
      { error: 'rate limit exceeded' },
      { error: 'insufficient credits' },
      { error: 'quota exceeded' },
      { success: true } as unknown as QuotaCheckInput, // would never be reached
    ]
    const outcome = runBatch(results)
    expect(outcome.pausedAt).toBe(2) // 0-indexed: 3rd company
    expect(outcome.finalHits).toBe(3)
  })

  it('does NOT pause when a success breaks up the quota-hit streak', () => {
    const results: QuotaCheckInput[] = [
      { error: 'rate limit exceeded' },
      {}, // clean success resets the streak
      { error: 'insufficient credits' },
      { error: 'quota exceeded' },
    ]
    const outcome = runBatch(results)
    // Only 2 consecutive hits at the end (companies 3 and 4) — never reaches 3
    expect(outcome.pausedAt).toBeNull()
    expect(outcome.finalHits).toBe(2)
  })

  it('does NOT pause on real-world successful runs (the actual 2026-07-12 batch)', () => {
    // Mirrors what genuinely happened: 3 companies, all completed, one had a
    // non-quota LLM_PARSE_FAIL retry that succeeded.
    const results: QuotaCheckInput[] = [
      {}, // A-1 Fence Products — succeeded after an internal retry
      {}, // AITG — succeeded
      {}, // AS Agri & Aqua — succeeded (PARTIAL gate, but not a quota error)
    ]
    const outcome = runBatch(results)
    expect(outcome.pausedAt).toBeNull()
    expect(outcome.finalHits).toBe(0)
  })
})
