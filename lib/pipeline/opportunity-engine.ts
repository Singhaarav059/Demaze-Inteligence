// ============================================================
// Deterministic Opportunity Engine — v3
// ============================================================
// Maps the 8 CONFIRMED Demaze service lines (DEMAZE_CAPABILITY_MAP.md) directly
// to detected evidence. The LLM EXPLAINS these opportunities; it does not invent
// them, and it cannot surface a service outside these 8.
//
// v3 rewrite (2026-07-11): the entire v2 catalog (~20 generic "AI opportunity"
// titles like "Predictive Maintenance AI", "Production Optimization AI") is
// gone — those were invented services that don't correspond to anything Demaze
// actually sells. A live AITG test showed the old catalog surfacing exactly
// these titles as "Demaze Opportunities", i.e. real misleading output implying
// capabilities that may not exist. See CLAUDE.md "Item 5" for the full
// root-cause writeup.
//
// Gating no longer runs through signal_clusters (signal-clustering.ts) — those
// clusters were purpose-built for the old invented catalog's evidence shape
// and don't map onto what the 8 real services actually need (see
// service-evidence.ts's file header). Each of the 8 services now has its own
// Evidence/Disqualifier/Threshold detection, run directly against raw content,
// per SERVICE_TO_OUTREACH_MAPPING.md. signal_clusters remains an input to
// clusterSignals()/scorer.ts elsewhere in the pipeline but is not consulted here.
//
// Threshold is a real gate: only 'medium'/'strong' surface here. 'weak' matches
// are computed by service-evidence.ts but intentionally excluded from the
// output entirely — surfacing them would recreate the generic "Digital
// Transformation for every company" anti-pattern (CLAUDE.md "Why this exists").
//
// No cap on how many services surface — a company with two genuine,
// evidence-backed problems shows both, ranked by evidence strength
// (strong > medium, then by evidence-match count). Forcing a single pick when
// multiple services genuinely clear the bar would hide real signal.
// ============================================================

import type { CompanyProfile, DetectedFactors, DetectedSignal, EvidenceOrigin } from './evidence-extractor'
import { detectServiceEvidence, ServiceThresholdResult, ServiceThreshold } from './service-evidence'
import { DEMAZE_SERVICE_PROFILES } from '@/lib/knowledge/demaze-service-profiles'

export type OpportunityCategory = string  // slugified service name — see CONFIRMED_SERVICES below

export interface DeterministicOpportunity {
  id: string
  title: string                    // one of the 8 confirmed service names, verbatim — never invented
  service: string                  // same as title; kept as a separate field for normalize.ts compatibility
  category: OpportunityCategory
  strategic_challenge: string      // "Likely Pain" from SERVICE_TO_OUTREACH_MAPPING.md
  llm_explanation_prompt: string   // what to ask the LLM to explain, seeded with the actual matched evidence
  entry_point: string              // "Outreach Angle" from the mapping doc — a usable first-line opener
  priority: number                 // derived from threshold: strong=90, medium=60
  relevance: 'High' | 'Medium'      // strong->High, medium->Medium ('weak'/'none' never reach here)
  threshold: ServiceThreshold
  disqualifier_matched?: string
  // Debug/traceability — kept under the pre-existing field name so the admin
  // debug UI (app/admin/intelligence-lab/page.tsx) continues to render
  // something meaningful without requiring an immediate UI change.
  triggered_by_clusters?: Array<{ id: string; name: string; confidence: string; origin: EvidenceOrigin }>
  priority_source?: string
  // Where the evidence this opportunity is based on actually came from —
  // the origin of its strongest (first) matched evidence item. own_site
  // means the only support is the company's own marketing/careers/investor
  // pages; filing/job_posting/news/other_external mean at least the
  // top-ranked match was independently sourced. Does not change threshold/
  // priority/relevance — purely a traceability field a salesperson (or a
  // later scoring pass) can read.
  evidence_origin: EvidenceOrigin
}

// ── The 8 confirmed services (verbatim from DEMAZE_CAPABILITY_MAP.md) ───────
// strategic_challenge/entry_point are DERIVED from
// lib/knowledge/demaze-service-profiles.ts (problemsSolvedConfidently /
// preferredOutreachAngle) instead of a second hardcoded copy of the same
// text — that file is now the single source of truth for this content,
// itself copied verbatim from SERVICE_TO_OUTREACH_MAPPING.md.

function slugify(service: string): string {
  return service.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

const SERVICE_CONTENT: Record<string, { strategic_challenge: string; entry_point: string; slug: string }> =
  Object.fromEntries(
    Object.values(DEMAZE_SERVICE_PROFILES).map(p => [
      p.service,
      {
        slug: slugify(p.service),
        strategic_challenge: p.problemsSolvedConfidently.join('; ') + '.',
        entry_point: p.preferredOutreachAngle,
      },
    ])
  )

// The literal 8 confirmed service-line names, exported for reuse as a
// whitelist elsewhere (normalize.ts's evidence-grounded LLM opportunity path
// — see CLAUDE.md "Research-quality initiative" 2026-07-22 Session 2 — checks
// an LLM-proposed opportunity's service_line against this exact list so it
// can never invent a 9th service).
export const CONFIRMED_SERVICE_NAMES: readonly string[] = Object.keys(SERVICE_CONTENT)

function toOpportunity(r: ServiceThresholdResult): DeterministicOpportunity {
  const content = SERVICE_CONTENT[r.service]
  const evidenceQuotes = r.evidence.map(e => `"${e.matched}" (${e.pattern})`).join('; ')

  return {
    id: content.slug,
    title: r.service,
    service: r.service,
    category: content.slug,
    strategic_challenge: content.strategic_challenge,
    llm_explanation_prompt: `Explain why "${r.service}" is relevant given this evidence from the company's own content: ${evidenceQuotes || '(no direct quote captured)'}. Quote specific evidence, don't restate generically.`,
    entry_point: content.entry_point,
    priority: r.threshold === 'strong' ? 90 : 60,
    relevance: r.threshold === 'strong' ? 'High' : 'Medium',
    threshold: r.threshold,
    disqualifier_matched: r.disqualifier_matched,
    triggered_by_clusters: r.evidence.map(e => ({ id: e.pattern, name: e.matched, confidence: r.threshold, origin: e.origin })),
    priority_source: `Threshold: ${r.threshold} | Evidence: ${r.evidence.length} pattern(s) matched`,
    // r.evidence is already ordered strong-patterns-first (service-evidence
    // .ts's firstMatch() checks strong/medium/weak in that order) — the
    // first item is the strongest-tier match, so its origin is the most
    // representative single value for this opportunity.
    evidence_origin: r.evidence[0]?.origin ?? 'unknown',
  }
}

// ── Main function ──────────────────────────────────────────────

/**
 * Given raw content and company profile, detect which of the 8 confirmed
 * Demaze services genuinely clear the evidence bar for this company.
 *
 * No cap — returns every service that clears 'medium' or 'strong', ranked by
 * threshold (strong first) then by evidence-match count. 'weak' and
 * disqualified services never reach the output.
 */
export function generateDeterministicOpportunities(
  content: string,
  profile: CompanyProfile,
  growthOrHiringSignal: boolean,
): DeterministicOpportunity[] {
  const results = detectServiceEvidence(content, profile, growthOrHiringSignal)

  const qualifying = results.filter(r => !r.disqualified && (r.threshold === 'medium' || r.threshold === 'strong'))

  qualifying.sort((a, b) => {
    if (a.threshold !== b.threshold) return a.threshold === 'strong' ? -1 : 1
    return b.evidence.length - a.evidence.length
  })

  return qualifying.map(toOpportunity)
}

// ============================================================
// v4 — per-opportunity evidence/fit model
// ============================================================
// Answers "why was this opportunity surfaced" with three separate,
// explainable dimensions instead of one opaque number — per opportunity,
// not per company (see sector-playbook/qualify.ts for the existing
// per-COMPANY 4-pillar equivalent; this is deliberately not unified with
// that system since it scores a different thing at a different grain).
//
// Nothing here adds a new evidence source or LLM call — every input is
// already computed elsewhere in the pipeline (an opportunity's `source` +
// `threshold`/verification tier from the existing merge in normalize.ts,
// and the company's already-extracted DetectedFactors booleans).
// ============================================================

export type OpportunitySource = 'deterministic' | 'llm_verified' | 'llm_inferred' | 'llm'
export type EvidenceStrength = 'CONFIRMED' | 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE'
export type CapabilityFit = 'high' | 'medium'
export type TimingStrength = 'strong' | 'moderate' | 'weak' | 'none'

/**
 * How strong is the proof behind this specific opportunity?
 *
 * - deterministic: code-matched real content via service-evidence.ts's
 *   regex ladder for this exact service — no LLM guess involved. `strong`
 *   threshold + 2+ independent pattern matches (i.e. multiple sources of
 *   support, not just one line of text) is the only path to CONFIRMED;
 *   a single strong match, or several medium matches, is STRONG; a lone
 *   medium match is MODERATE.
 * - llm_verified: the LLM's claimed quote was independently checked
 *   against real content (quote-verification.ts). An exact verbatim match
 *   is MODERATE (a single real quote, but the LLM chose which one — less
 *   rigorous than a code-driven multi-pattern match); a fuzzy/close match
 *   is WEAK.
 * - llm_inferred: no quote to verify at all, by definition — always WEAK.
 * - anything disqualified or with no threshold match: NONE.
 */
export function deriveEvidenceStrength(
  source: OpportunitySource | undefined,
  threshold: ServiceThreshold | undefined,
  evidenceCount: number,
  quoteMatchTier?: 'exact' | 'close' | 'none',
): EvidenceStrength {
  if (source === 'deterministic') {
    if (threshold === 'strong' && evidenceCount >= 2) return 'CONFIRMED'
    if (threshold === 'strong' || (threshold === 'medium' && evidenceCount >= 2)) return 'STRONG'
    if (threshold === 'medium') return 'MODERATE'
    return 'NONE'
  }
  if (source === 'llm_verified') {
    return quoteMatchTier === 'exact' ? 'MODERATE' : 'WEAK'
  }
  if (source === 'llm_inferred') {
    return 'WEAK'
  }
  return 'NONE'
}

/**
 * Does the identified problem actually map to a real Demaze capability?
 *
 * `deterministic` opportunities are 'high' by construction — code matched
 * this exact service's own evidence ladder, not a free-text LLM guess.
 * `llm_verified`/`llm_inferred` are 'medium' — the LLM chose the
 * service_line itself; it's whitelist-checked against the 8 confirmed
 * names (CONFIRMED_SERVICE_NAMES) so it can never invent a 9th service,
 * but that specific service's own regex ladder never ran against this
 * evidence, so it's a step below a code-verified match.
 */
export function deriveCapabilityFit(source: OpportunitySource | undefined): CapabilityFit {
  return source === 'deterministic' ? 'high' : 'medium'
}

const TIMING_TRIGGER_FACTORS: Array<keyof DetectedFactors> = [
  'recent_news_or_event',
  'hiring_signal',
  'capacity_expansion',
  'growth_signal',
  'digital_transformation',
  'industry_40_initiative',
]

/**
 * Is there a recent business change that makes now a sensible time to
 * reach out? Reuses the already-extracted DetectedFactors booleans
 * (evidence-extractor.ts) — no new signal detection. This is a
 * company-wide signal, not opportunity-specific: today's evidence doesn't
 * tie a given trigger to one particular service over another, so every
 * opportunity for a given company shares the same timing_strength. That's
 * an honest limitation, not a per-opportunity computation being faked.
 */
export function deriveTimingStrength(detectedFactors: Partial<DetectedFactors> | undefined): TimingStrength {
  if (!detectedFactors) return 'none'
  const firedCount = TIMING_TRIGGER_FACTORS.filter(f => detectedFactors[f]).length
  if (firedCount >= 2) return 'strong'
  if (firedCount === 1) return 'moderate'
  return 'none'
}

const EVIDENCE_STRENGTH_SCORE: Record<EvidenceStrength, number> = {
  CONFIRMED: 100, STRONG: 80, MODERATE: 55, WEAK: 30, NONE: 0,
}
const CAPABILITY_FIT_SCORE: Record<CapabilityFit, number> = { high: 90, medium: 55 }
const TIMING_STRENGTH_SCORE: Record<TimingStrength, number> = { strong: 90, moderate: 60, weak: 30, none: 10 }

function confidenceLabel(score: number): string {
  if (score >= 75) return 'Strong'
  if (score >= 50) return 'Moderate'
  if (score >= 25) return 'Weak'
  return 'Poor'
}

/**
 * Overall opportunity confidence — a weighted composite of capability fit
 * and evidence strength (co-primary, per the task's stated priority order),
 * with timing as a secondary factor. Deliberately has NO company
 * size/revenue/industry term: those are context, not proof a problem
 * exists, and folding them in here would recreate exactly the "large
 * company therefore opportunity" anti-pattern this model exists to avoid.
 */
export function computeOpportunityConfidence(
  evidenceStrength: EvidenceStrength,
  capabilityFit: CapabilityFit,
  timingStrength: TimingStrength,
): { score: number; label: string } {
  const score = Math.round(
    EVIDENCE_STRENGTH_SCORE[evidenceStrength] * 0.4 +
    CAPABILITY_FIT_SCORE[capabilityFit] * 0.4 +
    TIMING_STRENGTH_SCORE[timingStrength] * 0.2
  )
  return { score, label: confidenceLabel(score) }
}

// ============================================================
// D.3 — evidence-traceable Why Now
// ============================================================
// Replaces free LLM narrative as the source of "why now" text with a
// composed explanation built ONLY from real, code-verified evidence —
// reuses factorSourceMap + signals (evidence-extractor.ts's own
// mechanically-derived structures, no LLM involved in producing them) so
// this never invents a trigger the extractor didn't actually find. Kept
// deliberately separate from timing_strength (deriveTimingStrength above):
// timing_strength reads the FINAL, business-model-filtered DetectedFactors
// (which can include LLM-narrated contributions), while this reads ONLY
// factorSourceMap — the subset of that same set of factors that trace to a
// real, code-matched signal. The two can legitimately disagree (e.g.
// timing_strength 'moderate' from an LLM-only factor, while this reports
// "no verified timing signal") — that's an honest reflection of two
// different confidence bars, not a bug.
// ============================================================

export type WhyNowStatus = 'traceable' | 'no_verified_signal'

export interface WhyNowTrace {
  status: WhyNowStatus
  /** The factual trigger(s) — real, verbatim evidence quotes only. */
  fact?: string
  /** The interpretive hypothesis — clearly separated from `fact`, never presented as confirmed. */
  inference?: string
  /** Composed "WHY NOW: <fact>. <inference>" string, or the literal no-signal state. */
  explanation: string
  /** Real ExtractedEvidence ids the fact traces to — never manufactured. */
  evidence_ids: string[]
  /** Real ExtractedEvidence source_urls the fact traces to. */
  source_urls: string[]
}

const NO_VERIFIED_TIMING_SIGNAL: WhyNowTrace = {
  status: 'no_verified_signal',
  explanation: 'no verified timing signal',
  evidence_ids: [],
  source_urls: [],
}

/** factorSourceMap entries can carry a " (secondary)"-style suffix (see evidence-extractor.ts's addFactorSource calls) — strip it to recover the real SignalType before looking the signal up. */
function stripSecondaryTag(signalTypeLabel: string): string {
  const idx = signalTypeLabel.indexOf(' (')
  return idx === -1 ? signalTypeLabel : signalTypeLabel.slice(0, idx)
}

/**
 * Builds an evidence-traceable "why now" explanation from ONLY the factors
 * that trace to a real, code-matched signal (factorSourceMap), not the
 * broader (possibly LLM-only) DetectedFactors set. Never invents a trigger:
 * if nothing traces, returns the explicit NO_VERIFIED_TIMING_SIGNAL state
 * rather than falling back to generic urgency language.
 *
 * "Old vs recent" weighting: this codebase has no real date/timestamp on
 * any evidence item (website content and search-discovered content alike
 * carry no reliable publication date today — see this function's own
 * report writeup). As an honest, non-invented proxy, a signal's own
 * `validated` flag (2+ independent pieces of company-subject evidence,
 * already computed by evidence-extractor.ts) stands in for confidence: a
 * single, unvalidated mention is hedged as "(single-mention, unconfirmed)"
 * and produces a weaker inference sentence, rather than being presented
 * with the same confidence as a validated, multi-evidence trigger.
 */
export function deriveWhyNowTrace(
  factorSourceMap: Partial<Record<keyof DetectedFactors, string[]>> | undefined,
  signals: DetectedSignal[] | undefined,
): WhyNowTrace {
  if (!factorSourceMap || !signals || signals.length === 0) return NO_VERIFIED_TIMING_SIGNAL

  const cited: Array<{ quote: string; id: string; url: string; validated: boolean }> = []
  const seenSignalTypes = new Set<string>()

  for (const factor of TIMING_TRIGGER_FACTORS) {
    const rawTypes = factorSourceMap[factor]
    if (!rawTypes || rawTypes.length === 0) continue // not code-traceable for this factor — never invent one

    for (const raw of rawTypes) {
      const type = stripSecondaryTag(raw)
      if (seenSignalTypes.has(type)) continue
      const sig = signals.find(s => s.type === type)
      // is_company_subject: false means this text was about a customer/
      // partner/generic-marketing subject, not the researched company
      // itself — not a real trigger for THIS company.
      if (!sig || !sig.is_company_subject) continue
      const ev = sig.evidence[0]
      if (!ev) continue
      seenSignalTypes.add(type)
      cited.push({ quote: ev.quote, id: ev.id, url: ev.source_url, validated: sig.validated })
    }
  }

  if (cited.length === 0) return NO_VERIFIED_TIMING_SIGNAL

  const fact = cited
    .map(c => c.validated ? `"${c.quote}"` : `"${c.quote}" (single-mention, unconfirmed)`)
    .join('; ')
  const anyValidated = cited.some(c => c.validated)
  const inference = anyValidated
    ? 'This is a concrete, evidence-backed timing trigger for raising the identified opportunity now.'
    : 'This is a single, unconfirmed mention — a weaker timing cue, not a confirmed trigger.'

  return {
    status: 'traceable',
    fact,
    inference,
    explanation: `WHY NOW: ${fact}. ${inference}`,
    evidence_ids: [...new Set(cited.map(c => c.id))],
    source_urls: [...new Set(cited.map(c => c.url).filter(Boolean))],
  }
}

// ── Per-opportunity Why-Now narrowing (2026-08-27 fix) ───────────────────
// deriveWhyNowTrace() above is computed ONCE per company — "today's
// evidence doesn't tie a given trigger to one particular service over
// another" (see deriveTimingStrength()'s own header, a few lines up) — so
// building a new factor-to-service mapping table to fix this would be
// exactly the kind of invented taxonomy that comment already declines to
// fabricate. What's real and available instead: does the trigger's own
// quoted fact text actually share any vocabulary with THIS opportunity's
// own title/description/evidence? Confirmed live (2026-08-27 quality
// audit): Ador Welding's 6 opportunities — visibility dashboards,
// predictive maintenance, inventory automation, two genuinely AI-related
// ones — all shared the identical "hiring an AI Engineer" trigger
// unconditionally, reading as generic urgency-inflation on the unrelated
// ones rather than a reason to act on that specific opportunity now.
//
// A minimal connector-word list — NOT a general NLP stopword library, just
// enough to stop "we"/"our"/"the" from creating a false-positive overlap
// between two otherwise-unrelated sentences. Deliberately no length
// threshold (unlike some word-filtering elsewhere in this codebase) — a
// short but meaningful token like "AI" must survive, matching this
// codebase's established precedent (matchesKeyword()'s word-boundary
// handling for short keywords) rather than being dropped as "too short to
// matter."
const WHY_NOW_FILLER_WORDS = new Set([
  'a', 'an', 'the', 'to', 'in', 'on', 'at', 'we', 'us', 'of', 'is', 'are',
  'was', 'were', 'be', 'been', 'by', 'or', 'and', 'our', 'its', 'it', 'no',
  'not', 'as', 'has', 'have', 'had', 'this', 'that', 'these', 'those',
  'from', 'will', 'would', 'can', 'could', 'so', 'if', 'do', 'does', 'did',
  'for', 'with', 'into', 'about',
])

function significantWhyNowWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(w => w.length > 0 && !WHY_NOW_FILLER_WORDS.has(w))
  )
}

/**
 * Narrows a company-wide WhyNowTrace down to what's genuinely relevant to
 * ONE specific opportunity. When the trace's fact shares no real word with
 * this opportunity's own text, this opportunity honestly reports
 * no_verified_signal instead of inheriting a company-wide fact that isn't
 * actually about it — same "prefer under-confidence" discipline as every
 * other evidence gate in this file.
 */
export function narrowWhyNowToOpportunity(trace: WhyNowTrace, opportunityText: string): WhyNowTrace {
  if (trace.status !== 'traceable' || !trace.fact) return trace
  const factWords = significantWhyNowWords(trace.fact)
  if (factWords.size === 0) return trace // nothing meaningful to check against — don't block
  const oppWords = significantWhyNowWords(opportunityText)
  const overlaps = [...oppWords].some(w => factWords.has(w))
  return overlaps ? trace : NO_VERIFIED_TIMING_SIGNAL
}
