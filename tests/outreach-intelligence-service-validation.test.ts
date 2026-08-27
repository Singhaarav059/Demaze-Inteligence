// ============================================================
// outreach_intelligence.recommended_service / why_demaze.reasons[].recommended_service
// — confirmed-service validation (2026-08-27 fix)
// ============================================================
// Unlike opportunities[].service_line (whitelist-checked against
// CONFIRMED_SERVICE_NAMES so it can never invent a 9th service — see
// opportunity-engine.ts's own header), these two free-narrative LLM fields
// passed straight through with no check at all. Confirmed live: AITG's
// outreach_intelligence.recommended_service came back "AI-powered quality
// control and defect detection", which isn't one of Demaze's real 8
// services.
// ============================================================

import { describe, it, expect } from 'vitest'
import { normalizeAnalysisResult } from '../lib/pipeline/normalize'

function baseRaw(overrides: Record<string, unknown> = {}) {
  return {
    company_name: 'Test Co',
    _extractor: {
      companySubjectCount: 3,
      signals: [{ signal: 'growth' }],
      leadershipContacts: [],
      websitePreview: 'x',
    },
    ...overrides,
  }
}

describe('normalizeAnalysisResult — outreach_intelligence.recommended_service validation', () => {
  it('keeps recommended_service when it is one of the 8 confirmed Demaze services', () => {
    const result = normalizeAnalysisResult(baseRaw({
      outreach_intelligence: { recommended_service: 'AI integrations and intelligent automation' },
    }))
    expect(result.outreach_intelligence.recommended_service).toBe('AI integrations and intelligent automation')
  })

  it('falls back to the top opportunity\'s own (already-validated) service when the LLM invents a 9th service', () => {
    const evidenceQuote = 'operating heavy forging equipment across multiple sites'
    const result = normalizeAnalysisResult(baseRaw({
      _extractor: {
        companySubjectCount: 3,
        signals: [{ signal: 'growth' }],
        leadershipContacts: [],
        websitePreview: evidenceQuote,
      },
      ai_opportunities: [{
        title: 'Predictive Maintenance for Forging Presses',
        service_line: 'Internal operational software',
        claim_type: 'observed',
        evidence: evidenceQuote,
        description: 'x',
      }],
      outreach_intelligence: { recommended_service: 'AI-powered quality control and defect detection' },
    }))
    expect(result.opportunities.length).toBeGreaterThan(0) // sanity: the opportunity really did survive verification
    expect(result.outreach_intelligence.recommended_service).toBe(result.opportunities[0]?.title)
    expect(result.outreach_intelligence.recommended_service).not.toBe('AI-powered quality control and defect detection')
  })

  it('falls back to an empty string (never an invented service) when there is no real opportunity to borrow from either', () => {
    const result = normalizeAnalysisResult(baseRaw({
      outreach_intelligence: { recommended_service: 'AI-powered quality control and defect detection' },
    }))
    expect(result.outreach_intelligence.recommended_service).toBe('')
  })
})

describe('normalizeAnalysisResult — why_demaze.reasons[].recommended_service validation', () => {
  it('keeps recommended_service when it is one of the 8 confirmed Demaze services', () => {
    const result = normalizeAnalysisResult(baseRaw({
      why_demaze: {
        reasons: [{ signal: 'x', evidence: 'x', business_implication: 'x', recommended_service: 'Workflow automation systems' }],
      },
    }))
    const reason = result.why_demaze.reasons?.[0]
    expect(typeof reason === 'object' && reason?.recommended_service).toBe('Workflow automation systems')
  })

  it('drops an invented service name to an empty string rather than passing it through', () => {
    const result = normalizeAnalysisResult(baseRaw({
      why_demaze: {
        reasons: [{ signal: 'x', evidence: 'x', business_implication: 'x', recommended_service: 'Blockchain consulting' }],
      },
    }))
    const reason = result.why_demaze.reasons?.[0]
    expect(typeof reason === 'object' && reason?.recommended_service).toBe('')
  })
})
