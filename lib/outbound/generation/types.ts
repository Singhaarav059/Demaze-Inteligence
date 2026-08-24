// ============================================================
// Outreach Content Generation — Shared Types
// ============================================================
// Unlike email-finder/validation/enrichment, this module has no vendor
// abstraction — it calls the existing AI provider chain
// (lib/ai/provider-factory.ts's getCompletion()) directly, same as the
// rest of the research pipeline. EmailGenerationInput is assembled by the
// API route from lib/pipeline/analysis-sections.ts getters + the
// outbound_contacts row — never re-derived here.
// ============================================================

import type { PersonalizationCheckResult } from './personalization-check'
import type { ClaimGroundingCheckResult } from './claim-grounding'

// Optional — sourced from outbound_sales_intelligence (lib/sales-knowledge)
// when a Sales Strategy recommendation exists for this run. Absent for any
// run predating this feature, or where Sales Knowledge was never
// configured/generated — assemble-input.ts's degrade-gracefully contract
// means EmailGenerationInput's other fields behave identically either way.
export interface EmailGenerationSalesIntelligence {
  problemLabel?: string
  evidenceSentence?: string
  positioning?: string
  matchedCaseStudy?: {
    title: string
    client: string
    provenance: 'named_client' | 'composite_illustrative'
    challenge: string
    outcomes: Array<{ metric: string; value: string; window?: string }>
  }
  recommendedCta?: string
}

export interface EmailGenerationInput {
  personName: string
  titleHint?: string
  companyName: string
  companySummary?: string
  painPoints: string[]
  // Parallel, richer form of painPoints (Phase B, safety policy B3 — "do not
  // present inference as confirmed fact") — carries pain_points_structured's
  // own claim_type through so the prompt can instruct the model to hedge an
  // 'inferred' claim instead of stating it as certain. Optional: absent for
  // the fallback flat-string path (data.pain_points, no claim_type to carry)
  // or any pre-existing caller — prompts.ts falls back to the flat
  // `painPoints` list when this isn't present, so nothing here is required.
  painPointsDetailed?: Array<{ text: string; claimType?: 'observed' | 'inferred' }>
  opportunities: Array<{ title: string; description?: string; claimType?: 'observed' | 'inferred' }>
  recentActivity: string[]
  openingAngle?: string
  whatToSell?: string
  whyNow?: string
  salesIntelligence?: EmailGenerationSalesIntelligence
}

export type GenerationStatus = 'ok' | 'error'

export interface SubjectLineResult {
  status: GenerationStatus
  subjectLines: string[]
  providerUsed?: string
  modelUsed?: string
  error?: string
}

export interface EmailDraft {
  hook: string
  personalization: string
  painPoint: string
  valueProp: string
  cta: string
  signature: string
  fullText: string
  // Deterministic generic-personalization audit (Master Plan Phase 5, Step
  // 5.2 — see lib/outbound/generation/personalization-check.ts), computed
  // once at generation time and stored alongside the draft. Advisory only —
  // never blocks generation; the UI surfaces it as a warning for the human
  // reviewer. Absent on any draft generated before this field existed.
  personalizationCheck?: PersonalizationCheckResult
  // Deterministic unsupported-numeric-claim audit (Phase B, safety policy
  // B5 — see lib/outbound/generation/claim-grounding.ts). Unlike
  // personalizationCheck above, THIS one is BLOCKING: campaign-review.ts
  // and the send routes refuse to send a draft with
  // hasUnsupportedClaim: true. Absent on any draft generated before this
  // field existed — send-eligibility treats a missing check the same as a
  // passing one (nothing to refuse), same graceful-degradation contract as
  // every other optional field on this type.
  claimGroundingCheck?: ClaimGroundingCheckResult
}

export interface EmailDraftResult {
  status: GenerationStatus
  draft: EmailDraft | null
  providerUsed?: string
  modelUsed?: string
  error?: string
}

export type FollowupUrgency = 'low' | 'medium' | 'high'

export interface FollowupDraft {
  sequence: 1 | 2 | 3
  angle: string
  urgency: FollowupUrgency
  subject: string
  body: string
}

// Badge variant for a follow-up's urgency - shared by OutreachStep.tsx and
// GenerationPanel.tsx, which both render a FollowupDraft (2026-08-24: was
// duplicated verbatim in both, deduped here).
export function urgencyBadgeVariant(urgency: FollowupUrgency) {
  if (urgency === 'high') return 'destructive' as const
  if (urgency === 'medium') return 'secondary' as const
  return 'outline' as const
}

export interface FollowupResult {
  status: GenerationStatus
  followups: FollowupDraft[]
  providerUsed?: string
  modelUsed?: string
  error?: string
}
