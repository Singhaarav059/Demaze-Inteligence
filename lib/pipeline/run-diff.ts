// ============================================================
// Run Diff — change detection between two runs of the same company
// ============================================================
// Phase 3 (Epitaxy vNext audit §14): "New research surfaces this since last
// time" without a new table or API route — pipeline_test_runs already
// stores every run's full final_result JSONB keyed by domain, and
// app/admin/run-history/page.tsx already fetches up to 100 recent runs
// client-side, so finding "the previous run for this domain" and diffing
// is pure client-side work over already-fetched data. Reuses
// analysis-sections.ts's existing getters rather than re-reading
// data.signals/data.deterministic_opportunities directly.
//
// Signals are keyed by `type` (a closed SignalType enum, not per-instance
// IDed) — the only stable diff key available. Opportunities are keyed by
// `id`, which is the confirmed-service catalog slug (opportunity-engine.ts
// sets id: content.slug), stable across runs for the same matched service.
// ============================================================

import { getSignals, getDeterministicOpportunities } from './analysis-sections'

export interface OpportunityDiffEntry {
  id: string
  title: string
}

export interface RunDiff {
  newSignals: string[]
  unchangedSignals: string[]
  removedSignals: string[]
  newOpportunities: OpportunityDiffEntry[]
  unchangedOpportunities: OpportunityDiffEntry[]
  removedOpportunities: OpportunityDiffEntry[]
}

function partition<T, K>(
  previous: T[],
  current: T[],
  keyOf: (item: T) => K
): { added: T[]; unchanged: T[]; removed: T[] } {
  const prevKeys = new Set(previous.map(keyOf))
  const currKeys = new Set(current.map(keyOf))
  return {
    added: current.filter(item => !prevKeys.has(keyOf(item))),
    unchanged: current.filter(item => prevKeys.has(keyOf(item))),
    removed: previous.filter(item => !currKeys.has(keyOf(item))),
  }
}

export function diffRuns(
  previousResult: Record<string, unknown>,
  currentResult: Record<string, unknown>
): RunDiff {
  const signalTypes = partition(
    getSignals(previousResult).map(s => String(s.type)),
    getSignals(currentResult).map(s => String(s.type)),
    t => t
  )

  const opportunities = partition(
    getDeterministicOpportunities(previousResult),
    getDeterministicOpportunities(currentResult),
    o => o.id
  )

  return {
    newSignals: signalTypes.added,
    unchangedSignals: signalTypes.unchanged,
    removedSignals: signalTypes.removed,
    newOpportunities: opportunities.added.map(o => ({ id: o.id, title: o.title })),
    unchangedOpportunities: opportunities.unchanged.map(o => ({ id: o.id, title: o.title })),
    removedOpportunities: opportunities.removed.map(o => ({ id: o.id, title: o.title })),
  }
}
