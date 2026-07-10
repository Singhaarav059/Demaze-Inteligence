// Shared types for Intelligence Lab
// Extracted from page.tsx to keep component files small and prevent HMR parse errors

export interface RunResult {
  success: boolean
  domain?: string
  executionTimeMs?: number
  scrapeTimeMs?: number
  analysisTimeMs?: number
  scrapeResult?: import('@/lib/pipeline/scraper').ScrapeResult
  quality?: { score: number; note: string }
  analysisResult?: Record<string, unknown>
  parseError?: string
  mode?: string
  contentCharsUsed?: number
  scrapeSource?: 'cache' | 'fresh'
  cachedAt?: string
  aiMeta?: {
    model: string
    provider: string
    tokensUsed: number
    latencyMs: number
    rawResponse: string
  }
  prompts?: {
    systemPrompt: string
    userPrompt: string
    estimatedInputTokens: number
  }
  error?: string
  recoveryTriggered?: boolean
  enrichmentMeta?: {
    company_name: string
    sources_found: number
    sources_used: number
    signals_extracted: number
    enriched_at: string
  } | null
  sourcesUsed?: Array<{
    url: string
    title: string
    snippet: string
    source_type: string
    evidence_strength: string
    priority_score: number
    query_category: string
    fetch_order: number
    should_fetch: boolean
  }>
  contentQuality?: { score: number; recommendation: string; flags: string[]; summary: string }
  extractorResult?: {
    signals: Array<{
      type: string
      strength: string
      best_quote: string
      is_company_subject: boolean
      validated: boolean
      evidence: Array<{
        id: string
        quote: string
        signal_type: string | null
        subject: string
        source_url: string
        page_type: string
        source_tier: string
        evidence_strength: string
        pattern_matched: string
      }>
    }>
    detectedFactors: Record<string, boolean>
    factorSourceMap?: Record<string, string[]>
    businessModel: string
    companySubjectCount: number
    signalSummary: string
  }
  synthesisResult?: {
    validatedSignals: Array<{
      id: string; name: string; signal_type: string
      supportingSourceTypes: string[]; sourceCount: number
      validationScore: number; confidenceLevel: string
      supportingEvidence: Array<{ quote: string; source_type: string; source_label: string; url?: string }>
    }>
    strategicThemes: Array<{
      id: string; name: string; tagline: string
      confidence: string; businessImpact: string
      priority: string; priorityScore: number; demazeAngle: string
      signalTypes: string[]
      supportingEvidence: Array<{ quote: string; source_label: string }>
    }>
    whyNow: {
      headline: string; urgency: string; urgencyScore: number
      narrative: string; genericityFlag: boolean
      triggers: Array<{ signal_type: string; evidence_quote: string; source_label: string; urgency_contribution: number }>
    }
    outreachCards: Array<{
      role: string; likely_kpi: string; likely_pain: string
      message_angle: string; relevant_opportunity: string
      demaze_relevance: string; why_relevant: string
    }>
    intelligenceQuality: {
      overall: number; overall_label: string; tier: string
      data_coverage: { label: string; score: number; note: string }
      evidence_strength: { label: string; score: number; note: string }
      validation_strength: { label: string; score: number; note: string }
      signal_confidence: { label: string; score: number; note: string }
      opportunity_confidence: { label: string; score: number; note: string }
    }
  }
}

export type Operation = 'scraper' | 'analysis' | 'pipeline' | 'rescrape'
export type AnalysisMode = 'lightweight' | 'full'
export type ActiveTab = 'research_card' | 'scraper' | 'content' | 'analysis' | 'intelligence' | 'debug' | 'sources' | 'comparison'
