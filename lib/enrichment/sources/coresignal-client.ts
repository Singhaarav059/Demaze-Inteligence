// ============================================================
// Coresignal client — the ONE company-data provider for candidate discovery
// ============================================================
// Replaces the abandoned multi-source company-universe experiment (GLEIF,
// SEC EDGAR-as-a-discovery-source, Companies House, India MCA/data.gov.in,
// OpenCorporates, Bright Data) — that code lives on unmerged sibling
// branches (claude/company-universe-validation-gnjx0z and local-only WIP
// work found 2026-08-22), never on `main` and never on this branch, so
// there is nothing to delete FROM this branch — see CLAUDE.md's 2026-08-22
// entries for the corrected investigation history (an earlier version of
// this comment claimed a full-repo/all-branch grep found nothing at all;
// that grep ran before the company-universe-validation branch existed on
// the remote, and never saw local-only uncommitted work on another
// machine — both surfaced later the same day). SEC EDGAR stays, unchanged,
// as a per-company regulatory-filings ENRICHMENT source
// (lib/enrichment/sources/edgar-client.ts) — a different job (context for
// a company already being researched) from what this file does (surfacing
// NEW candidate companies), so it isn't part of the "one provider"
// consolidation.
//
// Two real endpoints, confirmed against Coresignal's own docs before writing
// any code (docs.coresignal.com — the egress proxy in this environment
// blocks direct fetches to that domain, so this is sourced from indexed
// documentation snippets, not a live browse; the live smoke test in
// scripts/coresignal-smoke-test.ts is what actually proves these shapes
// against the real API, not this comment):
//   POST /company_base/search/filter  — a filter object (industry, country,
//     employees_count_gte/lte, founded_year_gte/lte, size, name, website,
//     ...) returns an array of matching company IDs. Paginated via
//     ?items_per_page=<=1000 and, for the next page, ?after=<cursor from the
//     x-next-page-after response header>.
//   GET  /company_base/collect/{id}   — the full record for one ID (name,
//     industry, employees_count, headquarters_country[_parsed], size,
//     website, founded, type, description, url, ...).
//
// Base Company API (company_base) was chosen over the pricier Multi-source
// Company API (company_multi_source) deliberately — this task's own goal is
// "prove Coresignal can supply genuine companies matching our ICP" with the
// smallest clean integration, and company_base's filter/collect shape
// already gives every field the target filters need (geography, industry,
// size, founding year). Nothing here hardcodes company_base as the only
// possible choice — CORESIGNAL_API_BASE_URL is overridable — but switching
// endpoint families is a real, separate decision, not something to build
// both of speculatively.
// ============================================================

export function getCoresignalApiKey(): string | null {
  const key = process.env.CORESIGNAL_API_KEY
  return key && key.trim().length > 0 ? key.trim() : null
}

function getBaseUrl(): string {
  return process.env.CORESIGNAL_API_BASE_URL?.trim() || 'https://api.coresignal.com/cdapi/v2'
}

export class CoresignalApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'CoresignalApiError'
    this.status = status
  }
}

// ── Search filter shape — mirrors company_base/search/filter's real body
// fields exactly (not renamed/reshaped), so anyone cross-checking this
// against Coresignal's docs later doesn't have to reverse-map field names.
export interface CoresignalSearchFilter {
  name?: string
  website?: string
  exact_website?: string
  industry?: string
  country?: string
  location?: string
  size?: string
  employees_count_gte?: number
  employees_count_lte?: number
  founded_year_gte?: number
  founded_year_lte?: number
  deleted?: boolean
}

// Raw collect-endpoint record. Uses an index signature rather than a closed
// type — the exact field set was reconstructed from indexed documentation
// snippets (network access to the live docs is blocked in this environment,
// see the header comment), so treating anything beyond the fields we
// actively read as "unknown, pass through" is the honest, defensive choice
// rather than silently dropping real data the live API returns that this
// file didn't anticipate.
export interface CoresignalCompanyRecord {
  id: number
  name?: string
  industry?: string
  employees_count?: number
  headquarters_country?: string
  headquarters_country_parsed?: string
  size?: string
  website?: string
  url?: string
  founded?: number
  type?: string
  description?: string
  last_updated?: string
  [key: string]: unknown
}

const DEFAULT_TIMEOUT_MS = 15_000
const MAX_RETRIES = 3
const RETRY_BASE_DELAY_MS = 500

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Shared retry wrapper: retries on 429 (Too Many Requests) and 5xx up to
// MAX_RETRIES with exponential backoff, honoring a real Retry-After header
// when present instead of guessing. Never retries on other 4xx (bad
// request/unauthorized/not found) — those won't succeed on retry and
// retrying them would just burn quota against a request that's wrong, not
// transient.
async function fetchCoresignalWithRetry(url: string, init: RequestInit): Promise<Response> {
  const apiKey = getCoresignalApiKey()
  if (!apiKey) throw new CoresignalApiError(0, 'CORESIGNAL_API_KEY is not configured')

  let lastError: unknown = null
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { ...init.headers, apikey: apiKey },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      })

      if (res.ok) return res

      const retryable = res.status === 429 || res.status >= 500
      if (!retryable || attempt === MAX_RETRIES) {
        const body = await res.text().catch(() => '')
        throw new CoresignalApiError(res.status, `Coresignal API ${res.status}: ${body.slice(0, 500) || res.statusText}`)
      }

      const retryAfterHeader = res.headers.get('Retry-After')
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN
      const delay = Number.isFinite(retryAfterMs) && retryAfterMs > 0
        ? retryAfterMs
        : RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
      await sleep(delay)
    } catch (e) {
      if (e instanceof CoresignalApiError) throw e
      lastError = e
      if (attempt === MAX_RETRIES) {
        throw new CoresignalApiError(0, `Coresignal request failed: ${e instanceof Error ? e.message : String(e)}`)
      }
      await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt))
    }
  }
  // Unreachable in practice (the loop always returns or throws), kept only
  // to satisfy the compiler's control-flow analysis.
  throw new CoresignalApiError(0, `Coresignal request failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

export interface CoresignalSearchPage {
  ids: number[]
  nextAfter: string | null
}

const MAX_ITEMS_PER_PAGE = 1000

/**
 * Searches company_base for IDs matching `filter`. `after` is the raw
 * cursor value from a previous page's `nextAfter` (Coresignal's own
 * `x-next-page-after` response header) — omit for the first page.
 */
export async function searchCoresignalCompanyIds(
  filter: CoresignalSearchFilter,
  opts: { itemsPerPage?: number; after?: string } = {},
): Promise<CoresignalSearchPage> {
  const itemsPerPage = Math.min(opts.itemsPerPage ?? 100, MAX_ITEMS_PER_PAGE)
  const params = new URLSearchParams({ items_per_page: String(itemsPerPage) })
  if (opts.after) params.set('after', opts.after)

  const res = await fetchCoresignalWithRetry(
    `${getBaseUrl()}/company_base/search/filter?${params.toString()}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(filter),
    },
  )

  const ids = await res.json() as unknown
  const nextAfter = res.headers.get('x-next-page-after')
  return {
    ids: Array.isArray(ids) ? ids.filter((v): v is number => typeof v === 'number') : [],
    nextAfter: nextAfter && nextAfter.length > 0 ? nextAfter : null,
  }
}

/**
 * Collects the full record for one company ID. Returns null on a 404 (no
 * such record) — every other failure (auth, rate limit exhausted after
 * retries, network) throws CoresignalApiError, since a discovery run
 * silently treating "the API is broken" the same as "this one ID doesn't
 * exist" would hide a real problem from the caller.
 */
export async function collectCoresignalCompany(id: number): Promise<CoresignalCompanyRecord | null> {
  try {
    const res = await fetchCoresignalWithRetry(`${getBaseUrl()}/company_base/collect/${id}`, { method: 'GET' })
    const record = await res.json() as CoresignalCompanyRecord
    return record
  } catch (e) {
    if (e instanceof CoresignalApiError && e.status === 404) return null
    throw e
  }
}
