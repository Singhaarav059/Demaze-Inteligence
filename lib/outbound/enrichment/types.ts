// ============================================================
// Contact Enrichment — Shared Types
// ============================================================
// Same template as email-finder/email-validation. knownCompanySize/
// knownIndustry are optional hints the caller (the API route, which has DB
// access) passes in from the linked pipeline_test_runs.final_result — real
// research data the provider should prefer over an invented fixture guess.
// ============================================================

export type EnrichmentStatus = 'enriched' | 'partial' | 'not_found'
export type EnrichmentConfidence = 'high' | 'medium' | 'low'

export interface EnrichmentRequest {
  personName: string
  companyName: string
  linkedinUrl?: string
  knownCompanySize?: string
  knownIndustry?: string
}

export interface EnrichmentResult {
  department?: string
  seniority?: string
  location?: string
  roleCategory?: string
  linkedinSummary?: string
  companySize?: string
  industry?: string
  confidence: EnrichmentConfidence
  providerUsed: string
  status: EnrichmentStatus
}

export interface EnrichmentProvider {
  name: string
  displayName: string
  enrichContact(request: EnrichmentRequest): Promise<EnrichmentResult>
  isAvailable(): Promise<boolean>
}
