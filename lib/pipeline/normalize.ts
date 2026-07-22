// ============================================================
// Analysis Result Normalizer — v4
// ============================================================
// Pipeline:
//   raw LLM JSON
//   → flattenSections
//   → evidence extraction
//   → business model classification (code)
//   → signal filtering (remove false positives for business model)
//   → deriveDetectedFactors (4-pass signal supplementation)
//   → signal clustering (code)
//   → deterministic opportunity generation (code)
//   → score computation (deterministic)
//   → NormalizedAnalysis
// ============================================================

import {
  computeScores,
  computeClusterOpportunityFloor,
  scoreLabel,
  DetectedFactors,
  ScoreWithBreakdown,
  ScoreBreakdownItem,
} from '@/lib/pipeline/scorer'
import {
  classifyBusinessModel,
  getBusinessModelProfile,
  filterSignalsForBusinessModel,
  BusinessModelType,
  StrategicChallenge,
} from '@/lib/pipeline/business-model-classifier'
import {
  clusterSignals,
  SignalCluster,
} from '@/lib/pipeline/signal-clustering'
import {
  generateDeterministicOpportunities,
  DeterministicOpportunity,
  CONFIRMED_SERVICE_NAMES,
} from '@/lib/pipeline/opportunity-engine'
import { verifyQuoteInContent, isQuoteGrounded } from '@/lib/pipeline/quote-verification'
import {
  detectServiceEvidence,
  type ServiceThresholdResult,
  type ServiceThreshold,
  type ServiceEvidenceMatch,
} from '@/lib/pipeline/service-evidence'
import type { CompanyProfile, ExtractorResult, LeadershipContact } from '@/lib/pipeline/evidence-extractor'
import type { CompetitorProfile, CompetitorSufficiency, CompetitorDiscoveryResult } from '@/lib/enrichment/competitor-discovery'
import type { ICPSegment, ICPSufficiency, ICPDiscoveryResult } from '@/lib/enrichment/icp-generator'
import type { MarketIntelItem, MarketIntelSufficiency, MarketIntelligenceResult } from '@/lib/enrichment/market-intelligence'
import { auditResearchQuality, ResearchQualityAudit } from '@/lib/pipeline/research-quality'
import { emptyBusinessProfile, type CompanyBusinessProfile } from '@/lib/pipeline/business-profile'

// Converts a BusinessModelType string to a minimal CompanyProfile for
// backward compatibility when companyProfile is not available from extractor.
function businessModelToProfile(bmt: BusinessModelType): CompanyProfile {
  return {
    company_type: {
      manufacturer:           bmt === 'Manufacturing' || bmt === 'Automotive OEM' || bmt === 'Automotive Supplier',
      industrial_vendor:      bmt === 'Industrial Technology Vendor',
      software_saas:          bmt === 'Software/SaaS',
      services_provider:      bmt === 'Engineering Services',
      retailer:               false,
      logistics_operator:     bmt === 'Distribution/Logistics',
      financial_institution:  false,
      healthcare_provider:    false,
      pharma_biotech:         false,
      conglomerate:           bmt === 'Conglomerate',
    },
    operations: {
      multi_location:                false,
      global_presence:               false,
      has_rd_center:                 false,
      manufacturing_plants_count:    null,
      countries_present:             null,
    },
    capabilities: { has_robotics_or_automation: false, has_software_platform: false },
    selling_model: {
      sells_to_industry:       true,
      sells_to_consumers:      false,
      sells_physical_product:  bmt === 'Manufacturing' || bmt === 'Automotive OEM' || bmt === 'Automotive Supplier',
      sells_software:          bmt === 'Software/SaaS',
      sells_services:          bmt === 'Engineering Services',
    },
    primary_type: bmt,
  }
}

// ── Evidence types ─────────────────────────────────────────────

export interface EvidenceItem {
  id: string
  subject?: string   // company_operations | company_strategy | internal_technology | customer_use_case | product_capability | industry_trend | partner_story | generic_marketing
  tier?: string      // tier1 | tier2 | tier3
  category: string
  quote: string
  source_page: string
}

const COMPANY_SUBJECT_TYPES = new Set([
  'company_operations',
  'company_strategy',
  'internal_technology',
])

function isCompanySubjectEvidence(ev: EvidenceItem): boolean {
  if (!ev.subject) return true  // backward compat: no subject = allow through
  return COMPANY_SUBJECT_TYPES.has(ev.subject)
}

// ── v2/v3/v4 types ────────────────────────────────────────────

export interface StructuredPainPoint {
  title: string
  confidence: 'high' | 'medium' | 'low'
  evidence_id: string
  evidence: string
  reasoning: string
  // 2026-07-22 (Session 3, research-quality initiative — see CLAUDE.md):
  // 'observed' claims are quote-verified against the same content pool the
  // LLM was shown before surviving into the report; 'inferred' claims are
  // kept as legitimate business-model reasoning without requiring a quote.
  claim_type?: 'observed' | 'inferred'
}

export interface ReasoningChain {
  signal: string
  business_implication: string
  strategic_challenge?: string
  pain_point?: string           // backward compat
  opportunity: string
}

// v4 Why Demaze: reasons can be objects (new) or strings (backward compat)
export interface WhyDemazeReason {
  signal: string
  evidence: string
  evidence_tier?: string
  business_implication: string
  strategic_challenge?: string
  recommended_service: string
  confidence: 'high' | 'medium' | 'low'
}

export interface WhyDemaze {
  reasons: (WhyDemazeReason | string)[]   // objects (v4) or strings (v3 backward compat)
  relevant_services: string[]
  summary?: string
}

export interface OutreachIntelligence {
  trigger: string
  problem: string
  service: string
  opening_angle: string
  why_now: string
}

// Outreach message drafting (2026-07-16, lib/knowledge/demaze-proof-points.ts
// + proof-point-matcher.ts) — literal LinkedIn connection note / first
// message / follow-up drafts, grounded in a real Demaze proof point matched
// by industry-tag overlap. Drafting only, never sending — see DECISIONS.md's
// standing send-is-blocked-on-vendor-decision boundary, unaffected by this.
export interface OutreachDraft {
  matched_proof_point_id: string
  connection_note: string
  first_message: string
  follow_up: string
}

export interface ExecutiveBrief {
  what_we_observed: string[]
  what_it_means: string[]
  what_to_sell: string
  why_now: string
  overall_confidence: 'high' | 'medium' | 'low'
}

// Re-export for consumers
export type { ScoreWithBreakdown, ScoreBreakdownItem, DetectedFactors, SignalCluster, DeterministicOpportunity, BusinessModelType, StrategicChallenge, CompetitorProfile, CompetitorSufficiency, ICPSegment, ICPSufficiency, ResearchQualityAudit }

// ── Service Evidence Debug (diagnostic, internal-only) ─────────
// detectServiceEvidence() (service-evidence.ts) computes a threshold ('none'
// | 'weak' | 'medium' | 'strong') per one of the 8 confirmed Demaze
// services, but generateDeterministicOpportunities() (opportunity-engine.ts)
// only ever surfaces 'medium'/'strong' matches into deterministic_opportunities
// — 'weak' matches and disqualification reasons are silently discarded there,
// with no way to distinguish "genuinely thin evidence" from "a real
// extraction gap" for a past run without re-deriving everything by hand.
// This type captures that full per-service picture (including weak-tier
// evidence) plus the insufficientEvidence 4-condition breakdown below, purely
// for developer/debug visibility — never rendered in ResearchCard.tsx, never
// changes any gate's PASS/WARN/FAIL behavior.
export interface ServiceEvidenceDebugEntry {
  service: string
  threshold: ServiceThreshold
  // true when this service actually reached deterministic_opportunities
  // (mirrors opportunity-engine.ts's own qualifying filter exactly:
  // !disqualified && threshold is 'medium' or 'strong').
  surfaced: boolean
  disqualified: boolean
  disqualifier_matched?: string
  // All matches detectServiceEvidence() collected for this service, across
  // every pattern tier (strong/medium/weak) — includes weak-tier matches
  // even when a stronger tier is what actually set `threshold`.
  evidence: ServiceEvidenceMatch[]
}

export interface ServiceEvidenceDebug {
  services: ServiceEvidenceDebugEntry[]
  insufficient_evidence: {
    // Whether the "Insufficient Evidence" outcome (see evidence_sufficiency
    // above) fired and force-suppressed deterministic_opportunities to [].
    fired: boolean
    // The 4 individual conditions normalize.ts ANDs together to decide
    // `fired` — surfaced individually so a developer can see WHICH
    // condition(s) were true/false, not just the combined result.
    conditions: {
      companySubjectCount_zero: boolean
      signals_zero: boolean
      leadershipContacts_zero: boolean
      no_facility_evidence: boolean
    }
  }
}

// ── Pain-points validation-gate logic (pure, unit-testable) ────
// Extracted so route.ts's PAIN_POINTS gate (added alongside this field) and
// tests can both call the exact same rule: only warn when the company had
// usable evidence (evidence_sufficiency === 'sufficient') but pain_points
// still came back empty — that combination points at an LLM/parsing problem,
// not a data problem. An empty pain_points array on a genuinely-thin-evidence
// company (evidence_sufficiency === 'insufficient') is arguably correct and
// must NOT warn, same "no forced output on thin evidence" discipline
// deterministic_opportunities already follows via insufficientEvidence above.
export function shouldWarnEmptyPainPoints(
  painPointsCount: number,
  evidenceSufficiency: 'sufficient' | 'insufficient',
): boolean {
  return painPointsCount === 0 && evidenceSufficiency === 'sufficient'
}

// ── Stable internal schema ─────────────────────────────────────

export interface NormalizedAnalysis {
  // Company profile
  company_name: string
  company_summary: string
  industry: string
  sub_industry: string
  company_type: string
  company_size_estimate: string
  headquarters_location: string

  // Evidence layer
  evidence: EvidenceItem[]

  // Scores — deterministic
  company_fit: ScoreWithBreakdown
  automation_opportunity: ScoreWithBreakdown
  outreach_priority_score: number
  outreach_priority_label: string
  outreach_priority_methodology: string

  why_now: {
    explanation: string
    score: number
    urgency_label: string
  }

  score_explanations: {
    company_fit: string
    automation_opportunity: string
    outreach_priority: string
  }

  detected_factors: Partial<DetectedFactors>

  score_breakdown: {
    company_fit: ScoreBreakdownItem[]
    automation_opportunity: ScoreBreakdownItem[]
  }

  // Signal layer
  signals: Array<{
    type: string
    category: string
    strength: string
    evidence: string
    evidence_id?: string
  }>
  signal_summary: string

  // v4: Signal clusters (code-computed)
  signal_clusters: SignalCluster[]

  // Intelligence
  pain_points: string[]
  pain_points_structured: StructuredPainPoint[]
  reasoning_chains: ReasoningChain[]

  // v4: Strategic challenges from business model profile
  strategic_challenges: StrategicChallenge[]

  // Opportunities: LLM-explained + deterministic supplement
  opportunities: Array<{
    title: string
    description: string
    confidence?: string
    evidence_id?: string
    evidence?: string
    reasoning?: string
    expected_impact?: string
    entry_point?: string
    category?: string
    pain_point_mapped?: string
    relevance: string
    evidence_anchor?: string
    estimated_impact?: string
    // v4: source of this opportunity. 'llm_verified' (2026-07-22, Session 2
    // of the research-quality initiative — see CLAUDE.md) is an LLM-proposed
    // opportunity that had no matching deterministic-catalog entry but was
    // independently quote-verified against the actual content the LLM was
    // shown (see quote-verification.ts + the merge logic below) — a second,
    // additive path alongside the existing regex-gated 'deterministic' path,
    // never replacing it. 'llm_inferred' (found+fixed same day, live RIL
    // usage) is the same additive path's sibling for `claim_type: 'inferred'`
    // opportunities with a real stated reasoning basis but no literal quote
    // to verify — mirrors pain_points' existing observed/inferred split
    // rather than discarding every inferred opportunity outright.
    source?: 'llm' | 'deterministic' | 'llm_verified' | 'llm_inferred'
    deterministic_id?: string
    // Which of the 8 confirmed Demaze services this maps to — only ever
    // populated for 'llm_verified' entries (the LLM is asked for this
    // directly in the schema); deterministic entries already carry the same
    // information in `category`.
    service_line?: string
    // v5: trust signal fields
    claim_type?: string
    observed_basis?: string
    inferred_from?: string
    opportunity_confidence?: string
    demaze_fit_score?: string
  }>

  // v4: Deterministic opportunities from opportunity engine
  deterministic_opportunities: DeterministicOpportunity[]

  // Evidence-source-strategy addition: 'insufficient' means deterministic_opportunities
  // was deliberately suppressed (empty) because essentially no usable evidence was
  // found — distinct from a thorough analysis that genuinely found nothing relevant.
  // See EVIDENCE_SOURCE_STRATEGY.md, "Insufficient Evidence" outcome.
  evidence_sufficiency: 'sufficient' | 'insufficient'

  /**
   * @deprecated Dead field — confirmed unrendered by ResearchCard.tsx or the
   * brief export (grep-verified). Superseded by `competitors` /
   * `competitor_sufficiency` below (Competitor Discovery Engine, Phase 2 item
   * 1 — see CLAUDE.md "SCOPE PIVOT" and Latest Session Handoff.md). Left in
   * place, still populated from the LLM prompt, until the new engine is
   * actually implemented and wired — removing it now would be premature
   * given nothing produces `competitors` yet.
   */
  competitive_context: string

  // Competitor Discovery Engine output (Phase 2 item 1). Code-derived
  // candidate list with LLM-narrated why_they_compete/market_position per
  // candidate — same deterministic-list + LLM-narration-merge discipline as
  // `opportunities` below, once the merge step is implemented. Schema only
  // for now: normalizeAnalysisResult() below wires these to safe empty
  // defaults ('insufficient', []) since no producer exists yet — see
  // lib/enrichment/competitor-discovery.ts.
  competitors: CompetitorProfile[]
  competitor_sufficiency: CompetitorSufficiency

  // ICP Generator output (Phase 2 item 2) — who the RESEARCHED COMPANY
  // sells to (named target-customer segments), NOT company_fit above (which
  // scores whether this company is a good lead FOR DEMAZE, a single
  // number). See lib/enrichment/icp-generator.ts header for the full
  // reconciliation note. Same code-derived-skeleton + LLM-narration-merge
  // discipline as `competitors`.
  icp_segments: ICPSegment[]
  icp_sufficiency: ICPSufficiency

  // Market Intelligence Layer (Phase 2 item 6) — industry-level context
  // (trends/growth indicators/challenges/shifts) for the sector the
  // researched company operates in. Unlike competitors/icp_segments, this
  // is pure passthrough from discoverMarketIntelligence() — no LLM
  // narration/merge step exists (see lib/enrichment/market-intelligence.ts
  // header for why: each item is already a full statement extracted from a
  // real search snippet, not a name needing explanation).
  market_intelligence: MarketIntelItem[]
  market_intelligence_sufficiency: MarketIntelSufficiency

  // Named leadership individuals extracted from the company's own scraped
  // site (evidence-extractor.ts's leadershipContacts, via _extractor).
  // Previously only reachable through the internal `_raw._extractor`
  // passthrough — promoted to a real top-level field (2026-07-19) so any
  // consumer of a saved run (e.g. the standalone /admin/outbound/contacts
  // page) can feed it to decision-maker-discovery grounding without reaching
  // into an internal underscore field. Pure passthrough, same as
  // market_intelligence/company_offerings — no LLM narration step.
  leadership_contacts: LeadershipContact[]

  // What the researched company itself says it sells, extracted from its own
  // self-referential website language (see lib/pipeline/service-offerings.ts).
  // Superseded as the primary Competitor Discovery / ICP Generator query
  // anchor by business_profile below (2026-07-16 rebuild) — kept as a
  // display field and as the fallback query source when business_profile is
  // empty. Distinct from `competitive_context` (Demaze-pitch industry
  // framing) and `business_model` prose. Pure passthrough, same as
  // market_intelligence above — content-derived only, no LLM narration step.
  company_offerings: string[]

  // Business Profile (2026-07-16 rebuild) — structured "what does this
  // company actually do" extraction (services/problems solved/ideal
  // customers/industries served/target company size/market positioning/
  // technical capabilities/business outcomes), see
  // lib/pipeline/business-profile.ts. This is what Competitor Discovery and
  // ICP Generator ground their primary search queries in, replacing the old
  // company-name-based competitor search. Pure passthrough — it IS an LLM
  // output already, no further narration/merge step applies to it.
  business_profile: CompanyBusinessProfile

  // Research Quality Framework (Phase 2 item 4) — per-item confidence audit,
  // informational only, never gates. Computed last, from the fully-assembled
  // NormalizedAnalysis, since it cross-checks fields (evidence subject vs.
  // opportunity/pain-point confidence, competitor/ICP confidence vs. source
  // count, self-name collisions) that only exist once everything else above
  // is built. See lib/pipeline/research-quality.ts.
  research_quality: ResearchQualityAudit

  // Why Demaze (v4: structured reasons)
  why_demaze: WhyDemaze

  // Executive brief (top-level sales summary)
  executive_brief: ExecutiveBrief | null

  // Outreach
  outreach_angle: string
  outreach_intelligence: OutreachIntelligence
  // Literal drafted outreach messages, grounded in a matched Demaze proof
  // point — see OutreachDraft above. Pure passthrough-with-safety-net, same
  // shape as market_intelligence: no name-match merge step (there's only
  // one draft object per report, not a list), but matched_proof_point_id is
  // validated against the real candidate list before being trusted (see
  // the "Outreach Draft" section below).
  outreach_draft: OutreachDraft

  // Validation
  validation_warnings: string[]
  content_quality_flags: string[]

  // Business model (v3+)
  business_model_analysis: {
    model_type: string
    value_chain_position: string
    primary_customers: string
    core_operational_activities: string[]
    strategic_pressures: string[]
  } | null

  // v4: Canonical business model type (code-classified)
  business_model_type: BusinessModelType

  // SDR research fields (v5+)
  recent_activity: string[]   // growth/digital signals as plain strings for Research Card

  // Metadata
  confidence_level: string
  data_quality_score: number
  data_quality_notes: string
  pages_scraped: string[]
  analyzed_at: string

  // Distinguishes "the LLM narrative step genuinely failed" from "analysis ran
  // fine and found nothing" — separate from evidence_sufficiency above, which
  // is about evidence availability, not synthesis success. Without this, empty
  // pain_points/opportunities/outreach fields look identical whether the AI
  // failed to write them or correctly reported "nothing found". Defaults to
  // 'ok'; route.ts overrides to 'failed' when LLM_PARSE exhausts its retry.
  ai_synthesis_status: 'ok' | 'failed'
  ai_synthesis_failure_reason?: string

  // Diagnostic-only, see ServiceEvidenceDebug above — surfaces per-service
  // weak-tier matches and the insufficientEvidence condition breakdown so a
  // past run in run-history can be inspected without re-running the
  // pipeline. Additive/internal, never rendered in ResearchCard.tsx.
  _service_evidence_debug: ServiceEvidenceDebug

  _raw: Record<string, unknown>
}

// ── Signal derivation ─────────────────────────────────────────

function deriveDetectedFactors(
  llmFactors: Partial<DetectedFactors>,
  flat: Record<string, unknown>,
  evidence: EvidenceItem[],
): Partial<DetectedFactors> {
  const f: Partial<DetectedFactors> = { ...llmFactors }

  const growthSignals  = Array.isArray(flat.growth_signals)                 ? flat.growth_signals  as Array<Record<string, unknown>> : []
  const hiringSignals  = Array.isArray(flat.hiring_signals)                 ? flat.hiring_signals  as Array<Record<string, unknown>> : []
  const digitalSignals = Array.isArray(flat.digital_transformation_signals) ? flat.digital_transformation_signals as Array<Record<string, unknown>> : []
  const bizSignals     = Array.isArray(flat.business_signals)               ? flat.business_signals as Array<Record<string, unknown>> : []

  if (growthSignals.length > 0) {
    f.growth_signal = true
    if (growthSignals.some(s => /capacity/.test(String(s.type ?? '')))) f.capacity_expansion = true
  }
  if (hiringSignals.length > 0) f.hiring_signal = true
  if (digitalSignals.length > 0) {
    f.digital_transformation = true
    for (const sig of digitalSignals) {
      const t = String(sig.type ?? '').toLowerCase()
      if (/industry.?40|industry_40|smart_factory|iot_investment|mes/.test(t)) f.industry_40_initiative = true
      if (/automation_investment|automation/.test(t)) { f.automation_keywords = true; f.technology_investment = true }
      if (/erp|mes|iot|technology/.test(t)) f.technology_investment = true
    }
  }
  if (bizSignals.length > 0 && bizSignals.some(s => /acquisition|funding|partnership|sustainability/.test(String(s.type ?? '')))) {
    f.recent_news_or_event = true
  }

  // Pass 2: company-subject evidence only
  const companyEvidence = evidence.filter(isCompanySubjectEvidence)
  for (const ev of companyEvidence) {
    const cat = String(ev.category ?? '').toLowerCase()
    switch (cat) {
      case 'growth': case 'expansion': f.growth_signal = true; break
      case 'capacity_expansion': f.growth_signal = true; f.capacity_expansion = true; break
      case 'hiring': f.hiring_signal = true; break
      case 'digital_transformation': case 'digital': f.digital_transformation = true; break
      case 'automation': f.automation_keywords = true; break
      case 'ai': case 'ai_mention': f.ai_mention = true; break
      case 'multi_location': f.multi_location_operations = true; break
      case 'technology': case 'technology_investment': f.technology_investment = true; break
      case 'news': case 'recent_news': f.recent_news_or_event = true; break
    }
    const q = String(ev.quote ?? '').toLowerCase()
    if (/industry[\s-]*4\.0|smart[\s-]*factory|iiot|digital[\s-]*twin/.test(q)) { f.digital_transformation = true; f.industry_40_initiative = true }
    if (/artificial\s+intelligence|ai[\s-]powered|machine\s+learning/.test(q)) f.ai_mention = true
    if (/automat(?:ion|ed|ing)|robot(?:ics)?|autonomous/.test(q)) f.automation_keywords = true
    if (/digit(?:al\s+transform|ali[sz])/.test(q)) f.digital_transformation = true
    if (/(?:multiple|new|additional|expand\w*)\s+(?:plant|facilit|locat|campus|site)/.test(q)) f.multi_location_operations = true
    if (/technolog\w+\s+(?:invest|capex|deploy|rollout)|erp\s|scada|plc[\s,]/.test(q)) f.technology_investment = true
  }

  // Pass 3: signal text scan
  const allSigText = [...growthSignals, ...hiringSignals, ...digitalSignals, ...bizSignals]
    .map(s => `${String(s.evidence ?? '')} ${String(s.type ?? '')}`).join(' ').toLowerCase()
  if (/industry[\s-]*4\.0|smart[\s-]*factory|iiot|digital[\s-]*twin/.test(allSigText)) { f.digital_transformation = true; f.industry_40_initiative = true }
  if (/artificial\s+intelligence|ai[\s-]powered|machine\s+learning/.test(allSigText)) f.ai_mention = true
  if (/automat(?:ion|ed|ing)|robot(?:ics)?/.test(allSigText)) f.automation_keywords = true
  if (/digit(?:al\s+transform|ali[sz])/.test(allSigText)) f.digital_transformation = true
  if (/erp|scada|mes|technolog\w+\s+(?:invest|capex|deploy)/.test(allSigText)) f.technology_investment = true
  if (/(?:multiple|several|additional|new)\s+(?:plant|facilit|locat|campus|site)/.test(allSigText)) f.multi_location_operations = true

  // Pass 4 removed: scanning LLM-generated company_summary contaminates deterministic
  // factors with narrative intent rather than evidence. Passes 1-3 cover all legitimate pathways.

  return f
}

// ── Primitive coercion helpers (module-level) ────────────────

const str = (v: unknown, fallback = ''): string =>
  v == null ? fallback : typeof v === 'string' ? v.trim() || fallback : String(v).trim() || fallback
const num = (v: unknown, fallback = 0): number =>
  v == null ? fallback : typeof v === 'number' ? v : parseFloat(String(v)) || fallback
const arr = <T>(v: unknown): T[] =>
  Array.isArray(v) ? (v as T[]) : []

// Numeric/stat-shaped tokens (percentages, multipliers, day counts, crore
// figures) — used by the outreach_draft grounding check below to detect
// when the LLM cites a stat that doesn't trace back to the matched Demaze
// proof point's real outcomes. Sign-stripped so "-54%" and "+11%" compare
// on magnitude, since a paraphrase flipping the sign isn't a fabrication.
const STAT_TOKEN_RE = /[+-]?\d+(?:\.\d+)?\s?(?:%|x\b|days?\b|hours?\b|hrs?\b|cr\b)/gi
const extractStatTokens = (text: string): string[] =>
  (text.match(STAT_TOKEN_RE) ?? []).map(t => t.replace(/^[+-]/, '').replace(/\s+/g, '').toLowerCase())

// ── Section flattening ─────────────────────────────────────────

// SECTION_KEYS maps section wrapper names ONLY — NOT output field names.
// Output field names (pain_points, outreach_angle, etc.) must NOT appear here.
// Adding them causes flattenSections() to silently drop arrays with those names
// when the LLM response also contains any section-wrapped object (e.g. company_profile).
const SECTION_KEYS: Record<string, string[]> = {
  profile:    ['COMPANY PROFILE', 'Company Profile', 'company_profile', 'PROFILE'],
  evidence:   ['EVIDENCE', 'Evidence', 'evidence_extraction', 'EVIDENCE EXTRACTION'],
  signals:    ['SIGNALS', 'Signals', 'SIGNAL DETECTION'],
  factors:    ['DETECTED FACTORS', 'Detected Factors', 'FACTORS'],
  pain:       ['PAIN POINTS', 'Pain Points'],
  chains:     ['REASONING CHAINS', 'Reasoning Chains'],
  intel:      ['INTELLIGENCE', 'Intelligence', 'AI OPPORTUNITIES'],
  why_demaze: ['WHY DEMAZE', 'Why Demaze', 'WHY CONTACT'],
  outreach:   ['OUTREACH INTELLIGENCE', 'Outreach Intelligence', 'OUTREACH'],
  contacts:   ['CONTACTS', 'Contact Prioritization', 'CONTACT PRIORITIZATION'],
  scoring:    ['SCORING', 'Scoring', 'SCORE EXPLANATIONS'],
  metadata:   ['METADATA', 'Metadata', 'URGENCY'],
}

function flattenSections(raw: Record<string, unknown>): Record<string, unknown> {
  const allSectionKeys = Object.values(SECTION_KEYS).flat()
  const foundSections = allSectionKeys.filter(
    k => k in raw && typeof raw[k] === 'object' && raw[k] !== null && !Array.isArray(raw[k])
  )
  if (foundSections.length === 0) return raw
  const flat: Record<string, unknown> = {}
  for (const key of foundSections) Object.assign(flat, raw[key] as object)
  for (const [key, value] of Object.entries(raw)) {
    if (!allSectionKeys.includes(key)) flat[key] = value
  }
  return flat
}

// ── Main export ────────────────────────────────────────────────

export function normalizeAnalysisResult(
  raw: Record<string, unknown>
): NormalizedAnalysis {
  const flat = flattenSections(raw)

  // ── Company profile ──────────────────────────────────────────
  const company_name          = str(flat.company_name)
  const company_summary       = str(flat.company_summary)
  const industry              = str(flat.industry)
  const sub_industry          = str(flat.sub_industry)
  const company_type          = str(flat.business_model ?? flat.company_type)
  const company_size_estimate = str(flat.company_size_estimate)
  const headquarters_location = str(flat.headquarters_location)

  // ── Evidence ─────────────────────────────────────────────────
  const evidence = arr<EvidenceItem>(flat.evidence)

  // ── Business model classification (code) ────────────────────
  const rawBma = flat.business_model_analysis
  let business_model_analysis: NormalizedAnalysis['business_model_analysis'] = null
  if (rawBma && typeof rawBma === 'object') {
    const bma = rawBma as Record<string, unknown>
    business_model_analysis = {
      model_type:                  str(bma.model_type),
      value_chain_position:        str(bma.value_chain_position),
      primary_customers:           str(bma.primary_customers),
      core_operational_activities: arr<string>(bma.core_operational_activities),
      strategic_pressures:         arr<string>(bma.strategic_pressures),
    }
  }
  // Canonical business model type from code classifier
  const rawModelType = business_model_analysis?.model_type ?? str(flat.industry)
  const business_model_type = classifyBusinessModel(rawModelType)
  const modelProfile = getBusinessModelProfile(business_model_type)

  // ── Detected factors ─────────────────────────────────────────
  const llmFactors: Partial<DetectedFactors> = (
    flat.detected_factors && typeof flat.detected_factors === 'object'
      ? flat.detected_factors as Partial<DetectedFactors>
      : {}
  )

  // 4-pass derivation first
  const derivedFactors = deriveDetectedFactors(llmFactors, flat, evidence)

  // Then filter out false positives for this business model
  // (e.g., SaaS companies should not have industry_40_initiative = true)
  const detected_factors = filterSignalsForBusinessModel(
    derivedFactors as Partial<Record<string, boolean>>,
    business_model_type,
  ) as Partial<DetectedFactors>

  // ── Signal clustering (code) ─────────────────────────────────
  // Prefer companyProfile from extractor (multi-dimensional) over single-label BusinessModelType.
  const extractorProfile = (flat._extractor as { companyProfile?: CompanyProfile } | undefined)?.companyProfile
  const profileForClustering: CompanyProfile = extractorProfile ?? businessModelToProfile(business_model_type)
  const signal_clusters = clusterSignals(
    detected_factors as Partial<Record<string, boolean>>,
    profileForClustering,
  )

  // ── Strategic challenges from business model profile ─────────
  const strategic_challenges = modelProfile.strategic_challenges

  // ── Deterministic opportunities (code) ──────────────────────
  // v3: gates directly against the 8 confirmed Demaze services via
  // service-evidence.ts, not signal_clusters (see opportunity-engine.ts header).
  const serviceEvidenceContent = str(flat._service_evidence_content) || ''
  const growthOrHiringSignal = Boolean(detected_factors.growth_signal || detected_factors.hiring_signal)
  let deterministic_opportunities = generateDeterministicOpportunities(
    serviceEvidenceContent,
    profileForClustering,
    growthOrHiringSignal,
  )

  // ── Insufficient Evidence outcome (EVIDENCE_SOURCE_STRATEGY.md) ─────────
  // A company with essentially no usable evidence (AS Agri and Aqua: single-page
  // Google Sites, companySubjectCount=0, no signals, no named contacts, no facility
  // data) can still reach this point with clusters=[] and thus opportunities=[]
  // today — but nothing distinguishes that from "thoroughly analyzed, genuinely
  // nothing relevant found." Forcing a recommendation in the thin case reads as
  // presumptuous, not sharp (see the benchmark review). This flag makes the
  // distinction explicit and defensively re-suppresses opportunities even if
  // something weak slipped through clustering.
  const extractorData = flat._extractor as Partial<ExtractorResult> | undefined
  const hasFacilityEvidence =
    (profileForClustering.operations.manufacturing_plants_count ?? 0) > 0 ||
    (profileForClustering.operations.countries_present ?? 0) > 0
  const insufficientEvidence =
    (extractorData?.companySubjectCount ?? 0) === 0 &&
    (extractorData?.signals?.length ?? 0) === 0 &&
    (extractorData?.leadershipContacts?.length ?? 0) === 0 &&
    !hasFacilityEvidence
  const evidence_sufficiency: 'sufficient' | 'insufficient' = insufficientEvidence ? 'insufficient' : 'sufficient'
  if (insufficientEvidence) deterministic_opportunities = []

  // The SAME capped, blended content pool the LLM was actually shown (see
  // evidence-extractor.ts's 2026-07-22 websitePreview rewrite) — used to
  // quote-verify both the LLM-verified opportunity path (below) and
  // pain_points (further below). Deliberately NOT `serviceEvidenceContent`
  // above, which is the larger unbounded pool service-evidence.ts's regex
  // gate uses — verifying against that would let a claim pass on content the
  // LLM never actually saw and couldn't have legitimately quoted from.
  const llmContentPool = str(extractorData?.websitePreview) || ''

  // ── Service Evidence Debug (diagnostic, internal-only) ──────────────
  // Re-runs detectServiceEvidence() (same call generateDeterministicOpportunities()
  // already makes above, cheap pure regex, no I/O) purely to keep the full
  // per-service result — including 'weak'-tier matches and disqualification
  // reasons that generateDeterministicOpportunities() itself discards after
  // filtering to 'medium'/'strong'. See ServiceEvidenceDebug's own doc comment.
  const serviceEvidenceDebugResults: ServiceThresholdResult[] = detectServiceEvidence(
    serviceEvidenceContent,
    profileForClustering,
    growthOrHiringSignal,
  )
  const _service_evidence_debug: ServiceEvidenceDebug = {
    services: serviceEvidenceDebugResults.map(r => ({
      service: r.service,
      threshold: r.threshold,
      surfaced: !r.disqualified && (r.threshold === 'medium' || r.threshold === 'strong'),
      disqualified: r.disqualified,
      disqualifier_matched: r.disqualifier_matched,
      evidence: r.evidence,
    })),
    insufficient_evidence: {
      fired: insufficientEvidence,
      conditions: {
        companySubjectCount_zero: (extractorData?.companySubjectCount ?? 0) === 0,
        signals_zero: (extractorData?.signals?.length ?? 0) === 0,
        leadershipContacts_zero: (extractorData?.leadershipContacts?.length ?? 0) === 0,
        no_facility_evidence: !hasFacilityEvidence,
      },
    },
  }

  // ── Confidence & why_now ─────────────────────────────────────
  const confidence_level = str(flat.confidence_level) || 'low'
  const rawWhyNow = flat.why_now
  let why_now_explanation: string
  let why_now_score_raw: number
  if (typeof rawWhyNow === 'object' && rawWhyNow !== null) {
    const w = rawWhyNow as Record<string, unknown>
    why_now_explanation = str(w.explanation ?? w.why_now ?? w.text)
    why_now_score_raw   = num(w.score ?? flat.why_now_score)
  } else {
    why_now_explanation = str(rawWhyNow)
    why_now_score_raw   = num(flat.why_now_score)
  }

  // ── Score explanations ───────────────────────────────────────
  const rawScoreExpl = flat.score_explanations
  let scoreExpl = { company_fit: '', automation_opportunity: '', outreach_priority: '' }
  if (rawScoreExpl && typeof rawScoreExpl === 'object') {
    const se = rawScoreExpl as Record<string, unknown>
    scoreExpl = {
      company_fit:            str(se.company_fit),
      automation_opportunity: str(se.automation_opportunity),
      outreach_priority:      str(se.outreach_priority),
    }
  }

  // ── Deterministic scoring ────────────────────────────────────
  // Apply ICP score modifier from business model profile
  const adjustedFactors = { ...detected_factors }
  // Boost multi_location if 2+ plant-related clusters active
  if (signal_clusters.filter(c => c.id === 'multi_site_coordination').length > 0) {
    adjustedFactors.multi_location_operations = true
  }

  const computed = computeScores(
    adjustedFactors,
    why_now_score_raw,
    confidence_level,
    why_now_explanation,
    scoreExpl.company_fit,
    scoreExpl.automation_opportunity,
    scoreExpl.outreach_priority,
  )

  const company_fit = computed.company_fit

  // Apply cluster-based opportunity floor.
  // AUTOMATION_OPP_FACTORS are manufacturing-keyword-based and score near 0 for
  // conglomerates/SaaS even when multiple high-tier clusters are present.
  // The floor ensures score ↔ opportunity consistency.
  const SCORE_CAPS: Record<string, number> = { high: 100, medium: 82, low: 50 }
  const clusterFloor = computeClusterOpportunityFloor(signal_clusters)
  const rawOppValue = computed.automation_opportunity.value
  const boostedOppValue = Math.min(
    Math.max(rawOppValue, clusterFloor),
    SCORE_CAPS[confidence_level] ?? 100,
  )
  const automation_opportunity: ScoreWithBreakdown = boostedOppValue > rawOppValue
    ? {
        ...computed.automation_opportunity,
        value: boostedOppValue,
        label: scoreLabel(boostedOppValue),
        rationale: computed.automation_opportunity.rationale
          ? `${computed.automation_opportunity.rationale} [Score boosted to ${boostedOppValue} by ${signal_clusters.length} active signal cluster(s)]`
          : `Score derived from ${signal_clusters.length} active signal cluster(s) (cluster floor: ${clusterFloor})`,
      }
    : computed.automation_opportunity

  // Recompute outreach priority with boosted opp score
  const whyNowCapped = computed.why_now.score
  const priorityRaw = (company_fit.value * 0.35) + (boostedOppValue * 0.30) + (whyNowCapped * 10 * 0.35)
  const outreach_priority_score = Math.min(Math.round(priorityRaw), SCORE_CAPS[confidence_level] ?? 100)
  const outreach_priority_label = scoreLabel(outreach_priority_score)
  const outreach_priority_methodology = computed.outreach_priority.rationale ?? ''
  const why_now = {
    explanation:   computed.why_now.explanation,
    score:         computed.why_now.score,
    urgency_label: computed.why_now.urgency_label,
  }
  const score_breakdown = {
    company_fit:            company_fit.breakdown,
    automation_opportunity: automation_opportunity.breakdown,
  }

  // ── Signals ──────────────────────────────────────────────────
  const signals        = mergeSignals(flat)
  const signal_summary = str(flat.signal_summary)

  // ── Pain points (2026-07-22, Session 3 — see CLAUDE.md "Research-quality
  // initiative") ──────────────────────────────────────────────────────────
  // Was a pure passthrough of the LLM's flat-string output, no evidence gate
  // at all — the prompt's old "ALWAYS 3-5, NEVER []" rule meant every company
  // got an identically-shaped, padded pain-point list regardless of how much
  // real evidence existed. analyze-v2.ts now asks for structured objects
  // (title/claim_type/evidence/confidence/reasoning) and no longer forces a
  // fixed count. Gating here mirrors the opportunities Path B discipline
  // above: 'observed' claims must quote-verify against llmContentPool (the
  // exact content the LLM was shown) or they're dropped; 'inferred' claims
  // are kept as legitimate business-model reasoning without needing a quote.
  // On genuinely insufficient evidence, force []  — implementing the
  // "arguably correct" behavior a comment elsewhere in this file (see
  // "Insufficient Evidence outcome" above) already flagged but never wired up.
  const rawPainPoints = flat.pain_points
  let pain_points_structured: StructuredPainPoint[] = []
  let pain_points: string[] = []
  const painPointWarnings: string[] = []
  if (insufficientEvidence) {
    // pain_points stays [] — same suppression discipline as
    // deterministic_opportunities above; genuinely thin evidence gets an
    // honest empty result, not a padded generic list.
  } else if (Array.isArray(rawPainPoints)) {
    if (rawPainPoints.length > 0 && typeof rawPainPoints[0] === 'object') {
      const structuredRaw = rawPainPoints as Array<Record<string, unknown>>
      let droppedUngrounded = 0
      pain_points_structured = structuredRaw
        .map((p): StructuredPainPoint | null => {
          const title = str(p.title) || str(p)
          if (!title) return null
          const claimType = p.claim_type === 'observed' || p.claim_type === 'inferred' ? p.claim_type : undefined
          const evidence = str(p.evidence)
          if (claimType === 'observed') {
            if (!isQuoteGrounded(evidence, llmContentPool)) {
              droppedUngrounded++
              return null
            }
          }
          return {
            title,
            confidence: (p.confidence === 'high' || p.confidence === 'medium' || p.confidence === 'low') ? p.confidence : 'low',
            evidence_id: str(p.evidence_id),
            evidence,
            reasoning: str(p.reasoning),
            claim_type: claimType,
          }
        })
        .filter((p): p is StructuredPainPoint => p !== null)
      if (droppedUngrounded > 0) {
        painPointWarnings.push(
          `pain_points: dropped ${droppedUngrounded} item(s) claiming an observed quote that wasn't found in source content`
        )
      }
      pain_points = pain_points_structured.map(p => p.title)
    } else {
      // Backward-compat: old flat-string shape from a caller/cached run that
      // predates this session's schema change. No evidence field exists on
      // a bare string, so it can't be quote-gated — passed through as-is.
      pain_points = rawPainPoints.map(p => str(p))
    }
  }

  // ── Reasoning chains ─────────────────────────────────────────
  const reasoning_chains = arr<ReasoningChain>(flat.reasoning_chains)

  // ── Opportunities: deterministic skeleton + LLM enrichment ──
  // OPPORTUNITY_CATALOG (opportunity-engine.ts) is the canonical source.
  // The deterministic list defines WHAT opportunities exist (title, entry_point, relevance, category).
  // The LLM enriches description, evidence, and expected_impact where titles match.
  // LLM-only titles that do not match any catalog entry are discarded.
  const rawOpps = flat.ai_opportunities ?? flat.opportunities
  const llmOpportunities = normalizeOpportunities(rawOpps)

  // Path A matches are tracked by reference so Path B (below) can operate on
  // the genuine remainder — LLM opportunities that never matched ANY
  // deterministic-catalog title — instead of re-considering entries Path A
  // already consumed.
  const matchedLlmOpportunities = new Set<NormalizedAnalysis['opportunities'][number]>()
  const opportunitiesFromDeterministic: NormalizedAnalysis['opportunities'] = deterministic_opportunities.map(d => {
    const llmMatch = llmOpportunities.find(l => titleMatch(d.title, l.title))
    if (llmMatch) matchedLlmOpportunities.add(llmMatch)
    return {
      title:             d.title,                                         // canonical from OPPORTUNITY_CATALOG
      description:       llmMatch?.description || d.strategic_challenge,  // LLM narrative; catalog challenge as fallback
      confidence:        llmMatch?.confidence,
      evidence_id:       llmMatch?.evidence_id,
      evidence:          llmMatch?.evidence,
      reasoning:         d.llm_explanation_prompt,                        // always catalog prompt — not LLM-invented
      expected_impact:   llmMatch?.expected_impact ?? '',
      entry_point:       d.entry_point,                                   // always catalog entry point
      category:          d.category,
      pain_point_mapped: llmMatch?.pain_point_mapped,
      relevance:         d.relevance,                                     // always catalog relevance (High/Medium/Low)
      evidence_anchor:   undefined,
      estimated_impact:  '',
      source:            'deterministic' as const,
      deterministic_id:  d.id,
      claim_type:        llmMatch?.claim_type,
      observed_basis:    llmMatch?.observed_basis,
      inferred_from:     llmMatch?.inferred_from,
      opportunity_confidence: llmMatch?.opportunity_confidence ?? llmMatch?.confidence,
      demaze_fit_score:  llmMatch?.demaze_fit_score,
    }
  })

  // ── Path B: evidence-grounded LLM opportunities (2026-07-22, Session 2;
  // extended same day after live RIL usage exposed a real gap, see below) ──
  // Additive to Path A above, which stays completely untouched — this exists
  // because service-evidence.ts's regex catalog (Path A's gate) was built and
  // tuned against 6 benchmark companies and doesn't generalize; most real
  // companies' LLM-proposed opportunities were being silently discarded even
  // when well-reasoned and evidence-backed. See CLAUDE.md "Research-quality
  // initiative" for the full root-cause writeup.
  //
  // Common gate for both sub-paths below: never already matched by Path A,
  // service_line must be exactly one of the 8 confirmed Demaze services
  // (never a 9th invented one), and the whole path is suppressed entirely
  // when insufficientEvidence fires, same as Path A.
  const opportunityCandidates = insufficientEvidence
    ? []
    : llmOpportunities
        .filter(l => !matchedLlmOpportunities.has(l))
        .filter(l => l.service_line && CONFIRMED_SERVICE_NAMES.includes(l.service_line))

  function shapeOpportunity(
    l: NormalizedAnalysis['opportunities'][number],
    relevance: string,
    evidence_anchor: string | undefined,
    source: 'llm_verified' | 'llm_inferred',
  ): NormalizedAnalysis['opportunities'][number] {
    return {
      title:             l.title,
      description:       l.description,
      confidence:        l.confidence,
      evidence_id:       l.evidence_id,
      evidence:          l.evidence,
      reasoning:         l.reasoning,
      expected_impact:   l.expected_impact ?? '',
      entry_point:       l.entry_point,
      category:          l.service_line,
      pain_point_mapped: l.pain_point_mapped,
      relevance,
      evidence_anchor,
      estimated_impact:  l.estimated_impact ?? '',
      source,
      deterministic_id:  undefined,
      claim_type:        l.claim_type,
      observed_basis:    l.observed_basis,
      inferred_from:     l.inferred_from,
      opportunity_confidence: l.opportunity_confidence ?? l.confidence,
      demaze_fit_score:  l.demaze_fit_score,
      service_line:      l.service_line,
    }
  }

  // Sub-path B1: claim_type 'observed' — its evidence quote is independently
  // verified (verifyQuoteInContent) against llmContentPool, the SAME capped,
  // blended content pool the LLM was actually shown (see evidence-extractor
  // .ts's 2026-07-22 websitePreview rewrite), not the larger unbounded
  // `_service_evidence_content` pool, since that would let verification pass
  // on content the LLM never saw and couldn't have legitimately quoted from.
  // relevance is capped below a real regex-strong match, so this path can
  // only fill gaps Path A found nothing for, never outrank it.
  const opportunitiesFromLlmVerified: NormalizedAnalysis['opportunities'] = opportunityCandidates
    .filter(l => l.claim_type === 'observed')
    .map(l => ({ opp: l, verification: verifyQuoteInContent(l.evidence ?? '', llmContentPool) }))
    .filter(({ verification }) => verification.tier !== 'none')
    .map(({ opp: l, verification }) =>
      shapeOpportunity(l, verification.tier === 'exact' ? 'Medium' : 'Low', verification.matchedSnippet, 'llm_verified')
    )

  // Sub-path B2 (found+fixed 2026-07-22, same day as B1, via live RIL usage):
  // claim_type 'inferred' opportunities were being discarded entirely — a
  // real gap, not intentional caution. A live RIL run showed the LLM
  // proposing 5 specific, RIL-grounded opportunities (e.g. "Integrating
  // new-energy assets with legacy oil-to-chemicals systems", tied to RIL's
  // real, publicly known Green Energy Giga Complex) that were ALL tagged
  // 'inferred' with no quote — none of B1's above requires a quote for
  // 'inferred' by design (there isn't one to verify), so all 5 were silently
  // dropped, leaving 0 opportunities despite genuinely good reasoning.
  // pain_points already proved 'inferred' claims can be surfaced safely when
  // honestly labeled (Session 3, same file) — this closes the asymmetry.
  // Gate: `inferred_from` must be a real, substantive stated reasoning basis
  // (not empty, not a token placeholder) — same "don't fabricate a reason"
  // discipline as everything else in this merge, just without a literal
  // quote to check. relevance is always 'Low' — a step below even the
  // fuzzy-matched observed tier, since this is reasoning, not evidence.
  const opportunitiesFromLlmInferred: NormalizedAnalysis['opportunities'] = opportunityCandidates
    .filter(l => l.claim_type === 'inferred')
    .filter(l => (l.inferred_from ?? '').trim().length >= 15)
    .map(l => shapeOpportunity(l, 'Low', undefined, 'llm_inferred'))

  const opportunities: NormalizedAnalysis['opportunities'] = [
    ...opportunitiesFromDeterministic,
    ...opportunitiesFromLlmVerified,
    ...opportunitiesFromLlmInferred,
  ]
  console.log(`[normalize:opps] deterministic=${deterministic_opportunities.length} | llm_parsed=${llmOpportunities.length} | llm_enriched=${opportunitiesFromDeterministic.filter(o => o.evidence).length} | llm_verified=${opportunitiesFromLlmVerified.length} | llm_inferred=${opportunitiesFromLlmInferred.length}`)

  const competitive_context = str(flat.competitive_context)

  // ── Competitors (Phase 2 item 1, business-understanding rebuild 2026-07-16) ──
  // route.ts's discoverCompetitorsFromBusinessProfile() call supplies
  // code-derived skeletons (name/confidence/source_urls/website + a fallback
  // why_they_compete) via `_competitor_discovery`. The LLM's `competitors`
  // narration (from the [COMPETITOR CANDIDATES] prompt block, analyze-v2.ts)
  // is matched onto them by name and, when found, overwrites why_they_compete/
  // market_position/differentiator — same "LLM narrative, code text as
  // fallback" pattern as the opportunities merge above
  // (`llmMatch?.description || d.strategic_challenge`). An LLM entry whose
  // name doesn't match any code-derived skeleton is discarded — same
  // anti-hallucination discipline as deterministic_opportunities' titleMatch
  // discard, just exact-ish (normalized) name matching instead of keyword
  // overlap, since competitor identity needs higher precision than a title.
  const competitorDiscovery = flat._competitor_discovery as CompetitorDiscoveryResult | undefined
  const llmCompetitors = arr<Record<string, unknown>>(flat.competitors)

  let competitorsLlmEnrichedCount = 0
  const competitors: CompetitorProfile[] = (competitorDiscovery?.competitors ?? []).map(c => {
    const llmMatch = llmCompetitors.find(l => identityNameMatch(str(l.name), c.name))
    if (llmMatch) competitorsLlmEnrichedCount++
    const category = llmMatch?.category ? str(llmMatch.category) : ''
    return {
      name: c.name,
      domain: c.domain,
      // website is resolved directly onto the code-derived skeleton in
      // route.ts (discoverCompanyWebsite()) — never part of the LLM merge.
      website: c.website,
      why_they_compete: (llmMatch && str(llmMatch.why_they_compete)) || c.why_they_compete,
      market_position:  llmMatch?.market_position ? str(llmMatch.market_position) : undefined,
      differentiator:   llmMatch?.differentiator ? str(llmMatch.differentiator) : undefined,
      category: (category === 'direct' || category === 'growing' || category === 'established') ? category : undefined,
      similarities:     llmMatch?.similarities ? str(llmMatch.similarities) : undefined,
      relative_size:    llmMatch?.relative_size ? str(llmMatch.relative_size) : undefined,
      confidence: c.confidence,
      source_urls: c.source_urls,
    }
  })
  const competitor_sufficiency: CompetitorSufficiency = competitorDiscovery?.sufficiency ?? 'insufficient'
  console.log(`[normalize:competitors] discovered=${competitorDiscovery?.competitors.length ?? 0} | llm_parsed=${llmCompetitors.length} | llm_enriched=${competitorsLlmEnrichedCount}`)

  // ── ICP Segments (Phase 2 item 2) ──────────────────────────────
  // Same shape as the competitors merge above: route.ts's
  // discoverICPSegments() supplies code-derived skeletons
  // (name/confidence/source_urls/signals + a fallback reason) via
  // `_icp_discovery`. The LLM's `icp_segments` narration (from the
  // [ICP CANDIDATES] prompt block, analyze-v2.ts) is matched onto them by
  // normalized name and, when found, overwrites reason/criteria/
  // buying_indicators/example_companies. An LLM entry whose name doesn't
  // match any code-derived skeleton is discarded — same anti-hallucination
  // discipline as the competitors merge.
  const icpDiscovery = flat._icp_discovery as ICPDiscoveryResult | undefined
  const llmIcpSegments = arr<Record<string, unknown>>(flat.icp_segments)

  const validTier = (v: unknown): 'high' | 'medium' | 'low' | undefined =>
    (v === 'high' || v === 'medium' || v === 'low') ? v : undefined

  let icpLlmEnrichedCount = 0
  const icp_segments: ICPSegment[] = (icpDiscovery?.segments ?? []).map(s => {
    const llmMatch = llmIcpSegments.find(l => identityNameMatch(str(l.name), s.name))
    if (llmMatch) icpLlmEnrichedCount++
    return {
      name: s.name,
      reason: (llmMatch && str(llmMatch.reason)) || s.reason,
      criteria: llmMatch?.criteria ? str(llmMatch.criteria) : undefined,
      signals: s.signals,
      buying_indicators: llmMatch?.buying_indicators ? str(llmMatch.buying_indicators) : undefined,
      example_companies: Array.isArray(llmMatch?.example_companies) ? arr<string>(llmMatch.example_companies) : undefined,
      use_cases: llmMatch?.use_cases ? str(llmMatch.use_cases) : undefined,
      market_attractiveness: validTier(llmMatch?.market_attractiveness),
      priority: validTier(llmMatch?.priority),
      confidence: s.confidence,
      source_urls: s.source_urls,
    }
  })
  const icp_sufficiency: ICPSufficiency = icpDiscovery?.sufficiency ?? 'insufficient'
  console.log(`[normalize:icp] discovered=${icpDiscovery?.segments.length ?? 0} | llm_parsed=${llmIcpSegments.length} | llm_enriched=${icpLlmEnrichedCount}`)

  // ── Market Intelligence (Phase 2 item 6) ───────────────────────
  // route.ts's discoverMarketIntelligence() call supplies the final items
  // directly via `_market_intelligence` — no LLM narration layer, so
  // (unlike competitors/icp_segments above) there is no name-match merge
  // step here, just a passthrough with a safe empty default.
  const marketIntelligence = flat._market_intelligence as MarketIntelligenceResult | undefined
  const market_intelligence: MarketIntelItem[] = marketIntelligence?.items ?? []
  const market_intelligence_sufficiency: MarketIntelSufficiency = marketIntelligence?.sufficiency ?? 'insufficient'
  console.log(`[normalize:market_intelligence] items=${market_intelligence.length} | sufficiency=${market_intelligence_sufficiency}`)

  // ── Company Offerings — what the researched company itself sells ──────
  // Pure passthrough from extractSignals() via `_extractor` (extractorData,
  // computed above), same shape as market_intelligence — no LLM merge step.
  const company_offerings: string[] = extractorData?.companyOfferings ?? []

  // ── Leadership Contacts — named individuals from the company's own site ─
  // Pure passthrough, same shape as company_offerings above. Promoted to a
  // top-level field (2026-07-19) so it survives as a normal part of a saved
  // run instead of only being reachable via the internal `_raw._extractor`
  // passthrough — see the interface comment above for why.
  const leadership_contacts: LeadershipContact[] = extractorData?.leadershipContacts ?? []

  // ── Business Profile — passthrough from extractBusinessProfile() via
  // `_business_profile` (route.ts), same passthrough shape as
  // market_intelligence above — it's already an LLM output, nothing to merge.
  const business_profile: CompanyBusinessProfile = (flat._business_profile as CompanyBusinessProfile | undefined) ?? emptyBusinessProfile()

  // ── Why Demaze V4 ────────────────────────────────────────────
  const rawWhyDemaze = flat.why_demaze
  let why_demaze: WhyDemaze = { reasons: [], relevant_services: [] }
  if (rawWhyDemaze && typeof rawWhyDemaze === 'object') {
    const wd = rawWhyDemaze as Record<string, unknown>
    const rawReasons = arr<unknown>(wd.reasons)
    // Handle both v3 (string array) and v4 (object array)
    const reasons = rawReasons.map(r => {
      if (typeof r === 'string') return r
      if (r && typeof r === 'object') {
        const ro = r as Record<string, unknown>
        return {
          signal:               str(ro.signal),
          evidence:             str(ro.evidence),
          evidence_tier:        ro.evidence_tier ? str(ro.evidence_tier) : undefined,
          business_implication: str(ro.business_implication),
          strategic_challenge:  ro.strategic_challenge ? str(ro.strategic_challenge) : undefined,
          recommended_service:  str(ro.recommended_service),
          confidence:           (str(ro.confidence) || 'medium') as 'high' | 'medium' | 'low',
        } satisfies WhyDemazeReason
      }
      return String(r)
    })
    why_demaze = {
      reasons:          reasons,
      relevant_services: arr<string>(wd.relevant_services),
      summary:          wd.summary ? str(wd.summary) : undefined,
    }
  }

  // ── Outreach intelligence ────────────────────────────────────
  const rawOI = flat.outreach_intelligence
  let outreach_intelligence: OutreachIntelligence = {
    trigger: '', problem: '', service: '', opening_angle: '', why_now: '',
  }
  if (rawOI && typeof rawOI === 'object') {
    const oi = rawOI as Record<string, unknown>
    outreach_intelligence = {
      trigger:        str(oi.trigger),
      problem:        str(oi.problem),
      service:        str(oi.service),
      opening_angle:  str(oi.opening_angle),
      why_now:        str(oi.why_now),
    }
  }
  const outreach_angle = str(flat.outreach_angle ?? outreach_intelligence.opening_angle)

  // ── Flags & warnings ─────────────────────────────────────────
  // Declared ahead of outreach_draft below so its grounding check (safety
  // net 2) can push directly into the same array.
  const content_quality_flags: string[] = arr<string>(flat.content_quality_flags)
  const validation_warnings: string[]   = arr<string>(flat.validation_warnings)
  validation_warnings.push(...painPointWarnings)

  // ── Outreach draft (2026-07-16) ──────────────────────────────
  // Safety net 1: matched_proof_point_id is only trusted if it echoes a real
  // id from the candidate list route.ts actually gave the LLM
  // (_proof_point_candidates, from matchProofPoints()) — same
  // belt-and-suspenders discipline as research-quality.ts's self-name-
  // collision check, protecting against the LLM echoing a malformed or
  // invented id despite the prompt's "copy exactly or leave empty" rule.
  const proofPointCandidatesRaw = arr<{ id?: unknown; outcomes?: unknown }>(flat._proof_point_candidates)
  const proofPointCandidateIds = new Set(
    proofPointCandidatesRaw.map(p => str(p?.id)).filter(Boolean)
  )
  const rawOD = flat.outreach_draft
  let outreach_draft: OutreachDraft = {
    matched_proof_point_id: '', connection_note: '', first_message: '', follow_up: '',
  }
  if (rawOD && typeof rawOD === 'object') {
    const od = rawOD as Record<string, unknown>
    const claimedId = str(od.matched_proof_point_id)
    const claimedIdValid = proofPointCandidateIds.has(claimedId)
    outreach_draft = {
      matched_proof_point_id: claimedIdValid ? claimedId : '',
      connection_note: str(od.connection_note),
      first_message:   str(od.first_message),
      follow_up:        str(od.follow_up),
    }

    // Safety net 2 (2026-07-17): even when matched_proof_point_id echoes a
    // real id, the LLM can still fabricate the stat/client text around it —
    // confirmed live (an aerospace/defense company run invented "a major
    // turbine producer" and "45%" for its outreach draft, neither of which
    // appears anywhere in demaze-proof-points.ts, despite the prompt's
    // explicit "never invent a stat" rule). Cross-check every numeric/stat-
    // shaped token in the drafted text against the matched proof point's
    // REAL outcome values; if the draft cites a stat that doesn't trace back
    // to real data, the grounding is broken — clear the id so the UI never
    // implies this text is backed by a real Demaze result, and warn loudly
    // so a human reviews it before send (send already requires explicit
    // per-batch confirmation regardless, see CLAUDE.md).
    if (claimedIdValid) {
      const matched = proofPointCandidatesRaw.find(p => str(p?.id) === claimedId)
      const outcomes = arr<{ value?: unknown; window?: unknown }>(matched?.outcomes)
      const realStatTokens = new Set(
        outcomes.flatMap(o => extractStatTokens(`${str(o?.value)} ${str(o?.window)}`))
      )
      const draftText = `${outreach_draft.connection_note} ${outreach_draft.first_message} ${outreach_draft.follow_up}`
      const draftStatTokens = extractStatTokens(draftText)
      const hasUngroundedStat = draftStatTokens.length > 0 && !draftStatTokens.some(
        t => Array.from(realStatTokens).some(r => r === t || r.includes(t) || t.includes(r))
      )
      if (hasUngroundedStat) {
        outreach_draft.matched_proof_point_id = ''
        validation_warnings.push(
          `outreach_draft cites a stat (${draftStatTokens.join(', ')}) not found in the matched proof point's real outcomes — likely fabricated, matched_proof_point_id cleared. Review before sending.`
        )
      }
    }
  }

  const llmFlagsActive     = Object.values(llmFactors).filter(Boolean).length
  const derivedFlagsActive = Object.values(detected_factors).filter(Boolean).length
  if (llmFlagsActive === 0 && derivedFlagsActive > 0) {
    validation_warnings.push(`Auto-derived ${derivedFlagsActive} detected_factor(s) — LLM provided all-false flags`)
  }
  // Warn if business model type caused signals to be filtered
  const filteredCount = Object.keys(derivedFactors).filter(
    k => Boolean((derivedFactors as Record<string, boolean>)[k]) && !Boolean((detected_factors as Record<string, boolean>)[k])
  ).length
  if (filteredCount > 0) {
    validation_warnings.push(`${filteredCount} signal(s) suppressed — not valid for ${business_model_type} business model (likely false positives from product/customer content)`)
  }

  // ── Metadata ─────────────────────────────────────────────────
  const data_quality_score = num(flat.data_quality_score)
  const data_quality_notes = str(flat.data_quality_notes)
  const pages_scraped      = arr<string>(flat.pages_scraped)
  const analyzed_at        = str(flat.analyzed_at)

  // ── SDR research fields (v5+) ─────────────────────────────────
  const recent_activity: string[] = Array.isArray(flat.recent_activity)
    ? (flat.recent_activity as unknown[]).map(a => str(a)).filter(Boolean)
    : []

  // ── Executive brief ─────────────────────────────────────────
  const rawBrief = flat.executive_brief
  let executive_brief: ExecutiveBrief | null = null
  if (rawBrief && typeof rawBrief === 'object') {
    const b = rawBrief as Record<string, unknown>
    executive_brief = {
      what_we_observed: arr<string>(b.what_we_observed),
      what_it_means:    arr<string>(b.what_it_means),
      what_to_sell:     str(b.what_to_sell),
      why_now:          str(b.why_now),
      overall_confidence: (str(b.overall_confidence) || 'medium') as 'high' | 'medium' | 'low',
    }
  }

  const withoutQuality: Omit<NormalizedAnalysis, 'research_quality'> = {
    company_name, company_summary, industry, sub_industry, company_type,
    company_size_estimate, headquarters_location,
    evidence,
    company_fit, automation_opportunity,
    outreach_priority_score, outreach_priority_label, outreach_priority_methodology,
    why_now,
    score_explanations: scoreExpl,
    detected_factors,
    score_breakdown,
    signals, signal_summary,
    signal_clusters,
    pain_points, pain_points_structured,
    reasoning_chains,
    strategic_challenges,
    opportunities,
    deterministic_opportunities,
    evidence_sufficiency,
    competitive_context,
    competitors,
    competitor_sufficiency,
    icp_segments,
    icp_sufficiency,
    market_intelligence,
    market_intelligence_sufficiency,
    leadership_contacts,
    company_offerings,
    business_profile,
    why_demaze,
    outreach_angle, outreach_intelligence, outreach_draft,
    validation_warnings, content_quality_flags,
    business_model_analysis,
    executive_brief,
    business_model_type,
    recent_activity,
    confidence_level, data_quality_score, data_quality_notes,
    pages_scraped, analyzed_at,
    ai_synthesis_status: 'ok',
    _service_evidence_debug,
    _raw: raw,
  }

  const research_quality = auditResearchQuality(withoutQuality as NormalizedAnalysis)
  console.log(`[normalize:quality] audited=${research_quality.items_audited} | flagged=${research_quality.items_flagged}`)

  return { ...withoutQuality, research_quality }
}

// ── Signal merger ──────────────────────────────────────────────

function mergeSignals(flat: Record<string, unknown>): NormalizedAnalysis['signals'] {
  const arrays: Array<[unknown, string]> = [
    [flat.growth_signals, 'growth'],
    [flat.hiring_signals, 'hiring'],
    [flat.digital_transformation_signals, 'digital_transformation'],
    [flat.business_signals, 'business'],
  ]
  const merged: NormalizedAnalysis['signals'] = []
  for (const [rawArr, defaultCat] of arrays) {
    if (Array.isArray(rawArr)) {
      for (const sig of rawArr) {
        if (sig && typeof sig === 'object') {
          const s = sig as Record<string, unknown>
          merged.push({
            type:        str(s.type),
            category:    str(s.category || defaultCat),
            strength:    str(s.strength),
            evidence:    str(s.evidence),
            evidence_id: s.evidence_id ? str(s.evidence_id) : undefined,
          })
        }
      }
    }
  }
  return merged
}

// ── LLM title → deterministic title matcher ────────────────────
// Matches by shared meaningful keywords (>4 chars).
// "Manufacturing Analytics Platform" matches "Real-time Manufacturing Analytics" via "manufacturing".
function titleMatch(detTitle: string, llmTitle: string): boolean {
  const words = (t: string) =>
    t.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 4)
  const detWords = new Set(words(detTitle))
  return words(llmTitle).some(w => detWords.has(w))
}

// ── LLM name → deterministic identity name matcher ────────────
// Unlike titleMatch (fuzzy keyword overlap, appropriate for free-text
// opportunity titles), identity fields (competitor names, ICP segment
// names) need higher precision — a keyword-overlap match could wrongly
// merge narration meant for one entity onto a different one that happens to
// share a word (e.g. two "X Industries" companies, or "automotive" vs
// "automotive aftermarket" segments). Normalized exact match instead:
// lowercase, strip punctuation, collapse whitespace — tolerates
// casing/punctuation drift from the LLM without accepting a
// same-word-different-entity match. Shared by both the competitors merge
// and the icp_segments merge below.
function identityNameMatch(llmName: string, detName: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim()
  return norm(llmName) === norm(detName)
}

// ── Opportunity normalizer ─────────────────────────────────────

function normalizeOpportunities(raw: unknown): NormalizedAnalysis['opportunities'] {
  if (!Array.isArray(raw)) return []
  return raw.map((o: unknown) => {
    if (!o || typeof o !== 'object') return null
    const item = o as Record<string, unknown>
    return {
      title:            str(item.title),
      description:      str(item.description),
      confidence:       item.confidence ? str(item.confidence) : undefined,
      evidence_id:      item.evidence_id ? str(item.evidence_id) : undefined,
      evidence:         item.evidence ? str(item.evidence) : undefined,
      reasoning:        item.reasoning ? str(item.reasoning) : undefined,
      expected_impact:  item.expected_impact ? str(item.expected_impact) : undefined,
      entry_point:      item.entry_point ? str(item.entry_point) : undefined,
      category:         item.category ? str(item.category) : undefined,
      pain_point_mapped: item.pain_point_mapped ? str(item.pain_point_mapped) : undefined,
      relevance:        str(item.relevance ?? item.confidence ?? 'Medium'),
      evidence_anchor:  item.evidence_anchor ? str(item.evidence_anchor) : undefined,
      claim_type:           item.claim_type ? str(item.claim_type) : undefined,
      observed_basis:       item.observed_basis ? str(item.observed_basis) : undefined,
      inferred_from:        item.inferred_from ? str(item.inferred_from) : undefined,
      opportunity_confidence: item.opportunity_confidence ? str(item.opportunity_confidence) : undefined,
      demaze_fit_score:     item.demaze_fit_score ? str(item.demaze_fit_score) : undefined,
      estimated_impact: item.estimated_impact ? str(item.estimated_impact) : undefined,
      service_line:     item.service_line ? str(item.service_line) : undefined,
    }
  }).filter((o): o is NonNullable<typeof o> => o !== null)
}
