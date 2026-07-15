// ============================================================
// Research Evaluation Framework (Roadmap Phase 2, item 5)
// ============================================================
// Covers evaluateResearch()'s 7 scoring dimensions and aggregateEvaluations().
// Pure/sync — no network, no fs — full unit-test surface, same as
// tests/research-quality.test.ts.

import { describe, it, expect } from 'vitest'
import { evaluateResearch, aggregateEvaluations, type EvaluationInput } from '../benchmarks/research-evaluation'

function stub(overrides: Partial<EvaluationInput> = {}): EvaluationInput {
  return {
    name: 'Test Co',
    success: true,
    validationOverall: 'PASS',
    signals: 5,
    minSignals: 3,
    opportunities: [],
    painPointsStructured: [],
    painPointsTotal: 0,
    evidenceSufficiency: 'insufficient',
    competitorSufficiency: 'insufficient',
    icpSufficiency: 'insufficient',
    researchQuality: { items_audited: 0, items_flagged: 0 },
    checks: [],
    ...overrides,
  }
}

describe('evaluateResearch — pipeline reliability', () => {
  it('scores 0 total when the pipeline did not succeed, not just the reliability dimension', () => {
    const result = evaluateResearch(stub({ success: false, evidenceSufficiency: 'insufficient' }))
    expect(result.score).toBe(0)
    expect(result.dimensions.every(d => d.score === 0)).toBe(true)
  })

  it('gives full credit for a PASS gate, partial for WARN/PARTIAL, none for FAIL', () => {
    expect(evaluateResearch(stub({ validationOverall: 'PASS' })).dimensions[0].score).toBe(20)
    expect(evaluateResearch(stub({ validationOverall: 'WARN' })).dimensions[0].score).toBe(14)
    expect(evaluateResearch(stub({ validationOverall: 'PARTIAL' })).dimensions[0].score).toBe(8)
    expect(evaluateResearch(stub({ validationOverall: 'FAIL' })).dimensions[0].score).toBe(0)
  })
})

describe('evaluateResearch — evidence-backed opportunities', () => {
  it('gives full credit for zero opportunities honestly reported as insufficient evidence', () => {
    const result = evaluateResearch(stub({ opportunities: [], evidenceSufficiency: 'insufficient' }))
    const d = result.dimensions.find(d => d.name === 'Evidence-backed opportunities')!
    expect(d.score).toBe(20)
  })

  it('gives half credit for zero opportunities despite sufficient evidence', () => {
    const result = evaluateResearch(stub({ opportunities: [], evidenceSufficiency: 'sufficient' }))
    const d = result.dimensions.find(d => d.name === 'Evidence-backed opportunities')!
    expect(d.score).toBe(10)
  })

  it('scores by ratio of opportunities carrying an evidence_id', () => {
    const result = evaluateResearch(stub({
      opportunities: [{ evidence_id: 'ev1' }, { evidence_id: 'ev2' }, {}, {}],
    }))
    const d = result.dimensions.find(d => d.name === 'Evidence-backed opportunities')!
    expect(d.score).toBe(10) // 2/4 * 20
  })
})

describe('evaluateResearch — evidence sufficiency & signal depth', () => {
  it('awards half for sufficient evidence, half scaled by signal ratio', () => {
    const result = evaluateResearch(stub({ evidenceSufficiency: 'sufficient', signals: 3, minSignals: 3 }))
    const d = result.dimensions.find(d => d.name === 'Evidence sufficiency & signal depth')!
    expect(d.score).toBe(15) // 7.5 + 7.5
  })

  it('caps signal ratio at 1 even when signals exceed minSignals', () => {
    const result = evaluateResearch(stub({ evidenceSufficiency: 'insufficient', signals: 100, minSignals: 3 }))
    const d = result.dimensions.find(d => d.name === 'Evidence sufficiency & signal depth')!
    expect(d.score).toBe(7.5) // 0 + 7.5
  })
})

describe('evaluateResearch — pain-point quality', () => {
  it('gives full credit for zero pain points honestly reported as insufficient evidence', () => {
    const result = evaluateResearch(stub({ painPointsTotal: 0, evidenceSufficiency: 'insufficient' }))
    const d = result.dimensions.find(d => d.name === 'Pain-point quality')!
    expect(d.score).toBe(10)
  })

  it('excludes low-confidence pain points from the evidence-backed ratio', () => {
    const result = evaluateResearch(stub({
      painPointsTotal: 2,
      painPointsStructured: [
        { evidence_id: 'ev1', confidence: 'high' },
        { evidence_id: 'ev2', confidence: 'low' },
      ],
    }))
    const d = result.dimensions.find(d => d.name === 'Pain-point quality')!
    expect(d.score).toBe(5) // 1/2 * 10
  })
})

describe('evaluateResearch — competitor / ICP discovery yield', () => {
  it('awards 5 pts each for sufficient competitor and ICP discovery', () => {
    const result = evaluateResearch(stub({ competitorSufficiency: 'sufficient', icpSufficiency: 'sufficient' }))
    const d = result.dimensions.find(d => d.name === 'Competitor / ICP discovery yield')!
    expect(d.score).toBe(10)
  })

  it('awards 0 when both are insufficient or unset', () => {
    const result = evaluateResearch(stub({ competitorSufficiency: 'insufficient', icpSufficiency: undefined }))
    const d = result.dimensions.find(d => d.name === 'Competitor / ICP discovery yield')!
    expect(d.score).toBe(0)
  })
})

describe('evaluateResearch — research quality flag ratio', () => {
  it('gives full credit when nothing was audited', () => {
    const result = evaluateResearch(stub({ researchQuality: { items_audited: 0, items_flagged: 0 } }))
    const d = result.dimensions.find(d => d.name === 'Research quality flag ratio')!
    expect(d.score).toBe(15)
  })

  it('scores inversely proportional to the flagged ratio', () => {
    const result = evaluateResearch(stub({ researchQuality: { items_audited: 10, items_flagged: 4 } }))
    const d = result.dimensions.find(d => d.name === 'Research quality flag ratio')!
    expect(d.score).toBe(9) // (1 - 0.4) * 15
  })
})

describe('evaluateResearch — narrative safety', () => {
  it('scores 0 when a forbidden term was found', () => {
    const result = evaluateResearch(stub({
      checks: [{ check: 'no_forbidden:"pipeline"', status: 'FAIL', actual: 'found' }],
    }))
    const d = result.dimensions.find(d => d.name === 'Narrative safety')!
    expect(d.score).toBe(0)
  })

  it('scores full when no forbidden-term check failed', () => {
    const result = evaluateResearch(stub({
      checks: [{ check: 'no_forbidden:"pipeline"', status: 'PASS', actual: 'absent' }],
    }))
    const d = result.dimensions.find(d => d.name === 'Narrative safety')!
    expect(d.score).toBe(10)
  })
})

describe('evaluateResearch — overall score', () => {
  it('sums all 7 dimensions to a max of 100 for a clean run', () => {
    const result = evaluateResearch(stub({
      validationOverall: 'PASS',
      opportunities: [{ evidence_id: 'ev1' }],
      evidenceSufficiency: 'sufficient',
      signals: 5,
      minSignals: 3,
      painPointsTotal: 1,
      painPointsStructured: [{ evidence_id: 'ev1', confidence: 'high' }],
      competitorSufficiency: 'sufficient',
      icpSufficiency: 'sufficient',
      researchQuality: { items_audited: 0, items_flagged: 0 },
      checks: [],
    }))
    expect(result.score).toBe(100)
    expect(result.dimensions).toHaveLength(7)
  })
})

describe('aggregateEvaluations', () => {
  it('computes mean/min/max across company scores', () => {
    const scores = [
      evaluateResearch(stub({ name: 'A', validationOverall: 'PASS' })),
      evaluateResearch(stub({ name: 'B', validationOverall: 'FAIL', success: false })),
    ]
    const agg = aggregateEvaluations(scores)
    expect(agg.companyScores).toEqual([{ name: 'A', score: scores[0].score }, { name: 'B', score: 0 }])
    expect(agg.maxScore).toBe(scores[0].score)
    expect(agg.minScore).toBe(0)
    expect(agg.meanScore).toBe(Math.round((scores[0].score / 2) * 100) / 100)
  })

  it('returns zeroed aggregate for an empty score list', () => {
    const agg = aggregateEvaluations([])
    expect(agg.meanScore).toBe(0)
    expect(agg.minScore).toBe(0)
    expect(agg.maxScore).toBe(0)
    expect(agg.companyScores).toEqual([])
  })
})
