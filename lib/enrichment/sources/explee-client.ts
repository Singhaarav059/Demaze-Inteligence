// ============================================================
// Explee client — POC, company search only
// ============================================================
// Minimal wrapper around POST /search/companies. Field names/shapes below
// are copied verbatim from Explee's own OpenAPI schema
// (https://api.explee.com/public/api/openapi.json,
// SearchCompaniesPayload/PublicCompaniesFilters/SearchCompaniesResponse/
// PublicCompanyResponse), not guessed. Auth is a single `X-API-Key` header,
// no OAuth, no DB-backed credential row — same flat-env-var pattern as
// lib/enrichment/sources/edgar-client.ts (this is a discovery SOURCE, not
// an outbound-capability provider, so it doesn't go through
// outbound_integrations).
//
// POC scope only: no retry/backoff, no caching, no pagination beyond a
// single page — add those if/when this becomes the production pipeline.
// ============================================================

const BASE_URL = process.env.EXPLEE_API_BASE_URL || 'https://api.explee.com/public/api/v1'

export function getExpleeApiKey(): string | null {
  return process.env.EXPLEE_API_KEY || null
}

// Subset of PublicCompaniesFilters we actually expose for this POC —
// Explee's real filter schema has ~40 fields (geo, funding, tech stack,
// traffic, NACE codes, etc.); add more here only once the POC proves the
// data is worth building against.
export interface ExpleeCompanyFilters {
  definition: string
  geo_include?: string[]
  size?: { min?: number; max?: number }
}

// PublicCompanyResponse has ~60 fields; this is the subset used for
// display. The route/UI still receive the full raw object from Explee
// (this type is a lower bound via an index signature, not a strict cast),
// so nothing Explee returns is lost even though we only name a few fields.
export interface ExpleeCompany {
  name: string | null
  domain: string | null
  url: string | null
  description: string | null
  industry: string | null
  geo: string | null
  geo_city: string | null
  size: number | null
  founded: number | null
  revenue_annual: number | null
  funding_stage: string | null
  linkedin_id: number | null
  [key: string]: unknown
}

export interface ExpleeSearchMeta {
  total: number
  results_count: number
  credits_charged: number
  remaining_balance: number
}

export interface ExpleeSearchResult {
  companies: ExpleeCompany[]
  meta: ExpleeSearchMeta
}

export class ExpleeApiError extends Error {
  constructor(public status: number, detail: string) {
    super(`Explee API ${status}: ${detail}`)
  }
}

export async function searchExpleeCompanies(
  filters: ExpleeCompanyFilters,
  pageSize = 20,
): Promise<ExpleeSearchResult> {
  const apiKey = getExpleeApiKey()
  if (!apiKey) throw new Error('EXPLEE_API_KEY is not set')

  const res = await fetch(`${BASE_URL}/search/companies`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({ filters, page: 1, page_size: pageSize }),
    signal: AbortSignal.timeout(30_000),
  })

  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new ExpleeApiError(res.status, body?.detail ?? 'Unknown error')
  }
  return body as ExpleeSearchResult
}
