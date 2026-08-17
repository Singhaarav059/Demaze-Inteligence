// ============================================================
// Failure Taxonomy (Production Hardening Master Plan, Step 6.5)
// ============================================================
// Deterministic, rule-based mapping from data the pipeline already computes
// (validation gate reasonCode/stage, benchmark check names) onto a fixed set
// of failure categories — so "AI quality issue" doesn't become a meaningless
// catch-all. No new detection logic, no new LLM call: this is purely a
// lookup over app/api/admin/test-analysis/route.ts's existing GateReasonCode
// values (see that file's Production Hardening Plan Phase 2 work) and
// benchmark-runner.ts's existing CheckResult names.
//
// Only WARN/PARTIAL/FAIL gates and non-PASS checks contribute a category —
// a clean run (all PASS) must produce an empty list, never a manufactured one.

export type FailureCategory =
  | 'RETRIEVAL_FAILURE'
  | 'RELEVANCE_FAILURE'
  | 'IDENTITY_FAILURE'
  | 'EVIDENCE_FAILURE'
  | 'EXTRACTION_FAILURE'
  | 'CLASSIFICATION_FAILURE'
  | 'ICP_FAILURE'
  | 'MATCH_FAILURE'
  | 'PEOPLE_DATA_FAILURE'
  | 'EMAIL_FAILURE'
  | 'QA_FAILURE'
  | 'EXTERNAL_PROVIDER_FAILURE'
  | 'AUTH_FAILURE'

export interface GateLike {
  stage: string
  status: string
  reasonCode?: string
  reason?: string
}

export interface CheckLike {
  check: string
  status: string
}

// ── reasonCode -> category ─────────────────────────────────────
// Primary signal — matches app/api/admin/test-analysis/route.ts's
// GateReasonCode union 1:1. Two are judgment calls (documented inline);
// LANGUAGE_MISMATCH and VALIDATION_REJECTED are declared in that union but
// not currently emitted by any gate() call — mapped anyway so this stays
// correct if/when a future session wires them up.
const REASON_CODE_MAP: Record<string, FailureCategory> = {
  SOURCE_FAILURE: 'RETRIEVAL_FAILURE',
  NO_RELEVANT_CONTENT: 'RELEVANCE_FAILURE',
  IDENTITY_MISMATCH: 'IDENTITY_FAILURE',
  NO_EVIDENCE: 'EVIDENCE_FAILURE',
  PARSER_FAILURE: 'EXTRACTION_FAILURE',
  LOW_CONFIDENCE: 'CLASSIFICATION_FAILURE',
  PROVIDER_FAILURE: 'EXTERNAL_PROVIDER_FAILURE',
  // Judgment call: the content itself is real and relevant, it's just not in
  // a language the (English-only) extraction regexes can process — same
  // framing as CLAUDE.md's own non-English "silent zero" audit chain, which
  // treats this as an extraction-machinery gap, not a relevance/retrieval one.
  LANGUAGE_MISMATCH: 'EXTRACTION_FAILURE',
  // Judgment call: "a validation step rejected this" maps most directly onto
  // this repo's QA/narrative-safety concept (the same territory as the
  // forbidden-terms check below), not a retrieval/evidence problem.
  VALIDATION_REJECTED: 'QA_FAILURE',
}

// ── stage overrides ──────────────────────────────────────────────
// Applied BEFORE the reasonCode map for stages whose semantic failure is
// clear regardless of which generic reasonCode the gate happened to attach
// (both COMPETITOR and ICP currently always gate WARN with reasonCode
// NO_EVIDENCE — but the real failure is "discovery/matching found nothing",
// not "the scraped content had no evidence in it").
const STAGE_OVERRIDE_MAP: Record<string, FailureCategory> = {
  COMPETITOR: 'MATCH_FAILURE',
  ICP: 'ICP_FAILURE',
}

// ── stage -> category fallback ───────────────────────────────────
// Used only when a gate has no reasonCode (or an unrecognized one) and no
// stage override applies.
const STAGE_FALLBACK_MAP: Record<string, FailureCategory> = {
  SCRAPE: 'RETRIEVAL_FAILURE',
  SCRAPE_RELEVANCE: 'RELEVANCE_FAILURE',
  PROFILE: 'CLASSIFICATION_FAILURE',
  SIGNAL: 'EVIDENCE_FAILURE',
  BUSINESS_PROFILE: 'EVIDENCE_FAILURE',
  MARKET_INTEL: 'EVIDENCE_FAILURE',
  ENRICHMENT: 'RETRIEVAL_FAILURE',
  LLM_PARSE: 'EXTRACTION_FAILURE',
  NORMALIZATION: 'EXTRACTION_FAILURE',
  PAIN_POINTS: 'EXTRACTION_FAILURE',
  OPPORTUNITY: 'EXTRACTION_FAILURE',
  SYNTHESIS: 'EXTERNAL_PROVIDER_FAILURE',
}

function categorizeGate(gate: GateLike): FailureCategory {
  const override = STAGE_OVERRIDE_MAP[gate.stage]
  if (override) return override
  if (gate.reasonCode && REASON_CODE_MAP[gate.reasonCode]) return REASON_CODE_MAP[gate.reasonCode]
  return STAGE_FALLBACK_MAP[gate.stage] ?? 'EXTRACTION_FAILURE'
}

// ── benchmark check name -> category ─────────────────────────────
function categorizeCheck(check: CheckLike): FailureCategory | null {
  const name = check.check
  if (name.startsWith('profile_flag:') || name === 'primary_type') return 'CLASSIFICATION_FAILURE'
  if (name.startsWith('no_forbidden:')) return 'QA_FAILURE'
  if (name === 'min_signals' || name === 'min_opportunities' || name === 'min_challenges') return 'EVIDENCE_FAILURE'
  // pipeline_success is handled separately via the top-level error string
  // (no gates/checks exist yet at that point in a genuine network failure).
  // validation_not_failed is structurally unreachable today (every gate()
  // call that sets status FAIL also short-circuits the response to
  // success:false before this check ever runs) — no mapping needed, but
  // deliberately not silently dropped: falls through to null below so a
  // future code path that does reach it just contributes nothing rather
  // than crashing.
  return null
}

// ── top-level error string (no gates/checks available at all) ────
// Only reached when benchmark-runner.ts's own fetch() to the analysis API
// threw (network/timeout reaching our own server) — the one case where no
// validation gates exist to categorize from.
function categorizeTopLevelError(error: string): FailureCategory {
  const lower = error.toLowerCase()
  if (/(econnrefused|econnreset|etimedout|enotfound|fetch failed|abort|network)/.test(lower)) {
    return 'RETRIEVAL_FAILURE'
  }
  if (/(provider|llm|openai|nvidia|gemini|deepseek)/.test(lower)) {
    return 'EXTERNAL_PROVIDER_FAILURE'
  }
  return 'RETRIEVAL_FAILURE'
}

/**
 * Deterministically categorize every failure signal already present in a
 * benchmark run — WARN/PARTIAL/FAIL gates, non-PASS checks, and (only when
 * the pipeline call itself never returned) a top-level error string.
 * Returns a deduplicated, sorted list; empty when nothing failed.
 */
export function categorizeFailures(
  gates: GateLike[],
  checks: CheckLike[],
  topLevelError?: string,
): FailureCategory[] {
  const categories = new Set<FailureCategory>()

  if (topLevelError) {
    categories.add(categorizeTopLevelError(topLevelError))
  }

  for (const g of gates) {
    if (g.status === 'WARN' || g.status === 'PARTIAL' || g.status === 'FAIL') {
      categories.add(categorizeGate(g))
    }
  }

  for (const c of checks) {
    if (c.status !== 'PASS') {
      const category = categorizeCheck(c)
      if (category) categories.add(category)
    }
  }

  return Array.from(categories).sort()
}
