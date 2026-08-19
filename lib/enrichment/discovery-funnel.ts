// ============================================================
// Discovery funnel counters — measured, never assumed
// ============================================================
// Plain accumulator object, not AsyncLocalStorage (contrast with
// lib/pipeline/research-metrics.ts) — a discovery run is one flat
// sequential loop inside a single route handler, so there's no nested-
// async-context propagation problem to solve here, just a counter object
// threaded through the loop and returned in the response.
//
// No hardcoded conversion-rate assumption anywhere in this codebase —
// this module exists specifically so the real discovered -> qualified ->
// researched -> lead numbers can be read off after real runs instead of
// guessed at (15%/25%/50%/80% were all explicitly rejected as
// assumptions in the governing request).
// ============================================================

import type { RejectionReason } from '../companies/identity'

export interface DiscoveryFunnel {
  discovered: number
  duplicate: number
  alreadyResearched: number
  alreadyOutreached: number
  wrongSector: number
  outsideSize: number
  otherRejected: number
  qualified: number
}

export function emptyFunnel(): DiscoveryFunnel {
  return {
    discovered: 0, duplicate: 0, alreadyResearched: 0, alreadyOutreached: 0,
    wrongSector: 0, outsideSize: 0, otherRejected: 0, qualified: 0,
  }
}

const REASON_TO_FUNNEL_FIELD: Record<RejectionReason, keyof DiscoveryFunnel | null> = {
  duplicate: 'duplicate',
  already_researched: 'alreadyResearched',
  already_outreached: 'alreadyOutreached',
  wrong_sector: 'wrongSector',
  outside_size_range: 'outsideSize',
  insufficient_evidence: 'otherRejected',
  poor_icp_fit: 'otherRejected',
  inactive_company: 'otherRejected',
  other: 'otherRejected',
}

// Every rejection increments exactly one counter — never silently dropped.
export function recordRejection(funnel: DiscoveryFunnel, reason: RejectionReason): void {
  const field = REASON_TO_FUNNEL_FIELD[reason] ?? 'otherRejected'
  funnel[field] += 1
}

export function recordDiscovered(funnel: DiscoveryFunnel, count = 1): void {
  funnel.discovered += count
}

export function recordQualified(funnel: DiscoveryFunnel, count = 1): void {
  funnel.qualified += count
}

export function mergeFunnels(a: DiscoveryFunnel, b: DiscoveryFunnel): DiscoveryFunnel {
  const out = emptyFunnel()
  for (const key of Object.keys(out) as (keyof DiscoveryFunnel)[]) {
    out[key] = a[key] + b[key]
  }
  return out
}
