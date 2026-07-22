// ============================================================
// Opportunities — evidence-grounded LLM path (normalize.ts, Path B)
// ============================================================
// Covers Session 2 of the 2026-07-22 research-quality initiative, plus the
// same-day fix found via live RIL usage: Path B originally only surfaced
// claim_type 'observed' + quote-verified opportunities, silently discarding
// every 'inferred' one — even well-reasoned, company-specific ones with no
// literal quote to cite. Sub-path B2 (llm_inferred) closes that gap: an
// 'inferred' opportunity surfaces if it has a real, substantive
// `inferred_from` reasoning basis, tagged `source: 'llm_inferred'` and
// capped at `relevance: 'Low'`.

import { describe, it, expect } from 'vitest'
import { normalizeAnalysisResult } from '../lib/pipeline/normalize'

const REAL_CONTENT = 'Our refinery at Jamnagar is the world\'s largest, integrated, single-location refining complex, and the Green Energy Giga Complex adds hydrogen, wind and solar to existing operations.'

function baseRaw(ai_opportunities: unknown) {
  return {
    company_name: 'Test Co',
    _extractor: {
      companySubjectCount: 3,
      signals: [{ signal: 'growth' }],
      leadershipContacts: [],
      websitePreview: REAL_CONTENT,
    },
    ai_opportunities,
  }
}

describe('normalizeAnalysisResult — opportunities Path B (observed + inferred)', () => {
  it('surfaces an observed opportunity with a real quote as llm_verified', () => {
    const result = normalizeAnalysisResult(baseRaw([{
      title: 'Predictive Maintenance for Jamnagar Refinery',
      service_line: 'AI-powered business applications',
      claim_type: 'observed',
      evidence: 'Our refinery at Jamnagar is the world\'s largest, integrated, single-location refining complex',
      confidence: 'high',
      description: 'x',
    }]))
    const opp = result.opportunities.find(o => o.title === 'Predictive Maintenance for Jamnagar Refinery')
    expect(opp?.source).toBe('llm_verified')
  })

  it('surfaces an inferred opportunity with a substantive inferred_from as llm_inferred, relevance Low', () => {
    const result = normalizeAnalysisResult(baseRaw([{
      title: 'Integrating new-energy assets with legacy oil-to-chemicals systems',
      service_line: 'Workflow automation systems',
      claim_type: 'inferred',
      evidence: '',
      inferred_from: 'deployment of Green Energy Giga Complex alongside existing hydrocarbon operations',
      confidence: 'medium',
      description: 'x',
    }]))
    const opp = result.opportunities.find(o => o.title === 'Integrating new-energy assets with legacy oil-to-chemicals systems')
    expect(opp?.source).toBe('llm_inferred')
    expect(opp?.relevance).toBe('Low')
  })

  it('drops an inferred opportunity with no real inferred_from stated', () => {
    const result = normalizeAnalysisResult(baseRaw([{
      title: 'Vague AI thing',
      service_line: 'AI-powered business applications',
      claim_type: 'inferred',
      evidence: '',
      inferred_from: 'general',
      confidence: 'low',
      description: 'x',
    }]))
    expect(result.opportunities.find(o => o.title === 'Vague AI thing')).toBeUndefined()
  })

  it('drops an observed opportunity with a fabricated quote (does not fall back to inferred)', () => {
    const result = normalizeAnalysisResult(baseRaw([{
      title: 'Fabricated opportunity',
      service_line: 'AI-powered business applications',
      claim_type: 'observed',
      evidence: 'The company recently announced a major new partnership with a global cloud computing provider',
      confidence: 'high',
      description: 'x',
    }]))
    expect(result.opportunities.find(o => o.title === 'Fabricated opportunity')).toBeUndefined()
  })

  it('drops an opportunity whose service_line is not one of the 8 confirmed services', () => {
    const result = normalizeAnalysisResult(baseRaw([{
      title: 'Invented 9th service',
      service_line: 'Blockchain consulting',
      claim_type: 'inferred',
      evidence: '',
      inferred_from: 'a genuinely substantive stated reasoning basis here',
      confidence: 'medium',
      description: 'x',
    }]))
    expect(result.opportunities.find(o => o.title === 'Invented 9th service')).toBeUndefined()
  })

  it('surfaces nothing via Path B when evidence is genuinely insufficient', () => {
    const result = normalizeAnalysisResult({
      company_name: 'Test Co',
      _extractor: { companySubjectCount: 0, signals: [], leadershipContacts: [], websitePreview: '' },
      ai_opportunities: [{
        title: 'Should be suppressed',
        service_line: 'AI-powered business applications',
        claim_type: 'inferred',
        evidence: '',
        inferred_from: 'a genuinely substantive stated reasoning basis here',
        confidence: 'medium',
        description: 'x',
      }],
    })
    expect(result.opportunities).toHaveLength(0)
  })
})
