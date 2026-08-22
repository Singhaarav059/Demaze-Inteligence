import { describe, it, expect } from 'vitest'
import { qualifyDiscoveredCompany } from '../lib/sector-playbook/qualify-discovery'
import { qualifyCompany } from '../lib/sector-playbook/qualify'
import type { CompanyResearchResult } from '../lib/research/company-signals'

function emptyResult(overrides: Partial<CompanyResearchResult> = {}): CompanyResearchResult {
  return {
    signals: [],
    whatThisSuggests: null,
    potentialPainPoints: [],
    opportunities: [],
    whyContactNow: null,
    groundingSources: [],
    ...overrides,
  }
}

describe('qualifyDiscoveredCompany', () => {
  it('classifies sector from industry + signal text and scores it the same as qualifyCompany would', () => {
    const result = qualifyDiscoveredCompany(
      { industry: 'Manufacturing' },
      emptyResult({ whatThisSuggests: 'Operates multiple manufacturing facilities producing industrial components.' })
    )
    expect(result.classification.sector).toBe('manufacturing')
    expect(result.playbook?.label).toBe('Manufacturing')
    expect(result.sectorFit.score).toBeGreaterThan(0)
  })

  it('scores company fit on firmographic completeness, not a size/revenue judgment', () => {
    const rich = qualifyDiscoveredCompany(
      { industry: 'Manufacturing', employeeCount: 500, hqLocation: 'India', founded: 2001, revenueAnnual: 20_000_000 },
      emptyResult()
    )
    expect(rich.companyFit.score).toBe(100)
    expect(rich.companyFit.reasons[0]).toContain('not a size/revenue judgment')

    const thin = qualifyDiscoveredCompany({}, emptyResult())
    expect(thin.companyFit.score).toBe(0)
    expect(thin.companyFit.reasons[0]).toContain('No firmographic data')
  })

  it('maps opportunities into matchedOpportunities tagged inferred, never confirmed', () => {
    const result = qualifyDiscoveredCompany(
      { industry: 'Manufacturing' },
      emptyResult({
        opportunities: [
          { service: 'Workflow automation systems', evidence: 'Hiring 50 production engineers.', interpretation: 'Scaling ops.', opportunity: 'Operational scaling support' },
        ],
      })
    )
    expect(result.matchedOpportunities).toHaveLength(1)
    expect(result.matchedOpportunities[0].tier).toBe('inferred')
    expect(result.matchedOpportunities[0].capability).toBe('Workflow automation systems')
    expect(result.opportunityEvidence.score).toBeGreaterThan(0)
  })

  it('never fabricates evidence — no opportunities/pain points means score 0 and an honest reason', () => {
    const result = qualifyDiscoveredCompany({ industry: 'Manufacturing' }, emptyResult())
    expect(result.opportunityEvidence.score).toBe(0)
    expect(result.opportunityEvidence.reasons[0]).toContain('No specific opportunity evidence')
  })

  it('leaves contactability null — this view never runs decision-maker discovery', () => {
    const result = qualifyDiscoveredCompany({ industry: 'Manufacturing' }, emptyResult())
    expect(result.contactability.score).toBeNull()
  })

  it('produces the same overall-score formula qualifyCompany uses (shared buildOverallScore)', () => {
    const lightweight = qualifyDiscoveredCompany(
      { industry: 'Manufacturing', employeeCount: 500, founded: 2001, hqLocation: 'India', revenueAnnual: 5_000_000 },
      emptyResult({ whatThisSuggests: 'Operates multiple manufacturing facilities.' })
    )
    const heavy = qualifyCompany({
      industry: 'Manufacturing',
      company_summary: 'Operates multiple manufacturing facilities.',
      company_fit: { value: 100 },
    })
    // Same sector classification + same 100 company-fit score + both 0
    // opportunity evidence + both null contactability -> identical formula
    // output, proving the two producers share one weighting implementation.
    expect(lightweight.overall.score).toBe(heavy.overall.score)
  })
})
