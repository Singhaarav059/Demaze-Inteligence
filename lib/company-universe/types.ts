// ============================================================
// Company Universe — core types
// ============================================================
// Demaze_Multi_Source_Company_Universe_Claude_Prompt.md, Sections 7-9.
// "Do NOT create one giant provider" — this file is the CompanyDataProvider
// abstraction every adapter in lib/company-universe/providers/ implements,
// plus the canonical company schema (Section 8) every adapter normalizes
// into. Modeled after this repo's existing per-capability provider pattern
// (lib/outbound/*/types.ts + provider-factory.ts: one interface, one file
// per implementation, DB row -> env var -> safe-default resolution) but NOT
// a literal reuse of that pattern — those are single-active-provider
// capabilities (pick exactly one), this is a multi-provider layer where
// every configured provider contributes in parallel and results get merged
// via identity.ts, a fundamentally different shape.
// ============================================================

export type ProviderName = 'india_mca' | 'companies_house' | 'gleif' | 'opencorporates' | 'sec_edgar'

export type CompanyStatus = 'active' | 'inactive' | 'dissolved' | 'unknown'

// A provider may support some methods and not others (Section 7: "Do not
// force every provider to implement methods it doesn't support... e.g.
// bulkDownload() may be supported by GLEIF/Companies House but not
// OpenCorporates"). Consumers must check capabilities before calling a
// method rather than assuming every provider supports everything.
export interface ProviderCapabilities {
  search: boolean
  getCompany: boolean
  bulkIngest: boolean
  refresh: boolean
}

// ── Canonical company schema (Section 8) ────────────────────────────
// Mirrors supabase/migrations/026_company_universe.sql's company_universe
// table field-for-field (camelCase here, snake_case in SQL) — this is the
// shape every provider's normalize() function produces, and the shape
// identity.ts merges across providers. `id` is absent here deliberately —
// this type is the pre-persistence normalized record; the DB row (with a
// real id) is a separate, thin extension used only at the persistence layer
// (see ingestion.ts's CompanyUniverseRow).
export interface CanonicalCompanyFields {
  canonicalName: string
  legalName?: string
  tradeName?: string

  domain?: string

  country?: string
  countryCode?: string
  stateRegion?: string
  city?: string
  registeredAddress?: string

  companyType?: string
  entityType?: string

  industry?: string
  industryCodes: string[]
  sicCodes: string[]
  naicsCodes: string[]

  // Deliberately `number | undefined`, never a manufactured 0 or a guess —
  // Section 17: "Do NOT manufacture values... known / unknown / conflicting
  // states." Absence IS the "unknown" state; there is no separate sentinel.
  employeeCount?: number
  employeeCountMin?: number
  employeeCountMax?: number

  revenue?: number
  revenueCurrency?: string
  revenueYear?: number

  foundedYear?: number

  registrationId?: string
  registrationAuthority?: string

  cin?: string
  lei?: string
  cik?: string
  companyNumber?: string

  status: CompanyStatus
}

// ── Source provenance (Section 9) ───────────────────────────────────
// Every fact this system knows must trace back to one of these. A single
// NormalizedCompanyRecord always carries exactly one provenance block (its
// own provider's) — cross-provider provenance (which provider said what,
// when facts conflict) lives at the company_source_records table level,
// not in this in-memory type; identity.ts reads multiple
// NormalizedCompanyRecord[] (one per contributing provider) to do that
// reconciliation, it never mutates one record's provenance to point at a
// different provider.
export interface SourceProvenance {
  sourceProvider: ProviderName
  sourceRecordId: string
  sourceType: 'api' | 'bulk'
  sourceUrl?: string
  sourceLastUpdated?: string // ISO 8601, as reported BY the source (e.g. a filing date), not retrievedAt
  retrievedAt: string        // ISO 8601, when Demaze fetched this
  rawData: unknown           // the parsed-but-unnormalized provider record, verbatim
}

// One provider's normalized view of one company — the unit every adapter's
// search()/getCompany()/bulkIngest() callback produces, and the unit
// ingestion.ts feeds into identity.ts for cross-provider resolution.
export interface NormalizedCompanyRecord {
  fields: CanonicalCompanyFields
  provenance: SourceProvenance
}

// ── Query model (Section 16) ────────────────────────────────────────
// "Normalize user-facing ICP criteria into provider-specific filters. If a
// provider cannot support a filter, don't pretend it can." Every field is
// optional — a provider applies whichever subset it can and reports the
// rest back as `unsupportedFilters` rather than silently ignoring them.
export interface CompanySearchQuery {
  name?: string
  country?: string       // free-text country name, e.g. "India"
  countryCode?: string   // ISO 3166-1 alpha-2, e.g. "IN", "GB", "US"
  industry?: string
  sicCodes?: string[]
  naicsCodes?: string[]
  employeeCountMin?: number
  employeeCountMax?: number
  status?: CompanyStatus
  limit?: number
}

export interface ProviderSearchResult {
  records: NormalizedCompanyRecord[]
  // Which of the query's fields this provider actually applied server-side
  // vs. could not support (Section 16's "don't pretend it can" — the
  // caller, not this provider, is responsible for local/research-based
  // filtering on anything listed in unsupportedFilters).
  appliedFilters: string[]
  unsupportedFilters: string[]
  totalAvailable?: number
  // Opaque provider-specific pagination token — never parsed by callers,
  // only round-tripped back into a follow-up search() call.
  nextCursor?: string
  // Present only on a genuine failure (network/parse/rate-limit exhaustion)
  // — an empty `records` array with no `error` means "searched
  // successfully, found nothing," a meaningfully different outcome from
  // "the search itself failed." Same distinction discipline as every other
  // discovery module in this repo (CompanyDiscoveryResult.sufficiency).
  error?: string
}

export interface CompanyLookupIdentifier {
  lei?: string
  cik?: string
  cin?: string
  companyNumber?: string
  registrationAuthority?: string
  name?: string
  domain?: string
}

// ── Health (Section 25) ─────────────────────────────────────────────
export interface ProviderHealthCheckResult {
  provider: ProviderName
  healthy: boolean
  // false when the provider needs an API key/token that isn't configured —
  // distinct from `healthy: false`, which means "configured but currently
  // failing" (e.g. a real outage or exhausted quota). A caller degrading
  // gracefully (Section 5's "must degrade gracefully rather than blocking
  // the entire discovery engine") checks `configured` first.
  configured: boolean
  reason?: string
  latencyMs?: number
}

// ── Bulk ingestion (Section 4/11) ───────────────────────────────────
// Only providers with capabilities.bulkIngest = true implement this. A
// provider streams normalized records in batches via onBatch rather than
// returning a single giant array — Section 11's "do not hold entire
// dataset in RAM" applies to the in-memory representation just as much as
// the wire format.
export interface BulkIngestSource {
  // Local file path (already downloaded) OR a remote URL the adapter should
  // stream from directly — never held fully in memory either way. Which one
  // a given provider expects is documented on that provider's own
  // bulkIngest() signature comment.
  filePath?: string
  url?: string
  // Resume cursor from a previous, interrupted run's
  // company_universe_ingestion_runs.checkpoint — provider-specific shape,
  // opaque to everything except that one provider's own bulkIngest().
  checkpoint?: unknown
}

export interface BulkIngestBatchResult {
  fetched: number
  parsed: number
  rejected: number
}

export interface BulkIngestSummary {
  totalFetched: number
  totalParsed: number
  totalRejected: number
  checkpoint?: unknown // final cursor, for a deliberate stop/resume (Section 33's "small controlled pilot")
  error?: string
}

// ── The provider abstraction itself (Section 7) ─────────────────────
export interface CompanyDataProvider {
  name: ProviderName
  displayName: string
  capabilities: ProviderCapabilities

  healthCheck(): Promise<ProviderHealthCheckResult>

  // Present on every provider (capabilities.search may still be false for a
  // provider that can only do point lookups — callers must check
  // capabilities.search before calling, calling when unsupported is a
  // programmer error, not a soft-fail case).
  search(query: CompanySearchQuery): Promise<ProviderSearchResult>

  getCompany(identifier: CompanyLookupIdentifier): Promise<NormalizedCompanyRecord | null>

  // Optional — only present when capabilities.bulkIngest is true.
  // `onBatch` is awaited between batches, both so the caller can persist
  // (upsert) incrementally per Section 10's checkpointing requirement, and
  // so a slow database write applies real backpressure on how fast the
  // adapter reads the next batch, rather than buffering ahead of it.
  bulkIngest?(
    source: BulkIngestSource,
    onBatch: (records: NormalizedCompanyRecord[]) => Promise<BulkIngestBatchResult | void>
  ): Promise<BulkIngestSummary>
}
