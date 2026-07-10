// ============================================================
// Demaze AI Outbound Intelligence Platform
// Shared TypeScript Types
// ============================================================


// ============================================================
// ENUMS
// ============================================================

export type AnalysisStatus = 'pending' | 'scraping' | 'analyzing' | 'done' | 'error'

export type TriggeredBy = 'manual' | 'scheduled' | 'bulk' | 'api'

export type SignalCategory = 'growth' | 'hiring' | 'digital_transformation' | 'business'

export type SignalStrength = 'weak' | 'moderate' | 'strong'

export type OpportunityRelevance = 'High' | 'Medium' | 'Low'

export type ConfidenceLevel = 'high' | 'medium' | 'low'

export type WhyNowRating = 'hot' | 'warm' | 'cold'


// ============================================================
// DATABASE ROW TYPES
// These match the Supabase table columns exactly.
// ============================================================

export interface Company {
  id: string
  domain: string
  name: string | null
  website: string
  industry: string | null
  sub_industry: string | null
  headquarters: string | null
  size_estimate: string | null
  business_model: string | null
  first_seen_at: string
  last_analyzed_at: string | null
  analysis_count: number
  metadata: Record<string, unknown>
}

export interface Analysis {
  id: string
  company_id: string
  status: AnalysisStatus
  error_message: string | null
  triggered_by: TriggeredBy
  scraped_content: ScrapedContent | null
  report: IntelligenceReport | null
  ai_provider_used: string | null
  ai_model_used: string | null
  scrape_duration_ms: number | null
  analysis_duration_ms: number | null
  created_at: string
  completed_at: string | null
}

export interface Signal {
  id: string
  company_id: string
  analysis_id: string | null
  type: string
  category: SignalCategory
  strength: SignalStrength
  evidence: string
  source_url: string | null
  detected_at: string
  is_active: boolean
}

export interface Opportunity {
  id: string
  company_id: string
  analysis_id: string | null
  title: string
  description: string
  relevance: OpportunityRelevance
  estimated_impact: string | null
  entry_point: string | null
  category: string | null
  detected_at: string
  is_active: boolean
}

export interface AIProvider {
  id: string
  name: string
  display_name: string
  is_active: boolean
  is_default: boolean
  priority: number
  config: AIProviderConfig
  created_at: string
}


// ============================================================
// NESTED TYPES
// Sub-objects used inside the JSONB fields.
// ============================================================

export interface AIProviderConfig {
  base_url: string
  model: string
  max_tokens: number
  temperature: number
}

export interface ScrapedContent {
  pages: ScrapedPage[]
  total_char_count: number
  scraped_at: string
}

export interface ScrapedPage {
  url: string
  markdown: string
  char_count: number
  success: boolean
}


// ============================================================
// INTELLIGENCE REPORT
// The full structured output stored in analyses.report (JSONB).
// ============================================================

export interface IntelligenceReport {
  // Company Profile
  company_name: string
  company_summary: string
  industry: string
  sub_industry: string
  business_model: string
  company_size_estimate: string
  headquarters_location: string

  // Signals
  growth_signals: ReportSignal[]
  hiring_signals: ReportSignal[]
  digital_transformation_signals: ReportSignal[]
  business_signals: ReportSignal[]
  signal_summary: string

  // Intelligence
  pain_points: string[]
  ai_opportunities: ReportOpportunity[]
  competitive_context: string

  // Scoring
  company_fit_score: Score
  automation_opportunity_score: Score
  outreach_priority_score: Score

  // Outreach Intelligence
  why_now: string
  why_now_score: number        // 0–10
  recommended_contact_roles: string[]
  outreach_angle: string

  // Metadata
  confidence_level: ConfidenceLevel
  data_quality_score: number   // 0–100
  data_quality_notes: string
  pages_scraped: string[]
  analyzed_at: string
}

export interface ReportSignal {
  type: string
  category: SignalCategory
  strength: SignalStrength
  evidence: string
  source_url?: string
}

export interface ReportOpportunity {
  title: string
  description: string
  evidence_anchor: string   // The specific pain point or signal from this company that justifies this opportunity
  relevance: OpportunityRelevance
  estimated_impact: string
  entry_point: string
  category: string
}

export interface Score {
  value: number          // 0–100
  label: string          // e.g. "Strong Fit", "Good Opportunity"
  rationale: string
  methodology: string
}


// ============================================================
// API REQUEST / RESPONSE TYPES
// Used by the Next.js route handlers and client hooks.
// ============================================================

// POST /api/v1/companies/analyze
export interface AnalyzeRequest {
  url: string
}

export interface AnalyzeResponse {
  companyId: string
  analysisId: string
  isNewCompany: boolean
}

// GET /api/v1/analyses/:id
export interface AnalysisPollResponse {
  id: string
  status: AnalysisStatus
  currentStep: string
  progress: number           // 0–100
  report: IntelligenceReport | null
  aiProviderUsed: string | null
  aiModelUsed: string | null
  completedAt: string | null
  errorMessage: string | null
}

// GET /api/v1/companies (list item)
export interface CompanyListItem {
  id: string
  name: string | null
  domain: string
  website: string
  industry: string | null
  sub_industry: string | null
  company_fit_score: number | null
  automation_opportunity_score: number | null
  outreach_priority_score: number | null
  why_now_score: number | null
  signal_count: number
  last_analyzed_at: string | null
}

// GET /api/v1/companies (list response)
export interface CompanyListResponse {
  companies: CompanyListItem[]
  total: number
  limit: number
  offset: number
}

// GET /api/v1/companies/:id (full profile)
export interface CompanyProfile {
  company: Company
  latestReport: IntelligenceReport | null
  latestAnalysisId: string | null
  activeSignals: Signal[]
  activeOpportunities: Opportunity[]
}


// ============================================================
// PIPELINE STEP LABELS
// Used by the progress UI to show human-readable step names.
// ============================================================

export const PIPELINE_STEPS: Record<AnalysisStatus, string> = {
  pending:   'Queued',
  scraping:  'Scraping website',
  analyzing: 'Analyzing company intelligence',
  done:      'Report ready',
  error:     'Analysis failed',
}

// Numeric progress value per status (for the progress bar)
export const PIPELINE_PROGRESS: Record<AnalysisStatus, number> = {
  pending:   5,
  scraping:  25,
  analyzing: 70,
  done:      100,
  error:     0,
}


// ============================================================
// SIGNAL TYPE CONSTANTS
// The full taxonomy from PRD v2, Section 6.1.
// ============================================================

export const SIGNAL_TYPES = {
  growth: [
    'new_facility',
    'capacity_expansion',
    'new_market_entry',
    'new_product_launch',
    'revenue_milestone',
  ],
  hiring: [
    'operations_hiring_surge',
    'digital_transformation_hiring',
    'ai_ml_hiring',
    'automation_engineering_hiring',
    'leadership_hiring',
  ],
  digital_transformation: [
    'erp_implementation',
    'mes_adoption',
    'industry40_initiative',
    'automation_investment',
    'iot_investment',
  ],
  business: [
    'acquisition',
    'partnership_announced',
    'sustainability_initiative',
    'quality_certification_pursuit',
    'funding_round',
  ],
} as const satisfies Record<SignalCategory, string[]>

export type SignalType =
  (typeof SIGNAL_TYPES)[SignalCategory][number]


// ============================================================
// WHY NOW RATING HELPER
// Maps why_now_score (0–10) to a display label.
// ============================================================

export function getWhyNowRating(score: number): WhyNowRating {
  if (score >= 7) return 'hot'
  if (score >= 4) return 'warm'
  return 'cold'
}

// Maps why_now_score to a display label string
export function getScoreLabel(score: number): string {
  if (score >= 80) return 'Strong'
  if (score >= 60) return 'Good'
  if (score >= 40) return 'Moderate'
  return 'Weak'
}
