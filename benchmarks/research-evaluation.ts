// ============================================================
// Research Evaluation Framework (Roadmap Phase 2, item 5)
// ============================================================
// A separate, OFFLINE, benchmark-harness-only 0-100 aggregator — NOT part of
// the live pipeline, NOT a new scoring engine wired into normalize.ts. See
// docs/DECISIONS.md ("Research Quality Framework — item 4 vs item 5
// boundary") and docs/CURRENT_TASK.md for the boundary this respects: item 4
// (lib/pipeline/research-quality.ts) runs live, per-run, for a human
// reviewer; item 5 (this file) runs here, across many runs, to compare
// pipeline versions over time. It consumes item 4's items_flagged/
// items_audited ratio as one input signal (dimension 6 below) rather than
// recomputing anything item 4 already computes.
//
// Pure, sync, zero I/O — reads only the fields already present in a
// benchmark run's API response (the full NormalizedAnalysis under
// analysisResult) plus the CheckResult[] benchmark-runner.ts already
// computed. No new LLM calls, no new vendor calls, no gating of any pipeline
// stage — a low score here never suppresses or downgrades a report, same
// "informational only" discipline as evidence_sufficiency and item 4.
//
// Rubric (7 dimensions, weights sum to 100): each dimension operationalizes
// a documented quality goal from CLAUDE.md rather than an arbitrary metric —
// see the comment above each scorer for which rule it encodes.
// ============================================================

import type {
  CheckResult,
  EvaluationDimensionResult,
  ResearchEvaluationScore,
  AggregateEvaluation,
} from './benchmark-types'

// ── Input contract ──────────────────────────────────────────────
// Deliberately narrow — only the fields this file's scorers actually read,
// same "minimal stub" discipline as tests/research-quality.test.ts, rather
// than importing the full NormalizedAnalysis type into a benchmark-only
// module.

export interface EvaluationOpportunity {
  evidence_id?: string
  confidence?: string
  opportunity_confidence?: string
  relevance?: string
}

export interface EvaluationPainPoint {
  evidence_id?: string
  confidence?: string
}

export interface EvaluationInput {
  name: string
  success: boolean
  validationOverall: string
  signals: number
  minSignals: number
  opportunities: EvaluationOpportunity[]
  painPointsStructured: EvaluationPainPoint[]
  painPointsTotal: number
  evidenceSufficiency?: 'sufficient' | 'insufficient'
  competitorSufficiency?: 'sufficient' | 'insufficient'
  icpSufficiency?: 'sufficient' | 'insufficient'
  researchQuality?: { items_audited: number; items_flagged: number }
  checks: CheckResult[]
}

function dim(name: string, score: number, max: number, note?: string): EvaluationDimensionResult {
  return { name, score: Math.round(score * 100) / 100, max, note }
}

// ── Dimension 1 (20 pts): Pipeline reliability ──────────────────
// CLAUDE.md "The actual goal": no hard crashes, no hard FAILs, graceful
// degradation. A failed run scores 0 outright (nothing else is trustworthy);
// otherwise scored by the validation gate's own PASS/WARN/PARTIAL/FAIL tier.
function scoreReliability(input: EvaluationInput): EvaluationDimensionResult {
  const MAX = 20
  if (!input.success) return dim('Pipeline reliability', 0, MAX, 'pipeline did not succeed')
  const tier: Record<string, number> = { PASS: 20, WARN: 14, PARTIAL: 8, FAIL: 0 }
  const score = tier[input.validationOverall] ?? 0
  return dim('Pipeline reliability', score, MAX, `validation gate: ${input.validationOverall}`)
}

// ── Dimension 2 (20 pts): Evidence-backed opportunities ─────────
// CLAUDE.md "Target pattern": evidence -> problem -> capability, not
// invented titles. Ratio of opportunities carrying a real evidence_id.
// Zero opportunities is not automatically bad — CLAUDE.md's "9th outcome"
// (insufficient evidence) says a company with genuinely thin evidence
// should show nothing, not a forced fit; that case scores full credit here,
// while zero opportunities despite 'sufficient' evidence is a real gap.
function scoreEvidenceBackedOpportunities(input: EvaluationInput): EvaluationDimensionResult {
  const MAX = 20
  const total = input.opportunities.length
  if (total === 0) {
    if (input.evidenceSufficiency === 'insufficient') {
      return dim('Evidence-backed opportunities', MAX, MAX, 'no opportunities, honestly reported as insufficient evidence')
    }
    return dim('Evidence-backed opportunities', MAX / 2, MAX, 'no opportunities despite sufficient evidence')
  }
  const withEvidence = input.opportunities.filter(o => !!o.evidence_id).length
  const ratio = withEvidence / total
  return dim('Evidence-backed opportunities', ratio * MAX, MAX, `${withEvidence}/${total} opportunities carry an evidence_id`)
}

// ── Dimension 3 (15 pts): Evidence sufficiency + signal depth ───
// Half for evidence_sufficiency === 'sufficient', half for signal count
// clearing the benchmark spec's own minSignals threshold.
function scoreEvidenceAndSignals(input: EvaluationInput): EvaluationDimensionResult {
  const MAX = 15
  const sufficiencyPts = input.evidenceSufficiency === 'sufficient' ? MAX / 2 : 0
  const signalRatio = input.minSignals > 0
    ? Math.min(1, input.signals / input.minSignals)
    : (input.signals > 0 ? 1 : 0)
  const signalPts = signalRatio * (MAX / 2)
  return dim(
    'Evidence sufficiency & signal depth',
    sufficiencyPts + signalPts,
    MAX,
    `evidence_sufficiency=${input.evidenceSufficiency ?? 'unknown'}, signals=${input.signals}/${input.minSignals}`,
  )
}

// ── Dimension 4 (10 pts): Structured pain-point quality ─────────
// Rewards pain points that trace to real evidence over bare narrative
// strings — same "evidence, not vibes" discipline as opportunities.
function scorePainPointQuality(input: EvaluationInput): EvaluationDimensionResult {
  const MAX = 10
  if (input.painPointsTotal === 0) {
    if (input.evidenceSufficiency === 'insufficient') {
      return dim('Pain-point quality', MAX, MAX, 'no pain points, honestly reported as insufficient evidence')
    }
    return dim('Pain-point quality', MAX / 2, MAX, 'no pain points despite sufficient evidence')
  }
  const backed = input.painPointsStructured.filter(p => !!p.evidence_id && p.confidence !== 'low').length
  const ratio = backed / input.painPointsTotal
  return dim('Pain-point quality', ratio * MAX, MAX, `${backed}/${input.painPointsTotal} pain points evidence-backed, non-low-confidence`)
}

// ── Dimension 5 (10 pts): Competitor / ICP discovery yield ──────
// Rewards Phase 2's discovery engines (items 1-2) actually surfacing
// something on a real run, not just being wired with safe empty defaults.
function scoreDiscoveryYield(input: EvaluationInput): EvaluationDimensionResult {
  const MAX = 10
  const competitorPts = input.competitorSufficiency === 'sufficient' ? MAX / 2 : 0
  const icpPts = input.icpSufficiency === 'sufficient' ? MAX / 2 : 0
  return dim(
    'Competitor / ICP discovery yield',
    competitorPts + icpPts,
    MAX,
    `competitor_sufficiency=${input.competitorSufficiency ?? 'unknown'}, icp_sufficiency=${input.icpSufficiency ?? 'unknown'}`,
  )
}

// ── Dimension 6 (15 pts): Research Quality flag ratio ───────────
// Consumes item 4's (research-quality.ts) items_flagged/items_audited ratio
// as an input signal, per the documented item 4 vs item 5 boundary — does
// NOT recompute any of item 4's checks itself.
function scoreResearchQualityRatio(input: EvaluationInput): EvaluationDimensionResult {
  const MAX = 15
  const rq = input.researchQuality
  if (!rq || rq.items_audited === 0) {
    return dim('Research quality flag ratio', MAX, MAX, 'nothing audited (no flaggable items)')
  }
  const ratio = rq.items_flagged / rq.items_audited
  return dim('Research quality flag ratio', (1 - ratio) * MAX, MAX, `${rq.items_flagged}/${rq.items_audited} audited items flagged`)
}

// ── Dimension 7 (10 pts): Narrative safety (no contamination) ───
// Reuses benchmark-runner.ts's existing forbidden-term checks rather than
// re-scanning narrative text — binary, since a single cross-industry
// contamination is a real defect, not a partial-credit situation.
function scoreNarrativeSafety(input: EvaluationInput): EvaluationDimensionResult {
  const MAX = 10
  const contaminated = input.checks.some(c => c.check.startsWith('no_forbidden:') && c.status === 'FAIL' && c.actual === 'found')
  return contaminated
    ? dim('Narrative safety', 0, MAX, 'forbidden term found in LLM narrative')
    : dim('Narrative safety', MAX, MAX)
}

// ── Aggregate ─────────────────────────────────────────────────

export function evaluateResearch(input: EvaluationInput): ResearchEvaluationScore {
  // A pipeline that didn't succeed produced no trustworthy analysisResult —
  // every other dimension would otherwise misread "empty" as "honestly
  // reported nothing" and hand out undeserved credit. Zero the whole score,
  // not just the reliability dimension.
  if (!input.success) {
    const dimensions = [
      scoreReliability(input),
      dim('Evidence-backed opportunities', 0, 20, 'pipeline did not succeed'),
      dim('Evidence sufficiency & signal depth', 0, 15, 'pipeline did not succeed'),
      dim('Pain-point quality', 0, 10, 'pipeline did not succeed'),
      dim('Competitor / ICP discovery yield', 0, 10, 'pipeline did not succeed'),
      dim('Research quality flag ratio', 0, 15, 'pipeline did not succeed'),
      dim('Narrative safety', 0, 10, 'pipeline did not succeed'),
    ]
    return { name: input.name, score: 0, dimensions }
  }

  const dimensions = [
    scoreReliability(input),
    scoreEvidenceBackedOpportunities(input),
    scoreEvidenceAndSignals(input),
    scorePainPointQuality(input),
    scoreDiscoveryYield(input),
    scoreResearchQualityRatio(input),
    scoreNarrativeSafety(input),
  ]
  const score = dimensions.reduce((sum, d) => sum + d.score, 0)
  return { name: input.name, score: Math.round(score * 100) / 100, dimensions }
}

export function aggregateEvaluations(scores: ResearchEvaluationScore[]): AggregateEvaluation {
  const companyScores = scores.map(s => ({ name: s.name, score: s.score }))
  const values = companyScores.map(c => c.score)
  const meanScore = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0
  return {
    runAt: new Date().toISOString(),
    companyScores,
    meanScore: Math.round(meanScore * 100) / 100,
    minScore: values.length > 0 ? Math.min(...values) : 0,
    maxScore: values.length > 0 ? Math.max(...values) : 0,
  }
}
