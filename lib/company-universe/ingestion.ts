// ============================================================
// Company Universe — ingestion pipeline
// ============================================================
// Demaze_Multi_Source_Company_Universe_Claude_Prompt.md, Section 10:
// SOURCE -> FETCH -> PARSE -> NORMALIZE -> VALIDATE -> IDENTITY MATCH ->
// UPSERT -> SOURCE PROVENANCE. FETCH/PARSE/NORMALIZE are each provider's
// own job (lib/company-universe/providers/*.ts already return
// NormalizedCompanyRecord[] — parsed and normalized); this file is
// VALIDATE -> IDENTITY MATCH -> UPSERT -> PROVENANCE, plus the health/
// metrics logging (Section 25) and the local-first query layer (Section 21)
// that makes company_universe queryable without hitting a provider on
// every discovery request.
//
// Impure by design (Supabase I/O throughout) — same split as
// lib/outbound/warmup/engine/run-tick.ts vs. tick-logic.ts: the actual
// matching DECISION (lib/company-universe/identity.ts) stays pure and
// unit-testable; this file is the orchestration/persistence layer around
// it, following the ReturnType<typeof createServerClient> convention that
// file already established for a Supabase-client parameter.
// ============================================================

import { createServerClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import {
  resolveIdentity,
  mergeCanonicalFields,
  normalizeDomain,
  normalizeCompanyName,
  significantWords,
  type ExistingCompanyIdentitySlice,
} from './identity'
import type {
  CanonicalCompanyFields,
  NormalizedCompanyRecord,
  ProviderName,
  CompanySearchQuery,
  CompanyDataProvider,
  BulkIngestSource,
} from './types'

type SupabaseClient = ReturnType<typeof createServerClient>

const SCOPE = 'CompanyUniverse:Ingestion'

// ── Validation (Section 10's VALIDATE stage) ────────────────────────
// Deliberately minimal — "do not manufacture values" (Section 17) applies
// here too: this rejects genuinely unusable records (no name at all), it
// does not try to second-guess a provider's own data quality beyond that.
function isValidRecord(fields: CanonicalCompanyFields): boolean {
  return typeof fields.canonicalName === 'string' && fields.canonicalName.trim().length > 0
}

// ── Confidence ranking, for "never downgrade a canonical record's
// data_confidence just because a later, weaker-matched provider merged
// into it" ───────────────────────────────────────────────────────────
const CONFIDENCE_RANK: Record<string, number> = {
  deterministic_id: 3,
  fuzzy_name_domain: 2,
  fuzzy_name_country: 1,
  single_source: 0,
}

interface CompanyUniverseRow {
  id: string
  canonical_name: string
  legal_name: string | null
  trade_name: string | null
  domain: string | null
  country: string | null
  country_code: string | null
  state_region: string | null
  city: string | null
  registered_address: string | null
  company_type: string | null
  entity_type: string | null
  industry: string | null
  industry_codes: string[]
  sic_codes: string[]
  naics_codes: string[]
  employee_count: number | null
  employee_count_min: number | null
  employee_count_max: number | null
  revenue: number | null
  revenue_currency: string | null
  revenue_year: number | null
  founded_year: number | null
  registration_id: string | null
  registration_authority: string | null
  cin: string | null
  lei: string | null
  cik: string | null
  company_number: string | null
  status: string
  source_providers: string[]
  data_confidence: string
}

function rowToSlice(row: CompanyUniverseRow): ExistingCompanyIdentitySlice {
  return {
    id: row.id,
    lei: row.lei ?? undefined,
    cik: row.cik ?? undefined,
    cin: row.cin ?? undefined,
    companyNumber: row.company_number ?? undefined,
    registrationAuthority: row.registration_authority ?? undefined,
    domain: row.domain ?? undefined,
    canonicalName: row.canonical_name,
    legalName: row.legal_name ?? undefined,
    countryCode: row.country_code ?? undefined,
  }
}

function rowToFields(row: CompanyUniverseRow): CanonicalCompanyFields {
  return {
    canonicalName: row.canonical_name,
    legalName: row.legal_name ?? undefined,
    tradeName: row.trade_name ?? undefined,
    domain: row.domain ?? undefined,
    country: row.country ?? undefined,
    countryCode: row.country_code ?? undefined,
    stateRegion: row.state_region ?? undefined,
    city: row.city ?? undefined,
    registeredAddress: row.registered_address ?? undefined,
    companyType: row.company_type ?? undefined,
    entityType: row.entity_type ?? undefined,
    industry: row.industry ?? undefined,
    industryCodes: row.industry_codes ?? [],
    sicCodes: row.sic_codes ?? [],
    naicsCodes: row.naics_codes ?? [],
    employeeCount: row.employee_count ?? undefined,
    employeeCountMin: row.employee_count_min ?? undefined,
    employeeCountMax: row.employee_count_max ?? undefined,
    revenue: row.revenue ?? undefined,
    revenueCurrency: row.revenue_currency ?? undefined,
    revenueYear: row.revenue_year ?? undefined,
    foundedYear: row.founded_year ?? undefined,
    registrationId: row.registration_id ?? undefined,
    registrationAuthority: row.registration_authority ?? undefined,
    cin: row.cin ?? undefined,
    lei: row.lei ?? undefined,
    cik: row.cik ?? undefined,
    companyNumber: row.company_number ?? undefined,
    status: (row.status as CanonicalCompanyFields['status']) ?? 'unknown',
  }
}

function fieldsToRow(fields: CanonicalCompanyFields): Record<string, unknown> {
  return {
    canonical_name: fields.canonicalName,
    legal_name: fields.legalName ?? null,
    trade_name: fields.tradeName ?? null,
    domain: fields.domain ? normalizeDomain(fields.domain) : null,
    country: fields.country ?? null,
    country_code: fields.countryCode ?? null,
    state_region: fields.stateRegion ?? null,
    city: fields.city ?? null,
    registered_address: fields.registeredAddress ?? null,
    company_type: fields.companyType ?? null,
    entity_type: fields.entityType ?? null,
    industry: fields.industry ?? null,
    industry_codes: fields.industryCodes ?? [],
    sic_codes: fields.sicCodes ?? [],
    naics_codes: fields.naicsCodes ?? [],
    employee_count: fields.employeeCount ?? null,
    employee_count_min: fields.employeeCountMin ?? null,
    employee_count_max: fields.employeeCountMax ?? null,
    revenue: fields.revenue ?? null,
    revenue_currency: fields.revenueCurrency ?? null,
    revenue_year: fields.revenueYear ?? null,
    founded_year: fields.foundedYear ?? null,
    registration_id: fields.registrationId ?? null,
    registration_authority: fields.registrationAuthority ?? null,
    cin: fields.cin ?? null,
    lei: fields.lei ?? null,
    cik: fields.cik ?? null,
    company_number: fields.companyNumber ?? null,
    status: fields.status,
  }
}

// Escapes a value for safe interpolation into a PostgREST `.or()` filter
// string — deterministic IDs (LEI/CIK/CIN/company numbers) are checked
// against a strict alphanumeric+punctuation shape rather than a general
// escaper; any candidate value containing a comma/parenthesis (which would
// break PostgREST's or-list syntax) is simply excluded from the query
// instead of risking a malformed filter.
const SAFE_OR_VALUE = /^[A-Za-z0-9._\- ]+$/

function safeOrValue(v: string | undefined): string | null {
  if (!v) return null
  return SAFE_OR_VALUE.test(v) ? v : null
}

/**
 * Fetches existing company_universe rows that are plausible identity-match
 * candidates for `fields` — every deterministic identifier present, plus a
 * domain match, plus (only when NEITHER an identifier nor a domain is
 * present on the incoming record) a small, capped name-prefix search so the
 * fuzzy_name_country tier in identity.ts has a real chance to fire. This is
 * the only place in this pipeline that queries company_universe broadly;
 * resolveIdentity() itself never touches the database (kept pure/testable).
 */
async function fetchIdentityCandidates(
  supabase: SupabaseClient,
  fields: CanonicalCompanyFields
): Promise<ExistingCompanyIdentitySlice[]> {
  const orClauses: string[] = []
  const lei = safeOrValue(fields.lei)
  const cik = safeOrValue(fields.cik)
  const cin = safeOrValue(fields.cin)
  const companyNumber = safeOrValue(fields.companyNumber)
  const registrationAuthority = safeOrValue(fields.registrationAuthority)
  const domain = fields.domain ? normalizeDomain(fields.domain) : null

  if (lei) orClauses.push(`lei.eq.${lei}`)
  if (cik) orClauses.push(`cik.eq.${cik}`)
  if (cin) orClauses.push(`cin.eq.${cin}`)
  if (companyNumber && registrationAuthority) orClauses.push(`and(company_number.eq.${companyNumber},registration_authority.eq.${registrationAuthority})`)
  if (domain) orClauses.push(`domain.eq.${domain}`)

  if (orClauses.length > 0) {
    const { data, error } = await supabase
      .from('company_universe')
      .select('id, lei, cik, cin, company_number, registration_authority, domain, canonical_name, legal_name, country_code')
      .or(orClauses.join(','))
      .limit(10)
    if (error) {
      logger.warn(SCOPE, 'identity candidate lookup failed, treating as no candidates (fails toward "create new," never a wrong merge)', { error: error.message })
      return []
    }
    return (data ?? []).map(rowToSlice as (r: unknown) => ExistingCompanyIdentitySlice)
  }

  // No identifier and no domain — the only case identity.ts's
  // fuzzy_name_country tier can possibly apply. A small, capped ilike
  // prefix search on the first significant word of the normalized name;
  // NOT a full-text/trigram search (no such index exists on this table,
  // deliberately not added — Section 35's "don't create dozens of
  // unnecessary indexes" for a tier this narrow).
  const normalized = normalizeCompanyName(fields.canonicalName)
  const words = significantWords(normalized)
  if (words.length < 2) return [] // same single-word-name guard as every other discovery module in this repo

  const { data, error } = await supabase
    .from('company_universe')
    .select('id, lei, cik, cin, company_number, registration_authority, domain, canonical_name, legal_name, country_code')
    .ilike('canonical_name', `%${words[0]}%`)
    .limit(20)
  if (error) return []
  return (data ?? []).map(rowToSlice as (r: unknown) => ExistingCompanyIdentitySlice)
}

export type IngestOutcome = 'inserted' | 'updated' | 'conflict' | 'rejected'

/**
 * VALIDATE -> IDENTITY MATCH -> UPSERT -> PROVENANCE for one normalized
 * record. Re-run safe: running the same provider record through this twice
 * upserts (not duplicates) both the company_source_records row (unique on
 * provider+source_record_id) and, for a genuine re-run of the SAME record,
 * resolves back to the SAME canonical company via its own deterministic
 * identifier (which is now present on that row from the first run).
 */
export async function ingestOneRecord(
  supabase: SupabaseClient,
  record: NormalizedCompanyRecord
): Promise<{ outcome: IngestOutcome; companyUniverseId?: string; reason: string }> {
  if (!isValidRecord(record.fields)) {
    return { outcome: 'rejected', reason: 'no canonical name on the normalized record' }
  }

  const candidates = await fetchIdentityCandidates(supabase, record.fields)
  const identity = resolveIdentity(record.fields, candidates)

  let companyUniverseId: string | undefined
  let outcome: IngestOutcome
  let reason: string

  if (identity.outcome === 'conflict') {
    // Never guess — create a standalone new canonical row for this
    // provider's evidence rather than linking to either disputed
    // candidate. The conflict itself is logged for visibility, per
    // Section 25's "Demaze should know... rather than silently returning
    // incomplete discovery."
    logger.warn(SCOPE, 'identity conflict — not auto-merging', { candidateIds: identity.candidateIds, name: record.fields.canonicalName, reason: identity.reason })
    const { data, error } = await supabase
      .from('company_universe')
      .insert({ ...fieldsToRow(record.fields), source_providers: [record.provenance.sourceProvider], data_confidence: 'single_source', source_last_updated: record.provenance.sourceLastUpdated ?? null })
      .select('id')
      .single()
    if (error) return { outcome: 'rejected', reason: `insert failed after identity conflict: ${error.message}` }
    companyUniverseId = data.id
    outcome = 'conflict'
    reason = identity.reason
  } else if (identity.outcome === 'no_match') {
    const { data, error } = await supabase
      .from('company_universe')
      .insert({ ...fieldsToRow(record.fields), source_providers: [record.provenance.sourceProvider], data_confidence: 'single_source', source_last_updated: record.provenance.sourceLastUpdated ?? null })
      .select('id')
      .single()
    if (error) return { outcome: 'rejected', reason: `insert failed: ${error.message}` }
    companyUniverseId = data.id
    outcome = 'inserted'
    reason = 'no existing match — new canonical company'
  } else {
    const { data: existingRow, error: fetchError } = await supabase
      .from('company_universe')
      .select('*')
      .eq('id', identity.existingId)
      .single()
    if (fetchError || !existingRow) {
      return { outcome: 'rejected', reason: `matched company ${identity.existingId} but could not re-fetch it: ${fetchError?.message}` }
    }
    const existingFields = rowToFields(existingRow as CompanyUniverseRow)
    const existingProviders = (existingRow.source_providers as ProviderName[]) ?? []
    const merged = mergeCanonicalFields(existingFields, record.fields, record.provenance.sourceProvider, existingProviders)
    const newProviders = existingProviders.includes(record.provenance.sourceProvider)
      ? existingProviders
      : [...existingProviders, record.provenance.sourceProvider]
    const currentConfidenceRank = CONFIDENCE_RANK[existingRow.data_confidence as string] ?? 0
    const newMatchRank = CONFIDENCE_RANK[identity.confidence] ?? 0
    const dataConfidence = newMatchRank > currentConfidenceRank ? identity.confidence : existingRow.data_confidence

    const { error: updateError } = await supabase
      .from('company_universe')
      .update({
        ...fieldsToRow(merged),
        source_providers: newProviders,
        data_confidence: dataConfidence,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', identity.existingId)
    if (updateError) return { outcome: 'rejected', reason: `update failed: ${updateError.message}` }
    companyUniverseId = identity.existingId
    outcome = 'updated'
    reason = identity.reason
  }

  const { error: sourceError } = await supabase
    .from('company_source_records')
    .upsert(
      {
        source_provider: record.provenance.sourceProvider,
        source_record_id: record.provenance.sourceRecordId,
        source_type: record.provenance.sourceType,
        source_url: record.provenance.sourceUrl ?? null,
        raw_data: record.provenance.rawData as object,
        source_last_updated: record.provenance.sourceLastUpdated ?? null,
        retrieved_at: record.provenance.retrievedAt,
        company_universe_id: companyUniverseId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'source_provider,source_record_id' }
    )
  if (sourceError) {
    logger.warn(SCOPE, 'company_source_records upsert failed (canonical row was still written)', { error: sourceError.message })
  }

  return { outcome, companyUniverseId, reason }
}

export interface IngestBatchSummary {
  fetched: number
  parsed: number
  inserted: number
  updated: number
  conflicts: number
  rejected: number
}

export async function ingestBatch(supabase: SupabaseClient, records: NormalizedCompanyRecord[]): Promise<IngestBatchSummary> {
  const summary: IngestBatchSummary = { fetched: records.length, parsed: 0, inserted: 0, updated: 0, conflicts: 0, rejected: 0 }
  // Sequential, not Promise.all — same "respect real quota/DB write
  // pressure, don't parallelize aggressively" discipline as every other
  // batch loop in this codebase (Section 23's "do not parallelize
  // aggressively" applies to database write pressure here, not just
  // provider API calls).
  for (const record of records) {
    const result = await ingestOneRecord(supabase, record)
    if (result.outcome === 'rejected') summary.rejected++
    else {
      summary.parsed++
      if (result.outcome === 'inserted') summary.inserted++
      else if (result.outcome === 'updated') summary.updated++
      else if (result.outcome === 'conflict') summary.conflicts++
    }
  }
  return summary
}

// ── Ingestion-run health/metrics logging (Section 25) ───────────────

export async function startIngestionRun(
  supabase: SupabaseClient,
  provider: ProviderName,
  runType: 'initial' | 'incremental' | 'search'
): Promise<string | null> {
  const { data, error } = await supabase
    .from('company_universe_ingestion_runs')
    .insert({ provider, run_type: runType, status: 'running' })
    .select('id')
    .single()
  if (error) {
    logger.warn(SCOPE, 'could not create ingestion run row (ingestion will still proceed, just without a health record)', { provider, error: error.message })
    return null
  }
  return data.id
}

export async function finishIngestionRun(
  supabase: SupabaseClient,
  runId: string | null,
  patch: {
    status: 'succeeded' | 'failed' | 'partial'
    recordsFetched: number
    recordsParsed: number
    recordsRejected: number
    recordsInserted: number
    recordsUpdated: number
    recordsDeduplicated: number
    apiCalls?: number
    rateLimitedCount?: number
    timeoutCount?: number
    checkpoint?: unknown
    error?: string
  }
): Promise<void> {
  if (!runId) return
  const { error } = await supabase
    .from('company_universe_ingestion_runs')
    .update({
      status: patch.status,
      records_fetched: patch.recordsFetched,
      records_parsed: patch.recordsParsed,
      records_rejected: patch.recordsRejected,
      records_inserted: patch.recordsInserted,
      records_updated: patch.recordsUpdated,
      records_deduplicated: patch.recordsDeduplicated,
      api_calls: patch.apiCalls ?? 0,
      rate_limited_count: patch.rateLimitedCount ?? 0,
      timeout_count: patch.timeoutCount ?? 0,
      checkpoint: patch.checkpoint ?? null,
      error: patch.error ?? null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId)
  if (error) logger.warn(SCOPE, 'could not finalize ingestion run row', { runId, error: error.message })
}

/**
 * Runs a live search() against one provider and ingests every result —
 * used both for an on-demand discovery query (Section 21: query local
 * first, hit providers "for... missing data") and as the small-scale path
 * for a provider with no bulkIngest support (India MCA).
 * Returns the ingested records' resulting canonical ids alongside the raw
 * search records, so a caller doing a live discovery request gets useful
 * results immediately rather than having to re-query company_universe
 * right after writing to it.
 */
export async function runProviderSearch(
  supabase: SupabaseClient,
  provider: CompanyDataProvider,
  query: CompanySearchQuery
): Promise<{ result: Awaited<ReturnType<CompanyDataProvider['search']>>; summary: IngestBatchSummary }> {
  if (!provider.capabilities.search) {
    return {
      result: { records: [], appliedFilters: [], unsupportedFilters: [], error: `${provider.displayName} does not support search()` },
      summary: { fetched: 0, parsed: 0, inserted: 0, updated: 0, conflicts: 0, rejected: 0 },
    }
  }

  const runId = await startIngestionRun(supabase, provider.name, 'search')
  const result = await provider.search(query)
  const summary = result.error
    ? { fetched: 0, parsed: 0, inserted: 0, updated: 0, conflicts: 0, rejected: 0 }
    : await ingestBatch(supabase, result.records)

  await finishIngestionRun(supabase, runId, {
    status: result.error ? 'failed' : 'succeeded',
    recordsFetched: summary.fetched,
    recordsParsed: summary.parsed,
    recordsRejected: summary.rejected,
    recordsInserted: summary.inserted,
    recordsUpdated: summary.updated,
    recordsDeduplicated: summary.conflicts,
    apiCalls: 1,
    error: result.error,
  })

  return { result, summary }
}

/**
 * Runs a provider's bulkIngest() (only for providers with
 * capabilities.bulkIngest = true), ingesting each batch as it streams in
 * and periodically checkpointing the run row so a later session can resume
 * (Section 10's "record 4,000 of 10,000 fails, don't lose the previous
 * 3,999") — the checkpoint written here is whatever the provider itself
 * returns in BulkIngestSummary.checkpoint; this function does not invent
 * its own cursor format, since only the provider's own bulkIngest() knows
 * how to resume its particular source shape.
 */
export async function runProviderBulkIngest(
  supabase: SupabaseClient,
  provider: CompanyDataProvider,
  source: BulkIngestSource,
  runType: 'initial' | 'incremental' = 'initial'
): Promise<{ totalFetched: number; totalParsed: number; totalInserted: number; totalUpdated: number; totalConflicts: number; totalRejected: number; error?: string }> {
  if (!provider.capabilities.bulkIngest || !provider.bulkIngest) {
    return { totalFetched: 0, totalParsed: 0, totalInserted: 0, totalUpdated: 0, totalConflicts: 0, totalRejected: 0, error: `${provider.displayName} does not support bulkIngest()` }
  }

  const runId = await startIngestionRun(supabase, provider.name, runType)
  let totalInserted = 0
  let totalUpdated = 0
  let totalConflicts = 0
  let totalRejectedFromIngest = 0

  const outcome = await provider.bulkIngest(source, async (records) => {
    const summary = await ingestBatch(supabase, records)
    totalInserted += summary.inserted
    totalUpdated += summary.updated
    totalConflicts += summary.conflicts
    totalRejectedFromIngest += summary.rejected
    return { fetched: records.length, parsed: summary.parsed, rejected: summary.rejected }
  })

  await finishIngestionRun(supabase, runId, {
    status: outcome.error ? 'partial' : 'succeeded',
    recordsFetched: outcome.totalFetched,
    recordsParsed: outcome.totalParsed,
    recordsRejected: outcome.totalRejected + totalRejectedFromIngest,
    recordsInserted: totalInserted,
    recordsUpdated: totalUpdated,
    recordsDeduplicated: totalConflicts,
    checkpoint: outcome.checkpoint,
    error: outcome.error,
  })

  return {
    totalFetched: outcome.totalFetched,
    totalParsed: outcome.totalParsed,
    totalInserted,
    totalUpdated,
    totalConflicts,
    totalRejected: outcome.totalRejected + totalRejectedFromIngest,
    error: outcome.error,
  }
}

// ── Local-first query layer (Section 21) ────────────────────────────
// Queries the already-ingested company_universe table directly — Section
// 21: "Discovery should query the local canonical database first...
// external providers are used for initial ingestion, refresh, new
// jurisdictions, missing data, verification." The Company Discovery
// Engine integration (lib/enrichment/company-discovery.ts) calls this
// BEFORE deciding whether to also call a provider's live search().
export interface LocalUniverseCompany {
  id: string
  fields: CanonicalCompanyFields
  sourceProviders: ProviderName[]
  dataConfidence: string
}

export async function queryLocalCompanyUniverse(
  supabase: SupabaseClient,
  query: CompanySearchQuery
): Promise<LocalUniverseCompany[]> {
  let q = supabase.from('company_universe').select('*')

  if (query.name) q = q.ilike('canonical_name', `%${query.name}%`)
  if (query.countryCode) q = q.eq('country_code', query.countryCode.toUpperCase())
  if (query.industry) q = q.ilike('industry', `%${query.industry}%`)
  if (query.status) q = q.eq('status', query.status)
  if (query.employeeCountMin !== undefined) q = q.gte('employee_count', query.employeeCountMin)
  if (query.employeeCountMax !== undefined) q = q.lte('employee_count', query.employeeCountMax)
  if (query.sicCodes?.length) q = q.overlaps('sic_codes', query.sicCodes)
  if (query.naicsCodes?.length) q = q.overlaps('naics_codes', query.naicsCodes)

  q = q.limit(query.limit ?? 25)

  const { data, error } = await q
  if (error) {
    logger.warn(SCOPE, 'local company_universe query failed', { error: error.message })
    return []
  }

  return (data ?? []).map((row) => {
    const r = row as CompanyUniverseRow
    return {
      id: r.id,
      fields: rowToFields(r),
      sourceProviders: (r.source_providers as ProviderName[]) ?? [],
      dataConfidence: r.data_confidence,
    }
  })
}
