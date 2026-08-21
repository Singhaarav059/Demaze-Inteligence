// ============================================================
// Company Universe — OpenCorporates provider
// ============================================================
// Demaze_Multi_Source_Company_Universe_Claude_Prompt.md, Section 5.
// Global company-discovery/legal-entity-matching source, 200M+ companies
// with source provenance per OpenCorporates' own documentation. Requires
// an API token (OPENCORPORATES_API_TOKEN) — Section 5 is explicit that
// this must "degrade gracefully rather than blocking the entire discovery
// engine" when the account/plan is too restrictive or unconfigured, same
// discipline CLAUDE.md documents for this repo's own prior Apollo
// integration attempt (build the adapter, treat a real 403/quota error as
// evidence the code path works, never a code bug to route around).
//
// Same "do not scrape OpenCorporates, respect rate limits/quota/licensing"
// hard rule as Section 5/29 — this adapter only ever calls the documented
// REST API, never fetches opencorporates.com HTML.
//
// NOT LIVE-VERIFIED in this session — api.opencorporates.com is blocked by
// this session's network egress policy (confirmed via WebFetch/curl, both
// returned EGRESS_BLOCKED/403). No OPENCORPORATES_API_TOKEN is configured
// in this environment either way, so even without the network block this
// adapter would currently report itself unconfigured — see the final
// report for both facts stated separately (a missing key and a blocked
// network are different blockers, and this codebase's own convention is to
// report them as such rather than collapsing them into one vague "doesn't
// work").
// ============================================================

import { fetchProviderJson } from '../http-client'
import type {
  CompanyDataProvider,
  CompanySearchQuery,
  ProviderSearchResult,
  CompanyLookupIdentifier,
  NormalizedCompanyRecord,
  CanonicalCompanyFields,
  ProviderHealthCheckResult,
} from '../types'

const SCOPE = 'CompanyUniverse:OpenCorporates'
const BASE_URL = 'https://api.opencorporates.com/v0.4'
const SEARCH_LIMIT_DEFAULT = 25
// Conservative placeholder, same caveat as gleif.ts's RATE_LIMIT — this
// session could not reach OpenCorporates' own docs to confirm the real
// current per-plan limit.
const RATE_LIMIT = { limit: 20, windowMs: 60_000 }

export function getOpenCorporatesApiToken(): string | null {
  return process.env.OPENCORPORATES_API_TOKEN || null
}

interface OcIndustryCode {
  industry_code?: { code?: string; description?: string; code_scheme_id?: string; code_scheme_name?: string }
}
export interface OcCompany {
  name: string
  company_number: string
  jurisdiction_code: string
  incorporation_date?: string
  dissolution_date?: string
  company_type?: string
  current_status?: string
  inactive?: boolean
  registered_address_in_full?: string
  registry_url?: string
  industry_codes?: OcIndustryCode[]
}
interface OcSearchResponse {
  results?: {
    companies?: Array<{ company: OcCompany }>
    total_count?: number
    page?: number
    per_page?: number
  }
}
interface OcGetResponse {
  results?: { company?: OcCompany }
}

export function mapStatus(company: OcCompany): CanonicalCompanyFields['status'] {
  if (company.dissolution_date || company.inactive === true) return 'dissolved'
  const status = (company.current_status || '').toLowerCase()
  if (status.includes('active') || status.includes('good standing')) return 'active'
  if (status.includes('inactive') || status.includes('dissolved') || status.includes('struck off')) return 'dissolved'
  return 'unknown'
}

// jurisdiction_code is OpenCorporates' own compound code (e.g. "us_de",
// "gb", "in") — the leading 2-letter segment is the ISO country code for
// every jurisdiction shape OpenCorporates documents, so this is a safe,
// simple mapping rather than needing OpenCorporates' full jurisdiction list.
export function jurisdictionToCountryCode(jurisdictionCode: string): string | undefined {
  const seg = jurisdictionCode.split('_')[0]
  return seg ? seg.toUpperCase() : undefined
}

export function companyToFields(company: OcCompany): CanonicalCompanyFields {
  const naics = company.industry_codes?.filter(c => c.industry_code?.code_scheme_name?.toUpperCase().includes('NAICS')).map(c => c.industry_code!.code!).filter(Boolean) ?? []
  const sic = company.industry_codes?.filter(c => c.industry_code?.code_scheme_name?.toUpperCase().includes('SIC')).map(c => c.industry_code!.code!).filter(Boolean) ?? []

  return {
    canonicalName: company.name,
    legalName: company.name,
    companyNumber: company.company_number,
    registrationAuthority: company.jurisdiction_code,
    countryCode: jurisdictionToCountryCode(company.jurisdiction_code),
    country: jurisdictionToCountryCode(company.jurisdiction_code),
    registeredAddress: company.registered_address_in_full,
    companyType: company.company_type,
    foundedYear: company.incorporation_date ? Number(company.incorporation_date.slice(0, 4)) || undefined : undefined,
    status: mapStatus(company),
    naicsCodes: naics,
    sicCodes: sic,
    industryCodes: [],
  }
}

function companyToRecord(company: OcCompany): NormalizedCompanyRecord {
  return {
    fields: companyToFields(company),
    provenance: {
      sourceProvider: 'opencorporates',
      sourceRecordId: `${company.jurisdiction_code}/${company.company_number}`,
      sourceType: 'api',
      sourceUrl: company.registry_url,
      retrievedAt: new Date().toISOString(),
      rawData: company,
    },
  }
}

export const OpenCorporatesProvider: CompanyDataProvider = {
  name: 'opencorporates',
  displayName: 'OpenCorporates',
  // No bulkIngest — OpenCorporates does not publish a free bulk-download
  // dataset (Section 5 only describes API access with usage limits); a
  // full-database export requires a commercial data license, out of scope
  // per Section 3 ("no new vendors" beyond what this plan explicitly names).
  capabilities: { search: true, getCompany: true, bulkIngest: false, refresh: true },

  async healthCheck(): Promise<ProviderHealthCheckResult> {
    const token = getOpenCorporatesApiToken()
    if (!token) {
      return { provider: 'opencorporates', configured: false, healthy: false, reason: 'OPENCORPORATES_API_TOKEN is not set' }
    }
    const result = await fetchProviderJson<OcSearchResponse>(
      `${BASE_URL}/companies/search?q=test&per_page=1&api_token=${encodeURIComponent(token)}`,
      SCOPE,
      { timeoutMs: 8_000, rateLimit: { key: 'opencorporates', config: RATE_LIMIT } }
    )
    return {
      provider: 'opencorporates',
      configured: true,
      healthy: result.ok,
      reason: result.ok ? undefined : result.error,
      latencyMs: result.ok ? result.latencyMs : undefined,
    }
  },

  async search(query: CompanySearchQuery): Promise<ProviderSearchResult> {
    const token = getOpenCorporatesApiToken()
    if (!token) {
      return { records: [], appliedFilters: [], unsupportedFilters: [], error: 'OPENCORPORATES_API_TOKEN is not set — OpenCorporates is unconfigured, degrading gracefully (Section 5)' }
    }

    const params = new URLSearchParams({ api_token: token })
    const appliedFilters: string[] = []
    const unsupportedFilters: string[] = []

    if (query.name) { params.set('q', query.name); appliedFilters.push('name') }
    else params.set('q', '*')

    if (query.countryCode) { params.set('jurisdiction_code', query.countryCode.toLowerCase()); appliedFilters.push('countryCode') }
    else if (query.country) unsupportedFilters.push('country') // OpenCorporates only filters by jurisdiction_code, not a free-text country name

    if (query.status === 'active') { params.set('current_status', 'Active'); appliedFilters.push('status') }
    else if (query.status) unsupportedFilters.push('status')

    if (query.industry) unsupportedFilters.push('industry') // no free-text industry filter on OpenCorporates' search endpoint
    if (query.sicCodes?.length) unsupportedFilters.push('sicCodes')
    if (query.naicsCodes?.length) unsupportedFilters.push('naicsCodes')
    if (query.employeeCountMin !== undefined || query.employeeCountMax !== undefined) unsupportedFilters.push('employeeCount') // OpenCorporates has no firmographic size data

    params.set('per_page', String(query.limit ?? SEARCH_LIMIT_DEFAULT))

    const result = await fetchProviderJson<OcSearchResponse>(
      `${BASE_URL}/companies/search?${params.toString()}`,
      SCOPE,
      { timeoutMs: 10_000, rateLimit: { key: 'opencorporates', config: RATE_LIMIT } }
    )
    if (!result.ok) {
      return { records: [], appliedFilters, unsupportedFilters, error: result.error }
    }

    const companies = result.data.results?.companies?.map(c => c.company) ?? []
    return {
      records: companies.map(companyToRecord),
      appliedFilters,
      unsupportedFilters,
      totalAvailable: result.data.results?.total_count,
    }
  },

  async getCompany(identifier: CompanyLookupIdentifier): Promise<NormalizedCompanyRecord | null> {
    const token = getOpenCorporatesApiToken()
    if (!token) return null
    if (!identifier.companyNumber || !identifier.registrationAuthority) return null // OpenCorporates' get-by-id endpoint needs jurisdiction_code + company_number together

    const result = await fetchProviderJson<OcGetResponse>(
      `${BASE_URL}/companies/${encodeURIComponent(identifier.registrationAuthority)}/${encodeURIComponent(identifier.companyNumber)}?api_token=${encodeURIComponent(token)}`,
      SCOPE,
      { timeoutMs: 8_000, rateLimit: { key: 'opencorporates', config: RATE_LIMIT } }
    )
    if (!result.ok || !result.data.results?.company) return null
    return companyToRecord(result.data.results.company)
  },
}
