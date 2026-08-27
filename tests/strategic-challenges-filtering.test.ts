// ============================================================
// Strategic Challenges — evidence-filtered, not a static template
// ============================================================
// Covers the 2026-08-27 fix: modelProfile.strategic_challenges
// (business-model-classifier.ts) used to pass straight through
// unfiltered — every company sharing a business_model_type got the exact
// same challenge list, word for word, regardless of detected_factors. Live-
// confirmed on Bharat Forge/Ador Welding/ATE Group (three unrelated real
// businesses, byte-identical output). Now filters to challenges whose
// signal_triggers actually intersect the company's own detected_factors,
// ranked by match count, falling back to the full static list only when
// nothing matched at all (an honest "typical for this business model"
// baseline, not a fabricated company-specific claim).
// ============================================================

import { describe, it, expect } from 'vitest'
import { normalizeAnalysisResult } from '../lib/pipeline/normalize'

function baseRaw(industry: string, detected_factors: Record<string, boolean>) {
  return {
    company_name: 'Test Co',
    industry,
    detected_factors,
    _extractor: {
      companySubjectCount: 3,
      signals: [{ signal: 'growth' }],
      leadershipContacts: [],
      websitePreview: 'x',
    },
  }
}

describe('normalizeAnalysisResult — strategic_challenges evidence filtering', () => {
  it('filters Manufacturing challenges to only those matching real detected_factors, ranked by match count', () => {
    const result = normalizeAnalysisResult(baseRaw('Manufacturing', {
      hiring_signal: true,
      capacity_expansion: true,
    }))
    // production_efficiency matches both triggers (count 2) -> ranked first.
    // predictive_maintenance/quality_control/supply_chain_intelligence each
    // match exactly one -> included, order preserved among ties.
    // plant_visibility/cross_plant_coordination/industrial_ai_scaling match
    // zero triggers -> excluded entirely, not padded back in.
    expect(result.strategic_challenges.map(c => c.id)).toEqual([
      'production_efficiency',
      'predictive_maintenance',
      'quality_control',
      'supply_chain_intelligence',
    ])
  })

  it('falls back to the full static list when nothing matched at all (honest baseline, not an empty section)', () => {
    const result = normalizeAnalysisResult(baseRaw('Manufacturing', {}))
    expect(result.strategic_challenges).toHaveLength(7)
    expect(result.strategic_challenges.map(c => c.id)).toContain('plant_visibility')
  })

  it('two genuinely different companies of the same business model type get different challenge lists when their evidence differs', () => {
    const capacityHeavy = normalizeAnalysisResult(baseRaw('Manufacturing', { capacity_expansion: true }))
    const hiringHeavy = normalizeAnalysisResult(baseRaw('Manufacturing', { multi_location_operations: true }))
    expect(capacityHeavy.strategic_challenges.map(c => c.id)).not.toEqual(hiringHeavy.strategic_challenges.map(c => c.id))
    // Regression for the exact live bug: multi_location_operations-only
    // evidence should surface cross_plant_coordination, which the
    // capacity-only case must NOT include.
    expect(hiringHeavy.strategic_challenges.map(c => c.id)).toContain('cross_plant_coordination')
    expect(capacityHeavy.strategic_challenges.map(c => c.id)).not.toContain('cross_plant_coordination')
  })

  it('never surfaces a challenge belonging to a different business model type', () => {
    const result = normalizeAnalysisResult(baseRaw('Manufacturing', { hiring_signal: true, ai_mention: true }))
    // customer_support_scale is a Software/SaaS-only challenge (business-
    // model-classifier.ts) — filtering must never cross that boundary even
    // though its own trigger vocabulary could technically overlap.
    expect(result.strategic_challenges.map(c => c.id)).not.toContain('customer_support_scale')
  })
})
