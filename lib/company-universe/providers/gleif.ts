// ============================================================
// Company Universe — GLEIF provider (global legal-entity identity layer)
// ============================================================
// Demaze_Multi_Source_Company_Universe_Claude_Prompt.md, Section 4.
// "GLEIF is NOT the complete global company universe... many SMEs do not
// have LEIs. GLEIF = identity/verification/corporate relationship layer,
// NOT all global companies." Treated accordingly everywhere this adapter
// is consumed: a GLEIF miss is never evidence a company doesn't exist,
// only that it has no registered LEI.
//
// Public API (api.gleif.org), JSON:API format, no API key required —
// GLEIF's own documentation states the LEI data pool is publicly
// accessible via both bulk files and API. Search/getCompany use the live
// API; bulkIngest() streams a caller-supplied Golden Copy CSV file
// (Section 4's "prefer bulk files for large-scale ingestion") — this
// adapter does NOT hardcode GLEIF's current Golden Copy download URL,
// since that URL is versioned/changes over time and this session had no
// way to confirm the current one (see the file-level network note below);
// bulkIngest() takes a `source.filePath` the caller has already downloaded
// via whatever URL is current at ingestion time.
//
// NOT LIVE-VERIFIED in this session — api.gleif.org is blocked by this
// session's network egress policy (confirmed via WebFetch, which returned
// EGRESS_BLOCKED). Built and unit-tested against GLEIF's documented
// JSON:API response shape (api.gleif.org/api/v1/lei-records) and the
// published LEI-CDF Level 1 field names for the CSV bulk format — neither
// exercised against a real live response in this session. See the final
// report.
//
// The 429/backoff rate-limit default below (RATE_LIMIT) is a conservative
// placeholder, not a number confirmed from GLEIF's own published API
// policy (this session could not reach their docs either) — deliberately
// cautious rather than guessed-permissive; revisit once this adapter can
// actually be exercised against the live API.
// ============================================================

import { createReadStream } from 'fs'
import Papa from 'papaparse'
import { fetchProviderJson } from '../http-client'
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

const SCOPE = 'CompanyUniverse:GLEIF'
const BASE_URL = 'https://api.gleif.org/api/v1'
const SEARCH_LIMIT_DEFAULT = 25
const RATE_LIMIT = { limit: 30, windowMs: 60_000 } // conservative placeholder — see file header
const BULK_BATCH_SIZE = 500

export interface GleifAddress {
  country?: string
  city?: string
  region?: string
}
export interface GleifEntity {
  legalName?: { name?: string }
  legalAddress?: GleifAddress
  headquartersAddress?: GleifAddress
  status?: string // 'ACTIVE' | 'INACTIVE'
  legalForm?: { id?: string; other?: string }
  jurisdiction?: string
}
export interface GleifRecordAttributes {
  lei: string
  entity?: GleifEntity
}
export interface GleifRecord {
  type: string
  id: string
  attributes: GleifRecordAttributes
}
interface GleifListResponse {
  data: GleifRecord[]
  meta?: { pagination?: { total?: number } }
}
interface GleifSingleResponse {
  data: GleifRecord
}

export function mapStatus(gleifStatus: string | undefined): CanonicalCompanyFields['status'] {
  if (!gleifStatus) return 'unknown'
  const s = gleifStatus.toUpperCase()
  if (s === 'ACTIVE') return 'active'
  if (s === 'INACTIVE') return 'inactive'
  return 'unknown'
}

export function recordToFields(r: GleifRecord): CanonicalCompanyFields {
  const entity = r.attributes.entity
  const address = entity?.legalAddress ?? entity?.headquartersAddress
  return {
    canonicalName: entity?.legalName?.name || r.attributes.lei,
    legalName: entity?.legalName?.name,
    lei: r.attributes.lei,
    country: address?.country,
    countryCode: address?.country,
    stateRegion: address?.region,
    city: address?.city,
    entityType: entity?.legalForm?.other || entity?.legalForm?.id,
    status: mapStatus(entity?.status),
    industryCodes: [],
    sicCodes: [],
    naicsCodes: [],
  }
}

// Multi-alias, case-insensitive column lookup for the bulk Golden Copy CSV
// — exported (alongside csvRowToRecord below) specifically so this mapping
// is unit-testable without a real file stream.
export function col(row: Record<string, string>, ...names: string[]): string | undefined {
  const lower: Record<string, string> = {}
  for (const k of Object.keys(row)) lower[k.toLowerCase()] = row[k]
  for (const n of names) {
    const v = lower[n.toLowerCase()]
    if (v) return v
  }
  return undefined
}

// Pure row -> NormalizedCompanyRecord mapping, extracted out of
// bulkIngest()'s Papa.parse step callback specifically so it's testable in
// isolation (no file stream needed) — same reasoning as every other pure
// parsing function this codebase exports for testability (e.g.
// edgar-client.ts's matchTicker, website-discovery.ts's scoreCandidate).
export function csvRowToRecord(row: Record<string, string>): NormalizedCompanyRecord | null {
  const lei = col(row, 'LEI', 'Entity.LEI')
  const legalName = col(row, 'Entity.LegalName', 'LegalName')
  if (!lei || !legalName) return null

  const fields: CanonicalCompanyFields = {
    canonicalName: legalName,
    legalName,
    lei,
    country: col(row, 'Entity.LegalAddress.Country', 'LegalAddress.Country'),
    countryCode: col(row, 'Entity.LegalAddress.Country', 'LegalAddress.Country'),
    city: col(row, 'Entity.LegalAddress.City', 'LegalAddress.City'),
    status: mapStatus(col(row, 'Entity.EntityStatus', 'EntityStatus')),
    industryCodes: [], sicCodes: [], naicsCodes: [],
  }
  return {
    fields,
    provenance: {
      sourceProvider: 'gleif',
      sourceRecordId: lei,
      sourceType: 'bulk',
      retrievedAt: new Date().toISOString(),
      rawData: row,
    },
  }
}

function recordToNormalized(r: GleifRecord): NormalizedCompanyRecord {
  return {
    fields: recordToFields(r),
    provenance: {
      sourceProvider: 'gleif',
      sourceRecordId: r.attributes.lei,
      sourceType: 'api',
      sourceUrl: `https://www.gleif.org/en/lei-data/search#!search?fuzzy=false&page.size=10&page.number=1&q=${encodeURIComponent(r.attributes.lei)}`,
      retrievedAt: new Date().toISOString(),
      rawData: r,
    },
  }
}

export const GleifProvider: CompanyDataProvider = {
  name: 'gleif',
  displayName: 'GLEIF (Global LEI Index)',
  capabilities: { search: true, getCompany: true, bulkIngest: true, refresh: true },

  async healthCheck(): Promise<ProviderHealthCheckResult> {
    const result = await fetchProviderJson<GleifListResponse>(
      `${BASE_URL}/lei-records?page[size]=1`,
      SCOPE,
      { timeoutMs: 8_000, rateLimit: { key: 'gleif', config: RATE_LIMIT } }
    )
    return {
      provider: 'gleif',
      configured: true, // no API key required
      healthy: result.ok,
      reason: result.ok ? undefined : result.error,
      latencyMs: result.ok ? result.latencyMs : undefined,
    }
  },

  async search(query: CompanySearchQuery): Promise<ProviderSearchResult> {
    const unsupportedFilters: string[] = []
    const appliedFilters: string[] = []
    const params = new URLSearchParams()

    if (query.name) {
      params.set('filter[entity.legalName]', query.name)
      appliedFilters.push('name')
    }
    if (query.countryCode) {
      params.set('filter[entity.legalAddress.country]', query.countryCode.toUpperCase())
      appliedFilters.push('countryCode')
    } else if (query.country) {
      unsupportedFilters.push('country') // GLEIF filters by ISO country CODE only, not a free-text country name
    }
    if (query.status) {
      params.set('filter[entity.status]', query.status === 'active' ? 'ACTIVE' : query.status === 'inactive' ? 'INACTIVE' : '')
      appliedFilters.push('status')
    }
    if (query.industry) unsupportedFilters.push('industry')
    if (query.sicCodes?.length) unsupportedFilters.push('sicCodes')
    if (query.naicsCodes?.length) unsupportedFilters.push('naicsCodes')
    if (query.employeeCountMin !== undefined || query.employeeCountMax !== undefined) unsupportedFilters.push('employeeCount') // GLEIF has no firmographic size data at all

    params.set('page[size]', String(query.limit ?? SEARCH_LIMIT_DEFAULT))

    const result = await fetchProviderJson<GleifListResponse>(
      `${BASE_URL}/lei-records?${params.toString()}`,
      SCOPE,
      { timeoutMs: 10_000, rateLimit: { key: 'gleif', config: RATE_LIMIT } }
    )
    if (!result.ok) {
      return { records: [], appliedFilters, unsupportedFilters, error: result.error }
    }

    return {
      records: result.data.data.map(recordToNormalized),
      appliedFilters,
      unsupportedFilters,
      totalAvailable: result.data.meta?.pagination?.total,
    }
  },

  async getCompany(identifier: CompanyLookupIdentifier): Promise<NormalizedCompanyRecord | null> {
    if (!identifier.lei) return null // GLEIF's single-record lookup is LEI-only; name-based lookup goes through search() instead
    const result = await fetchProviderJson<GleifSingleResponse>(
      `${BASE_URL}/lei-records/${encodeURIComponent(identifier.lei)}`,
      SCOPE,
      { timeoutMs: 8_000, rateLimit: { key: 'gleif', config: RATE_LIMIT } }
    )
    if (!result.ok) return null
    return recordToNormalized(result.data.data)
  },

  // Streams a caller-already-downloaded GLEIF Golden Copy CSV (LEI-CDF
  // Level 1 format) — never loads the full file into memory (Section 11).
  // Column-name lookup is case-insensitive and tolerant of the couple of
  // header-naming variants GLEIF's own published schema versions have used,
  // since this session could not download and inspect a real current file
  // to confirm the exact current header set.
  async bulkIngest(
    source: BulkIngestSource,
    onBatch: (records: NormalizedCompanyRecord[]) => Promise<BulkIngestBatchResult | void>
  ): Promise<BulkIngestSummary> {
    if (!source.filePath) {
      return { totalFetched: 0, totalParsed: 0, totalRejected: 0, error: 'GLEIF bulkIngest requires a local filePath to an already-downloaded Golden Copy CSV — this adapter does not fetch the multi-hundred-MB file itself' }
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
              .then((r) => {
                if (r) totalRejected += r.rejected
                parser.resume()
              })
              .catch(() => {
                parser.resume() // never let one failed batch abort the whole stream — same graceful-degradation contract as every other ingestion path in this repo
              })
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
        error: (err: Error) => {
          resolve({ totalFetched, totalParsed, totalRejected, error: err.message })
        },
      })
    })
  },
}
