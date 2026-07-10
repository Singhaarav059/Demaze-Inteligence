// ============================================================
// Synthesis Layer — Shared Types (V3.4)
// ============================================================
// These types represent intelligence DERIVED from already-
// collected evidence. No new data acquisition here.
// ============================================================

import type { NormalizedAnalysis, EvidenceItem } from '@/lib/pipeline/normalize'
import type { EnrichedSignal } from '@/lib/enrichment/web-enricher'
import type { PrioritizedSource } from '@/lib/enrichment/source-prioritizer'
import type { CompanyProfile } from '@/lib/pipeline/evidence-extractor'

// ── Input ─────────────────────────────────────────────────────

export interface SynthesisInput {
  analysis: NormalizedAnalysis
  enrichedSignals: EnrichedSignal[]
  sourcesUsed: PrioritizedSource[]
  companyProfile?: CompanyProfile    // model-aware theme + outreach gating
}

// ── Validated Signal ──────────────────────────────────────────

export interface ValidatedSignalEvidence {
  quote: string
  source_type: string   // annual_report | careers_page | llm_evidence | etc.
  source_label: string  // human-readable
  url?: string
}

export type ConfidenceLevel = 'very_high' | 'high' | 'medium' | 'low'

export interface ValidatedSignal {
  id: string
  name: string
  signal_type: string   // ai_mention | automation_keywords | capacity_expansion | etc.
  supportingEvidence: ValidatedSignalEvidence[]
  supportingSourceTypes: string[]
  sourceCount: number
  validationScore: number    // 0–100 deterministic
  confidenceLevel: ConfidenceLevel
}

// ── Strategic Theme ───────────────────────────────────────────

export type PriorityLevel = 'critical' | 'important' | 'secondary'

export interface StrategicTheme {
  id: string
  name: string
  tagline: string                  // one-line description
  signals: ValidatedSignal[]
  signalTypes: string[]
  supportingEvidence: ValidatedSignalEvidence[]
  confidence: ConfidenceLevel
  businessImpact: string
  priority: PriorityLevel
  priorityScore: number            // 0–100 deterministic
  demazeAngle: string              // what Demaze sells into this theme
}

// ── Why Now Analysis ──────────────────────────────────────────

export type UrgencyLevel = 'immediate' | 'near_term' | 'emerging'

export interface WhyNowTrigger {
  signal_type: string
  evidence_quote: string
  source_label: string
  source_type: string
  urgency_contribution: number   // 0–100
}

export interface WhyNowAnalysis {
  headline: string
  triggers: WhyNowTrigger[]
  urgency: UrgencyLevel
  urgencyScore: number           // 0–100 deterministic
  narrative: string              // 2–4 sentence evidence-grounded paragraph
  genericityFlag: boolean        // true if narrative could apply to any company
}

// ── Outreach Intelligence ─────────────────────────────────────

export type DemazeRelevanceScore = 'very_strong' | 'strong' | 'moderate' | 'weak'

export interface OutreachCard {
  role: string
  likely_kpi: string
  likely_pain: string
  message_angle: string
  relevant_opportunity: string
  demaze_relevance: DemazeRelevanceScore
  why_relevant: string
}

// ── Intelligence Quality ──────────────────────────────────────

export interface IntelligenceQualityDimension {
  label: string
  score: number    // 0–100
  note: string
}

export interface IntelligenceQuality {
  data_coverage: IntelligenceQualityDimension
  evidence_strength: IntelligenceQualityDimension
  validation_strength: IntelligenceQualityDimension
  signal_confidence: IntelligenceQualityDimension
  opportunity_confidence: IntelligenceQualityDimension
  overall: number        // 0–100 weighted average
  overall_label: string  // Excellent | Good | Fair | Limited
  tier: 'A' | 'B' | 'C' | 'D'
}

// ── Full Synthesis Result ─────────────────────────────────────

export interface SynthesisResult {
  validatedSignals: ValidatedSignal[]
  strategicThemes: StrategicTheme[]
  whyNow: WhyNowAnalysis
  outreachCards: OutreachCard[]
  intelligenceQuality: IntelligenceQuality
  synthesizedAt: string
}
