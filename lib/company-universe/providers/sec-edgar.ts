// ============================================================
// Company Universe — SEC EDGAR provider
// ============================================================
// Demaze_Multi_Source_Company_Universe_Claude_Prompt.md, Section 6.
// Reuses lib/enrichment/sources/edgar-client.ts's ticker map / User-Agent /
// URL builders directly (all exported from that file specifically for this
// reuse) rather than re-implementing a second SEC client — that file's own
// fetchEdgarFilings() is unchanged and still serves its original purpose
// (a single-company enrichment context block); this adapter is a second,
// independent consumer of the same cached ticker map for a different
// purpose (bulk/search company-universe discovery, not narrative
// enrichment text).
//
// No API key required (confirmed in edgar-client.ts's own header comment).
// Free, but NOT a complete private-company database — Section 6: "SEC is
// NOT a complete US private-company database... use it primarily for
// public companies, financial evidence, revenue evidence, company
// identity." capabilities.search here can only filter by name (the ticker
// map has no industry/employee/country columns) — everything else is
// reported back as unsupportedFilters, per Section 16's "if a provider
// cannot support a filter, don't pretend it can."
//
// NOT LIVE-VERIFIED in this session — this session's network egress policy
// blocks www.sec.gov / data.sec.gov entirely (confirmed via direct curl and
// WebFetch, both returned EGRESS_BLOCKED/403 before this file was written).
// Built and unit-tested against SEC's documented, publicly-published JSON
// shapes (the same shapes lib/enrichment/sources/edgar-client.ts already
// relies on and this repo's own history documents live-verifying in an
// earlier session) — see the final report for the full list of blocked
// hosts and what that means for this session's verification.
// ============================================================

import {
  loadTickerMap,
  userAgent,
  matchTicker,
  SUBMISSIONS_URL,
  FETCH_TIMEOUT_MS,
  type TickerEntry,
  type SubmissionsResponse,
} from '@/lib/enrichment/sources/edgar-client'
import type {
  CompanyDataProvider,
  CompanySearchQuery,
  ProviderSearchResult,
  CompanyLookupIdentifier,
  NormalizedCompanyRecord,
  CanonicalCompanyFields,
  ProviderHealthCheckResult,
  BulkIngestSource,
  BulkIngestBatchResult,
  BulkIngestSummary,
} from '../types'
import { fetchProviderJson } from '../http-client'

const SCOPE = 'CompanyUniverse:SEC_EDGAR'
const SEARCH_LIMIT_DEFAULT = 25
const BULK_BATCH_SIZE = 500

export function tickerToFields(t: TickerEntry): CanonicalCompanyFields {
  return {
    canonicalName: t.title,
    legalName: t.title,
    cik: String(t.cik_str),
    status: 'unknown', // the ticker map alone doesn't say active/inactive — getCompany() can refine this from the submissions endpoint
    industryCodes: [],
    sicCodes: [],
    naicsCodes: [],
  }
}

function tickerToRecord(t: TickerEntry): NormalizedCompanyRecord {
  return {
    fields: tickerToFields(t),
    provenance: {
      sourceProvider: 'sec_edgar',
      sourceRecordId: String(t.cik_str),
      sourceType: 'bulk',
      sourceUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${String(t.cik_str).padStart(10, '0')}`,
      retrievedAt: new Date().toISOString(),
      rawData: t,
    },
  }
}

function nameMatches(title: string, query: string): boolean {
  const t = title.toLowerCase()
  const q = query.toLowerCase().trim()
  if (!q) return true
  return t.includes(q)
}

// Common XBRL us-gaap revenue tags, most-specific-first — SEC filers don't
// all use the same tag, this is a best-effort ordered search, not a
// guaranteed match. Only the most recent 10-K (annual, fp='FY') value is
// used, per Section 6's "prefer deterministic SEC evidence over LLM
// inference" — a quarterly figure isn't annual revenue and is deliberately
// excluded rather than silently treated as one.
const REVENUE_TAGS = [
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'RevenueFromContractWithCustomerIncludingAssessedTax',
  'Revenues',
  'SalesRevenueNet',
]

interface XbrlFact {
  val: number
  fy?: number
  fp?: string
  form?: string
  end?: string
}
interface XbrlCompanyFacts {
  facts?: { 'us-gaap'?: Record<string, { units?: { USD?: XbrlFact[] } }> }
}

async function fetchLatestAnnualRevenue(cik: number): Promise<{ revenue: number; year?: number } | null> {
  const cik10 = String(cik).padStart(10, '0')
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik10}.json`
  const result = await fetchProviderJson<XbrlCompanyFacts>(url, SCOPE, {
    headers: { 'User-Agent': userAgent() },
    timeoutMs: FETCH_TIMEOUT_MS,
  })
  if (!result.ok) return null

  for (const tag of REVENUE_TAGS) {
    const facts = result.data.facts?.['us-gaap']?.[tag]?.units?.USD
    if (!facts?.length) continue
    const annual = facts.filter(f => f.form === '10-K' && f.fp === 'FY' && typeof f.val === 'number')
    if (annual.length === 0) continue
    annual.sort((a, b) => (b.end ?? '').localeCompare(a.end ?? ''))
    return { revenue: annual[0].val, year: annual[0].fy }
  }
  return null
}

async function submissionsToFields(cik: number, data: SubmissionsResponse): Promise<CanonicalCompanyFields> {
  const location = data.addresses?.business
  const revenue = await fetchLatestAnnualRevenue(cik).catch(() => null)
  return {
    canonicalName: data.name || String(cik),
    legalName: data.name,
    cik: String(cik),
    country: location?.stateOrCountry,
    city: location?.city,
    industry: data.sicDescription,
    sicCodes: data.sic ? [data.sic] : [],
    industryCodes: [],
    naicsCodes: [],
    revenue: revenue?.revenue,
    revenueCurrency: revenue ? 'USD' : undefined,
    revenueYear: revenue?.year,
    status: 'unknown', // SEC submissions doesn't expose a clean active/dissolved flag; left honestly unknown rather than assumed active
  }
}

export const SecEdgarProvider: CompanyDataProvider = {
  name: 'sec_edgar',
  displayName: 'SEC EDGAR',
  capabilities: { search: true, getCompany: true, bulkIngest: true, refresh: true },

  async healthCheck(): Promise<ProviderHealthCheckResult> {
    const startedAt = Date.now()
    const tickers = await loadTickerMap()
    return {
      provider: 'sec_edgar',
      configured: true, // no API key required
      healthy: tickers !== null,
      reason: tickers ? undefined : 'Could not fetch/parse the SEC ticker map (www.sec.gov unreachable or returned an unexpected shape)',
      latencyMs: Date.now() - startedAt,
    }
  },

  async search(query: CompanySearchQuery): Promise<ProviderSearchResult> {
    const tickers = await loadTickerMap()
    if (!tickers) {
      return { records: [], appliedFilters: [], unsupportedFilters: [], error: 'SEC ticker map unavailable' }
    }

    const unsupportedFilters: string[] = []
    const appliedFilters: string[] = []

    let candidates = tickers
    if (query.name) {
      candidates = candidates.filter(t => nameMatches(t.title, query.name!))
      appliedFilters.push('name')
    }
    if (query.country || query.countryCode) unsupportedFilters.push('country')
    if (query.industry) unsupportedFilters.push('industry')
    if (query.sicCodes?.length) unsupportedFilters.push('sicCodes')
    if (query.naicsCodes?.length) unsupportedFilters.push('naicsCodes')
    if (query.employeeCountMin !== undefined || query.employeeCountMax !== undefined) unsupportedFilters.push('employeeCount')
    if (query.status) unsupportedFilters.push('status')

    const limit = query.limit ?? SEARCH_LIMIT_DEFAULT
    const records = candidates.slice(0, limit).map(tickerToRecord)

    return { records, appliedFilters, unsupportedFilters, totalAvailable: candidates.length }
  },

  async getCompany(identifier: CompanyLookupIdentifier): Promise<NormalizedCompanyRecord | null> {
    const tickers = await loadTickerMap()
    if (!tickers) return null

    let match: TickerEntry | null = null
    if (identifier.cik) {
      match = tickers.find(t => String(t.cik_str) === String(identifier.cik).replace(/^0+/, '')) ?? null
    } else if (identifier.name) {
      match = matchTicker(identifier.name, tickers)
    }
    if (!match) return null

    const cik10 = String(match.cik_str).padStart(10, '0')
    const result = await fetchProviderJson<SubmissionsResponse>(SUBMISSIONS_URL(cik10), SCOPE, {
      headers: { 'User-Agent': userAgent() },
      timeoutMs: FETCH_TIMEOUT_MS,
    })
    if (!result.ok) return null

    const fields = await submissionsToFields(match.cik_str, result.data)
    return {
      fields,
      provenance: {
        sourceProvider: 'sec_edgar',
        sourceRecordId: String(match.cik_str),
        sourceType: 'api',
        sourceUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik10}`,
        retrievedAt: new Date().toISOString(),
        rawData: result.data,
      },
    }
  },

  // The ticker map itself IS effectively SEC's bulk company list (~10k+
  // entries, already fetched and cached in memory as one file) — "bulk
  // ingestion" here means chunking that already-loaded array into batches
  // for the caller rather than a second network transfer, satisfying
  // Section 11's "don't hold entire dataset... insert one record at a
  // time" at the ingestion-pipeline boundary even though the source fetch
  // itself is a single JSON file, not a stream.
  async bulkIngest(
    _source: BulkIngestSource,
    onBatch: (records: NormalizedCompanyRecord[]) => Promise<BulkIngestBatchResult | void>
  ): Promise<BulkIngestSummary> {
    const tickers = await loadTickerMap()
    if (!tickers) return { totalFetched: 0, totalParsed: 0, totalRejected: 0, error: 'SEC ticker map unavailable' }

    let totalFetched = 0
    let totalParsed = 0
    let totalRejected = 0

    for (let i = 0; i < tickers.length; i += BULK_BATCH_SIZE) {
      const batch = tickers.slice(i, i + BULK_BATCH_SIZE)
      const records = batch.map(tickerToRecord)
      totalFetched += batch.length
      const result = await onBatch(records)
      if (result) {
        totalParsed += result.parsed
        totalRejected += result.rejected
      } else {
        totalParsed += records.length
      }
    }

    return { totalFetched, totalParsed, totalRejected }
  },
}
