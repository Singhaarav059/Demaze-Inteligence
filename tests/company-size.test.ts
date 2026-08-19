// ============================================================
// Company size qualification — revenue/valuation/market-cap/employee-count
// evidence extraction and verdict logic (no network — assessCompanySizeFromText
// only; the fetchAndExtract() homepage-fallback path in assessCompanySize()
// is exercised via a direct-call smoke test with no domain, which short-
// circuits before any network call).
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  assessCompanySizeFromText,
  assessCompanySize,
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

  it('returns unknown without a domain when snippets carry no evidence', async () => {
    const result = await assessCompanySize(['A small industrial parts supplier.'], undefined)
    expect(result.verdict).toBe('unknown')
  })
})
