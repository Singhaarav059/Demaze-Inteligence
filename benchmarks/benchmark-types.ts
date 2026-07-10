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
}
