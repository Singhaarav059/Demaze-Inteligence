// ============================================================
// Outreach draft grounding check (lib/pipeline/normalize.ts)
// ============================================================
// Covers safety net 2 added 2026-07-17: even when matched_proof_point_id
// echoes a real id from _proof_point_candidates, the LLM can still
// fabricate the stat/client text around it (confirmed live — an aerospace/
// defense company run invented "a major turbine producer" and "45%" for its
// outreach draft, neither of which appears anywhere in
// demaze-proof-points.ts). This cross-checks any numeric/stat-shaped token
// in the drafted text against the matched proof point's real outcome values.

import { describe, it, expect } from 'vitest'
import { normalizeAnalysisResult } from '../lib/pipeline/normalize'

const PROOF_POINT_CANDIDATE = {
  id: 'mfg-quality-control',
  title: 'AI Quality Control on Line',
  client: 'Composite: discrete-parts assembly line',
  provenance: 'composite_illustrative',
  industry_tags: ['manufacturing'],
  outcomes: [
    { metric: 'Defect detection accuracy on golden set', value: '99.2%' },
    { metric: 'Defect rework cost per 1,000 units', value: '-54%' },
    { metric: 'Inspection throughput vs. manual QC', value: '4x' },
  ],
}

function baseRaw(outreach_draft: Record<string, unknown>) {
  return {
    company_name: 'Test Co',
    _proof_point_candidates: [PROOF_POINT_CANDIDATE],
    outreach_draft,
  }
}

describe('normalizeAnalysisResult — outreach_draft grounding safety net', () => {
  it('clears matched_proof_point_id when the draft cites a stat absent from the real outcomes (the live "45%" bug)', () => {
    const result = normalizeAnalysisResult(baseRaw({
      matched_proof_point_id: 'mfg-quality-control',
      connection_note: 'Hi, came across Test Co and thought to connect.',
      first_message: 'We recently helped a major turbine producer cut assembly rework by 45% using AI vision.',
      follow_up: 'Can we connect for a quick call?',
    }))
    expect(result.outreach_draft.matched_proof_point_id).toBe('')
    expect(result.validation_warnings.some(w => w.includes('likely fabricated'))).toBe(true)
  })

  it('keeps matched_proof_point_id when the draft cites a real outcome value', () => {
    const result = normalizeAnalysisResult(baseRaw({
      matched_proof_point_id: 'mfg-quality-control',
      connection_note: 'Hi, came across Test Co and thought to connect.',
      first_message: 'We recently helped a discrete-parts assembly line cut rework cost by 54% using AI vision.',
      follow_up: 'Can we connect for a quick call?',
    }))
    expect(result.outreach_draft.matched_proof_point_id).toBe('mfg-quality-control')
    expect(result.validation_warnings.some(w => w.includes('likely fabricated'))).toBe(false)
  })

  it('keeps matched_proof_point_id when the draft cites no numeric stat at all', () => {
    const result = normalizeAnalysisResult(baseRaw({
      matched_proof_point_id: 'mfg-quality-control',
      connection_note: 'Hi, came across Test Co and thought to connect.',
      first_message: 'We recently helped a discrete-parts assembly line improve quality control with AI vision.',
      follow_up: 'Can we connect for a quick call?',
    }))
    expect(result.outreach_draft.matched_proof_point_id).toBe('mfg-quality-control')
    expect(result.validation_warnings.some(w => w.includes('likely fabricated'))).toBe(false)
  })

  it('does not clear the id for a sign-flipped or reformatted real stat (e.g. "+54%" vs "-54%")', () => {
    const result = normalizeAnalysisResult(baseRaw({
      matched_proof_point_id: 'mfg-quality-control',
      connection_note: 'Hi, came across Test Co and thought to connect.',
      first_message: 'We recently helped a discrete-parts assembly line improve rework cost by +54%.',
      follow_up: 'Can we connect for a quick call?',
    }))
    expect(result.outreach_draft.matched_proof_point_id).toBe('mfg-quality-control')
  })

  it('leaves matched_proof_point_id empty (via safety net 1) when the LLM echoes an id not in the candidate list, before safety net 2 even runs', () => {
    const result = normalizeAnalysisResult(baseRaw({
      matched_proof_point_id: 'invented-id-not-real',
      connection_note: 'Hi, came across Test Co.',
      first_message: 'We helped someone cut costs by 99% using AI.',
      follow_up: 'Can we connect?',
    }))
    expect(result.outreach_draft.matched_proof_point_id).toBe('')
  })
})
