// ============================================================
// Company Discovery — shared types + name/domain normalization
// ============================================================
// RETIRED 2026-08-22: the search-engine-based discovery engine that used to
// live in this file (discoverCompanies() — Tavily/Serper query building,
// regex + LLM candidate extraction, self-name/directory/size-mismatch
// rejection, confidence tiering) is gone. Explee (lib/enrichment/sources/
// explee-client.ts, app/api/admin/explee-discovery/route.ts) is now the
// sole company-discovery data source — see CLAUDE.md's Explee reconciliation
// entries. lib/enrichment/demaze-leads.ts (the sector-scoped wrapper on top
// of the old engine) was retired in the same pass; nothing else referenced
// it.
//
// What's kept here is the small, genuinely shared surface the Explee path
// still depends on: CompanyMatch (extended by useCompanyDiscoverySearch.ts's
// DiscoveredMatch), CompanyDiscoverySufficiency (the search-result state
// type), and normalizeName()/normalizeDomain() (used by the Explee route's
// already-researched annotation and by lib/enrichment/explee-lookup.ts's
// name matching). Same Unicode-aware (\p{L}/\p{N}, not \w) normalization
// this codebase standardized on across every discovery module in 2026-07-24.
// ============================================================

export type CompanyMatchConfidence = 'high' | 'medium' | 'low'
export type CompanyDiscoverySufficiency = 'sufficient' | 'insufficient'

export interface CompanyMatch {
  name: string
  domain?: string
  domain_confidence?: 'high' | 'medium'
  reason: string
  confidence: CompanyMatchConfidence
  source_urls: string[]
}

const LEGAL_SUFFIXES = /\b(?:pvt\.?|private|ltd\.?|limited|inc\.?|incorporated|llc|corp\.?|corporation|co\.?)\b/gi

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeDomain(input: string): string {
  let s = input.trim().toLowerCase()
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '')
  s = s.split('/')[0]
  return s
}
