// ============================================================
// Pain-Points Validation Gate — shouldWarnEmptyPainPoints()
// ============================================================
// Covers the pure gate-logic rule route.ts's new PAIN_POINTS gate uses (see
// CLAUDE.md "Outbound Workflow Modules" session notes / the task that added
// this gate): pain_points had no validation gate at all before this — the
// prompt instructs the LLM to always generate 3-5 pain points and never
// return [], but nothing detected a violation. The rule must only warn when
// there WAS usable evidence (evidence_sufficiency === 'sufficient') but
// pain_points still came back empty — an empty array on a genuinely-thin-
// evidence company (evidence_sufficiency === 'insufficient') is arguably
// correct and must NOT warn, same discipline deterministic_opportunities
// already follows via the insufficientEvidence flag in normalize.ts.
// Purely a pure function, no network/LLM — full unit-test surface.

import { describe, it, expect } from 'vitest'
import { shouldWarnEmptyPainPoints } from '../lib/pipeline/normalize'

describe('shouldWarnEmptyPainPoints', () => {
  it('warns when pain_points is empty AND evidence_sufficiency is sufficient', () => {
    expect(shouldWarnEmptyPainPoints(0, 'sufficient')).toBe(true)
  })

  it('does NOT warn when pain_points is empty AND evidence_sufficiency is insufficient (genuinely thin data)', () => {
    expect(shouldWarnEmptyPainPoints(0, 'insufficient')).toBe(false)
  })

  it('does NOT warn when pain_points is non-empty, regardless of evidence_sufficiency', () => {
    expect(shouldWarnEmptyPainPoints(3, 'sufficient')).toBe(false)
    expect(shouldWarnEmptyPainPoints(1, 'insufficient')).toBe(false)
  })

  it('treats any positive count as satisfying the gate, not just >=3', () => {
    // The prompt asks for 3-5, but the gate's job is only to catch a total
    // LLM/parsing failure (empty array), not to enforce the prompt's count
    // range — that's a narrower policy decision this gate deliberately
    // doesn't make.
    expect(shouldWarnEmptyPainPoints(1, 'sufficient')).toBe(false)
  })
})
