// ============================================================
// Run Diff — change detection between two runs (Phase 3, Epitaxy vNext audit)
// ============================================================
// Pure diffRuns() over analysis-sections.ts's already-normalized
// data.signals/data.deterministic_opportunities shapes — no I/O, no
// Supabase, matching this repo's existing pure-function test precedent
// (scraper-locale.test.ts, run-diff.ts's own header comment).
// ============================================================

import { describe, it, expect } from 'vitest'
import { diffRuns } from '../lib/pipeline/run-diff'

function resultWith(signalTypes: string[], opportunities: Array<{ id: string; title: string }>) {
  return {
    signals: signalTypes.map(type => ({ type })),
    deterministic_opportunities: opportunities.map(o => ({ ...o, service: o.title, category: 'x', strategic_challenge: '', relevance: '', priority: 0, entry_point: '' })),
  }
}

describe('diffRuns', () => {
  it('classifies a signal present in both runs as unchanged', () => {
    const previous = resultWith(['hiring_surge'], [])
    const current = resultWith(['hiring_surge'], [])
    const diff = diffRuns(previous, current)
    expect(diff.unchangedSignals).toEqual(['hiring_surge'])
    expect(diff.newSignals).toEqual([])
    expect(diff.removedSignals).toEqual([])
  })

  it('classifies a signal only in the current run as new', () => {
    const previous = resultWith([], [])
    const current = resultWith(['funding_round'], [])
    const diff = diffRuns(previous, current)
    expect(diff.newSignals).toEqual(['funding_round'])
  })

  it('classifies a signal only in the previous run as removed', () => {
    const previous = resultWith(['layoffs_restructuring'], [])
    const current = resultWith([], [])
    const diff = diffRuns(previous, current)
    expect(diff.removedSignals).toEqual(['layoffs_restructuring'])
  })

  it('diffs opportunities by id (the confirmed-service catalog slug), not by title text', () => {
    const previous = resultWith([], [{ id: 'workflow-automation', title: 'Workflow Automation' }])
    const current = resultWith([], [
      { id: 'workflow-automation', title: 'Workflow Automation' },
      { id: 'ai-chatbot', title: 'AI Chatbot Development' },
    ])
    const diff = diffRuns(previous, current)
    expect(diff.newOpportunities).toEqual([{ id: 'ai-chatbot', title: 'AI Chatbot Development' }])
    expect(diff.unchangedOpportunities).toEqual([{ id: 'workflow-automation', title: 'Workflow Automation' }])
    expect(diff.removedOpportunities).toEqual([])
  })

  it('returns all-empty when both runs have identical signals and opportunities', () => {
    const result = resultWith(['hiring_surge'], [{ id: 'workflow-automation', title: 'Workflow Automation' }])
    const diff = diffRuns(result, result)
    expect(diff.newSignals).toEqual([])
    expect(diff.removedSignals).toEqual([])
    expect(diff.newOpportunities).toEqual([])
    expect(diff.removedOpportunities).toEqual([])
  })

  it('handles a previous run with no signals/opportunities fields at all', () => {
    const diff = diffRuns({}, resultWith(['hiring_surge'], []))
    expect(diff.newSignals).toEqual(['hiring_surge'])
  })
})
