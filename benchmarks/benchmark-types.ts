// ============================================================
// Demaze Benchmark Framework — Types
// ============================================================

/** What a benchmark expects from the pipeline for a given company. */
export interface BenchmarkExpectations {
  /** Minimum number of deterministic signals extractorResult must produce. */
  minSignals: number
  /** Minimum number of AI opportunities in the normalized analysis. */
  minOpportunities: number
  /** Minimum number of pain_points / challenges in the normalized analysis. */
  minChallenges: number
  /**
   * Keys of companyProfile.company_type that must be true.
   * E.g. ["manufacturer"] or ["software_saas", "industrial_vendor"].
   */
  requiredProfileFlags: string[]
  /**
   * Expected companyProfile.primary_type label. Optional — omit when the
   * correct label is still an open question (e.g. Ace Pipeline, not yet
   * root-caused). Added after the AITG conglomerate-priority bug stayed
   * hidden for a full session because nothing asserted on this field,
   * only on company_type booleans and signal/opportunity counts.
   */
  expectedPrimaryType?: string
  /**
   * Strings that must NOT appear in the LLM-generated narrative fields
   * (company_summary, pain_points, opportunity titles/descriptions, outreach angle).
   * Case-insensitive.
   */
  forbiddenTerms: string[]
}

/** A single benchmark specification — defined in a company JSON file. */
export interface BenchmarkSpec {
  name: string
  url: string
  expectations: BenchmarkExpectations
}

export type CheckStatus = 'PASS' | 'WARN' | 'FAIL'

/** One regex hit recorded by captureFlag() in evidence-extractor. */
export interface ProfileFlagMatch {
  pattern: string
  matched: string
  snippet: string
}

/** Result of a single validation check. */
export interface CheckResult {
  check: string
  status: CheckStatus
  actual?: string | number
  expected?: string | number
  note?: string
}

/** Full result for one benchmark run. */
export interface BenchmarkResult {
  name: string
  url: string
  /** Aggregate status: worst of all check statuses. */
  overall: CheckStatus
  checks: CheckResult[]
  signals: number
  opportunities: number
  challenges: number
  validationOverall: string
  durationMs: number
  error?: string
  /** Evidence captured by captureFlag() -- keyed by flag name. */
  profileEvidence?: Record<string, ProfileFlagMatch[]>
  /** Research Evaluation Framework score (Roadmap Phase 2, item 5). */
  evaluation: ResearchEvaluationScore
}

// ============================================================
// Research Evaluation Framework (Roadmap Phase 2, item 5)
// ============================================================
// A single 0-100 objective score per company run, built from named,
// independently-scored dimensions — for comparing pipeline versions over
// time, not for gating any individual run. See
// benchmarks/research-evaluation.ts for the scoring logic and
// docs/DECISIONS.md for the rubric rationale.

/** One scored dimension within a ResearchEvaluationScore. */
export interface EvaluationDimensionResult {
  name: string
  score: number
  max: number
  note?: string
}

/** Full 0-100 evaluation for one company's benchmark run. */
export interface ResearchEvaluationScore {
  name: string
  score: number
  dimensions: EvaluationDimensionResult[]
}

/** Roll-up across every company in one benchmark run. */
export interface AggregateEvaluation {
  runAt: string
  companyScores: Array<{ name: string; score: number }>
  meanScore: number
  minScore: number
  maxScore: number
}
