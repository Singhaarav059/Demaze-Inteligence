// ============================================================
// Verbatim query templates — copied, not reimplemented
// ============================================================
// Every query builder below is a literal copy of the private query-builder
// function it cites. Nothing here is invented or rewritten to favor any
// provider — this file exists only so the benchmark scripts can call the
// SAME query text production uses without adding `export` to those private
// functions (a change to the pipeline, which this benchmark phase is
// explicitly not allowed to make). Re-diff against the cited source before
// trusting this file after a future pipeline query-wording change.
// ============================================================

export interface CategorizedQuery {
  query: string
  category: string
}

// Source: lib/enrichment/discovery-engine.ts buildDiscoveryQueries() (exported,
// L155-218) — copied here anyway for a single consistent import surface
// alongside the other three (which are NOT exported in their source files).
export function evidenceDiscoveryQueries(companyName: string): CategorizedQuery[] {
  const c = companyName
  const yr = new Date().getFullYear()
  return [
    { query: `"${c}" annual report ${yr}`, category: 'investor' },
    { query: `"${c}" investor presentation ${yr}`, category: 'investor' },
    { query: `"${c}" quarterly results earnings ${yr}`, category: 'investor' },
    { query: `"${c}" earnings call transcript ${yr}`, category: 'investor' },
    { query: `"${c}" investor call transcript quarterly results`, category: 'investor' },
    { query: `"${c}" AI machine learning engineer jobs hiring`, category: 'hiring' },
    { query: `"${c}" digital transformation IT SAP ERP careers`, category: 'hiring' },
    { query: `"${c}" automation robotics engineer vacancies`, category: 'hiring' },
    { query: `"${c}" new plant factory greenfield expansion ${yr}`, category: 'expansion' },
    { query: `"${c}" capacity increase manufacturing growth`, category: 'expansion' },
    { query: `"${c}" ERP SAP Oracle MES implementation digital`, category: 'strategy' },
    { query: `"${c}" Industry 4.0 smart factory IIoT initiative`, category: 'strategy' },
    { query: `"${c}" AI automation strategy CEO interview ${yr}`, category: 'strategy' },
    { query: `"${c}" acquisition merger partnership news ${yr}`, category: 'expansion' },
    { query: `"${c}" leadership team executives`, category: 'leadership' },
    { query: `"${c}" CEO CTO management team`, category: 'leadership' },
    { query: `"${c}" appoints new CEO`, category: 'leadership' },
    { query: `"${c}" CEO steps down leadership transition`, category: 'leadership' },
    { query: `"${c}" management change appointment ${yr}`, category: 'leadership' },
    { query: `"${c}" layoffs job cuts restructuring workforce reduction ${yr}`, category: 'risk' },
    { query: `"${c}" raises funding Series A B C investment round ${yr}`, category: 'investor' },
  ]
}

// Source: lib/enrichment/icp-generator.ts buildICPQueries() (private, L318-326)
export function icpBaseQueries(companyName: string): string[] {
  return [
    `"${companyName}" "we serve"`,
    `"${companyName}" clients include`,
    `"${companyName}" industries served`,
    `"${companyName}" customers include`,
    `who does "${companyName}" sell to`,
  ]
}

// Source: lib/enrichment/competitor-discovery.ts buildCompetitorQueries() (private, L390-397)
export function competitorBaseQueries(companyName: string): string[] {
  return [
    `"${companyName}" competitors`,
    `"${companyName}" vs`,
    `"${companyName}" alternatives`,
    `top competitors of "${companyName}"`,
  ]
}

// Source: lib/enrichment/market-intelligence.ts buildMarketIntelQueries() (private, L169-176)
export function marketIntelQueries(companyName: string): string[] {
  return [
    `"${companyName}" industry trends`,
    `"${companyName}" market growth`,
    `"${companyName}" industry challenges`,
    `"${companyName}" industry outlook`,
  ]
}

// All 4 categories combined for one company, tagged with which pipeline
// module they come from (for later per-module quality breakdown).
export function allQueriesForCompany(companyName: string): CategorizedQuery[] {
  return [
    ...evidenceDiscoveryQueries(companyName).map(q => ({ ...q, module: 'evidence_discovery' as const })),
    ...icpBaseQueries(companyName).map(query => ({ query, category: 'icp', module: 'icp_generator' as const })),
    ...competitorBaseQueries(companyName).map(query => ({ query, category: 'competitor', module: 'competitor_discovery' as const })),
    ...marketIntelQueries(companyName).map(query => ({ query, category: 'market_intel', module: 'market_intelligence' as const })),
  ]
}
