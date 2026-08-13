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
  opportunities: Array<{ title: string; description?: string }>
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

export interface FollowupResult {
  status: GenerationStatus
  followups: FollowupDraft[]
  providerUsed?: string
  modelUsed?: string
  error?: string
}
