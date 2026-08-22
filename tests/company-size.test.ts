// ============================================================
// Company size qualification — revenue/valuation/market-cap/employee-count
// evidence extraction and verdict logic (no network — assessCompanySizeFromText
// only; the fetchAndExtract() homepage-fallback path in assessCompanySize()
// is exercised via a direct-call smoke test with no domain, which short-
// circuits before any network call).
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

const getCompletionMock = vi.fn()
vi.mock('../lib/ai/provider-factory', () => ({
  getCompletion: (...args: unknown[]) => getCompletionMock(...args),
}))

beforeEach(() => {
  getCompletionMock.mockReset()
})

import {
  assessCompanySizeFromText,
  assessCompanySize,
  assessCompanySizeViaKnowledge,
  verdictFromStoredEvidence,
  sizeKnowledgeTierMetrics,
  resetSizeKnowledgeTierMetrics,
  TARGET_REVENUE_RANGE_CR_INR,
} from '../lib/enrichment/company-size'

describe('assessCompanySizeFromText — metric separation', () => {
  it('never conflates revenue with valuation', () => {
    const result = assessCompanySizeFromText(['The company reported revenue of $30 million and was valued at $200 million in its last funding round.'])
    const metrics = result.evidence.map(e => e.metric)
    expect(metrics).toContain('revenue')
    expect(metrics).toContain('valuation')
    const revenue = result.evidence.find(e => e.metric === 'revenue')
    const valuation = result.evidence.find(e => e.metric === 'valuation')
    expect(revenue?.valueUsdApprox).toBeCloseTo(30_000_000, -3)
    expect(valuation?.valueUsdApprox).toBeCloseTo(200_000_000, -3)
  })

  it('never conflates market cap with revenue', () => {
    const result = assessCompanySizeFromText(['Market cap of $50 million. Revenue of $8 million reported last year.'])
    const marketCap = result.evidence.find(e => e.metric === 'market_cap')
    const revenue = result.evidence.find(e => e.metric === 'revenue')
    expect(marketCap?.valueUsdApprox).toBeCloseTo(50_000_000, -3)
    expect(revenue?.valueUsdApprox).toBeCloseTo(8_000_000, -3)
  })

  it('never converts employee count into a revenue/valuation number', () => {
    const result = assessCompanySizeFromText(['The company employs around 300 employees.'])
    const employeeEvidence = result.evidence.find(e => e.metric === 'employee_count')
    expect(employeeEvidence?.employeeCount).toBe(300)
    expect(employeeEvidence?.valueUsdApprox).toBeUndefined()
  })
})

describe('assessCompanySizeFromText — INR revenue band', () => {
  it('accepts revenue within the ~₹50cr-₹500cr band', () => {
    // ₹100 crore ≈ $12M — well within the band
    const result = assessCompanySizeFromText(['The company reported revenue of ₹100 crore last fiscal year.'])
    expect(result.verdict).toBe('within_range')
    expect(result.reason).toMatch(/revenue/)
  })

  it('rejects revenue below the floor as too_small', () => {
    // ₹5 crore ≈ $600K — well below the ~₹50cr floor
    const result = assessCompanySizeFromText(['Annual revenue of ₹5 crore.'])
    expect(result.verdict).toBe('too_small')
  })

  it('rejects revenue above the ceiling as too_large', () => {
    // ₹2000 crore ≈ $240M — well above the ~₹500cr ceiling
    const result = assessCompanySizeFromText(['Annual revenue of ₹2000 crore.'])
    expect(result.verdict).toBe('too_large')
  })

  it(`documents the target band as ₹${TARGET_REVENUE_RANGE_CR_INR.min}cr-₹${TARGET_REVENUE_RANGE_CR_INR.max}cr`, () => {
    expect(TARGET_REVENUE_RANGE_CR_INR).toEqual({ min: 50, max: 500 })
  })
})

describe('assessCompanySizeFromText — never rejects on missing evidence', () => {
  it('returns unknown, not a rejection, when no size evidence exists at all', () => {
    const result = assessCompanySizeFromText(['A company that makes industrial fasteners for the automotive sector.'])
    expect(result.verdict).toBe('unknown')
    expect(result.evidence).toHaveLength(0)
  })

  it('returns unknown (not a rejection) when only a mid-range employee count is found — a supporting proxy, never confirms the band alone', () => {
    const result = assessCompanySizeFromText(['The company has approximately 250 employees.'])
    expect(result.verdict).toBe('unknown')
  })
})

describe('assessCompanySizeFromText — mega/micro scale rejections', () => {
  it('rejects an explicit mega-scale phrase regardless of other evidence', () => {
    const result = assessCompanySizeFromText(['A Fortune 500 company with revenue of ₹100 crore in one division.'])
    expect(result.verdict).toBe('too_large')
    expect(result.reason).toMatch(/Fortune/)
  })

  it('rejects a mega employee count as a supporting-proxy-only too_large', () => {
    const result = assessCompanySizeFromText(['The company employs over 75,000 employees worldwide.'])
    expect(result.verdict).toBe('too_large')
  })
})

describe('assessCompanySize — pure text path, no domain given', () => {
  it('never attempts a network fetch when no domain is provided', async () => {
    const result = await assessCompanySize(['Revenue of ₹100 crore.'], null)
    expect(result.verdict).toBe('within_range')
  })

  it('returns unknown without a domain when snippets carry no evidence and no companyName is given (knowledge tier skipped)', async () => {
    const result = await assessCompanySize(['A small industrial parts supplier.'], undefined)
    expect(result.verdict).toBe('unknown')
    expect(getCompletionMock).not.toHaveBeenCalled()
  })
})

// Real gap found live 2026-08-20 (fresh discovery benchmark): BMW, Audi,
// Porsche, Maruti Suzuki, JCB, Tencent, Jacobs Solutions, and Fluor all
// qualified with zero explicit revenue/employee evidence in their search
// snippets. This tier is the fix — a last-resort, decline-if-unsure LLM
// check, reached only when snippet AND homepage evidence both stay
// 'unknown'.
describe('assessCompanySizeViaKnowledge — AI direct-knowledge tier, decline-if-unsure', () => {
  it('returns too_large when the LLM confidently recognizes a global giant', async () => {
    getCompletionMock.mockResolvedValueOnce({ content: '{"scale":"large","reasoning":"BMW is a major German multinational automaker"}', model: 'test', providerName: 'test' })
    const result = await assessCompanySizeViaKnowledge('BMW')
    expect(result.verdict).toBe('too_large')
    expect(result.reason).toContain('BMW is a major German multinational automaker')
  })

  it('returns unknown when the LLM declines (does not recognize the company)', async () => {
    getCompletionMock.mockResolvedValueOnce({ content: '{"scale":"unknown","reasoning":"not a recognized company"}', model: 'test', providerName: 'test' })
    const result = await assessCompanySizeViaKnowledge('Some Obscure Regional Firm Pvt Ltd')
    expect(result.verdict).toBe('unknown')
  })

  it('never throws and returns unknown on a call failure', async () => {
    getCompletionMock.mockRejectedValueOnce(new Error('network error'))
    const result = await assessCompanySizeViaKnowledge('Anything')
    expect(result.verdict).toBe('unknown')
  })

  it('never throws and returns unknown on an unparseable response', async () => {
    getCompletionMock.mockResolvedValueOnce({ content: 'not json at all', model: 'test', providerName: 'test' })
    const result = await assessCompanySizeViaKnowledge('Anything')
    expect(result.verdict).toBe('unknown')
  })

  it('strips markdown code fences before parsing (same convention as the rest of this codebase)', async () => {
    getCompletionMock.mockResolvedValueOnce({ content: '```json\n{"scale":"large","reasoning":"test"}\n```', model: 'test', providerName: 'test' })
    const result = await assessCompanySizeViaKnowledge('Fenced Co')
    expect(result.verdict).toBe('too_large')
  })
})

describe('assessCompanySize — full 3-tier fallback chain (snippets -> homepage -> AI knowledge)', () => {
  it('reaches the knowledge tier and rejects a well-known giant when a companyName is given but no domain/snippet evidence exists', async () => {
    getCompletionMock.mockResolvedValueOnce({ content: '{"scale":"large","reasoning":"a globally known automaker"}', model: 'test', providerName: 'test' })
    const result = await assessCompanySize([], undefined, 'BMW')
    expect(result.verdict).toBe('too_large')
  })

  it('does not reach the knowledge tier when snippet evidence already resolved the verdict', async () => {
    const result = await assessCompanySize(['Revenue of ₹100 crore.'], undefined, 'Some Company')
    expect(result.verdict).toBe('within_range')
    expect(getCompletionMock).not.toHaveBeenCalled()
  })

  it('a genuinely unknown small/obscure company stays unknown through all 3 tiers, still passes qualification', async () => {
    getCompletionMock.mockResolvedValueOnce({ content: '{"scale":"unknown"}', model: 'test', providerName: 'test' })
    const result = await assessCompanySize(['A regional supplier.'], undefined, 'Obscure Regional Supplier LLC')
    expect(result.verdict).toBe('unknown')
  })
})

// Production-hardening task's explicit safety property: the knowledge tier
// must never turn "evidence unknown + LLM uncertain" into "too_large" — it
// can ONLY reject on a confident "large" answer, and stays unknown for
// every other outcome (decline, malformed response, timeout, network
// error). Consolidates the individual cases already covered above into one
// place that states the property directly.
describe('assessCompanySizeViaKnowledge — the "unknown + uncertain = unknown, never too_large" safety property', () => {
  it.each([
    ['decline', '{"scale":"unknown","reasoning":"not recognized"}'],
    ['malformed JSON', 'not json'],
    ['unexpected scale value', '{"scale":"maybe","reasoning":"not sure"}'],
    ['empty response', ''],
  ])('%s never produces too_large', async (_label, content) => {
    getCompletionMock.mockResolvedValueOnce({ content, model: 'test', providerName: 'test' })
    const result = await assessCompanySizeViaKnowledge('Some Company')
    expect(result.verdict).not.toBe('too_large')
    expect(result.verdict).toBe('unknown')
  })

  it('a call failure never produces too_large', async () => {
    getCompletionMock.mockRejectedValueOnce(new Error('timeout'))
    const result = await assessCompanySizeViaKnowledge('Some Company')
    expect(result.verdict).not.toBe('too_large')
  })

  // Explicit "test repeated evaluation of the same known companies"
  // requirement — confirms the tier is stateless/idempotent per call (no
  // caching that could let one stale answer silently persist), and that a
  // confident answer stays confident across repeats.
  it('repeated calls for the same well-known company consistently reject', async () => {
    for (let i = 0; i < 3; i++) {
      getCompletionMock.mockResolvedValueOnce({ content: '{"scale":"large","reasoning":"BMW is a major global automaker"}', model: 'test', providerName: 'test' })
      const result = await assessCompanySizeViaKnowledge('BMW')
      expect(result.verdict).toBe('too_large')
    }
    expect(getCompletionMock).toHaveBeenCalledTimes(3)
  })

  it('repeated calls for the same obscure company consistently stay unknown', async () => {
    for (let i = 0; i < 3; i++) {
      getCompletionMock.mockResolvedValueOnce({ content: '{"scale":"unknown"}', model: 'test', providerName: 'test' })
      const result = await assessCompanySizeViaKnowledge('Obscure Co')
      expect(result.verdict).toBe('unknown')
    }
  })
})

describe('sizeKnowledgeTierMetrics — instrumentation (Phase 8: measure, not assume)', () => {
  it('counts calls, rejections, and unknowns correctly', async () => {
    resetSizeKnowledgeTierMetrics()
    getCompletionMock.mockResolvedValueOnce({ content: '{"scale":"large"}', model: 'test', providerName: 'test' })
    await assessCompanySizeViaKnowledge('Big Co')
    getCompletionMock.mockResolvedValueOnce({ content: '{"scale":"unknown"}', model: 'test', providerName: 'test' })
    await assessCompanySizeViaKnowledge('Small Co')

    expect(sizeKnowledgeTierMetrics.calls).toBe(2)
    expect(sizeKnowledgeTierMetrics.rejections).toBe(1)
    expect(sizeKnowledgeTierMetrics.unknowns).toBe(1)
  })

  it('resetSizeKnowledgeTierMetrics() zeroes every counter', async () => {
    getCompletionMock.mockResolvedValueOnce({ content: '{"scale":"large"}', model: 'test', providerName: 'test' })
    await assessCompanySizeViaKnowledge('Big Co')
    resetSizeKnowledgeTierMetrics()
    expect(sizeKnowledgeTierMetrics).toEqual({ calls: 0, rejections: 0, unknowns: 0, totalLatencyMs: 0 })
  })

  it('a call failure still counts toward calls/unknowns (never silently dropped from the metrics)', async () => {
    resetSizeKnowledgeTierMetrics()
    getCompletionMock.mockRejectedValueOnce(new Error('timeout'))
    await assessCompanySizeViaKnowledge('Anything')
    expect(sizeKnowledgeTierMetrics.calls).toBe(1)
    expect(sizeKnowledgeTierMetrics.unknowns).toBe(1)
  })
})

describe('verdictFromStoredEvidence — re-derives a verdict from persisted evidence, no I/O', () => {
  it('re-derives too_large from stored revenue evidence', () => {
    const result = verdictFromStoredEvidence([
      { metric: 'revenue', raw: '$10 billion', valueUsdApprox: 10_000_000_000, sourceSnippet: 'x' },
    ])
    expect(result.verdict).toBe('too_large')
    expect(result.source).toBe('snippets')
  })

  it('returns unknown/source none for empty stored evidence', () => {
    const result = verdictFromStoredEvidence([])
    expect(result.verdict).toBe('unknown')
    expect(result.source).toBe('none')
  })
})
