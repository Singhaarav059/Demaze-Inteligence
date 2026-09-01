// ============================================================
// useCompanyDiscoverySearch.ts's toMatches() — industry null-honesty
// ============================================================
// Regression test for the fixed bug: `industry: c.industry ?? industryLabel`
// used to silently backfill a company's missing industry with the
// *searched* sector/definition string, indistinguishable downstream from a
// real value. toMatches() is a pure function of its arguments (no hook
// state), hoisted to module scope specifically so it's testable here
// without a React render harness.
// ============================================================

import { describe, it, expect } from 'vitest'
import { toMatches } from '../app/admin/company-discovery/useCompanyDiscoverySearch'
import type { CompanyDiscoveryCompany } from '../lib/enrichment/company-discovery-provider-factory'

function company(overrides: Partial<CompanyDiscoveryCompany>): CompanyDiscoveryCompany {
  return {
    name: 'Acme', domain: 'acme.com', url: null, description: null, industry: null,
    geo: null, geo_city: null, size: null, founded: null, revenue_annual: null,
    funding_stage: null, linkedin_id: null,
    ...overrides,
  }
}

describe('toMatches', () => {
  it('stays null when the provider reported no industry, even with a search label present', () => {
    const [match] = toMatches([company({ industry: null })], {}, 'Manufacturing')
    expect(match.industry).toBeNull()
    expect(match.industryInferred).toBe(true)
  })

  it('preserves a real provider-reported industry untouched', () => {
    const [match] = toMatches([company({ industry: 'Aerospace' })], {}, 'Manufacturing')
    expect(match.industry).toBe('Aerospace')
    expect(match.industryInferred).toBe(false)
  })

  it('carries the provider tag through when present', () => {
    const [match] = toMatches([company({ provider: 'exa' })], {}, null)
    expect(match.provider).toBe('exa')
  })

  it('falls back to linkedin_url when linkedin_id is absent (Exa case)', () => {
    const [match] = toMatches([company({ linkedin_id: null, linkedin_url: 'https://linkedin.com/company/acme' })], {}, null)
    expect(match.linkedinUrl).toBe('https://linkedin.com/company/acme')
  })

  it('prefers linkedin_id when both are present (Explee case)', () => {
    const [match] = toMatches([company({ linkedin_id: 555 })], {}, null)
    expect(match.linkedinUrl).toBe('https://www.linkedin.com/company/555')
  })

  it('carries dataQualityFlags through when present (Exa case)', () => {
    const [match] = toMatches([company({ dataQualityFlags: ['generic_name'] })], {}, null)
    expect(match.dataQualityFlags).toEqual(['generic_name'])
  })

  it('leaves dataQualityFlags undefined when the provider never set it (Explee case)', () => {
    const [match] = toMatches([company({})], {}, null)
    expect(match.dataQualityFlags).toBeUndefined()
  })
})
