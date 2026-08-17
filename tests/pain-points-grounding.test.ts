// ============================================================
// Pain points — structured schema + quote-grounding (normalize.ts)
// ============================================================
// Covers Session 3 of the 2026-07-22 research-quality initiative (see
// CLAUDE.md): pain_points used to be a pure ungated passthrough of the LLM's
// flat-string output ("ALWAYS 3-5, NEVER []"). It's now structured
// (title/claim_type/evidence/confidence/reasoning), and 'observed' claims
// must quote-verify against the same content pool the LLM was shown
// (_extractor.websitePreview) or they're dropped; 'inferred' claims are kept
// without needing a quote; genuinely insufficient evidence forces [].

import { describe, it, expect } from 'vitest'
import { normalizeAnalysisResult } from '../lib/pipeline/normalize'

const REAL_CONTENT = 'Our team currently relies on SAP MM for inventory management across all plants, though the regional dealer network still coordinates orders manually via phone and email each week.'

function baseRaw(pain_points: unknown, extractorOverrides: Record<string, unknown> = {}) {
  return {
    company_name: 'Test Co',
    _extractor: {
      companySubjectCount: 3,
      signals: [{ signal: 'growth' }],
      leadershipContacts: [],
      websitePreview: REAL_CONTENT,
      ...extractorOverrides,
    },
    pain_points,
  }
}

describe('normalizeAnalysisResult — pain_points structured grounding', () => {
  it('keeps an observed pain point whose evidence quote is real', () => {
    const result = normalizeAnalysisResult(baseRaw([
      {
        title: 'Manual coordination with the regional dealer network',
        claim_type: 'observed',
        evidence: 'the regional dealer network still coordinates orders manually via phone and email each week',
        confidence: 'high',
        reasoning: 'Manual coordination at scale is error-prone and slow.',
      },
    ]))
    expect(result.pain_points).toEqual(['Manual coordination with the regional dealer network'])
    expect(result.pain_points_structured).toHaveLength(1)
    expect(result.pain_points_structured[0].claim_type).toBe('observed')
  })

  it('assigns a real evidence_id to a quote-verified observed pain point even when the LLM supplied none (Phase 4, Production Hardening Plan)', () => {
    // Regression for a real, benchmark-confirmed bug: evidence_id used to
    // come straight from the LLM's own field, which was almost always empty
    // — benchmarks/research-evaluation.ts's "Pain-point quality" check
    // filters on `!!p.evidence_id`, so a genuinely quote-verified pain point
    // was still scoring as non-evidence-backed.
    const result = normalizeAnalysisResult(baseRaw([
      {
        title: 'Manual coordination with the regional dealer network',
        claim_type: 'observed',
        evidence: 'the regional dealer network still coordinates orders manually via phone and email each week',
        confidence: 'high',
        reasoning: 'x',
        // evidence_id deliberately omitted — this is the real-world shape.
      },
    ]))
    expect(result.pain_points_structured[0].evidence_id).toBeTruthy()
  })

  it('does NOT manufacture an evidence_id for an inferred pain point (no verified quote exists)', () => {
    const result = normalizeAnalysisResult(baseRaw([
      {
        title: 'Likely lacks unified cross-plant reporting',
        claim_type: 'inferred',
        evidence: 'Multi-plant operations typically face this without a dedicated system',
        confidence: 'medium',
        reasoning: 'x',
      },
    ]))
    expect(result.pain_points_structured[0].evidence_id).toBeFalsy()
  })

  it('drops an observed pain point whose evidence quote is fabricated, and logs a warning', () => {
    const result = normalizeAnalysisResult(baseRaw([
      {
        title: 'Real one',
        claim_type: 'observed',
        evidence: 'the regional dealer network still coordinates orders manually via phone and email each week',
        confidence: 'high',
        reasoning: 'x',
      },
      {
        title: 'Fabricated one',
        claim_type: 'observed',
        evidence: 'The company recently announced a major new partnership with a global cloud computing provider',
        confidence: 'high',
        reasoning: 'x',
      },
    ]))
    expect(result.pain_points).toEqual(['Real one'])
    expect(result.validation_warnings.some(w => w.includes('pain_points: dropped 1 item'))).toBe(true)
  })

  it('keeps an inferred pain point without requiring a quote', () => {
    const result = normalizeAnalysisResult(baseRaw([
      {
        title: 'Likely lacks unified cross-plant reporting',
        claim_type: 'inferred',
        evidence: 'Multi-plant operations typically face this without a dedicated system',
        confidence: 'medium',
        reasoning: 'Common pattern for multi-facility manufacturers.',
      },
    ]))
    expect(result.pain_points).toEqual(['Likely lacks unified cross-plant reporting'])
    expect(result.pain_points_structured[0].claim_type).toBe('inferred')
  })

  it('forces pain_points to [] when evidence is genuinely insufficient, even if the LLM returned items', () => {
    const result = normalizeAnalysisResult(baseRaw(
      [{ title: 'Should be suppressed', claim_type: 'inferred', evidence: 'x', confidence: 'low', reasoning: 'x' }],
      { companySubjectCount: 0, signals: [], leadershipContacts: [] },
    ))
    expect(result.pain_points).toEqual([])
    expect(result.evidence_sufficiency).toBe('insufficient')
  })

  it('still accepts the old flat-string shape for backward compatibility', () => {
    const result = normalizeAnalysisResult(baseRaw(['A plain string pain point (observed)']))
    expect(result.pain_points).toEqual(['A plain string pain point (observed)'])
  })
})
