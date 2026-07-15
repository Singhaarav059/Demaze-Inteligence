// ============================================================
// Shared shape/extraction layer for the raw analysisResult object.
// Used by both the on-screen Inspector (AnalysisViewer, in
// app/admin/intelligence-lab/page.tsx) and the downloaded-brief
// appendix (buildAnalysisAppendix, in lib/export/brief-html.ts) so
// the two renderers pull each section from one agreed-upon shape
// instead of independently reaching into `data.xxx` and casting.
// Renaming or restructuring a field only needs to happen here —
// both renderers pick it up automatically.
// ============================================================

export interface CompanyFit {
  value?: number
  label?: string
  rationale?: string
  breakdown?: Array<{ factor: string; points: number; present: boolean }>
}

export interface AutomationOpportunity {
  value?: number
  label?: string
  breakdown?: Array<{ factor: string; points: number; present: boolean }>
}

export interface WhyNow {
  explanation?: string
  score?: number
  urgency_label?: string
}

export interface ExecutiveBrief {
  what_we_observed?: string[]
  what_it_means?: string[]
  what_to_sell?: string
  why_now?: string
  overall_confidence?: string
}

export interface BusinessModelAnalysis {
  model_type?: string
  value_chain_position?: string
  primary_customers?: string
  core_operational_activities?: string[]
  strategic_pressures?: string[]
}

export interface SignalCluster {
  id: string
  theme: string
  description: string
  signals_present: string[]
  confidence: string
  tier: number
}

export interface StrategicChallenge {
  id: string
  title: string
  description: string
  service: string
  priority: string
}

export interface DeterministicOpportunity {
  id: string
  title: string
  service: string
  category: string
  strategic_challenge: string
  relevance: string
  priority: number
  entry_point: string
  triggered_by_clusters?: Array<{ id: string; name: string; confidence: string }>
  priority_source?: string
}

export type WhyDemazeReason =
  | string
  | {
      signal?: string
      evidence?: string
      evidence_tier?: string
      business_implication?: string
      strategic_challenge?: string
      recommended_service?: string
      confidence?: string
    }

export interface WhyDemaze {
  reasons?: WhyDemazeReason[]
  relevant_services?: string[]
  summary?: string
}

export interface OutreachIntelligence {
  trigger?: string
  problem?: string
  service?: string
  opening_angle?: string
  why_now?: string
}

// Competitor Discovery Engine output (Phase 2 item 1, schema formalized in
// lib/enrichment/competitor-discovery.ts — this is that file's CompetitorProfile,
// loosened to optional fields per this file's convention since it reads off
// raw Record<string, unknown> data, not the strict NormalizedAnalysis type).
export interface CompetitorProfile {
  name?: string
  domain?: string
  why_they_compete?: string
  market_position?: string
  differentiator?: string
  confidence?: string
  source_urls?: string[]
}

// ICP Generator output (Phase 2 item 2, schema formalized in
// lib/enrichment/icp-generator.ts — this is that file's ICPSegment, loosened
// to optional fields per this file's convention). NOT company_fit — see
// icp-generator.ts header for the reconciliation note.
export interface ICPSegment {
  name?: string
  reason?: string
  criteria?: string
  signals?: string[]
  buying_indicators?: string
  example_companies?: string[]
  confidence?: string
  source_urls?: string[]
}

// Market Intelligence Layer output (Phase 2 item 6, schema in
// lib/enrichment/market-intelligence.ts — this is that file's
// MarketIntelItem, loosened to optional fields per this file's convention).
// Pure passthrough, no LLM narration layer — see that file's header.
export interface MarketIntelItem {
  statement?: string
  category?: string
  confidence?: string
  mention_count?: number
  source_urls?: string[]
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

export const getCompanyFit = (data: Record<string, unknown>): CompanyFit | undefined =>
  data.company_fit as CompanyFit | undefined

export const getAutomationOpportunity = (data: Record<string, unknown>): AutomationOpportunity | undefined =>
  data.automation_opportunity as AutomationOpportunity | undefined

export const getWhyNow = (data: Record<string, unknown>): WhyNow | undefined => data.why_now as WhyNow | undefined

export const getSignals = (data: Record<string, unknown>): Array<Record<string, unknown>> => arr(data.signals)

export const getOpportunities = (data: Record<string, unknown>): Array<Record<string, unknown>> =>
  arr(data.opportunities)

export const getPainPointsStructured = (data: Record<string, unknown>): Array<Record<string, unknown>> =>
  arr(data.pain_points_structured)

export const getReasoningChains = (data: Record<string, unknown>): Array<Record<string, unknown>> =>
  arr(data.reasoning_chains)

export const getWhyDemaze = (data: Record<string, unknown>): WhyDemaze | undefined =>
  data.why_demaze as WhyDemaze | undefined

export const getOutreachIntelligence = (data: Record<string, unknown>): OutreachIntelligence | undefined =>
  data.outreach_intelligence as OutreachIntelligence | undefined

export const getBusinessModelAnalysis = (data: Record<string, unknown>): BusinessModelAnalysis | undefined =>
  data.business_model_analysis as BusinessModelAnalysis | undefined

export const getSignalClusters = (data: Record<string, unknown>): SignalCluster[] => arr(data.signal_clusters)

export const getStrategicChallenges = (data: Record<string, unknown>): StrategicChallenge[] =>
  arr(data.strategic_challenges)

export const getExecutiveBrief = (data: Record<string, unknown>): ExecutiveBrief | null =>
  data.executive_brief && typeof data.executive_brief === 'object' ? (data.executive_brief as ExecutiveBrief) : null

export const getDeterministicOpportunities = (data: Record<string, unknown>): DeterministicOpportunity[] =>
  arr(data.deterministic_opportunities)

// Competitor Discovery Engine (Phase 2 item 1). Not yet rendered by either
// consumer (AnalysisViewer / buildAnalysisAppendix) — added now so both can
// pick it up the same way every other section does once the "Competitors"
// UI section is built, without another shape-plumbing pass later.
export const getCompetitors = (data: Record<string, unknown>): CompetitorProfile[] =>
  arr(data.competitors)

export const getCompetitorSufficiency = (data: Record<string, unknown>): string | undefined =>
  data.competitor_sufficiency ? String(data.competitor_sufficiency) : undefined

// ICP Generator (Phase 2 item 2). Same "add now, UI section built alongside
// this session" pattern as getCompetitors above.
export const getICPSegments = (data: Record<string, unknown>): ICPSegment[] =>
  arr(data.icp_segments)

export const getICPSufficiency = (data: Record<string, unknown>): string | undefined =>
  data.icp_sufficiency ? String(data.icp_sufficiency) : undefined

// Market Intelligence Layer (Phase 2 item 6). Same "add now, UI section
// built alongside this session" pattern as getCompetitors/getICPSegments.
export const getMarketIntelligence = (data: Record<string, unknown>): MarketIntelItem[] =>
  arr(data.market_intelligence)

export const getMarketIntelligenceSufficiency = (data: Record<string, unknown>): string | undefined =>
  data.market_intelligence_sufficiency ? String(data.market_intelligence_sufficiency) : undefined

// Research Quality Framework (Phase 2 item 4, schema in
// lib/pipeline/research-quality.ts — this is that file's QualityFlag/
// ResearchQualityAudit, loosened to optional fields per this file's
// convention). Informational-only audit, never gates anything above it.
export interface QualityFlag {
  item_type?: string
  item_ref?: string
  flag?: string
  reason?: string
  severity?: string
}

export interface ResearchQualityAudit {
  flags?: QualityFlag[]
  items_audited?: number
  items_flagged?: number
}

export const getResearchQuality = (data: Record<string, unknown>): ResearchQualityAudit | undefined =>
  data.research_quality as ResearchQualityAudit | undefined
