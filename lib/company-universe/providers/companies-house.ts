// ============================================================
// Company Universe — UK Companies House provider
// ============================================================
// Demaze_Multi_Source_Company_Universe_Claude_Prompt.md, Section 3.
// "Prefer the bulk snapshot for building the local UK company universe.
// Use the API for refreshing individual records/targeted enrichment. Do
// NOT make thousands of API calls when the bulk dataset can provide the
// base universe." Both are implemented: search()/getCompany() hit the live
// REST API (Basic Auth, API key as username / blank password, per
// Companies House's own documented convention); bulkIngest() streams a
// caller-already-downloaded monthly "Basic Company Data" CSV snapshot —
// same reasoning as gleif.ts's bulkIngest() for NOT hardcoding today's
// download URL (download.companieshouse.gov.uk publishes a new dated file
// every month; this adapter takes a local filePath the caller has already
// fetched from whichever URL is current).
//
// Rate limit is the one number this prompt gave directly (Section 3: "the
// default rate limit of 600 requests per 5 minutes") — used verbatim
// below, not a placeholder like the GLEIF/OpenCorporates limits.
//
// NOT LIVE-VERIFIED in this session — api.company-information.service.gov.uk
// is blocked by this session's network egress policy (confirmed via
// WebFetch/curl, EGRESS_BLOCKED/403). No COMPANIES_HOUSE_API_KEY is
// configured in this environment either — same "two separate blockers,
// reported separately" note as opencorporates.ts.
// ============================================================

import { fetchProviderJson } from '../http-client'
import { createReadStream } from 'fs'
import Papa from 'papaparse'
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

const SCOPE = 'CompanyUniverse:CompaniesHouse'
const BASE_URL = 'https://api.company-information.service.gov.uk'
const SEARCH_LIMIT_DEFAULT = 25
// The one rate limit this source prompt states directly (Section 3).
const RATE_LIMIT = { limit: 600, windowMs: 5 * 60_000 }
const BULK_BATCH_SIZE = 500

export function getCompaniesHouseApiKey(): string | null {
  return process.env.COMPANIES_HOUSE_API_KEY || null
}

function authHeader(apiKey: string): Record<string, string> {
  // Companies House Basic Auth: API key as username, blank password.
  return { Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}` }
}

interface ChAddress {
  address_line_1?: string
  locality?: string
  postal_code?: string
  country?: string
}
interface ChSearchItem {
  title: string
  company_number: string
  company_status?: string
  company_type?: string
  date_of_creation?: string
  date_of_cessation?: string
  sic_codes?: string[]
  address?: ChAddress
}
interface ChSearchResponse {
  items?: ChSearchItem[]
  total_results?: number
}
interface ChProfile {
  company_name: string
  company_number: string
  company_status?: string
  type?: string
  date_of_creation?: string
  date_of_cessation?: string
  sic_codes?: string[]
  registered_office_address?: ChAddress
}

export function mapStatus(status: string | undefined): CanonicalCompanyFields['status'] {
  if (!status) return 'unknown'
  const s = status.toLowerCase()
  if (s === 'active') return 'active'
  if (s === 'dissolved' || s === 'liquidation' || s === 'converted-closed') return 'dissolved'
  if (s.includes('administration') || s.includes('receivership')) return 'inactive'
  return 'unknown'
}

export function itemToFields(item: ChSearchItem): CanonicalCompanyFields {
  return {
    canonicalName: item.title,
    legalName: item.title,
    companyNumber: item.company_number,
    registrationAuthority: 'gb',
    country: item.address?.country || 'United Kingdom',
    countryCode: 'GB',
    city: item.address?.locality,
    registeredAddress: item.address?.address_line_1,
    companyType: item.company_type,
    foundedYear: item.date_of_creation ? Number(item.date_of_creation.slice(0, 4)) || undefined : undefined,
    status: mapStatus(item.company_status),
    sicCodes: item.sic_codes ?? [],
    industryCodes: [], naicsCodes: [],
  }
}

function profileToFields(profile: ChProfile): CanonicalCompanyFields {
  return {
    canonicalName: profile.company_name,
    legalName: profile.company_name,
    companyNumber: profile.company_number,
    registrationAuthority: 'gb',
    country: profile.registered_office_address?.country || 'United Kingdom',
    countryCode: 'GB',
    city: profile.registered_office_address?.locality,
    registeredAddress: profile.registered_office_address?.address_line_1,
    companyType: profile.type,
    foundedYear: profile.date_of_creation ? Number(profile.date_of_creation.slice(0, 4)) || undefined : undefined,
    status: mapStatus(profile.company_status),
    sicCodes: profile.sic_codes ?? [],
    industryCodes: [], naicsCodes: [],
  }
}

// Pure CSV-row -> NormalizedCompanyRecord mapping, extracted out of
// bulkIngest()'s Papa.parse step callback so it's unit-testable without a
// real file stream — same reasoning as gleif.ts's csvRowToRecord().
export function csvRowToRecord(row: Record<string, string>): NormalizedCompanyRecord | null {
  const name = row['CompanyName']
  const number = row['CompanyNumber']
  if (!name || !number) return null

  const sicCodes = [row['SICCode.SicText_1'], row['SICCode.SicText_2'], row['SICCode.SicText_3'], row['SICCode.SicText_4']]
    .map(s => s?.split(' - ')[0]?.trim())
    .filter((s): s is string => !!s)
  const fields: CanonicalCompanyFields = {
    canonicalName: name,
    legalName: name,
    companyNumber: number,
    registrationAuthority: 'gb',
    country: row['RegAddress.Country'] || row['CountryOfOrigin'] || 'United Kingdom',
    countryCode: 'GB',
    city: row['RegAddress.PostTown'],
    registeredAddress: [row['RegAddress.AddressLine1'], row['RegAddress.AddressLine2'], row['RegAddress.PostTown'], row['RegAddress.PostCode']].filter(Boolean).join(', '),
    companyType: row['CompanyCategory'],
    foundedYear: row['IncorporationDate'] ? Number(row['IncorporationDate'].slice(0, 4)) || undefined : undefined,
    status: mapStatus(row['CompanyStatus']),
    sicCodes,
    industryCodes: [], naicsCodes: [],
  }
  return {
    fields,
    provenance: {
      sourceProvider: 'companies_house',
      sourceRecordId: number,
      sourceType: 'bulk',
      retrievedAt: new Date().toISOString(),
      rawData: row,
    },
  }
}

export const CompaniesHouseProvider: CompanyDataProvider = {
  name: 'companies_house',
  displayName: 'UK Companies House',
  capabilities: { search: true, getCompany: true, bulkIngest: true, refresh: true },

  async healthCheck(): Promise<ProviderHealthCheckResult> {
    const key = getCompaniesHouseApiKey()
    if (!key) return { provider: 'companies_house', configured: false, healthy: false, reason: 'COMPANIES_HOUSE_API_KEY is not set' }
    const result = await fetchProviderJson<ChSearchResponse>(
      `${BASE_URL}/search/companies?q=test&items_per_page=1`,
      SCOPE,
      { headers: authHeader(key), timeoutMs: 8_000, rateLimit: { key: 'companies_house', config: RATE_LIMIT } }
    )
    return {
      provider: 'companies_house',
      configured: true,
      healthy: result.ok,
      reason: result.ok ? undefined : result.error,
      latencyMs: result.ok ? result.latencyMs : undefined,
    }
  },

  async search(query: CompanySearchQuery): Promise<ProviderSearchResult> {
    const key = getCompaniesHouseApiKey()
    if (!key) {
      return { records: [], appliedFilters: [], unsupportedFilters: [], error: 'COMPANIES_HOUSE_API_KEY is not set — degrading gracefully' }
    }
    if (query.countryCode && query.countryCode.toUpperCase() !== 'GB') {
      // Companies House only ever has UK-registered companies — a non-UK
      // country filter means this provider has nothing to contribute,
      // returning early rather than spending a real API call on a query it
      // structurally cannot answer.
      return { records: [], appliedFilters: [], unsupportedFilters: ['countryCode'], totalAvailable: 0 }
    }

    const appliedFilters: string[] = []
    const unsupportedFilters: string[] = []
    const params = new URLSearchParams()
    if (query.name) { params.set('q', query.name); appliedFilters.push('name') }
    else params.set('q', '') // Companies House's search endpoint requires a q param; an empty one is valid and returns broadly, same as the other providers' empty-query handling

    params.set('items_per_page', String(query.limit ?? SEARCH_LIMIT_DEFAULT))

    if (query.countryCode) appliedFilters.push('countryCode') // implicitly true — every result IS GB, handled by the early-return above for the negative case
    if (query.status) unsupportedFilters.push('status') // the search endpoint doesn't filter by status server-side; caller filters client-side on the returned company_status
    if (query.industry) unsupportedFilters.push('industry')
    if (query.sicCodes?.length) unsupportedFilters.push('sicCodes') // search doesn't filter by SIC; getCompany()'s profile does return sic_codes for post-hoc filtering
    if (query.naicsCodes?.length) unsupportedFilters.push('naicsCodes') // Companies House uses UK SIC 2007, not NAICS, at all
    if (query.employeeCountMin !== undefined || query.employeeCountMax !== undefined) unsupportedFilters.push('employeeCount') // no firmographic size data

    const result = await fetchProviderJson<ChSearchResponse>(
      `${BASE_URL}/search/companies?${params.toString()}`,
      SCOPE,
      { headers: authHeader(key), timeoutMs: 10_000, rateLimit: { key: 'companies_house', config: RATE_LIMIT } }
    )
    if (!result.ok) return { records: [], appliedFilters, unsupportedFilters, error: result.error }

    let items = result.data.items ?? []
    if (query.status) {
      items = items.filter(i => mapStatus(i.company_status) === query.status)
    }

    return {
      records: items.map(i => ({
        fields: itemToFields(i),
        provenance: {
          sourceProvider: 'companies_house' as const,
          sourceRecordId: i.company_number,
          sourceType: 'api' as const,
          sourceUrl: `https://find-and-update.company-information.service.gov.uk/company/${i.company_number}`,
          retrievedAt: new Date().toISOString(),
          rawData: i,
        },
      })),
      appliedFilters,
      unsupportedFilters,
      totalAvailable: result.data.total_results,
    }
  },

  async getCompany(identifier: CompanyLookupIdentifier): Promise<NormalizedCompanyRecord | null> {
    const key = getCompaniesHouseApiKey()
    if (!key || !identifier.companyNumber) return null

    const result = await fetchProviderJson<ChProfile>(
      `${BASE_URL}/company/${encodeURIComponent(identifier.companyNumber)}`,
      SCOPE,
      { headers: authHeader(key), timeoutMs: 8_000, rateLimit: { key: 'companies_house', config: RATE_LIMIT } }
    )
    if (!result.ok) return null

    return {
      fields: profileToFields(result.data),
      provenance: {
        sourceProvider: 'companies_house',
        sourceRecordId: result.data.company_number,
        sourceType: 'api',
        sourceUrl: `https://find-and-update.company-information.service.gov.uk/company/${result.data.company_number}`,
        retrievedAt: new Date().toISOString(),
        rawData: result.data,
      },
    }
  },

  // Streams a caller-already-downloaded "Basic Company Data" monthly CSV
  // snapshot (download.companieshouse.gov.uk) — column names follow that
  // dataset's long-stable published format (CompanyName, CompanyNumber,
  // RegAddress.*, CompanyStatus, IncorporationDate, DissolutionDate,
  // SICCode.SicText_1..4, CountryOfOrigin). Same never-load-whole-file-in-
  // memory / batched-with-backpressure shape as gleif.ts's bulkIngest().
  async bulkIngest(
    source: BulkIngestSource,
    onBatch: (records: NormalizedCompanyRecord[]) => Promise<BulkIngestBatchResult | void>
  ): Promise<BulkIngestSummary> {
    if (!source.filePath) {
      return { totalFetched: 0, totalParsed: 0, totalRejected: 0, error: 'Companies House bulkIngest requires a local filePath to an already-downloaded Basic Company Data CSV' }
    }

    let totalFetched = 0
    let totalParsed = 0
    let totalRejected = 0
    let buffer: NormalizedCompanyRecord[] = []
    let pendingFlush: Promise<void> = Promise.resolve()

    return new Promise<BulkIngestSummary>((resolve) => {
      const stream = createReadStream(source.filePath!)
      Papa.parse<Record<string, string>>(stream, {
        header: true,
        skipEmptyLines: true,
        step: (results, parser) => {
          const row = results.data
          totalFetched++
          const record = csvRowToRecord(row)
          if (!record) {
            totalRejected++
            return
          }
          buffer.push(record)
          totalParsed++

          if (buffer.length >= BULK_BATCH_SIZE) {
            parser.pause()
            const toFlush = buffer
            buffer = []
            pendingFlush = pendingFlush
              .then(() => onBatch(toFlush))
              .then((r) => { if (r) totalRejected += r.rejected; parser.resume() })
              .catch(() => { parser.resume() })
          }
        },
        complete: () => {
          pendingFlush
            .then(async () => {
              if (buffer.length > 0) {
                const r = await onBatch(buffer).catch(() => undefined)
                if (r) totalRejected += r.rejected
              }
              resolve({ totalFetched, totalParsed, totalRejected })
            })
            .catch(() => resolve({ totalFetched, totalParsed, totalRejected }))
        },
        error: (err: Error) => resolve({ totalFetched, totalParsed, totalRejected, error: err.message }),
      })
    })
  },
}
