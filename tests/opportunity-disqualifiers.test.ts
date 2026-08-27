// ============================================================
// Disqualifier consistency across opportunity paths (reliability pass item 2)
// ============================================================
// Before this fix, service-evidence.ts's disqualifiers only applied to the
// deterministic path (Path A) — an llm_verified/llm_inferred opportunity
// (Path B) whose service_line matched a disqualified service still surfaced,
// since Path B only whitelist-checked service_line against the 8 confirmed
// names, never consulted service-evidence.ts's disqualifier logic at all.
// Confirmed live: Chargebee (a real SaaS company) received a "Custom SaaS
// platforms" opportunity via llm_verified, even though
// detectCustomSaaSPlatforms()'s own disqualifier is exactly "company IS a
// SaaS company itself in the same space Demaze would build for."
//
// Fix reuses serviceEvidenceDebugResults (already computed for the debug
// field) to exclude any Path B candidate whose service_line matches an
// already-disqualified service — no new business rule, no threshold change,
// same disqualifier Path A already enforces.
// ============================================================

import { describe, it, expect } from 'vitest'
import { normalizeAnalysisResult } from '../lib/pipeline/normalize'
import { buildCompanyProfile } from '../lib/pipeline/evidence-extractor'

const SAAS_CONTENT = 'We are a leading SaaS company providing cloud-based subscription software platforms to businesses worldwide.'
const { profile: saasProfile } = buildCompanyProfile(SAAS_CONTENT)

function baseRaw(ai_opportunities: unknown, companyProfile = saasProfile) {
  return {
    company_name: 'Test SaaS Co',
    _service_evidence_content: SAAS_CONTENT,
    _extractor: {
      companySubjectCount: 3,
      signals: [{ signal: 'x' }],
      leadershipContacts: [],
      websitePreview: SAAS_CONTENT,
      companyProfile,
    },
    ai_opportunities,
  }
}

describe('llm_verified/llm_inferred opportunities respect service-evidence.ts disqualifiers', () => {
  it('rejects an llm_inferred "Custom SaaS platforms" opportunity for a company that IS a SaaS company itself', () => {
    const result = normalizeAnalysisResult(baseRaw([{
      title: 'Custom SaaS Platform Build',
      service_line: 'Custom SaaS platforms',
      claim_type: 'inferred',
      evidence: '',
      inferred_from: 'company operates a subscription software business model with recurring revenue',
      confidence: 'medium',
      description: 'x',
    }]))
    expect(result.opportunities.find(o => o.service_line === 'Custom SaaS platforms')).toBeUndefined()
  })

  it('rejects an llm_verified "Custom SaaS platforms" opportunity the same way (observed claim, real quote, still disqualified)', () => {
    const result = normalizeAnalysisResult(baseRaw([{
      title: 'Custom SaaS Platform Build',
      service_line: 'Custom SaaS platforms',
      claim_type: 'observed',
      evidence: 'We are a leading SaaS company providing cloud-based subscription software platforms',
      confidence: 'high',
      description: 'x',
    }]))
    expect(result.opportunities.find(o => o.service_line === 'Custom SaaS platforms')).toBeUndefined()
  })

  it('non-regression: a NON-disqualified service_line still surfaces via llm_inferred exactly as before', () => {
    const result = normalizeAnalysisResult(baseRaw([{
      title: 'Analytics Dashboard',
      service_line: 'Analytics and reporting systems',
      claim_type: 'inferred',
      evidence: '',
      inferred_from: 'a genuinely substantive stated reasoning basis about data silos across regions',
      confidence: 'medium',
      description: 'x',
    }]))
    const opp = result.opportunities.find(o => o.service_line === 'Analytics and reporting systems')
    expect(opp).toBeDefined()
    expect(opp?.source).toBe('llm_inferred')
  })

  it('non-regression: the deterministic path continues to apply the same disqualifier as before (unchanged behavior)', () => {
    const result = normalizeAnalysisResult(baseRaw([]))
    expect(result.deterministic_opportunities.find(o => o.title === 'Custom SaaS platforms')).toBeUndefined()
  })
})
