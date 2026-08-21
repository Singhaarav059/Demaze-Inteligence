// ============================================================
// Company Universe — India MCA (Ministry of Corporate Affairs) provider
// ============================================================
// Demaze_Multi_Source_Company_Universe_Claude_Prompt.md, Section 2.
//
// LOWEST-CONFIDENCE ADAPTER OF THE FIVE — read this whole comment before
// trusting field mappings from this file. Two separate things could not be
// confirmed in this session, for two separate reasons:
//
// 1. The HTTP contract (api.data.gov.in's generic "resource API" shape —
//    GET /resource/{resource_id}?api-key=...&format=json&offset=...&limit=...
//    returning {field: [{id,name,type}], records: [...], total, count,
//    limit, offset}) is a well-documented, stable pattern used uniformly
//    across every dataset on India's Open Government Data platform — this
//    part is implemented with reasonable confidence.
// 2. The Company Master Data dataset's own RESOURCE ID (the UUID that
//    identifies this specific dataset on data.gov.in) and its exact column
//    names (CIN/company name/status/etc.) could NOT be confirmed — this
//    session's network egress policy blocks data.gov.in and api.data.gov.in
//    entirely (confirmed via WebFetch, which returned EGRESS_BLOCKED), so
//    the actual data.gov.in/catalog/company-master-data page could not be
//    inspected to extract the real resource ID or a sample record.
//
// Per Section 29 ("do not implement around assumptions") and this
// project's own no-hallucination rule: the resource ID is NOT hardcoded
// here — it's a required env var (MCA_DATA_GOV_RESOURCE_ID) that whoever
// deploys this must fill in after finding the real UUID on the dataset's
// catalog page. Column-name lookup uses a defensive, multi-alias `col()`
// helper (same pattern as the GLEIF/Companies House bulk CSV parsers) built
// from the field names commonly published for MCA-derived company-master
// datasets — but these are NOT confirmed against a real live response and
// MUST be checked against one before this adapter is trusted in production.
// Field-name aliases are a single array per field specifically so fixing a
// wrong guess later is a one-line change, not a rewrite.
//
// India's MCA has no CAPTCHA-free public API of its OWN (CLAUDE.md already
// documents this finding from an earlier session, independently arrived at
// again by this session's own Section 1 inspection) — data.gov.in's
// government-published OGD mirror of MCA's master data is the only
// CAPTCHA-free path, which is exactly why Section 2 names it specifically
// instead of the mca.gov.in portal itself.
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

const SCOPE = 'CompanyUniverse:IndiaMCA'
const SEARCH_LIMIT_DEFAULT = 25
// data.gov.in's OGD API documents a default rate limit in the same rough
// range as other government open-data portals — not confirmed for this
// specific dataset in this session (network blocked), kept conservative.
const RATE_LIMIT = { limit: 30, windowMs: 60_000 }

export function getMcaResourceId(): string | null {
  return process.env.MCA_DATA_GOV_RESOURCE_ID || null
}
export function getMcaApiKey(): string | null {
  // data.gov.in publishes a shared demo key for light testing, but a real
  // deployment needs its own registered key — never hardcoded here, same
  // "no credentials in code" discipline as every other provider in this
  // repo.
  return process.env.MCA_DATA_GOV_API_KEY || null
}

function resourceUrl(resourceId: string, apiKey: string, params: Record<string, string>): string {
  const usp = new URLSearchParams({ 'api-key': apiKey, format: 'json', ...params })
  return `https://api.data.gov.in/resource/${resourceId}?${usp.toString()}`
}

interface OgdResourceResponse {
  total?: number
  count?: number
  limit?: string
  offset?: string
  records?: Array<Record<string, string>>
}

// Multi-alias, case-insensitive field lookup — see the file header for why
// this defensiveness exists instead of a fixed column list.
export function col(row: Record<string, string>, ...aliases: string[]): string | undefined {
  const lower: Record<string, string> = {}
  for (const k of Object.keys(row)) lower[k.toLowerCase().replace(/[\s_]/g, '')] = row[k]
  for (const a of aliases) {
    const v = lower[a.toLowerCase().replace(/[\s_]/g, '')]
    if (v) return v
  }
  return undefined
}

export function mapStatus(raw: string | undefined): CanonicalCompanyFields['status'] {
  if (!raw) return 'unknown'
  const s = raw.toLowerCase()
  if (s.includes('active')) return 'active'
  // MCA's own status vocabulary uses "Strike Off" (the action), not the
  // past-tense "Struck Off" — caught by a real test failure while writing
  // this adapter's test suite, fixed here rather than in the test.
  if (s.includes('dissolved') || s.includes('strike off') || s.includes('struck off') || s.includes('amalgamated')) return 'dissolved'
  if (s.includes('dormant') || s.includes('under process') || s.includes('liquidation')) return 'inactive'
  return 'unknown'
}

export function rowToFields(row: Record<string, string>): CanonicalCompanyFields | null {
  const cin = col(row, 'CIN', 'CorporateIdentificationNumber')
  const name = col(row, 'CompanyName', 'CompanyMaster_Name', 'Name')
  if (!cin || !name) return null

  return {
    canonicalName: name,
    legalName: name,
    cin,
    registrationId: cin,
    registrationAuthority: 'mca_in',
    country: 'India',
    countryCode: 'IN',
    stateRegion: col(row, 'RegisteredState', 'CompanyStateCode', 'State'),
    companyType: col(row, 'CompanyClass', 'CompanyCategory'),
    entityType: col(row, 'CompanySubCategory'),
    industry: col(row, 'PrincipalBusinessActivity', 'ActivityDescription', 'CompanyIndustrialClassification'),
    foundedYear: (() => {
      const d = col(row, 'DateOfRegistration', 'RegistrationDate')
      const year = d ? Number(d.slice(-4)) || Number(d.slice(0, 4)) : undefined
      return Number.isFinite(year) && year ? year : undefined
    })(),
    revenue: undefined, // MCA master data has authorized/paid-up CAPITAL, not revenue — deliberately not mapped to the revenue field to avoid conflating the two
    status: mapStatus(col(row, 'CompanyStatus', 'Status')),
    industryCodes: [], sicCodes: [], naicsCodes: [],
    // Authorized/paid-up capital doesn't have a dedicated canonical field
    // (it's not "revenue" and not "employee count") — surfaced only via
    // provenance.rawData for now rather than forcing it into a
    // wrong-shaped field. A future session adding a dedicated
    // `authorizedCapital`/`paidUpCapital` pair to CanonicalCompanyFields
    // (Section 8 said "add only fields that genuinely improve
    // functionality" — plausible, not done here to keep this migration's
    // schema exactly matching what Section 8 asked for) can read it back
    // out of the same raw row.
  }
}

function rowToRecord(row: Record<string, string>): NormalizedCompanyRecord | null {
  const fields = rowToFields(row)
  if (!fields) return null
  return {
    fields,
    provenance: {
      sourceProvider: 'india_mca',
      sourceRecordId: fields.cin!,
      sourceType: 'api',
      sourceUrl: 'https://www.data.gov.in/catalog/company-master-data',
      retrievedAt: new Date().toISOString(),
      rawData: row,
    },
  }
}

export const IndiaMcaProvider: CompanyDataProvider = {
  name: 'india_mca',
  displayName: 'India MCA Company Master Data (data.gov.in)',
  // No bulkIngest: the OGD "resource API" is paginated JSON, not a single
  // downloadable file the way GLEIF's Golden Copy / Companies House's
  // Basic Company Data are — "bulk" ingestion here just means paging
  // through search() with a large limit/offset, which ingestion.ts already
  // handles generically for any search()-only provider. Modeled explicitly
  // as false rather than faked, per Section 7's "don't force every
  // provider to implement methods it doesn't support."
  capabilities: { search: true, getCompany: true, bulkIngest: false, refresh: true },

  async healthCheck(): Promise<ProviderHealthCheckResult> {
    const resourceId = getMcaResourceId()
    const apiKey = getMcaApiKey()
    if (!resourceId || !apiKey) {
      return {
        provider: 'india_mca',
        configured: false,
        healthy: false,
        reason: !resourceId
          ? 'MCA_DATA_GOV_RESOURCE_ID is not set (find the real Company Master Data resource UUID on data.gov.in/catalog/company-master-data and set it)'
          : 'MCA_DATA_GOV_API_KEY is not set',
      }
    }
    const result = await fetchProviderJson<OgdResourceResponse>(
      resourceUrl(resourceId, apiKey, { limit: '1' }),
      SCOPE,
      { timeoutMs: 8_000, rateLimit: { key: 'india_mca', config: RATE_LIMIT } }
    )
    return {
      provider: 'india_mca',
      configured: true,
      healthy: result.ok,
      reason: result.ok ? undefined : result.error,
      latencyMs: result.ok ? result.latencyMs : undefined,
    }
  },

  async search(query: CompanySearchQuery): Promise<ProviderSearchResult> {
    const resourceId = getMcaResourceId()
    const apiKey = getMcaApiKey()
    if (!resourceId || !apiKey) {
      return { records: [], appliedFilters: [], unsupportedFilters: [], error: 'India MCA is unconfigured (missing resource id and/or api key) — degrading gracefully' }
    }
    if (query.countryCode && query.countryCode.toUpperCase() !== 'IN') {
      return { records: [], appliedFilters: [], unsupportedFilters: ['countryCode'], totalAvailable: 0 } // this dataset is India-only, same early-return reasoning as companies-house.ts
    }

    const appliedFilters: string[] = []
    const unsupportedFilters: string[] = []
    const params: Record<string, string> = { limit: String(query.limit ?? SEARCH_LIMIT_DEFAULT) }

    // The OGD resource API supports `filters[<field>]=<value>` for exact
    // (not fuzzy/substring) matches on a known field — a free-text name
    // search is NOT something this generic resource endpoint reliably
    // supports the way a purpose-built search API would, so `name` is
    // conservatively reported as unsupported here rather than sent as a
    // filter that would silently return zero results for a partial match.
    if (query.name) unsupportedFilters.push('name')
    if (query.status) unsupportedFilters.push('status') // would need the exact MCA status string as filter value, not the canonical active/inactive/dissolved/unknown enum — left to client-side post-filtering instead
    if (query.industry) unsupportedFilters.push('industry')
    if (query.sicCodes?.length) unsupportedFilters.push('sicCodes') // MCA master data doesn't use SIC/NAICS at all
    if (query.naicsCodes?.length) unsupportedFilters.push('naicsCodes')
    if (query.employeeCountMin !== undefined || query.employeeCountMax !== undefined) unsupportedFilters.push('employeeCount') // no firmographic size data in this dataset

    const result = await fetchProviderJson<OgdResourceResponse>(
      resourceUrl(resourceId, apiKey, params),
      SCOPE,
      { timeoutMs: 10_000, rateLimit: { key: 'india_mca', config: RATE_LIMIT } }
    )
    if (!result.ok) return { records: [], appliedFilters, unsupportedFilters, error: result.error }

    let records = (result.data.records ?? []).map(rowToRecord).filter((r): r is NormalizedCompanyRecord => r !== null)
    if (query.status) {
      records = records.filter(r => r.fields.status === query.status)
    }

    return { records, appliedFilters, unsupportedFilters, totalAvailable: result.data.total }
  },

  async getCompany(identifier: CompanyLookupIdentifier): Promise<NormalizedCompanyRecord | null> {
    const resourceId = getMcaResourceId()
    const apiKey = getMcaApiKey()
    if (!resourceId || !apiKey || !identifier.cin) return null

    const result = await fetchProviderJson<OgdResourceResponse>(
      resourceUrl(resourceId, apiKey, { 'filters[CIN]': identifier.cin, limit: '1' }),
      SCOPE,
      { timeoutMs: 8_000, rateLimit: { key: 'india_mca', config: RATE_LIMIT } }
    )
    if (!result.ok) return null
    const row = result.data.records?.[0]
    return row ? rowToRecord(row) : null
  },
}
